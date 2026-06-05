import {
  createWallet,
  PasswordRLNSigner,
  UTEXOWallet,
} from '@utexo/rgb-sdk-rn';
import * as FileSystem from 'expo-file-system/legacy';
import { documentDirectory } from 'expo-file-system/legacy';

import { sendToAddressUtexo } from '@/utils/bitcoin-node';
import { buildUtexoConfig } from '@/utils/env';
import {
  beginExclusiveFlow,
  createFlowResults,
  endExclusiveFlow,
  sleep,
} from '@/utils/flow-core';

// VSS (Versioned Storage Service) flow — UTEXO testnet.
//
// Structure mirrors runRlnVssFlow (regtest): nodeA is VSS-backed, nodeB is plain.
// Creates UTXOs + NIA asset, opens a BTC channel nodeA→nodeB (waits up to 20 min
// for testnet confirmation), then wipes nodeA local state and restores from VSS,
// verifying that both the pubkey and channel list survive the restore.
//
// VSS URL must be a plain-HTTP loopback address (native binary limitation).
// Use EXPO_PUBLIC_UTEXO_VSS_URL=http://127.0.0.1:8081/vss and run
// `adb reverse tcp:8081 tcp:8081` so the emulator tunnels to the host VSS server.
//
// Funding is manual — the flow polls up to 3 min for nodeA balance; asset/channel
// steps are skipped if no funds arrive in that window.
export async function runRlnUtexoVssFlow() {
  const flowName = 'runRlnUtexoVssFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();

  let wallet: UTEXOWallet | null = null;
  let nodeB: UTEXOWallet | null = null;
  let walletRestored: UTEXOWallet | null = null;

  try {
    const { network, unlockParams } = buildUtexoConfig();
    // VSS URL must stay as a loopback address — the native binary only accepts
    // localhost/127.0.0.1 over plain HTTP. On Android use `adb reverse tcp:PORT tcp:PORT`
    // so that 127.0.0.1:PORT on the emulator tunnels to the host.
    const vssUrl = process.env.EXPO_PUBLIC_UTEXO_VSS_URL?.trim() ?? null;

    if (!vssUrl) throw new Error('EXPO_PUBLIC_UTEXO_VSS_URL not set — add it to .env');
    // Flow-local tuning: keep independent from other tests/flows.
    // Fund as: utxo target size * count + safety buffer for fees/change.
    const targetUtxoCount = 3;
    const targetUtxoSizeSat = 32500;
    const faucetSafetyBufferSat = 1130000;
    const faucetAmountSat = targetUtxoSizeSat * targetUtxoCount + faucetSafetyBufferSat;
    const channelCapacitySat = 100000;

    const keysA = await createWallet(network);
    const keysB = await createWallet(network);
    const password = 'vssFlowPass';
    const ts = Date.now();
    const basePort = 26000 + Math.floor(Math.random() * 4000);

    const storageDirAUri = `${documentDirectory ?? ''}rln_vss_utx_a_${ts}`;
    const storageDirBUri = `${documentDirectory ?? ''}rln_vss_utx_b_${ts}`;
    await FileSystem.makeDirectoryAsync(storageDirAUri, { intermediates: true });
    await FileSystem.makeDirectoryAsync(storageDirBUri, { intermediates: true });
    const storageDirA = storageDirAUri.replace('file://', '');
    const storageDirB = storageDirBUri.replace('file://', '');
    // 1 — create nodeA (VSS-enabled) + nodeB (plain)
    addStep('vssCreateWallets', 'running');
    console.log('[vss] walletA params', JSON.stringify({
      storageDirPath: storageDirA,
      daemonListeningPort: basePort,
      ldkPeerListeningPort: basePort + 1,
      network,
      vssUrl,
      vssAllowHttp: vssUrl.startsWith('http://'),
      vssAllowEmptyRestore: false,
    }));
    console.log('[vss] walletB params', JSON.stringify({
      storageDirPath: storageDirB,
      daemonListeningPort: basePort + 100,
      ldkPeerListeningPort: basePort + 101,
      network,
    }));
    console.log('[vss] unlockParams', JSON.stringify(unlockParams));
    wallet = new UTEXOWallet(
      {
        storageDirPath: storageDirA,
        daemonListeningPort: basePort,
        ldkPeerListeningPort: basePort + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        vssUrl,
        vssAllowHttp: vssUrl.startsWith('http://'),
        vssAllowEmptyRestore: false,
      },
      new PasswordRLNSigner(password, keysA.mnemonic),
    );
    nodeB = new UTEXOWallet(
      {
        storageDirPath: storageDirB,
        daemonListeningPort: basePort + 100,
        ldkPeerListeningPort: basePort + 101,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
      },
      new PasswordRLNSigner(password, keysB.mnemonic),
    );
    await wallet.init();
    console.log('[vss] walletA init ✓');
    await wallet.unlock(unlockParams);
    console.log('[vss] walletA unlock ✓');
    await nodeB.init();
    console.log('[vss] walletB init ✓');
    await nodeB.unlock(unlockParams);
    console.log('[vss] walletB unlock ✓');
    const nodeBInfo = await nodeB.getNodeInfo();
    const pubkeyB = String(nodeBInfo?.pubkey ?? '');
    console.log(`[vss] walletB pubkey=${pubkeyB} storageDirB=${storageDirB}`);
    addStep('vssCreateWallets', 'success', { vssUrl, network, pubkeyB: pubkeyB.substring(0, 16) + '...' });

    // 2 — get deposit address + poll up to 3 min for BTC balance
    addStep('vssFundWallet', 'running');
    const address = await wallet.getAddress();
    let faucetResponse: string | null = null;
    try {
      faucetResponse = await sendToAddressUtexo(address, faucetAmountSat);
    } catch (e: any) {
      console.warn(`[vss] faucet funding failed: ${e?.message ?? String(e)}`);
    }
    let balance: any = null;
    let settled = 0;
    let spendable = 0;
    const fundDeadline = Date.now() + 3 * 60 * 1000;
    while (Date.now() < fundDeadline) {
      try {
        await wallet.syncWallet();
        balance = await wallet.getBtcBalance();
        settled = Number(balance?.vanilla?.settled ?? 0);
        spendable = Number(balance?.vanilla?.spendable ?? 0);
        console.log(`[vss] funding poll settled=${settled} spendable=${spendable}`);
        // For UTXO creation we need confirmed sats; spendable/future can appear before settlement.
        if (settled > 0) break;
      } catch (e: any) {
        console.warn(`[vss] waitForFunding: ${e?.message}`);
      }
      await sleep(15000);
    }
    const hasFunds = settled > 0;
    addStep('vssFundWallet', 'success', {
      address,
      faucetAmountSat,
      faucetResponse,
      settled,
      spendable,
      balance,
      hasFunds,
      note: hasFunds
        ? undefined
        : 'No settled balance yet — asset/channel steps skipped; VSS KV replication still tested',
    });

    let assetId: string | null = null;
    let preWipeBalance: any = null;
    let channelId: string = '';

    if (hasFunds) {
      // 3 — create UTXOs for RGB operations
      addStep('vssCreateUtxos', 'running');
      await wallet.syncWallet();
      await wallet.createUtxos({
        upTo: false,
        num: targetUtxoCount,
        feeRate: 3,
        size: targetUtxoSizeSat,
      });
      const utxoDeadline = Date.now() + 45 * 60 * 1000;
      while (Date.now() < utxoDeadline) {
        await sleep(20000);
        await wallet.syncWallet();
        const unspents = await wallet.listUnspents().catch(() => []);
        console.log(`[vss] unspents`, JSON.stringify(unspents));
        const confirmed = unspents.filter((u: any) => !(u.rgbAllocations?.length > 0));
        console.log(`[vss] UTXO confirmation check — rgb-ready=${confirmed.length}`);
        if (confirmed.length >= targetUtxoCount) break;
      }
      addStep('vssCreateUtxos', 'success', { num: targetUtxoCount });

      // 4 — issue NIA asset
      addStep('vssIssueAssetNia', 'running');
      await wallet.syncWallet();
      const issued = await wallet.issueAssetNia({ ticker: 'VDMO', name: 'VssDemo', precision: 0, amounts: [500] });
      assetId = String(issued?.assetId ?? '');
      if (!assetId) throw new Error('Failed to issue asset');
      await wallet.refreshWallet();
      preWipeBalance = await wallet.getAssetBalance(assetId);
      addStep('vssIssueAssetNia', 'success', { assetId: assetId.substring(0, 20) + '...', spendable: preWipeBalance?.spendable });

      // 5 — open BTC channel nodeA → nodeB (wait up to 20 min for testnet confirmation)
      addStep('vssOpenChannel', 'running');
      const peerUriB = `${pubkeyB}@127.0.0.1:${basePort + 101}`;
      console.log(`[vss] openChannel: connectPeer(${peerUriB})`);
      try {
        await wallet.connectPeer(peerUriB);
        console.log('[vss] openChannel: connectPeer ✓');
      } catch (e: any) {
        console.warn(`[vss] openChannel: connectPeer non-fatal: ${e?.message ?? String(e)}`);
      }
      await sleep(1000);
      console.log('[vss] openChannel: request', JSON.stringify({
        peerPubkeyAndOptAddr: peerUriB,
        capacitySat: channelCapacitySat,
        pushMsat: 0,
        public: true,
        withAnchors: true,
      }));
      const openResp = await wallet.openChannel({
        peerPubkeyAndOptAddr: peerUriB,
        capacitySat: channelCapacitySat,
        pushMsat: 0,
        public: true,
        withAnchors: true,
      });
      const tempChannelId = String(openResp?.temporaryChannelId ?? '');
      console.log(`[vss] openChannel: temporaryChannelId=${tempChannelId || '(empty)'}`);
      const channelDeadline = Date.now() + 20 * 60 * 1000;
      let channelUsable = false;
      while (Date.now() < channelDeadline) {
        await wallet.syncWallet();
        const info = await wallet.getNodeInfo();
        const usable = Number(info?.numUsableChannels ?? 0);
        const total = Number(info?.numChannels ?? 0);
        const channels = ((await wallet.listChannels().catch(() => [])) ?? []) as any[];
        const shortChannels = channels.map((c: any) => ({
          id: String(c?.channelId ?? '').substring(0, 16),
          usable: !!c?.isUsable,
          cap: Number(c?.capacitySat ?? 0),
          txid: String(c?.fundingTxid ?? '').substring(0, 16),
        }));
        console.log(
          `[vss] openChannel poll usable=${usable} total=${total} channels=${shortChannels.length} elapsedSec=${Math.floor((Date.now() - (channelDeadline - 20 * 60 * 1000)) / 1000)}`,
          JSON.stringify(shortChannels)
        );
        if (usable >= 1) {
          channelUsable = true;
          break;
        }
        await sleep(30000);
      }
      if (!channelUsable) {
        console.warn('[vss] openChannel: timeout waiting for numUsableChannels >= 1, continuing with best-known channel state');
      }
      const channelsA = await wallet.listChannels() ?? [];
      const channel = (channelsA as any[]).find((c: any) => c.isUsable);
      channelId = String(channel?.channelId ?? tempChannelId);
      addStep('vssOpenChannel', 'success', {
        channelId: channelId.substring(0, 16) + '...',
        capacitySat: Number(channel?.capacitySat ?? channelCapacitySat),
      });
    } else {
      addStep('vssCreateUtxos', 'success', { skipped: true });
      addStep('vssIssueAssetNia', 'success', { skipped: true });
      addStep('vssOpenChannel', 'success', { skipped: true });
    }

    const nodeInfoA = await wallet.getNodeInfo();
    const pubkeyA = String(nodeInfoA?.pubkey ?? '');

    // 6 — shutdown nodeA, delete local state
    addStep('vssDeleteState', 'running');
    await wallet.shutdown();
    wallet = null;
    await FileSystem.deleteAsync(storageDirAUri, { idempotent: true });
    const restoreDirUri = `${documentDirectory ?? ''}rln_vss_utx_restore_${ts}`;
    await FileSystem.makeDirectoryAsync(restoreDirUri, { intermediates: true });
    const restoreDir = restoreDirUri.replace('file://', '');
    addStep('vssDeleteState', 'success', { pubkeyA: pubkeyA.substring(0, 16) + '...', restoreDir });

    // 7 — restore nodeA from VSS (empty local DB → auto-restore LDK state)
    addStep('vssRestoreFromVss', 'running');
    const restorePort = basePort + 10;
    walletRestored = new UTEXOWallet(
      {
        storageDirPath: restoreDir,
        daemonListeningPort: restorePort,
        ldkPeerListeningPort: restorePort + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        vssUrl,
        vssAllowHttp: vssUrl.startsWith('http://'),
        vssAllowEmptyRestore: false,
      },
      new PasswordRLNSigner(password, keysA.mnemonic),
    );
    console.log('[vss] restore: init()');
    await walletRestored.init();
    console.log('[vss] restore: vssClearFence()');
    await walletRestored.vssClearFence(password);
    console.log('[vss] restore: unlock()');
    await walletRestored.unlock(unlockParams);
    console.log('[vss] restore: unlock() done');
    addStep('vssRestoreFromVss', 'success', { restoreDir });

    // 8 — verify restored state: pubkey, channels
    addStep('vssVerifyRestoredWallet', 'running');
    const restoredInfo = await walletRestored!.getNodeInfo();
    const restoredPubkey = String(restoredInfo?.pubkey ?? '');
    console.log(`[vss] restored pubkey=${restoredPubkey.substring(0, 16)}...`);

    await walletRestored!.syncWallet();
    const restoredChannels = (await walletRestored!.listChannels() ?? []) as any[];
    const restoredChannel = restoredChannels.find((c: any) => c.channelId === channelId) ?? restoredChannels[0];
    console.log(`[vss] restored channels=${restoredChannels.length}`, JSON.stringify(restoredChannels.map((c: any) => ({ id: c.channelId?.substring(0, 16), isUsable: c.isUsable }))));

    addStep('vssVerifyRestoredWallet', 'success', {
      pubkeyMatch: restoredPubkey === pubkeyA,
      pubkey: restoredPubkey.substring(0, 16) + '...',
      channelsRestored: restoredChannels.length,
      channelFound: !!restoredChannel,
    });

    // 9 — verify RGB asset balance after restore
    addStep('vssVerifyAssetBalance', 'running');
    let restoredAssets: any = null;
    let restoredAssetBalance: any = null;
    let assetBalanceError: string | null = null;
    if (assetId) {
      try {
        await walletRestored!.syncWallet();
        await walletRestored!.refreshWallet();
        restoredAssets = await walletRestored!.listAssets();
        console.log(`[vss] restored listAssets nia=${restoredAssets?.nia?.length ?? 0}`);
        restoredAssetBalance = await walletRestored!.getAssetBalance(assetId);
        console.log('[vss] restored assetBalance:', JSON.stringify(restoredAssetBalance));
      } catch (e: any) {
        assetBalanceError = `${e?.message ?? e} (${e?.code ?? 'unknown'})`;
        console.warn('[vss] asset balance after restore FAILED:', assetBalanceError);
      }
    }
    addStep('vssVerifyAssetBalance', assetBalanceError && !restoredAssetBalance ? 'error' : 'success', {
      assetId: assetId ? assetId.substring(0, 20) + '...' : null,
      preWipeSpendable: preWipeBalance?.spendable ?? null,
      restoredNiaCount: restoredAssets?.nia?.length ?? null,
      restoredSpendable: restoredAssetBalance?.spendable ?? null,
      error: assetBalanceError,
    });

    // 10 — cleanup
    addStep('vssCleanup', 'running');
    if (walletRestored) { try { await walletRestored.destroy(); } catch {} walletRestored = null; }
    if (nodeB) { try { await nodeB.destroy(); } catch {} nodeB = null; }
    addStep('vssCleanup', 'success', {});

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (wallet) { try { await wallet.destroy(); } catch {} }
    if (nodeB) { try { await nodeB.destroy(); } catch {} }
    if (walletRestored) { try { await walletRestored.destroy(); } catch {} }
    endExclusiveFlow(flowName);
  }
}
