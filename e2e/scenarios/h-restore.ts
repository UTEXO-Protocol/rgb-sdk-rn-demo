/**
 * Scenario H — backup survives device loss, with a channel open (§7a.3).
 *
 * G-style round-trips prove a quiet wallet restores. This one kills the device
 * mid-life: funded, holding an asset, with an open channel that value has
 * already moved through. On rn the wipe is a `shutdown()` plus deleting the
 * storage dir, and the restore is implicit — the node pulls from VSS when the
 * local wallet dir is absent (`maybe_restore_rgb_from_vss`).
 *
 * `allowEmptyRestore` is **false** for the restored node on purpose: it turns a
 * failed restore into a silent fresh start, which would let this scenario pass
 * with an empty wallet.
 *
 * Runs its own wallets — the shared A–E wallet has no VSS and must survive.
 */
import * as FileSystem from 'expo-file-system/legacy';
import {
  expectFields,
  expectNoWireKeys,
  HEX_32,
  HEX_PUBKEY,
} from '@utexo/rgb-sdk-core/conformance';

import { mine, sendToAddress } from '@/utils/bitcoin-node';

import {
  assert,
  assertEq,
  bootWallet,
  hostAddr,
  hostUrl,
  waitFor,
  type ScenarioContext,
} from '../harness';
import { emitLog } from '../marker';

const CAPACITY_SAT = 100_000;
const PUSH_MSAT = 50_000_000;
const INVOICE_SATS = 3_000;
const ISSUED_SUPPLY = 400;

export async function scenarioH(ctx: ScenarioContext): Promise<void> {
  const { fx, step } = ctx;

  if (!fx.VSS_URL) {
    emitLog('H skipped — stack has no VSS_URL (start it with VSS=1)');
    return;
  }
  const vssUrl = hostUrl(fx.VSS_URL);
  const peerUri = `${fx.FAUCET_PUBKEY}@${hostAddr(fx.FAUCET_PEER_PORT)}`;

  // ── the device that is about to be lost ───────────────────────────────────
  const first = await step(
    'boot wallet (VSS on)',
    () => bootWallet({ vssUrl, label: 'h_a_', allowEmptyRestore: true }),
    (b) => ({ storageDirPath: b.storageDirPath, ports: [b.daemonPort, b.ldkPeerPort] })
  );
  const w1 = first.wallet;

  const address = await step('getAddress', () => w1.getAddress());
  await step(
    'fund + createUtxos',
    async () => {
      await sendToAddress(address, 1);
      await mine(6);
      await waitFor(
        'funds to arrive',
        async () => {
          await w1.syncWallet();
          const bal = await w1.getBtcBalance();
          return bal.vanilla.spendable > 0 ? bal : null;
        },
        { attempts: 30, delayMs: 2000 }
      );
      await w1.createUtxos({ upTo: false, num: 5, feeRate: 7 });
      await mine(1);
      await w1.syncWallet();
      return true;
    },
    () => ({ address })
  );

  const issued = await step(
    'issueAssetNia',
    () =>
      w1.issueAssetNia({
        ticker: 'HRST',
        name: 'H Restore Asset',
        precision: 0,
        amounts: [ISSUED_SUPPLY],
      }),
    (a) => ({ assetId: a.assetId, issuedSupply: a.issuedSupply })
  );
  const assetId = issued.assetId;

  await step(
    'connectPeer (Faucet)',
    async () => {
      await w1.connectPeer(peerUri);
      return peerUri;
    },
    () => ({ peerUri })
  );

  const channel = await step(
    'openChannel + wait ready',
    async () => {
      await w1.openChannel({
        peerPubkey: peerUri,
        capacitySat: CAPACITY_SAT,
        pushMsat: PUSH_MSAT,
        isPublic: true,
        withAnchors: true,
      });
      return waitFor(
        'the channel to become ready',
        async () => {
          await w1.syncWallet();
          const channels = await w1.listChannels();
          return channels.find((c) => c.peerPubkey === fx.FAUCET_PUBKEY && c.ready) ?? null;
        },
        { attempts: 60, delayMs: 2000, onAttempt: async () => void (await mine(1)) }
      );
    },
    (c) => c
  );
  expectFields(channel, {
    channelId: { type: 'string', nonEmpty: true },
    capacitySat: { type: 'number', min: CAPACITY_SAT, max: CAPACITY_SAT },
    ready: { type: 'boolean' },
  });

  // Move value off-chain, so the restored channel balance is not just the
  // opening balance — a restore that lost the last HTLC would still look right.
  await step(
    'receive over the channel',
    async () => {
      const { lnInvoice } = await w1.createLightningInvoice({
        amountSats: INVOICE_SATS,
        expirySeconds: 900,
      });
      const res = await fetch(`${hostUrl(fx.FAUCET_URL)}/sendpayment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice: lnInvoice }),
      });
      if (!res.ok) throw new Error(`Faucet /sendpayment -> HTTP ${res.status}`);
      return waitFor(
        'the invoice to settle',
        async () => {
          const status = await w1.getLightningReceiveStatus(lnInvoice);
          if (status === 'Failed' || status === 'Expired') {
            throw new Error(`invoice terminated as ${status}`);
          }
          return status === 'Succeeded' ? status : null;
        },
        { attempts: 45, delayMs: 2000 }
      );
    },
    (s) => ({ status: s })
  );

  // ── snapshot everything a user would notice ───────────────────────────────
  const before = await step(
    'snapshot state',
    async () => {
      await w1.syncWallet();
      const [info, btc, asset, transfers, transactions, channels] = await Promise.all([
        w1.getNodeInfo(),
        w1.getBtcBalance(),
        w1.getAssetBalance(assetId),
        w1.listTransfers(assetId),
        w1.listTransactions(),
        w1.listChannels(),
      ]);
      const chan = channels.find((c) => c.channelId === channel.channelId);
      return {
        pubkey: info.pubkey,
        btcSpendable: btc.vanilla.spendable,
        assetSettled: asset.settled ?? 0,
        transfers: transfers.length,
        transactions: transactions.length,
        channelId: chan?.channelId ?? '',
        capacitySat: chan?.capacitySat ?? 0,
        localBalanceMsat: chan?.localBalanceMsat ?? 0,
      };
    },
    (v) => v
  );
  assert(HEX_PUBKEY.test(before.pubkey), 'node pubkey must be 66 hex chars');
  assertEq(before.assetSettled, ISSUED_SUPPLY, 'asset settled before wipe');
  assert(before.channelId.length > 0, 'the open channel must be in the snapshot');

  const version = await step(
    'backupNow',
    () => w1.backupNow(),
    (v) => ({ version: v })
  );
  assert(typeof version === 'number' && version >= 0, 'backupNow must return a version');

  // ── device loss: stop the node and delete its local state ─────────────────
  await step(
    'wipe local state',
    async () => {
      await w1.shutdown();
      await FileSystem.deleteAsync(first.storageDirUri, { idempotent: true });
      return first.storageDirUri;
    },
    (dir) => ({ deleted: dir })
  );

  // ── restore: same mnemonic, empty dir, no empty-restore escape hatch ──────
  const second = await step(
    'restore on a fresh device',
    () =>
      bootWallet({
        vssUrl,
        mnemonic: first.mnemonic,
        label: 'h_b_',
        allowEmptyRestore: false,
      }),
    (b) => ({ storageDirPath: b.storageDirPath })
  );
  const w2 = second.wallet;

  try {
    const after = await step(
      'verify restored state',
      async () => {
        await w2.syncWallet();
        await w2.refreshWallet().catch(() => undefined);
        const [info, btc, assets, asset, transfers, transactions, channels] =
          await Promise.all([
            w2.getNodeInfo(),
            w2.getBtcBalance(),
            w2.listAssets(),
            w2.getAssetBalance(assetId),
            w2.listTransfers(assetId),
            w2.listTransactions(),
            w2.listChannels(),
          ]);
        return {
          pubkey: info.pubkey,
          btcSpendable: btc.vanilla.spendable,
          niaCount: assets.nia?.length ?? 0,
          hasAsset: (assets.nia ?? []).some((a) => a.assetId === assetId),
          assetSettled: asset.settled ?? 0,
          transfers: transfers.length,
          transactions: transactions.length,
          channels: channels.map((c) => ({
            channelId: c.channelId,
            capacitySat: c.capacitySat,
            ready: c.ready,
            localBalanceMsat: c.localBalanceMsat ?? 0,
          })),
        };
      },
      (v) => v
    );

    // Identity: the restored node IS the old node, not a new one.
    assertEq(after.pubkey, before.pubkey, 'restored node pubkey');

    // RGB state.
    assert(after.hasAsset, `restored wallet must list the asset ${assetId}`);
    assertEq(after.assetSettled, before.assetSettled, 'restored asset balance');
    assert(
      after.transfers >= before.transfers,
      `transfers lost: ${after.transfers} < ${before.transfers}`
    );
    assert(
      after.transactions >= before.transactions,
      `transactions lost: ${after.transactions} < ${before.transactions}`
    );

    // Channel state — the half that costs money to lose.
    const restoredChannel = after.channels.find((c) => c.channelId === before.channelId);
    assert(
      restoredChannel !== undefined,
      `channel ${before.channelId} missing after restore (got ${JSON.stringify(after.channels)})`
    );
    assertEq(restoredChannel.capacitySat, before.capacitySat, 'restored channel capacity');

    // ── a restored channel that cannot be closed is not restored ────────────
    // A cooperative close needs the peer connected. The restored node has the
    // channel but not the peer's *address* — that lives in the peer store the
    // old device built up — so the reconnect has to be driven explicitly.
    await step(
      'reconnect the peer and wait for the channel to be usable',
      () =>
        waitFor(
          'the restored channel to reconnect',
          async () => {
            await w2.connectPeer(peerUri).catch(() => undefined);
            await w2.syncWallet().catch(() => undefined);
            const channels = await w2.listChannels();
            const c = channels.find((x) => x.channelId === before.channelId);
            return c?.isUsable ? c : null;
          },
          { attempts: 30, delayMs: 3000 }
        ),
      (c) => ({ channelId: c.channelId, isUsable: c.isUsable })
    );

    const closed = await step(
      'close the restored channel',
      async () => {
        const btcBefore = (await w2.getBtcBalance()).vanilla.spendable;
        await w2.closeChannel(before.channelId, fx.FAUCET_PUBKEY, false);
        return waitFor(
          'the channel funds to return on-chain',
          async () => {
            await mine(6);
            await w2.syncWallet().catch(() => undefined);
            await w2.refreshWallet().catch(() => undefined);
            const bal = await w2.getBtcBalance();
            return bal.vanilla.spendable > btcBefore ? { btcBefore, btcAfter: bal.vanilla.spendable } : null;
          },
          { attempts: 45, delayMs: 3000 }
        );
      },
      (v) => v
    );
    assert(
      closed.btcAfter > closed.btcBefore,
      `closing the restored channel must return funds on-chain (${closed.btcBefore} → ${closed.btcAfter})`
    );

    const finalTxs = await step(
      'listTransactions (after close)',
      () => w2.listTransactions(),
      (t) => ({ count: t.length })
    );
    for (const tx of finalTxs) expectNoWireKeys(tx);
    assert(
      finalTxs.some((t) => HEX_32.test(String(t.txid ?? ''))),
      'the restored wallet must report real txids'
    );
  } finally {
    await w2.destroy().catch(() => undefined);
  }
}
