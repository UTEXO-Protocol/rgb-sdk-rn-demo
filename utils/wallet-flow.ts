/**
 * React Native compatible wallet flow
 * Adapted from flow.js for React Native environment
 */

import {
  createWallet,
  NativeExternalRLNSigner,
  PasswordRLNSigner,
  UTEXOWallet,
} from '@utexo/rgb-sdk-rn';
import * as FileSystem from 'expo-file-system/legacy';
import { documentDirectory } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

let activeDemoFlow: string | null = null;

function isPoisonLike(e: unknown): boolean {
  const err = e as { message?: string; code?: unknown } | null;
  const code = typeof err?.code === 'string' ? err.code.toLowerCase() : '';
  const msg = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
  return (
    code.includes('nodestatecorrupted') ||
    msg.includes('poisonerror') ||
    msg.includes('poison error') ||
    msg.includes('node internal state is corrupted')
  );
}

function beginExclusiveFlow(flowName: string) {
  if (activeDemoFlow && activeDemoFlow !== flowName) {
    throw new Error(
      `Flow "${flowName}" blocked: "${activeDemoFlow}" is currently running. Run flows sequentially to avoid RLN/node state conflicts.`
    );
  }
  activeDemoFlow = flowName;
}

function endExclusiveFlow(flowName: string) {
  if (activeDemoFlow === flowName) {
    activeDemoFlow = null;
  }
}

function readEnv(name: string): string | null {
  const value =
    (name === 'RLN_NODE_PASSWORD'
      ? process.env.EXPO_PUBLIC_RLN_NODE_PASSWORD
      : name === 'RLN_BITCOIND_RPC_USERNAME'
        ? process.env.EXPO_PUBLIC_RLN_BITCOIND_RPC_USERNAME
        : name === 'RLN_BITCOIND_RPC_PASSWORD'
          ? process.env.EXPO_PUBLIC_RLN_BITCOIND_RPC_PASSWORD
          : name === 'RLN_BITCOIND_RPC_HOST'
            ? process.env.EXPO_PUBLIC_RLN_BITCOIND_RPC_HOST
            : name === 'RLN_BITCOIND_RPC_PORT'
              ? process.env.EXPO_PUBLIC_RLN_BITCOIND_RPC_PORT
              : name === 'RLN_INDEXER_URL'
                ? process.env.EXPO_PUBLIC_RLN_INDEXER_URL
                : name === 'RLN_PROXY_ENDPOINT'
                  ? process.env.EXPO_PUBLIC_RLN_PROXY_ENDPOINT
                  : name === 'RLN_ANNOUNCE_ADDRESSES'
                    ? process.env.EXPO_PUBLIC_RLN_ANNOUNCE_ADDRESSES
                    : name === 'RLN_ANNOUNCE_ALIAS'
                      ? process.env.EXPO_PUBLIC_RLN_ANNOUNCE_ALIAS
                      : name === 'RLN_PLAYGROUND_NETWORK'
                        ? process.env.EXPO_PUBLIC_RLN_PLAYGROUND_NETWORK
                      : name === 'RLN_STRICT_UNLOCK_CREDS'
                        ? process.env.EXPO_PUBLIC_RLN_STRICT_UNLOCK_CREDS
                      : name === 'RLN_VSS_URL'
                        ? process.env.EXPO_PUBLIC_RLN_VSS_URL
                      : null) ?? null;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

const _bitcoinNodeHost = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
const BITCOIN_NODE_ENDPOINT =
  process.env.BITCOIN_NODE_ENDPOINT ?? `http://${_bitcoinNodeHost}:5000/execute`;

async function postBitcoinNodeCommand(args: string) {
  const endpoints = [BITCOIN_NODE_ENDPOINT];
  if (BITCOIN_NODE_ENDPOINT.startsWith('http://')) {
    endpoints.push(BITCOIN_NODE_ENDPOINT.replace(/^http:\/\//, 'https://'));
  }

  // console.log(`[bitcoin-node] ► postBitcoinNodeCommand args="${args}" platform=${Platform.OS} endpoints=${JSON.stringify(endpoints)}`);

  const errors: string[] = [];
  for (const endpoint of endpoints) {
    // console.log(`[bitcoin-node]   trying endpoint: ${endpoint}`);
    try {
      const body = JSON.stringify({ args });
      console.log(`[bitcoin-node]   fetch POST ${endpoint} body=${body}`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      // console.log(`[bitcoin-node]   response status: ${response.status} ${response.statusText}`);
      if (!response.ok) {
        const text = await response.text().catch(() => '(no body)');
        console.warn(`[bitcoin-node]   HTTP error body: ${text}`);
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      const json = await response.json();
      console.log(`[bitcoin-node]   response json: ${JSON.stringify(json)}`);
      return json;
    } catch (e: any) {
      const msg = `${endpoint}: ${e?.message ?? String(e)}`;
      console.warn(`[bitcoin-node]   ✗ ${msg}`);
      errors.push(msg);
    }
  }

  const finalError = errors.length ? errors.join(' | ') : 'Unknown request error';
  console.error(`[bitcoin-node] ✗ all endpoints failed — args="${args}" errors: ${finalError}`);
  throw new Error(finalError);
}

function unwrapNodeResponse(data: any) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const statusText = typeof data.status === 'string' ? data.status.toLowerCase() : '';
    const errorText = typeof data.error === 'string' ? data.error.trim() : '';
    const outputText = typeof data.output === 'string' ? data.output.trim() : '';
    if (errorText || /^ERR:/i.test(outputText)) {
      console.error(`[bitcoin-node] unwrapNodeResponse error: ${errorText || outputText} raw=${JSON.stringify(data)}`);
      throw new Error(errorText || outputText);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'result')) {
      return data.result;
    }
    if (statusText === 'success' && outputText) {
      return outputText;
    }
  }
  return data;
}

export async function mine(numBlocks: number) {
  console.log(`[bitcoin-node] mine(${numBlocks})`);
  try {
    const raw = await postBitcoinNodeCommand(`mine ${numBlocks}`);
    const data = unwrapNodeResponse(raw);
    console.log(`[bitcoin-node] mine(${numBlocks}) ✓ result=${JSON.stringify(data)}`);
    return data;
  } catch (error: any) {
    console.error(`[bitcoin-node] mine(${numBlocks}) ✗ ${error?.message ?? String(error)}`);
    throw new Error(`Unable to mine: ${error.message}`);
  }
}

export async function sendToAddress(address: string, amount: number) {
  console.log(`[bitcoin-node] sendToAddress(address="${address}", amount=${amount})`);
  try {
    const raw = await postBitcoinNodeCommand(`sendtoaddress ${address} ${amount}`);
    const txid = unwrapNodeResponse(raw);
    if (typeof txid !== 'string' || txid.trim().length === 0) {
      const msg = `Unexpected sendtoaddress response: ${JSON.stringify(raw)}`;
      console.error(`[bitcoin-node] sendToAddress ✗ ${msg}`);
      throw new Error(msg);
    }
    console.log(`[bitcoin-node] sendToAddress ✓ txid=${txid}`);
    return txid;
  } catch (error: any) {
    console.error(`[bitcoin-node] sendToAddress(address="${address}", amount=${amount}) ✗ ${error?.message ?? String(error)}`);
    throw new Error(`Unable to send bitcoins: ${error.message}`);
  }
}


type RlnFlowResults = { steps: any[]; success: boolean; error: any };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createFlowResults(): {
  results: RlnFlowResults;
  addStep: (step: string, status: string, data?: any, error?: string) => void;
  failFlow: (flowName: string, error: any) => RlnFlowResults;
} {
  const results: RlnFlowResults = { steps: [], success: false, error: null };
  let lastStep: string | null = null;

  const addStep = (step: string, status: string, data?: any, error?: string) => {
    const idx = results.steps.findIndex((s: any) => s.step === step);
    const entry = { step, status, data, error };
    if (idx >= 0) results.steps[idx] = entry;
    else results.steps.push(entry);
    if (status !== 'running') lastStep = step;
    if (status === 'error' || error) {
      console.error(`[flow] ✗ step="${step}" error="${error ?? '(none)'}"`, data ?? null);
    } else if (status === 'running') {
      console.log(`[flow] ▶ step="${step}"`);
    } else {
      console.log(`[flow] ✓ step="${step}"`, data ?? null);
    }
  };

  const failFlow = (flowName: string, error: any): RlnFlowResults => {
    const message = error?.message ?? String(error);
    const stack = error?.stack ?? null;
    console.error(
      `[flow] ✗ FLOW FAILED flowName="${flowName}" lastStep="${lastStep ?? 'none'}" error="${message}"`,
      stack ? `\n${stack}` : ''
    );
    results.success = false;
    results.error = { message, lastStep, stack };
    return results;
  };

  return { results, addStep, failFlow };
}

function wChanValidate(
  fn: string,
  actual: any,
  schema: Record<string, string>,
): { fn: string; expected: Record<string, string>; received: any; match: boolean; fields: Record<string, boolean> } {
  const fields: Record<string, boolean> = {};
  for (const [key, type] of Object.entries(schema)) {
    const val = actual?.[key];
    if (type === 'nonempty-string') fields[key] = typeof val === 'string' && val.length > 0;
    else if (type === 'array') fields[key] = Array.isArray(val);
    else fields[key] = typeof val === type;
  }
  const match = Object.values(fields).every(Boolean);
  console.log(`[wChan][validate] ${fn} match=${match}`, JSON.stringify({ fields, received: actual }));
  return { fn, expected: schema, received: actual, match, fields };
}

export async function runRlnUtexoWalletChannelPaymentFlow() {
  const flowName = 'runRlnUtexoWalletChannelPaymentFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();

  let nodeA: UTEXOWallet | null = null;
  let nodeB: UTEXOWallet | null = null;

  try {
    const network = 'regtest' as const;
    const rpcHost = readEnv('RLN_BITCOIND_RPC_HOST') ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
    const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
    const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
    const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
    const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
    const proxyEndpoint = readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;

    const unlockParams = {
      bitcoindRpcUsername: rpcUsername,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl,
      proxyEndpoint,
      announceAddresses: [] as string[],
      announceAlias: null as string | null,
    };

    const keysA = await createWallet(network);
    const keysB = await createWallet(network);
    const nodeAPassword = 'nodeApass';
    const nodeBPassword = 'nodeBpass';

    const basePortA = 20000 + Math.floor(Math.random() * 10000);
    const basePortB = basePortA + 100;
    const ts = Date.now();
    const storageDirUriA = `${documentDirectory ?? ''}rln_wallet_chan_a_${ts}`;
    const storageDirUriB = `${documentDirectory ?? ''}rln_wallet_chan_b_${ts}`;
    await FileSystem.makeDirectoryAsync(storageDirUriA, { intermediates: true });
    await FileSystem.makeDirectoryAsync(storageDirUriB, { intermediates: true });
    const storageDirA = storageDirUriA.replace('file://', '');
    const storageDirB = storageDirUriB.replace('file://', '');

    nodeA = new UTEXOWallet(
      {
        storageDirPath: storageDirA,
        daemonListeningPort: basePortA,
        ldkPeerListeningPort: basePortA + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysA.accountXpubVanilla,
        xpubCol: keysA.accountXpubColored,
        masterFingerprint: keysA.masterFingerprint,
      },
      new PasswordRLNSigner(nodeAPassword, keysA.mnemonic),
    );

    nodeB = new UTEXOWallet(
      {
        storageDirPath: storageDirB,
        daemonListeningPort: basePortB,
        ldkPeerListeningPort: basePortB + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysB.accountXpubVanilla,
        xpubCol: keysB.accountXpubColored,
        masterFingerprint: keysB.masterFingerprint,
      },
      new PasswordRLNSigner(nodeBPassword, keysB.mnemonic),
    );

    // 1 — init nodeA (createNode + signer.initNode)
    addStep('wChanAInit', 'running');
    await nodeA.init();
    addStep('wChanAInit', 'success', { storageDirPath: storageDirA });

    // 2 — unlock nodeA
    addStep('wChanAUnlock', 'running');
    await nodeA.unlock(unlockParams);
    addStep('wChanAUnlock', 'success', {});

    // 3 — init nodeB (createNode + signer.initNode)
    addStep('wChanBInit', 'running');
    await nodeB.init();
    addStep('wChanBInit', 'success', { storageDirPath: storageDirB });

    // 4 — unlock nodeB (PasswordRLNSigner injects password automatically)
    addStep('wChanBUnlock', 'running');
    await nodeB.unlock(unlockParams);
    addStep('wChanBUnlock', 'success', {});

    // 5 — node infos
    // getNodeInfo() → RlnNodeInfo { pubkey, numUsableChannels, numChannels, localBalanceMsat, peers[] }
    const infoA = await nodeA.getNodeInfo();
    const infoB = await nodeB.getNodeInfo();
    const pubkeyA = String(infoA?.pubkey ?? '');
    const pubkeyB = String(infoB?.pubkey ?? '');
    const nodeInfoSchema = { pubkey: 'nonempty-string', numUsableChannels: 'number', numChannels: 'number', localBalanceMsat: 'number', peers: 'array' };
    const vInfoA = wChanValidate('getNodeInfo(nodeA)', infoA, nodeInfoSchema);
    const vInfoB = wChanValidate('getNodeInfo(nodeB)', infoB, nodeInfoSchema);
    addStep('wChanNodeInfos', 'success', {
      pubkeyA: pubkeyA.substring(0, 16) + '...',
      pubkeyB: pubkeyB.substring(0, 16) + '...',
      _v: { nodeA: { match: vInfoA.match, fields: vInfoA.fields }, nodeB: { match: vInfoB.match, fields: vInfoB.fields } },
    });

    // 6 — fund nodeA
    // getAddress() → string (bech32)
    // getBtcBalance() → BtcBalance { vanilla: { spendable, future, immature }, colored: { spendable, future, immature } }
    addStep('wChanAFund', 'running');
    const addrA = await nodeA.getAddress();
    const vAddrA = wChanValidate('getAddress(nodeA)', { address: addrA }, { address: 'nonempty-string' });
    const txidA = await sendToAddress(addrA, 1);
    await mine(6);
    await sleep(3000);
    await nodeA.syncWallet();
    const balA = await nodeA.getBtcBalance();
    const vBalA = wChanValidate('getBtcBalance(nodeA)', balA, { vanilla: 'object', colored: 'object' });
    addStep('wChanAFund', 'success', { txid: txidA, address: addrA, balance: balA,
      _v: { address: { match: vAddrA.match }, balance: { match: vBalA.match, fields: vBalA.fields, vanilla: balA?.vanilla, colored: balA?.colored } } });

    // 7 — create UTXOs for nodeA
    addStep('wChanACreateUtxos', 'running');
    await nodeA.syncWallet();
    await nodeA.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeA.syncWallet();
    addStep('wChanACreateUtxos', 'success', { num: 10 });

    // 8 — fund nodeB
    addStep('wChanBFund', 'running');
    const addrB = await nodeB.getAddress();
    const vAddrB = wChanValidate('getAddress(nodeB)', { address: addrB }, { address: 'nonempty-string' });
    const txidB = await sendToAddress(addrB, 1);
    await mine(6);
    await sleep(3000);
    await nodeB.syncWallet();
    const balB = await nodeB.getBtcBalance();
    const vBalB = wChanValidate('getBtcBalance(nodeB)', balB, { vanilla: 'object', colored: 'object' });
    addStep('wChanBFund', 'success', { txid: txidB, address: addrB, balance: balB,
      _v: { address: { match: vAddrB.match }, balance: { match: vBalB.match, fields: vBalB.fields, vanilla: balB?.vanilla, colored: balB?.colored } } });

    // 9 — create UTXOs for nodeB
    addStep('wChanBCreateUtxos', 'running');
    await nodeB.syncWallet();
    await nodeB.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeB.syncWallet();
    addStep('wChanBCreateUtxos', 'success', { num: 10 });

    // 10 — connect peers nodeA → nodeB
    addStep('wChanConnectPeers', 'running');
    const peerUriB = `${pubkeyB}@127.0.0.1:${basePortB + 1}`;
    console.log(`[wChan] connecting nodeA → ${peerUriB}`);
    try {
      await nodeA.connectPeer(peerUriB);
      console.log(`[wChan] connected to ${peerUriB}`);
    } catch (e: any) {
      if (isPoisonLike(e)) {
        addStep('wChanConnectPeers', 'error', undefined, e?.message ?? String(e));
        throw e;
      }
      console.warn(`[wChan] connectPeer ignored: ${e?.message ?? String(e)}`);
    }
    addStep('wChanConnectPeers', 'success', { peerUriB });

    // 11 — open BTC channel nodeA → nodeB (500k sat, no asset)
    // openChannel() → RlnOpenChannelResponse { temporaryChannelId: string }
    // listChannels() → RlnChannel[] — each: { channelId, fundingTxid, isUsable, capacitySat, localBalanceMsat, ... }
    addStep('wChanOpenChannel', 'running');
    const openResp = await nodeA.openChannel({
      peerPubkeyAndOptAddr: peerUriB,
      capacitySat: 500000,
      pushMsat: 0,
      public: false,
      withAnchors: true,
      assetId: null,
      assetAmount: null,
    });
    const vOpenResp = wChanValidate('openChannel(nodeA)', openResp, { temporaryChannelId: 'nonempty-string' });
    const tmpId = String(openResp?.temporaryChannelId ?? '');
    console.log(`[wChan] opened channel tmpId=${tmpId}`);

    let fundingTxid = '';
    let channelId = '';
    let foundChannel: any = null;
    const fundDeadline = Date.now() + 120000;
    while (Date.now() < fundDeadline) {
      await nodeA.syncWallet();
      const channels: any[] = (await nodeA.listChannels()) ?? [];
      const ch = channels.find((c: any) => (c.fundingTxid ?? c.funding_txid) != null);
      if (ch) {
        foundChannel = ch;
        fundingTxid = String(ch.fundingTxid ?? ch.funding_txid ?? '');
        channelId = String(ch.channelId ?? ch.channel_id ?? '');
        break;
      }
      await sleep(1000);
    }
    if (!fundingTxid) throw new Error('Timeout waiting for funding tx');
    const vChannel = wChanValidate('listChannels(nodeA)[found]', foundChannel, {
      channelId: 'nonempty-string', fundingTxid: 'nonempty-string',
      capacitySat: 'number', localBalanceMsat: 'number',
    });
    console.log(`[wChan] channelId=${channelId} fundingTxid=${fundingTxid}`);

    await mine(6);
    await sleep(3000);
    for (const [node, label] of [[nodeA, 'nodeA'], [nodeB, 'nodeB']] as [UTEXOWallet, string][]) {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        await node.syncWallet();
        const info = await node.getNodeInfo();
        const usable = Number(info?.numUsableChannels ?? 0);
        console.log(`[wChan] ${label} usableChannels=${usable}`);
        if (usable >= 1) break;
        await sleep(2000);
      }
    }
    addStep('wChanOpenChannel', 'success', { channelId, fundingTxid,
      _v: { openChannel: { match: vOpenResp.match, fields: vOpenResp.fields }, channel: { match: vChannel.match, fields: vChannel.fields, received: foundChannel } } });

    // 12 — payment 1: nodeB creates invoice, nodeA pays
    // createLightningInvoice() → { lnInvoice: string, amountMsat?: number, expirySeconds: number }
    // payLightningInvoice() → { txid: string }
    // getLightningSendRequest(hash) → status string: 'Pending' | 'Settled' | 'Failed'
    addStep('wChanPayment1', 'running');
    const inv1 = await nodeB.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId: '', amount: 0 } });
    const vInv1 = wChanValidate('createLightningInvoice(nodeB)', inv1, { lnInvoice: 'nonempty-string' });
    const invoice1 = String(inv1?.lnInvoice ?? '');
    console.log(`[wChan] invoice1: ${invoice1.substring(0, 40)}...`);
    const send1 = await nodeA.payLightningInvoice({ lnInvoice: invoice1 });
    const vSend1 = wChanValidate('payLightningInvoice(nodeA)', send1, { txid: 'nonempty-string' });
    const hash1 = String(send1?.txid ?? '');
    console.log(`[wChan] payment1 hash=${hash1}`);
    let status1 = '';
    const pay1Deadline = Date.now() + 60000;
    while (Date.now() < pay1Deadline) {
      await nodeA.syncWallet();
      status1 = String((await nodeA.getLightningSendRequest(hash1)) ?? '');
      console.log(`[wChan] payment1 status=${status1}`);
      if (status1 === 'Settled') break;
      if (status1 === 'Failed') throw new Error(`Payment1 failed: ${hash1}`);
      await sleep(2000);
    }
    const vStatus1 = wChanValidate('getLightningSendRequest(nodeA) payment1', { status: status1 }, { status: 'nonempty-string' });
    addStep('wChanPayment1', 'success', { paymentHash: hash1,
      _v: { invoice: { match: vInv1.match, fields: vInv1.fields }, pay: { match: vSend1.match, fields: vSend1.fields }, status: { value: status1, settled: status1 === 'Settled' } } });

    // 13 — restart nodeA (shutdown + reinit on same instance — no manager recreation needed)
    addStep('wChanRestartNodeA', 'running');
    await nodeA.shutdown();
    await sleep(1000);
    await nodeA.reinit(unlockParams);
    console.log('[wChan] nodeA restarted via UTEXOWallet.reinit()');
    const restartDeadline = Date.now() + 120000;
    while (Date.now() < restartDeadline) {
      await nodeA.syncWallet();
      const info = await nodeA.getNodeInfo();
      const usable = Number(info?.numUsableChannels ?? 0);
      console.log(`[wChan] nodeA usableChannels after restart=${usable}`);
      if (usable >= 1) break;
      await sleep(2000);
    }
    addStep('wChanRestartNodeA', 'success', {});

    // 14 — payment 2: nodeB creates invoice, nodeA pays (after restart)
    addStep('wChanPayment2', 'running');
    const inv2 = await nodeB.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId: '', amount: 0 } });
    const vInv2 = wChanValidate('createLightningInvoice(nodeB)', inv2, { lnInvoice: 'nonempty-string' });
    const invoice2 = String(inv2?.lnInvoice ?? '');
    console.log(`[wChan] invoice2: ${invoice2.substring(0, 40)}...`);
    const send2 = await nodeA.payLightningInvoice({ lnInvoice: invoice2 });
    const vSend2 = wChanValidate('payLightningInvoice(nodeA)', send2, { txid: 'nonempty-string' });
    const hash2 = String(send2?.txid ?? '');
    console.log(`[wChan] payment2 hash=${hash2}`);
    let status2 = '';
    const pay2Deadline = Date.now() + 60000;
    while (Date.now() < pay2Deadline) {
      await nodeA.syncWallet();
      status2 = String((await nodeA.getLightningSendRequest(hash2)) ?? '');
      console.log(`[wChan] payment2 status=${status2}`);
      if (status2 === 'Settled') break;
      if (status2 === 'Failed') throw new Error(`Payment2 failed: ${hash2}`);
      await sleep(2000);
    }
    addStep('wChanPayment2', 'success', { paymentHash: hash2,
      _v: { invoice: { match: vInv2.match, fields: vInv2.fields }, pay: { match: vSend2.match, fields: vSend2.fields }, status: { value: status2, settled: status2 === 'Settled' } } });

    // 15 — issue RGB asset on nodeA (1000 units)
    // issueAssetNia() → AssetNIA { assetId, ticker, name, precision, issuedSupply, timestamp, addedAt, balance: { spendable, future, settled } }
    addStep('wChanIssueAsset', 'running');
    await nodeA.syncWallet();
    const issued = await nodeA.issueAssetNia({ ticker: 'WCTS', name: 'WalletChanTest', precision: 0, amounts: [1000] });
    const vIssued = wChanValidate('issueAssetNia(nodeA)', issued, {
      assetId: 'nonempty-string', ticker: 'nonempty-string', name: 'nonempty-string',
      precision: 'number', issuedSupply: 'number', balance: 'object',
    });
    const assetId = String(issued?.assetId ?? '');
    await mine(1);
    await nodeA.syncWallet();
    await nodeA.refreshWallet();
    addStep('wChanIssueAsset', 'success', { assetId: assetId.substring(0, 20) + '...',
      _v: { match: vIssued.match, fields: vIssued.fields, received: { ticker: issued?.ticker, name: issued?.name, precision: issued?.precision, issuedSupply: issued?.issuedSupply, balance: issued?.balance } } });

    // 16 — nodeB generates witness invoice (nodeA will send 300 units with witnessData)
    // witnessReceive() → InvoiceReceiveData { invoice: string, recipientId: string, batchTransferIdx: number, expirationTimestamp?: number }
    // assetId/amount omitted: nodeB doesn't own the asset yet; passing them causes "resource not found"
    addStep('wChanWitnessReceive', 'running');
    await nodeB.syncWallet();
    const invWitness = await nodeB.witnessReceive({ minConfirmations: 1 });
    const vInvWitness = wChanValidate('witnessReceive(nodeB)', invWitness, {
      invoice: 'nonempty-string', recipientId: 'nonempty-string', batchTransferIdx: 'number',
    });
    const witnessInvoice = String(invWitness?.invoice ?? '');
    const witnessRecipientId = String(invWitness?.recipientId ?? '');
    console.log(`[wChan] witnessInvoice recipientId=${witnessRecipientId.substring(0, 20)}...`);
    addStep('wChanWitnessReceive', 'success', { recipientId: witnessRecipientId.substring(0, 20) + '...',
      _v: { match: vInvWitness.match, fields: vInvWitness.fields, received: { recipientId: witnessRecipientId.substring(0, 20) + '...', batchTransferIdx: invWitness?.batchTransferIdx } } });

    // 17 — nodeA sends 300 units to nodeB via witness invoice (witnessData.amountSat=1000)
    // send() → SendResult { txid: string, batchTransferIdx: number }
    // listOnchainTransfers(assetId) → Transfer[] — each: { kind, status, txid?, amount, assetId, ... }
    // listAssets() → ListAssets { nia?: AssetNIA[], cfa?: AssetCFA[], uda?: AssetUDA[] }
    addStep('wChanSendWitness', 'running');
    const sendWitness = await nodeA.send({
      invoice: witnessInvoice,
      assetId,
      amount: 300,
      donation: true,
      feeRate: 1,
      minConfirmations: 1,
      witnessData: { amountSat: 1000 },
    });
    const vSendWitness = wChanValidate('send(nodeA, witness)', sendWitness, { txid: 'nonempty-string', batchTransferIdx: 'number' });
    await mine(1);
    await nodeA.syncWallet();
    await nodeB.syncWallet();
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await nodeB.refreshWallet();
    const transfersWitness = await nodeA.listOnchainTransfers(assetId);
    const vTransfersW = wChanValidate('listOnchainTransfers(nodeA)', { transfers: transfersWitness }, { transfers: 'array' });
    const assetsAfterWitness = await nodeA.listAssets();
    const vAssetsW = wChanValidate('listAssets(nodeA)', assetsAfterWitness, { nia: 'array' });
    console.log(`[wChan] after witness send: transferCount=${transfersWitness.length} assetCount=${assetsAfterWitness?.nia?.length ?? 0}`);
    addStep('wChanSendWitness', 'success', {
      amount: 300,
      recipientId: witnessRecipientId.substring(0, 20) + '...',
      transferCount: transfersWitness.length,
      _v: {
        send: { match: vSendWitness.match, fields: vSendWitness.fields, received: sendWitness },
        transfers: { match: vTransfersW.match, count: transfersWitness.length, sample: transfersWitness[0] ?? null },
        assets: { match: vAssetsW.match, niaCount: assetsAfterWitness?.nia?.length ?? 0 },
      },
    });

    // 18 — nodeB generates blind invoice (nodeA will send 200 units, no witnessData)
    // blindReceive() → InvoiceReceiveData { invoice: string, recipientId: string, batchTransferIdx: number, expirationTimestamp?: number }
    // assetId/amount omitted: nodeB receives for the first time; asset not yet in its db
    addStep('wChanBlindReceive', 'running');
    await nodeB.syncWallet();
    const invBlind = await nodeB.blindReceive({ minConfirmations: 1 });
    const vInvBlind = wChanValidate('blindReceive(nodeB)', invBlind, {
      invoice: 'nonempty-string', recipientId: 'nonempty-string', batchTransferIdx: 'number',
    });
    const blindInvoice = String(invBlind?.invoice ?? '');
    const blindRecipientId = String(invBlind?.recipientId ?? '');
    console.log(`[wChan] blindInvoice recipientId=${blindRecipientId.substring(0, 20)}...`);
    addStep('wChanBlindReceive', 'success', { recipientId: blindRecipientId.substring(0, 20) + '...',
      _v: { match: vInvBlind.match, fields: vInvBlind.fields, received: { recipientId: blindRecipientId.substring(0, 20) + '...', batchTransferIdx: invBlind?.batchTransferIdx } } });

    // 19 — nodeA sends 200 units to nodeB via blind invoice (no witnessData)
    addStep('wChanSendBlind', 'running');
    const sendBlind = await nodeA.send({
      invoice: blindInvoice,
      assetId,
      amount: 200,
      donation: true,
      feeRate: 1,
      minConfirmations: 1,
    });
    const vSendBlind = wChanValidate('send(nodeA, blind)', sendBlind, { txid: 'nonempty-string', batchTransferIdx: 'number' });
    await mine(1);
    await nodeA.syncWallet();
    await nodeB.syncWallet();
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await nodeB.refreshWallet();
    const transfersBlind = await nodeA.listOnchainTransfers(assetId);
    const vTransfersB = wChanValidate('listOnchainTransfers(nodeA)', { transfers: transfersBlind }, { transfers: 'array' });
    const assetsAfterBlind = await nodeA.listAssets();
    const vAssetsB = wChanValidate('listAssets(nodeA)', assetsAfterBlind, { nia: 'array' });
    console.log(`[wChan] after blind send: transferCount=${transfersBlind.length} assetCount=${assetsAfterBlind?.nia?.length ?? 0}`);
    addStep('wChanSendBlind', 'success', {
      amount: 200,
      recipientId: blindRecipientId.substring(0, 20) + '...',
      transferCount: transfersBlind.length,
      _v: {
        send: { match: vSendBlind.match, fields: vSendBlind.fields, received: sendBlind },
        transfers: { match: vTransfersB.match, count: transfersBlind.length, sample: transfersBlind[0] ?? null },
        assets: { match: vAssetsB.match, niaCount: assetsAfterBlind?.nia?.length ?? 0 },
      },
    });

    // 20 — final asset balances: nodeA=500, nodeB=500
    // getAssetBalance(assetId) → AssetBalance { spendable: number, future: number, settled: number }
    addStep('wChanFinalBalances', 'running');
    const [finalBalA, finalBalB] = await Promise.all([
      nodeA.getAssetBalance(assetId),
      nodeB.getAssetBalance(assetId),
    ]);
    const balSchema = { spendable: 'number', future: 'number', settled: 'number' };
    const vFinalA = wChanValidate('getAssetBalance(nodeA)', finalBalA, balSchema);
    const vFinalB = wChanValidate('getAssetBalance(nodeB)', finalBalB, balSchema);
    console.log(`[wChan] finalA=${finalBalA?.spendable} finalB=${finalBalB?.spendable}`);
    addStep('wChanFinalBalances', 'success', {
      spendableA: finalBalA?.spendable ?? null,
      spendableB: finalBalB?.spendable ?? null,
      _v: {
        nodeA: { match: vFinalA.match, fields: vFinalA.fields, received: finalBalA, expectedSpendable: 500, matchSpendable: finalBalA?.spendable === 500 },
        nodeB: { match: vFinalB.match, fields: vFinalB.fields, received: finalBalB, expectedSpendable: 500, matchSpendable: finalBalB?.spendable === 500 },
      },
    });

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (nodeA) { try { await nodeA.destroy(); } catch {} }
    if (nodeB) { try { await nodeB.destroy(); } catch {} }
    endExclusiveFlow(flowName);
  }
}

export async function runRlnUtexoWalletAssetChannelExtSignerFlow() {
  const flowName = 'runRlnUtexoWalletAssetChannelExtSignerFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();

  let nodeA: UTEXOWallet | null = null;
  let nodeB: UTEXOWallet | null = null;

  try {
    const network = 'regtest' as const;
    const rpcHost = readEnv('RLN_BITCOIND_RPC_HOST') ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
    const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
    const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
    const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
    const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
    const proxyEndpoint = readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;

    const unlockParams = {
      bitcoindRpcUsername: rpcUsername,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl,
      proxyEndpoint,
      announceAddresses: [] as string[],
      announceAlias: null as string | null,
    };

    const keysA = await createWallet(network);
    const keysB = await createWallet(network);
    const nodeAPassword = 'nodeApass';

    const basePortA = 20000 + Math.floor(Math.random() * 10000);
    const basePortB = basePortA + 100;
    const ts = Date.now();
    const storageDirUriA = `${documentDirectory ?? ''}rln_asext_a_${ts}`;
    const storageDirUriB = `${documentDirectory ?? ''}rln_asext_b_${ts}`;
    await FileSystem.makeDirectoryAsync(storageDirUriA, { intermediates: true });
    await FileSystem.makeDirectoryAsync(storageDirUriB, { intermediates: true });
    const storageDirA = storageDirUriA.replace('file://', '');
    const storageDirB = storageDirUriB.replace('file://', '');

    // nodeA — regular node (PasswordRLNSigner): issues asset, opens asset channel, pays
    nodeA = new UTEXOWallet(
      {
        storageDirPath: storageDirA,
        daemonListeningPort: basePortA,
        ldkPeerListeningPort: basePortA + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysA.accountXpubVanilla,
        xpubCol: keysA.accountXpubColored,
        masterFingerprint: keysA.masterFingerprint,
      },
      new PasswordRLNSigner(nodeAPassword, keysA.mnemonic),
    );

    // nodeB — external signer node (NativeExternalRLNSigner): creates invoices
    nodeB = new UTEXOWallet(
      {
        storageDirPath: storageDirB,
        daemonListeningPort: basePortB,
        ldkPeerListeningPort: basePortB + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysB.accountXpubVanilla,
        xpubCol: keysB.accountXpubColored,
        masterFingerprint: keysB.masterFingerprint,
      },
      new NativeExternalRLNSigner(keysB.mnemonic, network),
    );

    // 1 — init nodeA
    addStep('wAsExtAInit', 'running');
    await nodeA.init();
    addStep('wAsExtAInit', 'success', { storageDirPath: storageDirA });

    // 2 — unlock nodeA
    addStep('wAsExtAUnlock', 'running');
    await nodeA.unlock(unlockParams);
    addStep('wAsExtAUnlock', 'success', {});

    // 3 — init nodeB
    addStep('wAsExtBInit', 'running');
    await nodeB.init();
    addStep('wAsExtBInit', 'success', { storageDirPath: storageDirB });

    // 4 — unlock nodeB
    addStep('wAsExtBUnlock', 'running');
    await nodeB.unlock(unlockParams);
    addStep('wAsExtBUnlock', 'success', {});

    // 5 — node infos
    const infoA = await nodeA.getNodeInfo();
    const infoB = await nodeB.getNodeInfo();
    const pubkeyA = String(infoA?.pubkey ?? '');
    const pubkeyB = String(infoB?.pubkey ?? '');
    addStep('wAsExtNodeInfos', 'success', {
      pubkeyA: pubkeyA.substring(0, 16) + '...',
      pubkeyB: pubkeyB.substring(0, 16) + '...',
    });

    // 6 — fund nodeA
    addStep('wAsExtAFund', 'running');
    const addrA = await nodeA.getAddress();
    const txidA = await sendToAddress(addrA, 1);
    await mine(6);
    await sleep(3000);
    await nodeA.syncWallet();
    const balA = await nodeA.getBtcBalance();
    addStep('wAsExtAFund', 'success', { txid: txidA, address: addrA, balance: balA });

    // 7 — create UTXOs for nodeA
    addStep('wAsExtACreateUtxos', 'running');
    await nodeA.syncWallet();
    await nodeA.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeA.syncWallet();
    addStep('wAsExtACreateUtxos', 'success', { num: 10 });

    // 8 — fund nodeB
    addStep('wAsExtBFund', 'running');
    const addrB = await nodeB.getAddress();
    const txidB = await sendToAddress(addrB, 1);
    await mine(6);
    await sleep(3000);
    await nodeB.syncWallet();
    const balB = await nodeB.getBtcBalance();
    addStep('wAsExtBFund', 'success', { txid: txidB, address: addrB, balance: balB });

    // 9 — create UTXOs for nodeB
    addStep('wAsExtBCreateUtxos', 'running');
    await nodeB.syncWallet();
    await nodeB.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeB.syncWallet();
    addStep('wAsExtBCreateUtxos', 'success', { num: 10 });

    // 10 — issue asset on nodeA (regular node)
    addStep('wAsExtIssueAsset', 'running');
    const issued = await nodeA.issueAssetNia({ ticker: 'USDT', name: 'Tether', precision: 0, amounts: [1000] });
    const assetId = String(issued?.assetId ?? '');
    if (!assetId) throw new Error('Failed to issue asset');
    addStep('wAsExtIssueAsset', 'success', { assetId });

    // 11 — connect peers nodeA → nodeB
    addStep('wAsExtConnectPeers', 'running');
    const peerUriB = `${pubkeyB}@127.0.0.1:${basePortB + 1}`;
    const peerUriA = `${pubkeyA}@127.0.0.1:${basePortA + 1}`;
    console.log(`[wAsExt] connecting nodeA → ${peerUriB}`);
    try {
      await nodeA.connectPeer(peerUriB);
      console.log(`[wAsExt] connected to ${peerUriB}`);
    } catch (e: any) {
      if (isPoisonLike(e)) {
        addStep('wAsExtConnectPeers', 'error', undefined, e?.message ?? String(e));
        throw e;
      }
      console.warn(`[wAsExt] connectPeer ignored: ${e?.message ?? String(e)}`);
    }
    addStep('wAsExtConnectPeers', 'success', { peerUriB });

    // 12 — open asset channel nodeA → nodeB (600 units, 100k sat)
    // pushMsat must be 0: channel_signer.rs hardcodes push_value_msat=0 when calling VLS SetupChannel,
    // so any non-zero push causes VLS to reject validate_holder_commitment on the acceptor side.
    addStep('wAsExtOpenChannel', 'running');
    await nodeA.openChannel({
      peerPubkeyAndOptAddr: peerUriB,
      capacitySat: 100000,
      pushMsat: 3_500_000,
      public: false,
      withAnchors: true,
      assetId,
      assetAmount: 600,
    });

    let fundingTxid = '';
    let channelId = '';
    const fundDeadline = Date.now() + 120000;
    while (Date.now() < fundDeadline) {
      await nodeA.syncWallet();
      const channels: any[] = (await nodeA.listChannels()) ?? [];
      const ch = channels.find(
        (c: any) => (c.assetId ?? c.asset_id) === assetId && (c.fundingTxid ?? c.funding_txid) != null,
      );
      if (ch) {
        fundingTxid = String(ch.fundingTxid ?? ch.funding_txid ?? '');
        channelId = String(ch.channelId ?? ch.channel_id ?? '');
        break;
      }
      await sleep(1000);
    }
    if (!fundingTxid) throw new Error('Timeout waiting for funding tx');
    console.log(`[wAsExt] channelId=${channelId} fundingTxid=${fundingTxid}`);

    await mine(6);
    await sleep(3000);
    for (const [node, label] of [[nodeA, 'nodeA'], [nodeB, 'nodeB']] as [UTEXOWallet, string][]) {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        await node.syncWallet();
        const info = await node.getNodeInfo();
        const usable = Number(info?.numUsableChannels ?? 0);
        console.log(`[wAsExt] ${label} usableChannels=${usable}`);
        if (usable >= 1) break;
        await sleep(2000);
      }
    }
    await mine(6);
    addStep('wAsExtOpenChannel', 'success', { channelId, fundingTxid, assetId });

    // log asset balances after channel open to confirm push worked
    const balAfterA = await nodeA.getAssetBalance(assetId).catch(() => null);
    const balAfterB = await nodeB.getAssetBalance(assetId).catch(() => null);
    console.log(`[wAsExt] assetBalance after open — nodeA: ${JSON.stringify(balAfterA)}, nodeB: ${JSON.stringify(balAfterB)}`);
    const channelsA = await nodeA.listChannels().catch(() => []);
    const channelsB = await nodeB.listChannels().catch(() => []);
    console.log(`[wAsExt] nodeA channels: ${JSON.stringify(channelsA)}`);
    console.log(`[wAsExt] nodeB channels: ${JSON.stringify(channelsB)}`);

    // 13 — payment 1: nodeB (ext signer) creates asset invoice, nodeA (regular) pays
    addStep('wAsExtPayment1', 'running');
    const inv1 = await nodeB.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 100 } });
    console.log(`[wAsExt] createLightningInvoice raw response: ${JSON.stringify(inv1)}`);
    const invoice1 = String(inv1?.lnInvoice ?? '');
    console.log(`[wAsExt] invoice1 type=${typeof inv1?.lnInvoice} length=${invoice1.length} first60="${invoice1.substring(0, 60)}"`);
    console.log(`[wAsExt] invoice1 charCodes(0-5): ${Array.from(invoice1.substring(0, 6)).map(c => c.charCodeAt(0)).join(',')}`);
    console.log(`[wAsExt] calling nodeA.payLightningInvoice with invoice1`);
    const send1 = await nodeA.payLightningInvoice({ lnInvoice: invoice1 });
    const hash1 = String(send1?.txid ?? '');
    console.log(`[wAsExt] payment1 hash=${hash1}`);
    const pay1Deadline = Date.now() + 60000;
    while (Date.now() < pay1Deadline) {
      await nodeA.syncWallet();
      const status = await nodeA.getLightningSendRequest(hash1);
      console.log(`[wAsExt] payment1 status=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Payment1 failed: ${hash1}`);
      await sleep(2000);
    }
    addStep('wAsExtPayment1', 'success', { paymentHash: hash1, assetAmount: 100 });

    // 14 — restart nodeA (shutdown + reinit on same instance)
    addStep('wAsExtRestartNodeA', 'running');
    await nodeA.shutdown();
    await sleep(1000);
    await nodeA.reinit(unlockParams);
    console.log('[wAsExt] nodeA restarted via UTEXOWallet.reinit()');
    const restartDeadline = Date.now() + 120000;
    while (Date.now() < restartDeadline) {
      await nodeA.syncWallet();
      const info = await nodeA.getNodeInfo();
      const usable = Number(info?.numUsableChannels ?? 0);
      console.log(`[wAsExt] nodeA usableChannels after restart=${usable}`);
      if (usable >= 1) break;
      await sleep(2000);
    }
    addStep('wAsExtRestartNodeA', 'success', {});

    // 15 — payment 2: nodeB creates invoice, nodeA pays (after restart)
    addStep('wAsExtPayment2', 'running');
    const inv2 = await nodeB.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 50 } });
    const invoice2 = String(inv2?.lnInvoice ?? '');
    console.log(`[wAsExt] invoice2: ${invoice2.substring(0, 40)}...`);
    const send2 = await nodeA.payLightningInvoice({ lnInvoice: invoice2 });
    const hash2 = String(send2?.txid ?? '');
    console.log(`[wAsExt] payment2 hash=${hash2}`);
    const pay2Deadline = Date.now() + 60000;
    while (Date.now() < pay2Deadline) {
      await nodeA.syncWallet();
      const status = await nodeA.getLightningSendRequest(hash2);
      console.log(`[wAsExt] payment2 status=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Payment2 failed: ${hash2}`);
      await sleep(2000);
    }
    addStep('wAsExtPayment2', 'success', { paymentHash: hash2, assetAmount: 50 });

    // 16 — cooperative close channel nodeA → nodeB
    // After payments: nodeA channel=450, nodeB channel=150; nodeA off-chain=400
    // Expected after close: nodeA=850 (400+450), nodeB=150
    addStep('wAsExtCloseChannel', 'running');
    try { await nodeA.syncWallet(); } catch {}
    try { await nodeB.syncWallet(); } catch {}
    await nodeA.closeChannel(channelId, pubkeyB, false);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await sleep(20000);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await sleep(20000);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    addStep('wAsExtCloseChannel', 'success', { channelId });

    // 17 — wait for on-chain balances to settle
    addStep('wAsExtWaitBalances', 'running');
    const balDeadline = Date.now() + 170000;
    let lastSpendableA = -1;
    let lastSpendableB = -1;
    while (Date.now() < balDeadline) {
      try {
        const b = await nodeA.getAssetBalance(assetId);
        lastSpendableA = Number(b?.spendable ?? -1);
        console.log(`[wAsExt] waitBal nodeA spendable=${lastSpendableA} expected=850`);
      } catch (e: any) { console.warn(`[wAsExt] waitBal nodeA: ${e?.message}`); }
      try {
        const b = await nodeB.getAssetBalance(assetId);
        lastSpendableB = Number(b?.spendable ?? -1);
        console.log(`[wAsExt] waitBal nodeB spendable=${lastSpendableB} expected=150`);
      } catch (e: any) { console.warn(`[wAsExt] waitBal nodeB: ${e?.message}`); }
      if (lastSpendableA === 850 && lastSpendableB === 150) break;
      try { await nodeA.refreshWallet(); } catch {}
      try { await nodeB.refreshWallet(); } catch {}
      await sleep(12000);
    }
    if (lastSpendableA !== 850) throw new Error(`nodeA balance did not reach 850, last=${lastSpendableA}`);
    if (lastSpendableB !== 150) throw new Error(`nodeB balance did not reach 150, last=${lastSpendableB}`);
    addStep('wAsExtWaitBalances', 'success', { expectedA: 850, expectedB: 150 });

    // TODO iteration 2: nodeA → nodeB second channel (original direction)
    // addStep('wAsExt2ConnectPeers', 'running');
    // ...
    // addStep('wAsExt2OpenChannel', 'running');  // nodeA opens 500-unit channel to nodeB
    // ...
    // addStep('wAsExt2Payment', 'running');       // nodeB creates invoice, nodeA pays 100 units
    // ...
    // addStep('wAsExt2CloseChannel', 'running');  // nodeA closes, expected A=750, B=250
    // ...
    // addStep('wAsExt2WaitBalances', 'running');
    // ...

    // 18 — reconnect peers for second channel (nodeB signer → nodeA password)
    // NativeExternalRLNSigner (VLS) is the channel initiator here; this tests whether VLS
    // can open a channel. FundingGenerationReady is known to loop without producing a funding
    // tx when VLS is the funder — this step will time out if that Rust-layer bug is present.
    addStep('wAsExtRevConnectPeers', 'running');
    try {
      await nodeB.connectPeer(peerUriA);
    } catch (e: any) {
      if (isPoisonLike(e)) {
        addStep('wAsExtRevConnectPeers', 'error', undefined, e?.message ?? String(e));
        throw e;
      }
      console.warn(`[wAsExt] rev connectPeer ignored: ${e?.message ?? String(e)}`);
    }
    addStep('wAsExtRevConnectPeers', 'success', { peerUriA });

    // 19 — open second channel nodeB (VLS) → nodeA (100 units, 100k sat)
    // nodeB off-chain=150; nodeB puts 100 units into channel (off-chain→50), pushMsat to nodeA.
    // Channel after open: nodeB=100 units, nodeA=0 units.
    addStep('wAsExtRevOpenChannel', 'running');
    await nodeB.syncWallet();
    await nodeB.openChannel({
      peerPubkeyAndOptAddr: peerUriA,
      capacitySat: 100000,
      pushMsat: 3_500_000,
      public: false,
      withAnchors: true,
      assetId,
      assetAmount: 100,
    });

    let revFundingTxid = '';
    let revChannelId = '';
    const revFundDeadline = Date.now() + 120000;
    // nodeB is the initiator, so assetId appears in nodeB.listChannels().
    while (Date.now() < revFundDeadline) {
      await nodeB.syncWallet();
      const channels: any[] = (await nodeB.listChannels()) ?? [];
      const ch = channels.find(
        (c: any) =>
          (c.assetId ?? c.asset_id) === assetId &&
          (c.fundingTxid ?? c.funding_txid) != null,
      );
      if (ch) {
        revFundingTxid = String(ch.fundingTxid ?? ch.funding_txid ?? '');
        revChannelId = String(ch.channelId ?? ch.channel_id ?? '');
        break;
      }
      await sleep(1000);
    }
    if (!revFundingTxid) throw new Error('Timeout waiting for reverse funding tx');
    console.log(`[wAsExt] rev channelId=${revChannelId} fundingTxid=${revFundingTxid}`);

    // listChannels() returns fundingTxid as soon as FundingCreated is sent, but with
    // NativeExternalRLNSigner the VLS signing on the initiator (nodeB) side takes several
    // seconds, so the funding tx may not be broadcast yet. Mine in a retry loop.
    await sleep(5000);
    const revOpenDeadline = Date.now() + 120000;
    let revOpenDone = false;
    while (Date.now() < revOpenDeadline) {
      await mine(6);
      await sleep(3000);
      let allUsable = true;
      for (const [node, label] of [[nodeA, 'nodeA'], [nodeB, 'nodeB']] as [UTEXOWallet, string][]) {
        await node.syncWallet();
        const info = await node.getNodeInfo();
        const usable = Number(info?.numUsableChannels ?? 0);
        console.log(`[wAsExt] rev open ${label} usableChannels=${usable}`);
        if (usable < 1) allUsable = false;
      }
      if (allUsable) { revOpenDone = true; break; }
      await sleep(5000);
    }
    if (!revOpenDone) throw new Error('Reverse channel never became usable within 120s');
    await mine(6);
    addStep('wAsExtRevOpenChannel', 'success', { channelId: revChannelId, fundingTxid: revFundingTxid, assetId });

    // 20 — payment: nodeA creates invoice (50 units), nodeB (VLS initiator) pays
    // Channel: nodeB=100, nodeA=0; after payment: nodeB=50, nodeA=50
    addStep('wAsExtRevPayment', 'running');
    const invRev = await nodeA.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 50 } });
    const invoiceRev = String(invRev?.lnInvoice ?? '');
    const sendRev = await nodeB.payLightningInvoice({ lnInvoice: invoiceRev });
    const hashRev = String(sendRev?.txid ?? '');
    console.log(`[wAsExt] rev payment hash=${hashRev}`);
    const revPayDeadline = Date.now() + 60000;
    while (Date.now() < revPayDeadline) {
      await nodeB.syncWallet();
      const status = await nodeB.getLightningSendRequest(hashRev);
      console.log(`[wAsExt] rev payment status=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Rev payment failed: ${hashRev}`);
      await sleep(2000);
    }
    addStep('wAsExtRevPayment', 'success', { paymentHash: hashRev, assetAmount: 50 });

    // 21 — cooperative close reverse channel (nodeA initiates)
    // Expected after close: nodeA=850+50=900, nodeB=50+50=100
    addStep('wAsExtRevCloseChannel', 'running');
    try { await nodeA.syncWallet(); } catch {}
    try { await nodeB.syncWallet(); } catch {}
    await nodeA.closeChannel(revChannelId, pubkeyB, false);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await sleep(20000);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await sleep(20000);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    addStep('wAsExtRevCloseChannel', 'success', { channelId: revChannelId });

    // 22 — wait for settled balances: A=900, B=100
    addStep('wAsExtRevWaitBalances', 'running');
    const revBalDeadline = Date.now() + 300000;
    let lastSpendableRevA = -1;
    let lastSpendableRevB = -1;
    while (Date.now() < revBalDeadline) {
      try {
        const b = await nodeA.getAssetBalance(assetId);
        lastSpendableRevA = Number(b?.spendable ?? -1);
        console.log(`[wAsExt] rev waitBal nodeA spendable=${lastSpendableRevA} expected=900`);
      } catch (e: any) { console.warn(`[wAsExt] rev waitBal nodeA: ${e?.message}`); }
      try {
        const b = await nodeB.getAssetBalance(assetId);
        lastSpendableRevB = Number(b?.spendable ?? -1);
        console.log(`[wAsExt] rev waitBal nodeB spendable=${lastSpendableRevB} expected=100`);
      } catch (e: any) { console.warn(`[wAsExt] rev waitBal nodeB: ${e?.message}`); }
      if (lastSpendableRevA === 900 && lastSpendableRevB === 100) break;
      try { await nodeA.refreshWallet(); } catch {}
      try { await nodeB.refreshWallet(); } catch {}
      await sleep(12000);
    }
    if (lastSpendableRevA !== 900) throw new Error(`nodeA rev balance did not reach 900, last=${lastSpendableRevA}`);
    if (lastSpendableRevB !== 100) throw new Error(`nodeB rev balance did not reach 100, last=${lastSpendableRevB}`);
    addStep('wAsExtRevWaitBalances', 'success', { expectedA: 900, expectedB: 100 });

    // TODO iteration 2: nodeB RGB on-chain sends 150 back to nodeA
    // addStep('wAsExtRgbSendBtoA', 'running');
    // const invA = await nodeA.blindReceive({ minConfirmations: 1 });
    // await nodeB.send({ invoice: invA.invoice, assetId, amount: 150, donation: true, feeRate: 1, minConfirmations: 1 });
    // await mine(1);
    // await nodeA.syncWallet();
    // await nodeA.refreshWallet();
    // await nodeA.refreshWallet();
    // await nodeB.refreshWallet();
    // addStep('wAsExtRgbSendBtoA', 'success', { amount: 150, recipientId: invA.recipientId.substring(0, 20) + '...' });

    // TODO iteration 2: final balances: A=1000, B=0
    // addStep('wAsExtFinalBalances', 'running');
    // const [finalA, finalB] = await Promise.all([
    //   nodeA.getAssetBalance(assetId),
    //   nodeB.getAssetBalance(assetId).catch(() => ({ spendable: 0 })),
    // ]);
    // addStep('wAsExtFinalBalances', 'success', {
    //   spendableA: finalA?.spendable ?? null,
    //   spendableB: finalB?.spendable ?? null,
    // });

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (nodeA) { try { await nodeA.destroy(); } catch {} }
    if (nodeB) { try { await nodeB.destroy(); } catch {} }
    endExclusiveFlow(flowName);
  }
}

export async function runRLNUtexoPaymentFlow() {
  const flowName = 'runRLNUtexoPaymentFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();

  let nodeA: UTEXOWallet | null = null;
  let nodeB: UTEXOWallet | null = null;
  let nodeC: UTEXOWallet | null = null;

  try {
    const network = 'regtest' as const;
    const rpcHost = readEnv('RLN_BITCOIND_RPC_HOST') ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
    const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
    const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
    const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
    const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
    const proxyEndpoint = readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;

    const unlockParams = {
      bitcoindRpcUsername: rpcUsername,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl,
      proxyEndpoint,
      announceAddresses: [] as string[],
      announceAlias: null as string | null,
    };
    console.log('unlockParams', unlockParams);

    const keysA = await createWallet(network);
    const keysB = await createWallet(network);
    const keysC = await createWallet(network);
    const nodeAPassword = 'nodeApass';
    const nodeBPassword = 'nodeBpass';
    const nodeCPassword = 'nodeCpass';

    const basePortA = 21000 + Math.floor(Math.random() * 5000);
    const basePortB = basePortA + 100;
    const basePortC = basePortA + 200;
    const ts = Date.now();
    const storageDirUriA = `${documentDirectory ?? ''}rln_utexo_pay_a_${ts}`;
    const storageDirUriB = `${documentDirectory ?? ''}rln_utexo_pay_b_${ts}`;
    const storageDirUriC = `${documentDirectory ?? ''}rln_utexo_pay_c_${ts}`;
    await FileSystem.makeDirectoryAsync(storageDirUriA, { intermediates: true });
    await FileSystem.makeDirectoryAsync(storageDirUriB, { intermediates: true });
    await FileSystem.makeDirectoryAsync(storageDirUriC, { intermediates: true });
    const storageDirA = storageDirUriA.replace('file://', '');
    const storageDirB = storageDirUriB.replace('file://', '');
    const storageDirC = storageDirUriC.replace('file://', '');

    nodeA = new UTEXOWallet(
      {
        storageDirPath: storageDirA,
        daemonListeningPort: basePortA,
        ldkPeerListeningPort: basePortA + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysA.accountXpubVanilla,
        xpubCol: keysA.accountXpubColored,
        masterFingerprint: keysA.masterFingerprint,
      },
      new PasswordRLNSigner(nodeAPassword, keysA.mnemonic),
    );
    nodeB = new UTEXOWallet(
      {
        storageDirPath: storageDirB,
        daemonListeningPort: basePortB,
        ldkPeerListeningPort: basePortB + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysB.accountXpubVanilla,
        xpubCol: keysB.accountXpubColored,
        masterFingerprint: keysB.masterFingerprint,
      },
      new PasswordRLNSigner(nodeBPassword, keysB.mnemonic),
    );
    nodeC = new UTEXOWallet(
      {
        storageDirPath: storageDirC,
        daemonListeningPort: basePortC,
        ldkPeerListeningPort: basePortC + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysC.accountXpubVanilla,
        xpubCol: keysC.accountXpubColored,
        masterFingerprint: keysC.masterFingerprint,
      },
      new PasswordRLNSigner(nodeCPassword, keysC.mnemonic),
    );

    addStep('wPayAInit', 'running');
    await nodeA.init();
    addStep('wPayAInit', 'success', { storageDirPath: storageDirA });

    addStep('wPayAUnlock', 'running');
    await nodeA.unlock(unlockParams);
    addStep('wPayAUnlock', 'success', {});

    // issue #23 — optional regression check: estimateFeeRate can throw Conflict right after unlock; not required for the flow.
    // const feeEstimate = await nodeA.estimateFeeRate(6);
    // console.log(`[wPay][#23] estimateFeeRate(6) type=${typeof feeEstimate} value=${feeEstimate}`);
    // if (typeof feeEstimate !== 'number') {
    //   console.error(`[wPay][#23] REGRESSION: estimateFeeRate returned ${JSON.stringify(feeEstimate)} instead of a number`);
    // }

    addStep('wPayBInit', 'running');
    await nodeB.init();
    addStep('wPayBInit', 'success', { storageDirPath: storageDirB });

    addStep('wPayBUnlock', 'running');
    await nodeB.unlock(unlockParams);
    addStep('wPayBUnlock', 'success', {});

    addStep('wPayCInit', 'running');
    await nodeC.init();
    addStep('wPayCInit', 'success', { storageDirPath: storageDirC });

    addStep('wPayCUnlock', 'running');
    await nodeC.unlock(unlockParams);
    addStep('wPayCUnlock', 'success', {});

    addStep('wPayAFund', 'running');
    const addrA = await nodeA.getAddress();
    const txidA = await sendToAddress(addrA, 1);
    await mine(6);
    await sleep(3000);
    await nodeA.syncWallet();
    const balA = await nodeA.getBtcBalance();
    addStep('wPayAFund', 'success', { txid: txidA, address: addrA, balance: balA });

    addStep('wPayACreateUtxos', 'running');
    await nodeA.syncWallet();
    await nodeA.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeA.syncWallet();
    addStep('wPayACreateUtxos', 'success', { num: 10 });

    addStep('wPayBFund', 'running');
    const addrB = await nodeB.getAddress();
    const txidB = await sendToAddress(addrB, 1);
    await mine(6);
    await sleep(3000);
    await nodeB.syncWallet();
    const balB = await nodeB.getBtcBalance();
    addStep('wPayBFund', 'success', { txid: txidB, address: addrB, balance: balB });

    addStep('wPayBCreateUtxos', 'running');
    await nodeB.syncWallet();
    await nodeB.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeB.syncWallet();
    addStep('wPayBCreateUtxos', 'success', { num: 10 });

    addStep('wPayCFund', 'running');
    const addrC = await nodeC.getAddress();
    const txidC = await sendToAddress(addrC, 1);
    await mine(6);
    await sleep(3000);
    await nodeC.syncWallet();
    const balC = await nodeC.getBtcBalance();
    addStep('wPayCFund', 'success', { txid: txidC, address: addrC, balance: balC });

    addStep('wPayCCreateUtxos', 'running');
    await nodeC.syncWallet();
    await nodeC.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeC.syncWallet();
    addStep('wPayCCreateUtxos', 'success', { num: 10 });

    addStep('wPayIssueAsset', 'running');
    const issued = await nodeA.issueAssetNia({ ticker: 'USDT', name: 'Tether', precision: 0, amounts: [1000] });
    const assetId = String(issued?.assetId ?? '');
    if (!assetId) throw new Error('Failed to issue asset');
    addStep('wPayIssueAsset', 'success', { assetId });

    // issue #22/#28 — listUnspents assignment must be {type:'Fungible', amount:N} on both platforms
    const unspentsAfterIssue = await nodeA.listUnspents();
    const allocsAfterIssue = unspentsAfterIssue.flatMap((u) => u.rgbAllocations ?? []);
    console.log(`[wPay][#22] listUnspents after issue: ${allocsAfterIssue.length} allocation(s)`);
    for (const alloc of allocsAfterIssue) {
      console.log(`[wPay][#22] assignment=${JSON.stringify(alloc.assignment)} settled=${alloc.settled}`);
      if ((alloc.assignment as any)?.type === 'type') {
        console.error(`[wPay][#22] REGRESSION: assignment.type is the literal string "type" — serialization bug`);
      }
    }

    const infoA = await nodeA.getNodeInfo();
    const infoB = await nodeB.getNodeInfo();
    const pubkeyA = String(infoA?.pubkey ?? '');
    const pubkeyB = String(infoB?.pubkey ?? '');
    addStep('wPayNodeInfos', 'success', {
      pubkeyA: pubkeyA.substring(0, 16) + '...',
      pubkeyB: pubkeyB.substring(0, 16) + '...',
    });

    addStep('wPayConnectPeers', 'running');
    const peerUriB = `${pubkeyB}@127.0.0.1:${basePortB + 1}`;
    try {
      await nodeA.connectPeer(peerUriB);
    } catch (e: any) {
      if (isPoisonLike(e)) {
        addStep('wPayConnectPeers', 'error', undefined, e?.message ?? String(e));
        throw e;
      }
      console.warn(`[wPay] connectPeer ignored: ${e?.message ?? String(e)}`);
    }
    addStep('wPayConnectPeers', 'success', { peerUriB });

    // nodeA opens asset channel to nodeB (600 units pushed, 100k sat)
    addStep('wPayOpenChannel', 'running');
    await nodeA.openChannel({
      peerPubkeyAndOptAddr: peerUriB,
      capacitySat: 100000,
      pushMsat: 3_500_000,
      public: true,
      withAnchors: true,
      assetId,
      assetAmount: 600,
    });

    let fundingTxid = '';
    let channelId = '';
    const fundDeadline = Date.now() + 120000;
    while (Date.now() < fundDeadline) {
      await nodeA.syncWallet();
      const channels: any[] = (await nodeA.listChannels()) ?? [];
      const ch = channels.find(
        (c: any) => (c.assetId ?? c.asset_id) === assetId && (c.fundingTxid ?? c.funding_txid) != null,
      );
      if (ch) {
        fundingTxid = String(ch.fundingTxid ?? ch.funding_txid ?? '');
        channelId = String(ch.channelId ?? ch.channel_id ?? '');
        break;
      }
      await sleep(1000);
    }
    if (!fundingTxid) throw new Error('Timeout waiting for funding tx');
    console.log(`[wPay] channelId=${channelId} fundingTxid=${fundingTxid}`);

    await mine(6);
    await sleep(3000);
    for (const [node, label] of [[nodeA, 'nodeA'], [nodeB, 'nodeB']] as [UTEXOWallet, string][]) {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        await node.syncWallet();
        const info = await node.getNodeInfo();
        const usable = Number(info?.numUsableChannels ?? 0);
        console.log(`[wPay] ${label} usableChannels=${usable}`);
        if (usable >= 1) break;
        await sleep(2000);
      }
    }
    await mine(6);
    addStep('wPayOpenChannel', 'success', { channelId, fundingTxid });

    addStep('wPayAssetBalanceA', 'running');
    const bal0 = await nodeA.getAssetBalance(assetId);
    addStep('wPayAssetBalanceA', 'success', { spendable: bal0?.spendable ?? null });

    // inv1: B creates (100 asset units), A pays
    addStep('wPayInvoice1', 'running');
    const inv1Resp = await nodeB.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 100 } });
    const invoice1 = String(inv1Resp?.lnInvoice ?? '');
    const send1Resp = await nodeA.payLightningInvoice({ lnInvoice: invoice1 });
    const hash1 = String(send1Resp?.txid ?? '');
    const pay1Deadline = Date.now() + 60000;
    while (Date.now() < pay1Deadline) {
      await nodeA.syncWallet();
      const status = await nodeA.getLightningSendRequest(hash1);
      console.log(`[wPay] inv1 sendStatus=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Invoice1 payment failed: ${hash1}`);
      await sleep(2000);
    }
    addStep('wPayInvoice1', 'success', { paymentHash: hash1, assetAmount: 100 });

    // inv2: A creates (50 asset units), B pays
    addStep('wPayInvoice2', 'running');
    const inv2Resp = await nodeA.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 50 } });
    const invoice2 = String(inv2Resp?.lnInvoice ?? '');
    const send2Resp = await nodeB.payLightningInvoice({ lnInvoice: invoice2 });
    const hash2 = String(send2Resp?.txid ?? '');
    const pay2Deadline = Date.now() + 60000;
    while (Date.now() < pay2Deadline) {
      await nodeB.syncWallet();
      const status = await nodeB.getLightningSendRequest(hash2);
      console.log(`[wPay] inv2 sendStatus=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Invoice2 payment failed: ${hash2}`);
      await sleep(2000);
    }
    addStep('wPayInvoice2', 'success', { paymentHash: hash2, assetAmount: 50 });

    // inv3: B creates (50 asset units), A pays
    addStep('wPayInvoice3', 'running');
    const inv3Resp = await nodeB.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 50 } });
    const invoice3 = String(inv3Resp?.lnInvoice ?? '');
    const send3Resp = await nodeA.payLightningInvoice({ lnInvoice: invoice3 });
    const hash3 = String(send3Resp?.txid ?? '');
    const pay3Deadline = Date.now() + 60000;
    while (Date.now() < pay3Deadline) {
      await nodeA.syncWallet();
      const status = await nodeA.getLightningSendRequest(hash3);
      console.log(`[wPay] inv3 sendStatus=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Invoice3 payment failed: ${hash3}`);
      await sleep(2000);
    }
    addStep('wPayInvoice3', 'success', { paymentHash: hash3, assetAmount: 50 });

    // inv4: A creates (50 asset units), B pays
    addStep('wPayInvoice4', 'running');
    const inv4Resp = await nodeA.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 50 } });
    const invoice4 = String(inv4Resp?.lnInvoice ?? '');
    const send4Resp = await nodeB.payLightningInvoice({ lnInvoice: invoice4 });
    const hash4 = String(send4Resp?.txid ?? '');
    const pay4Deadline = Date.now() + 60000;
    while (Date.now() < pay4Deadline) {
      await nodeB.syncWallet();
      const status = await nodeB.getLightningSendRequest(hash4);
      console.log(`[wPay] inv4 sendStatus=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Invoice4 payment failed: ${hash4}`);
      await sleep(2000);
    }
    addStep('wPayInvoice4', 'success', { paymentHash: hash4, assetAmount: 50 });

    // Cooperative close
    addStep('wPayCloseChannel', 'running');
    try { await nodeA.syncWallet(); } catch {}
    try { await nodeB.syncWallet(); } catch {}
    await nodeA.closeChannel(channelId, pubkeyB, false);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await sleep(20000);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await sleep(20000);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    addStep('wPayCloseChannel', 'success', { channelId });

    // After close: A=950 (400 settled + 550 from channel), B=50
    addStep('wPayWaitBalances', 'running');
    const balDeadlineA = Date.now() + 70000;
    let lastSpendableA = -1;
    while (Date.now() < balDeadlineA) {
      try {
        const b = await nodeA.getAssetBalance(assetId);
        lastSpendableA = Number(b?.spendable ?? -1);
        console.log(`[wPay] waitBal nodeA spendable=${lastSpendableA} expected=950`);
        if (lastSpendableA === 950) break;
      } catch (e: any) { console.warn(`[wPay] waitBal nodeA: ${e?.message}`); }
      try { await nodeA.refreshWallet(); } catch {}
      await sleep(2000);
    }
    if (lastSpendableA !== 950) throw new Error(`nodeA balance did not reach 950, last=${lastSpendableA}`);

    const balDeadlineB = Date.now() + 70000;
    let lastSpendableB = -1;
    while (Date.now() < balDeadlineB) {
      try {
        const b = await nodeB.getAssetBalance(assetId);
        lastSpendableB = Number(b?.spendable ?? -1);
        console.log(`[wPay] waitBal nodeB spendable=${lastSpendableB} expected=50`);
        if (lastSpendableB === 50) break;
      } catch (e: any) { console.warn(`[wPay] waitBal nodeB: ${e?.message}`); }
      try { await nodeB.refreshWallet(); } catch {}
      await sleep(2000);
    }
    if (lastSpendableB !== 50) throw new Error(`nodeB balance did not reach 50, last=${lastSpendableB}`);
    addStep('wPayWaitBalances', 'success', { expectedA: 950, expectedB: 50 });

    // RGB on-chain sends to nodeC (A sends 925, B sends 25)
    addStep('wPayRgbSendA', 'running');
    const invC1 = await nodeC.blindReceive({ minConfirmations: 1, durationSeconds: 3600 });
    await nodeA.send({ invoice: invC1.invoice, assetId, amount: 925, donation: true, feeRate: 1, minConfirmations: 1 });
    await mine(1);
    await nodeC.syncWallet();
    await nodeC.refreshWallet();
    await nodeC.refreshWallet();
    await nodeA.refreshWallet();
    addStep('wPayRgbSendA', 'success', { amount: 925, recipientId: invC1.recipientId.substring(0, 20) + '...' });

    addStep('wPayRgbSendB', 'running');
    const invC2 = await nodeC.blindReceive({ minConfirmations: 1, durationSeconds: 3600 });
    await nodeB.send({ invoice: invC2.invoice, assetId, amount: 25, donation: true, feeRate: 1, minConfirmations: 1 });
    await mine(1);
    await nodeC.syncWallet();
    await nodeC.refreshWallet();
    await nodeC.refreshWallet();
    await nodeB.refreshWallet();
    addStep('wPayRgbSendB', 'success', { amount: 25, recipientId: invC2.recipientId.substring(0, 20) + '...' });

    // ── Regression diagnostics ────────────────────────────────────────────────

    addStep('wPayDiagChecks', 'running');

    // issue #22/#28 — assignment shape on nodeC after receiving
    const unspentsC = await nodeC.listUnspents();
    const allocsC = unspentsC.flatMap((u) => u.rgbAllocations ?? []);
    console.log(`[wPay][#22] nodeC listUnspents: ${allocsC.length} allocation(s)`);
    for (const alloc of allocsC) {
      console.log(`[wPay][#22] assignment=${JSON.stringify(alloc.assignment)} settled=${alloc.settled}`);
      if ((alloc.assignment as any)?.type === 'type') {
        console.error(`[wPay][#22] REGRESSION: assignment.type is literal "type" — serialization bug still present`);
      }
      if (alloc.assignment?.type === 'Fungible' && typeof alloc.assignment?.amount === 'number') {
        console.log(`[wPay][#22] ✓ Fungible assignment shape correct: amount=${alloc.assignment.amount}`);
      }
    }

    // issue #29 — Transfer.expiration field is present and correctly named
    const transfersC = await nodeC.listTransfers(assetId);
    console.log(`[wPay][#29] nodeC listTransfers: ${transfersC.length} transfer(s)`);
    for (const t of transfersC) {
      const exp = t.expiration;
      console.log(`[wPay][#29] transfer idx=${t.idx} status=${t.status} expiration=${exp ?? 'null'}`);
      if (typeof exp !== 'number') {
        console.error(`[wPay][#29] REGRESSION: expiration is ${JSON.stringify(exp)} — expected a Unix timestamp number`);
      } else {
        console.log(`[wPay][#29] ✓ expiration is a number (Unix ts=${exp}, ~${Math.round((exp - Date.now() / 1000) / 60)}min from now)`);
      }
    }

    // issue #27 — failTransfers with no batchTransferIdx returns false (no expired transfers)
    const failResultNull = await nodeC.failTransfers({ noAssetOnly: false });
    console.log(`[wPay][#27] failTransfers(undefined) transfersChanged=${failResultNull} — expected false (no expired transfers)`);
    if (failResultNull === true) {
      console.warn(`[wPay][#27] failTransfers(undefined) unexpectedly changed transfers — check for expired pending UTXOs`);
    }

    // issue #27 — failTransfers with a specific batchTransferIdx on a settled transfer should throw
    const settledTransfer = transfersC.find((t) => t.status === 'Settled');
    if (settledTransfer) {
      try {
        await nodeC.failTransfers({ batchTransferIdx: settledTransfer.batchTransferIdx, noAssetOnly: false });
        console.error(`[wPay][#27] UNEXPECTED: failTransfers on Settled transfer should have thrown CannotFailBatchTransfer`);
      } catch (e: any) {
        console.log(`[wPay][#27] ✓ failTransfers on Settled correctly threw: ${e?.message ?? String(e)}`);
      }
    }

    addStep('wPayDiagChecks', 'success', {
      allocCount: allocsC.length,
      transferCount: transfersC.length,
    });

    // ── Final balances: A=25, B=25, C=950
    addStep('wPayFinalBalances', 'running');
    const [finalA, finalB, finalC] = await Promise.all([
      nodeA.getAssetBalance(assetId),
      nodeB.getAssetBalance(assetId),
      nodeC.getAssetBalance(assetId),
    ]);
    addStep('wPayFinalBalances', 'success', {
      spendableA: finalA?.spendable ?? null,
      spendableB: finalB?.spendable ?? null,
      spendableC: finalC?.spendable ?? null,
    });

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (nodeA) { try { await nodeA.destroy(); } catch {} }
    if (nodeB) { try { await nodeB.destroy(); } catch {} }
    if (nodeC) { try { await nodeC.destroy(); } catch {} }
    endExclusiveFlow(flowName);
  }
}

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
    const network = (process.env.EXPO_PUBLIC_UTEXO_NETWORK?.trim() || 'utexo') as any;
    const rpcUsername = process.env.EXPO_PUBLIC_UTEXO_BITCOIND_RPC_USERNAME?.trim() ?? '';
    const rpcPassword = process.env.EXPO_PUBLIC_UTEXO_BITCOIND_RPC_PASSWORD?.trim() ?? '';
    const rpcHost = process.env.EXPO_PUBLIC_UTEXO_BITCOIND_RPC_HOST?.trim() ?? '';
    const rpcPort = Number(process.env.EXPO_PUBLIC_UTEXO_BITCOIND_RPC_PORT?.trim() ?? '38332');
    const indexerUrl = process.env.EXPO_PUBLIC_UTEXO_INDEXER_URL?.trim() ?? 'https://esplora-api.utexo.com';
    const proxyEndpoint = process.env.EXPO_PUBLIC_UTEXO_PROXY_ENDPOINT?.trim() ?? 'rpcs://rgb-proxy-utexo.utexo.com/json-rpc';

    // VSS URL must stay as a loopback address — the native binary only accepts
    // localhost/127.0.0.1 over plain HTTP. On Android use `adb reverse tcp:PORT tcp:PORT`
    // so that 127.0.0.1:PORT on the emulator tunnels to the host.
    const vssUrl = process.env.EXPO_PUBLIC_UTEXO_VSS_URL?.trim() ?? null;

    if (!rpcHost) throw new Error('EXPO_PUBLIC_UTEXO_BITCOIND_RPC_HOST not set — configure .env');
    if (!vssUrl) throw new Error('EXPO_PUBLIC_UTEXO_VSS_URL not set — add it to .env');

    const unlockParams = {
      bitcoindRpcUsername: rpcUsername,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl,
      proxyEndpoint,
      announceAddresses: [] as string[],
      announceAlias: null as string | null,
    };

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
      xpubVan: keysA.accountXpubVanilla,
      xpubCol: keysA.accountXpubColored,
      masterFingerprint: keysA.masterFingerprint,
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
        xpubVan: keysA.accountXpubVanilla,
        xpubCol: keysA.accountXpubColored,
        masterFingerprint: keysA.masterFingerprint,
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
        xpubVan: keysB.accountXpubVanilla,
        xpubCol: keysB.accountXpubColored,
        masterFingerprint: keysB.masterFingerprint,
      },
      new PasswordRLNSigner(password, keysB.mnemonic),
    );
    await wallet.init();
    await wallet.unlock(unlockParams);
    await nodeB.init();
    await nodeB.unlock(unlockParams);
    const nodeBInfo = await nodeB.getNodeInfo();
    const pubkeyB = String(nodeBInfo?.pubkey ?? '');
    addStep('vssCreateWallets', 'success', { vssUrl, network, pubkeyB: pubkeyB.substring(0, 16) + '...' });

    // 2 — get deposit address + poll up to 3 min for BTC balance
    addStep('vssFundWallet', 'running');
    const address = await wallet.getAddress();
    let balance: any = null;
    const fundDeadline = Date.now() + 3 * 60 * 1000;
    while (Date.now() < fundDeadline) {
      try {
        await wallet.syncWallet();
        balance = await wallet.getBtcBalance();
        if (Number(balance?.vanilla?.spendable ?? 0) > 0) break;
      } catch (e: any) {
        console.warn(`[vss] waitForFunding: ${e?.message}`);
      }
      await sleep(15000);
    }
    const hasFunds = Number(balance?.vanilla?.spendable ?? 0) > 0;
    addStep('vssFundWallet', 'success', {
      address,
      balance,
      hasFunds,
      note: hasFunds ? undefined : 'No balance — asset/channel steps skipped; VSS KV replication still tested',
    });

    let assetId: string | null = null;
    let preWipeBalance: any = null;
    let channelId: string = '';

    if (hasFunds) {
      // 3 — create UTXOs for RGB operations
      addStep('vssCreateUtxos', 'running');
      await wallet.syncWallet();
      await wallet.createUtxos({ upTo: false, num: 5, feeRate: 3 });
      const utxoDeadline = Date.now() + 45 * 60 * 1000;
      while (Date.now() < utxoDeadline) {
        await sleep(20000);
        await wallet.syncWallet();
        const unspents = await wallet.listUnspents().catch(() => []);
        const confirmed = unspents.filter((u: any) => !(u.rgbAllocations?.length > 0));
        console.log(`[vss] UTXO confirmation check — rgb-ready=${confirmed.length}`);
        if (confirmed.length >= 5) break;
      }
      addStep('vssCreateUtxos', 'success', { num: 5 });

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
      try { await wallet.connectPeer(peerUriB); } catch {}
      await sleep(1000);
      const openResp = await wallet.openChannel({
        peerPubkeyAndOptAddr: peerUriB,
        capacitySat: 200000,
        pushMsat: 0,
        public: true,
        withAnchors: true,
      });
      const tempChannelId = String(openResp?.temporaryChannelId ?? '');
      const channelDeadline = Date.now() + 20 * 60 * 1000;
      while (Date.now() < channelDeadline) {
        await wallet.syncWallet();
        const info = await wallet.getNodeInfo();
        if (Number(info?.numUsableChannels ?? 0) >= 1) break;
        await sleep(30000);
      }
      const channelsA = await wallet.listChannels() ?? [];
      const channel = (channelsA as any[]).find((c: any) => c.isUsable);
      channelId = String(channel?.channelId ?? tempChannelId);
      addStep('vssOpenChannel', 'success', {
        channelId: channelId.substring(0, 16) + '...',
        capacitySat: Number(channel?.capacitySat ?? 200000),
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
        xpubVan: keysA.accountXpubVanilla,
        xpubCol: keysA.accountXpubColored,
        masterFingerprint: keysA.masterFingerprint,
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

export async function runRlnVssFlow() {
  const flowName = 'runRlnVssFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();

  let wallet: UTEXOWallet | null = null;
  let nodeB: UTEXOWallet | null = null;
  let walletRestored: UTEXOWallet | null = null;

  try {
    const network = 'regtest' as const;
    const rpcHost = readEnv('RLN_BITCOIND_RPC_HOST') ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
    const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
    const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
    const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
    const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
    const proxyEndpoint = readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;
    const vssUrl = (() => {
      const raw = readEnv('RLN_VSS_URL')?.trim() ?? null;
      return raw ?? null;
    })();

    if (!vssUrl) throw new Error('EXPO_PUBLIC_RLN_VSS_URL not set — add it to .env');

    const unlockParams = {
      bitcoindRpcUsername: rpcUsername,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl,
      proxyEndpoint,
      announceAddresses: [] as string[],
      announceAlias: null as string | null,
    };

    const keysA = await createWallet(network);
    const keysB = await createWallet(network);
    const password = 'vssFlowPass';
    const ts = Date.now();
    const basePort = 26000 + Math.floor(Math.random() * 4000);

    const storageDirAUri = `${documentDirectory ?? ''}rln_vss_rgt_a_${ts}`;
    const storageDirBUri = `${documentDirectory ?? ''}rln_vss_rgt_b_${ts}`;
    await FileSystem.makeDirectoryAsync(storageDirAUri, { intermediates: true });
    await FileSystem.makeDirectoryAsync(storageDirBUri, { intermediates: true });
    const storageDirA = storageDirAUri.replace('file://', '');
    const storageDirB = storageDirBUri.replace('file://', '');

    // 1 — create nodeA (VSS-enabled) + nodeB (plain)
    addStep('vssCreateWallets', 'running');
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
        xpubVan: keysA.accountXpubVanilla,
        xpubCol: keysA.accountXpubColored,
        masterFingerprint: keysA.masterFingerprint,
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
        xpubVan: keysB.accountXpubVanilla,
        xpubCol: keysB.accountXpubColored,
        masterFingerprint: keysB.masterFingerprint,
      },
      new PasswordRLNSigner(password, keysB.mnemonic),
    );
    await wallet.init();
    await wallet.unlock(unlockParams);
    await nodeB.init();
    await nodeB.unlock(unlockParams);
    const nodeBInfo = await nodeB.getNodeInfo();
    const pubkeyB = String(nodeBInfo?.pubkey ?? '');
    addStep('vssCreateWallets', 'success', { vssUrl, network, pubkeyB: pubkeyB.substring(0, 16) + '...' });

    // 2 — fund nodeA
    addStep('vssFundWallet', 'running');
    const address = await wallet.getAddress();
    const txid = await sendToAddress(address, 1);
    await mine(6);
    await sleep(3000);
    await wallet.syncWallet();
    const btcBalance = await wallet.getBtcBalance();
    addStep('vssFundWallet', 'success', { txid, spendable: btcBalance?.vanilla?.spendable });

    // 3 — create UTXOs for RGB operations
    addStep('vssCreateUtxos', 'running');
    await wallet.createUtxos({ upTo: false, num: 5, feeRate: 3 });
    await mine(1);
    await sleep(2000);
    await wallet.syncWallet();
    addStep('vssCreateUtxos', 'success', { num: 5 });

    // 4 — issue NIA asset
    addStep('vssIssueAssetNia', 'running');
    await wallet.syncWallet();
    const issued = await wallet.issueAssetNia({ ticker: 'VDMO', name: 'VssDemo', precision: 0, amounts: [500] });
    const assetId = String(issued?.assetId ?? '');
    if (!assetId) throw new Error('Failed to issue asset');
    await wallet.refreshWallet();
    const preWipeBalance = await wallet.getAssetBalance(assetId);
    addStep('vssIssueAssetNia', 'success', { assetId: assetId.substring(0, 20) + '...', spendable: preWipeBalance?.spendable });

    // 5 — open BTC channel nodeA → nodeB
    addStep('vssOpenChannel', 'running');
    const peerUriB = `${pubkeyB}@127.0.0.1:${basePort + 101}`;
    try { await wallet.connectPeer(peerUriB); } catch {}
    await sleep(1000);
    const openResp = await wallet.openChannel({
      peerPubkeyAndOptAddr: peerUriB,
      capacitySat: 200000,
      pushMsat: 0,
      public: true,
      withAnchors: true,
    });
    const tempChannelId = String(openResp?.temporaryChannelId ?? '');
    await mine(6);
    await sleep(3000);
    // wait for channel to be usable on both nodes
    for (const [node, label] of [[wallet, 'nodeA'], [nodeB, 'nodeB']] as [UTEXOWallet, string][]) {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        await node.syncWallet();
        const info = await node.getNodeInfo();
        const usable = Number(info?.numUsableChannels ?? 0);
        console.log(`[vss] ${label} usableChannels=${usable}`);
        if (usable >= 1) break;
        await sleep(2000);
      }
    }
    const channelsA = await wallet.listChannels() ?? [];
    const channel = (channelsA as any[]).find((c: any) => c.isUsable);
    const channelId = String(channel?.channelId ?? tempChannelId);
    const channelCapacity = Number(channel?.capacitySat ?? 200000);
    addStep('vssOpenChannel', 'success', { channelId: channelId.substring(0, 16) + '...', capacitySat: channelCapacity });

    const nodeInfoA = await wallet.getNodeInfo();
    const pubkeyA = String(nodeInfoA?.pubkey ?? '');

    // 6 — shutdown nodeA (keep nodeB running), delete nodeA local state
    addStep('vssDeleteState', 'running');
    await wallet.shutdown();
    wallet = null;
    await FileSystem.deleteAsync(storageDirAUri, { idempotent: true });
    const restoreDirUri = `${documentDirectory ?? ''}rln_vss_rgt_restore_${ts}`;
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
        xpubVan: keysA.accountXpubVanilla,
        xpubCol: keysA.accountXpubColored,
        masterFingerprint: keysA.masterFingerprint,
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

    // 8 — verify restored state: pubkey, BTC balance, channel still present
    addStep('vssVerifyRestoredWallet', 'running');
    const restoredInfo = await walletRestored!.getNodeInfo();
    const restoredPubkey = String(restoredInfo?.pubkey ?? '');
    console.log(`[vss] restored pubkey=${restoredPubkey.substring(0, 16)}...`);

    await walletRestored!.syncWallet();

    let restoredBtcBalance: any = null;
    try {
      restoredBtcBalance = await walletRestored!.getBtcBalance();
      console.log('[vss] restored btcBalance:', JSON.stringify(restoredBtcBalance));
    } catch (e: any) { console.warn('[vss] getBtcBalance FAILED:', e?.message); }

    const restoredChannels = (await walletRestored!.listChannels() ?? []) as any[];
    const restoredChannel = restoredChannels.find((c: any) => c.channelId === channelId)
      ?? restoredChannels[0];
    console.log(`[vss] restored channels=${restoredChannels.length}`, JSON.stringify(restoredChannels.map((c: any) => ({ id: c.channelId?.substring(0, 16), isUsable: c.isUsable }))));

    addStep('vssVerifyRestoredWallet', 'success', {
      pubkeyMatch: restoredPubkey === pubkeyA,
      pubkey: restoredPubkey.substring(0, 16) + '...',
      restoredBtcSpendable: restoredBtcBalance?.vanilla?.spendable ?? null,
      channelsRestored: restoredChannels.length,
      channelFound: !!restoredChannel,
      channelIsUsable: restoredChannel?.isUsable ?? false,
    });

    // 9 — verify RGB asset balance after restore
    addStep('vssVerifyAssetBalance', 'running');
    let restoredAssets: any = null;
    let restoredAssetBalance: any = null;
    let assetBalanceError: string | null = null;
    try {
      await walletRestored!.syncWallet();
      await walletRestored!.refreshWallet();
      restoredAssets = await walletRestored!.listAssets();
      console.log(`[vss] restored listAssets nia=${restoredAssets?.nia?.length ?? 0}`,
        JSON.stringify(restoredAssets?.nia?.map((a: any) => a.assetId)));
      restoredAssetBalance = await walletRestored!.getAssetBalance(assetId);
      console.log('[vss] restored assetBalance:', JSON.stringify(restoredAssetBalance));
    } catch (e: any) {
      assetBalanceError = `${e?.message ?? e} (${e?.code ?? 'unknown'})`;
      console.warn('[vss] asset balance after restore FAILED:', assetBalanceError);
    }
    addStep('vssVerifyAssetBalance', assetBalanceError && !restoredAssetBalance ? 'error' : 'success', {
      assetId: assetId.substring(0, 20) + '...',
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

// Same as runRLNUtexoPaymentFlow but nodeB uses NativeExternalRLNSigner.
// pushMsat must be 0 — VLS rejects non-zero push on the acceptor side.
// Balance math (pushMsat=0): open: A=600, B=0
//   inv1(B→A 100): A=500, B=100  inv2(A→B 50): A=550, B=50
//   inv3(B→A 50):  A=500, B=100  inv4(A→B 50): A=550, B=50
//   after close: A=400+550=950, B=50
//   rgb send A→C 925, B→C 25 → A=25, B=25, C=950
export async function runRLNUtexoExternalPaymentFlow() {
  const flowName = 'runRLNUtexoExternalPaymentFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();

  let nodeA: UTEXOWallet | null = null;
  let nodeB: UTEXOWallet | null = null;
  let nodeC: UTEXOWallet | null = null;

  try {
    const network = 'regtest' as const;
    const rpcHost = readEnv('RLN_BITCOIND_RPC_HOST') ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
    const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
    const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
    const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
    const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
    const proxyEndpoint = readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;

    const unlockParams = {
      bitcoindRpcUsername: rpcUsername,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl,
      proxyEndpoint,
      announceAddresses: [] as string[],
      announceAlias: null as string | null,
    };

    const keysA = await createWallet(network);
    const keysB = await createWallet(network);
    const keysC = await createWallet(network);
    const nodeAPassword = 'nodeApass';
    const nodeCPassword = 'nodeCpass';

    const basePortA = 22000 + Math.floor(Math.random() * 5000);
    const basePortB = basePortA + 100;
    const basePortC = basePortA + 200;
    const ts = Date.now();
    const storageDirUriA = `${documentDirectory ?? ''}rln_xpay_a_${ts}`;
    const storageDirUriB = `${documentDirectory ?? ''}rln_xpay_b_${ts}`;
    const storageDirUriC = `${documentDirectory ?? ''}rln_xpay_c_${ts}`;
    await FileSystem.makeDirectoryAsync(storageDirUriA, { intermediates: true });
    await FileSystem.makeDirectoryAsync(storageDirUriB, { intermediates: true });
    await FileSystem.makeDirectoryAsync(storageDirUriC, { intermediates: true });
    const storageDirA = storageDirUriA.replace('file://', '');
    const storageDirB = storageDirUriB.replace('file://', '');
    const storageDirC = storageDirUriC.replace('file://', '');

    nodeA = new UTEXOWallet(
      {
        storageDirPath: storageDirA,
        daemonListeningPort: basePortA,
        ldkPeerListeningPort: basePortA + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysA.accountXpubVanilla,
        xpubCol: keysA.accountXpubColored,
        masterFingerprint: keysA.masterFingerprint,
      },
      new PasswordRLNSigner(nodeAPassword, keysA.mnemonic),
    );
    // nodeB uses NativeExternalRLNSigner — VLS in-process transport
    nodeB = new UTEXOWallet(
      {
        storageDirPath: storageDirB,
        daemonListeningPort: basePortB,
        ldkPeerListeningPort: basePortB + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysB.accountXpubVanilla,
        xpubCol: keysB.accountXpubColored,
        masterFingerprint: keysB.masterFingerprint,
      },
      new NativeExternalRLNSigner(keysB.mnemonic, network),
    );
    nodeC = new UTEXOWallet(
      {
        storageDirPath: storageDirC,
        daemonListeningPort: basePortC,
        ldkPeerListeningPort: basePortC + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysC.accountXpubVanilla,
        xpubCol: keysC.accountXpubColored,
        masterFingerprint: keysC.masterFingerprint,
      },
      new PasswordRLNSigner(nodeCPassword, keysC.mnemonic),
    );

    addStep('xPayAInit', 'running');
    await nodeA.init();
    addStep('xPayAInit', 'success', { storageDirPath: storageDirA });

    addStep('xPayAUnlock', 'running');
    await nodeA.unlock(unlockParams);
    addStep('xPayAUnlock', 'success', {});

    addStep('xPayBInit', 'running');
    await nodeB.init();
    addStep('xPayBInit', 'success', { storageDirPath: storageDirB });

    addStep('xPayBUnlock', 'running');
    await nodeB.unlock(unlockParams);
    addStep('xPayBUnlock', 'success', {});

    addStep('xPayCInit', 'running');
    await nodeC.init();
    addStep('xPayCInit', 'success', { storageDirPath: storageDirC });

    addStep('xPayCUnlock', 'running');
    await nodeC.unlock(unlockParams);
    addStep('xPayCUnlock', 'success', {});

    addStep('xPayAFund', 'running');
    const addrA = await nodeA.getAddress();
    const txidA = await sendToAddress(addrA, 1);
    await mine(6);
    await sleep(3000);
    await nodeA.syncWallet();
    const balA = await nodeA.getBtcBalance();
    addStep('xPayAFund', 'success', { txid: txidA, address: addrA, balance: balA });

    addStep('xPayACreateUtxos', 'running');
    await nodeA.syncWallet();
    await nodeA.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeA.syncWallet();
    addStep('xPayACreateUtxos', 'success', { num: 10 });

    addStep('xPayBFund', 'running');
    const addrB = await nodeB.getAddress();
    const txidB = await sendToAddress(addrB, 1);
    await mine(6);
    await sleep(3000);
    await nodeB.syncWallet();
    const balB = await nodeB.getBtcBalance();
    addStep('xPayBFund', 'success', { txid: txidB, address: addrB, balance: balB });

    addStep('xPayBCreateUtxos', 'running');
    await nodeB.syncWallet();
    await nodeB.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeB.syncWallet();
    addStep('xPayBCreateUtxos', 'success', { num: 10 });

    addStep('xPayCFund', 'running');
    const addrC = await nodeC.getAddress();
    const txidC = await sendToAddress(addrC, 1);
    await mine(6);
    await sleep(3000);
    await nodeC.syncWallet();
    const balC = await nodeC.getBtcBalance();
    addStep('xPayCFund', 'success', { txid: txidC, address: addrC, balance: balC });

    addStep('xPayCCreateUtxos', 'running');
    await nodeC.syncWallet();
    await nodeC.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeC.syncWallet();
    addStep('xPayCCreateUtxos', 'success', { num: 10 });

    addStep('xPayIssueAsset', 'running');
    const issued = await nodeA.issueAssetNia({ ticker: 'USDT', name: 'Tether', precision: 0, amounts: [1000] });
    const assetId = String(issued?.assetId ?? '');
    if (!assetId) throw new Error('Failed to issue asset');
    addStep('xPayIssueAsset', 'success', { assetId });

    const infoA = await nodeA.getNodeInfo();
    const infoB = await nodeB.getNodeInfo();
    const pubkeyA = String(infoA?.pubkey ?? '');
    const pubkeyB = String(infoB?.pubkey ?? '');
    addStep('xPayNodeInfos', 'success', {
      pubkeyA: pubkeyA.substring(0, 16) + '...',
      pubkeyB: pubkeyB.substring(0, 16) + '...',
    });

    addStep('xPayConnectPeers', 'running');
    const peerUriB = `${pubkeyB}@127.0.0.1:${basePortB + 1}`;
    try {
      await nodeA.connectPeer(peerUriB);
    } catch (e: any) {
      if (isPoisonLike(e)) {
        addStep('xPayConnectPeers', 'error', undefined, e?.message ?? String(e));
        throw e;
      }
      console.warn(`[xPay] connectPeer ignored: ${e?.message ?? String(e)}`);
    }
    addStep('xPayConnectPeers', 'success', { peerUriB });

    // nodeA opens asset channel to nodeB; pushMsat=0 required for external signer acceptor
    let fundingTxid = '';
    let channelId = '';
    addStep('xPayOpenChannel', 'running');
    try {
    await nodeA.openChannel({
      peerPubkeyAndOptAddr: peerUriB,
      capacitySat: 100000,
      pushMsat: 0,
      public: true,
      withAnchors: true,
      assetId,
      assetAmount: 600,
    });
    const fundDeadline = Date.now() + 120000;
    while (Date.now() < fundDeadline) {
      await nodeA.syncWallet();
      const channels: any[] = (await nodeA.listChannels()) ?? [];
      const ch = channels.find(
        (c: any) => (c.assetId ?? c.asset_id) === assetId && (c.fundingTxid ?? c.funding_txid) != null,
      );
      if (ch) {
        fundingTxid = String(ch.fundingTxid ?? ch.funding_txid ?? '');
        channelId = String(ch.channelId ?? ch.channel_id ?? '');
        break;
      }
      await sleep(1000);
    }
    if (!fundingTxid) throw new Error('Timeout waiting for funding tx');
    console.log(`[xPay] channelId=${channelId} fundingTxid=${fundingTxid}`);

    await mine(6);
    await sleep(3000);
    for (const [node, label] of [[nodeA, 'nodeA'], [nodeB, 'nodeB']] as [UTEXOWallet, string][]) {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        await node.syncWallet();
        const info = await node.getNodeInfo();
        const usable = Number(info?.numUsableChannels ?? 0);
        console.log(`[xPay] ${label} usableChannels=${usable}`);
        if (usable >= 1) break;
        await sleep(2000);
      }
    }
    await mine(6);
    addStep('xPayOpenChannel', 'success', { channelId, fundingTxid });
    } catch (e: any) {
      addStep('xPayOpenChannel', 'error', undefined, e?.message ?? String(e));
      throw e;
    }

    addStep('xPayAssetBalanceA', 'running');
    const bal0 = await nodeA.getAssetBalance(assetId);
    addStep('xPayAssetBalanceA', 'success', { spendable: bal0?.spendable ?? null });

    // inv1: B creates (100 asset units), A pays → A_chan=500, B_chan=100
    // amountSats=5000 so nodeB gets 5000 sats; it will need 3000+1000(reserve)=4000 for inv2.
    addStep('xPayInvoice1', 'running');
    const inv1Resp = await nodeB.createLightningInvoice({ amountSats: 5000, expirySeconds: 900, asset: { assetId, amount: 100 } });
    const invoice1 = String(inv1Resp?.lnInvoice ?? '');
    const send1Resp = await nodeA.payLightningInvoice({ lnInvoice: invoice1 });
    const hash1 = String(send1Resp?.txid ?? '');
    const pay1Deadline = Date.now() + 60000;
    while (Date.now() < pay1Deadline) {
      await nodeA.syncWallet();
      const status = await nodeA.getLightningSendRequest(hash1);
      console.log(`[xPay] inv1 sendStatus=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Invoice1 payment failed: ${hash1}`);
      await sleep(2000);
    }
    addStep('xPayInvoice1', 'success', { paymentHash: hash1, assetAmount: 100 });

    // inv2: A creates (50 asset units), B pays → A_chan=550, B_chan=50
    // RGB invoices require amountSats>=3000 (RGB_MIN_HTLC_MSAT=3_000_000 msat). nodeB has 5000
    // sats from inv1; pays 3000, keeps 2000 >= 1000 (channel reserve). Fine.
    addStep('xPayInvoice2', 'running');
    const inv2Resp = await nodeA.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 50 } });
    const invoice2 = String(inv2Resp?.lnInvoice ?? '');
    const send2Resp = await nodeB.payLightningInvoice({ lnInvoice: invoice2 });
    const hash2 = String(send2Resp?.txid ?? '');
    const pay2Deadline = Date.now() + 60000;
    while (Date.now() < pay2Deadline) {
      await nodeB.syncWallet();
      const status = await nodeB.getLightningSendRequest(hash2);
      console.log(`[xPay] inv2 sendStatus=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Invoice2 payment failed: ${hash2}`);
      await sleep(2000);
    }
    addStep('xPayInvoice2', 'success', { paymentHash: hash2, assetAmount: 50 });

    // inv3: B creates (50 asset units), A pays → A_chan=500, B_chan=100
    // amountSats=5000 again so nodeB can afford inv4 (3000 sats + reserve).
    addStep('xPayInvoice3', 'running');
    const inv3Resp = await nodeB.createLightningInvoice({ amountSats: 5000, expirySeconds: 900, asset: { assetId, amount: 50 } });
    const invoice3 = String(inv3Resp?.lnInvoice ?? '');
    const send3Resp = await nodeA.payLightningInvoice({ lnInvoice: invoice3 });
    const hash3 = String(send3Resp?.txid ?? '');
    const pay3Deadline = Date.now() + 60000;
    while (Date.now() < pay3Deadline) {
      await nodeA.syncWallet();
      const status = await nodeA.getLightningSendRequest(hash3);
      console.log(`[xPay] inv3 sendStatus=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Invoice3 payment failed: ${hash3}`);
      await sleep(2000);
    }
    addStep('xPayInvoice3', 'success', { paymentHash: hash3, assetAmount: 50 });

    // inv4: A creates (50 asset units), B pays → A_chan=550, B_chan=50
    // nodeB has 2000(leftover)+5000(inv3)=7000 sats; pays 3000, keeps 4000 >= reserve. Fine.
    addStep('xPayInvoice4', 'running');
    const inv4Resp = await nodeA.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 50 } });
    const invoice4 = String(inv4Resp?.lnInvoice ?? '');
    const send4Resp = await nodeB.payLightningInvoice({ lnInvoice: invoice4 });
    const hash4 = String(send4Resp?.txid ?? '');
    const pay4Deadline = Date.now() + 60000;
    while (Date.now() < pay4Deadline) {
      await nodeB.syncWallet();
      const status = await nodeB.getLightningSendRequest(hash4);
      console.log(`[xPay] inv4 sendStatus=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Invoice4 payment failed: ${hash4}`);
      await sleep(2000);
    }
    addStep('xPayInvoice4', 'success', { paymentHash: hash4, assetAmount: 50 });

    // Cooperative close: A=400(off-chain)+550(channel)=950, B=50
    addStep('xPayCloseChannel', 'running');
    try { await nodeA.syncWallet(); } catch {}
    try { await nodeB.syncWallet(); } catch {}
    await nodeA.closeChannel(channelId, pubkeyB, false);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await sleep(20000);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await sleep(20000);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    addStep('xPayCloseChannel', 'success', { channelId });

    // Wait for settled balances: A=950, B=50
    addStep('xPayWaitBalances', 'running');
    const balDeadlineA = Date.now() + 70000;
    let lastSpendableA = -1;
    while (Date.now() < balDeadlineA) {
      try {
        const b = await nodeA.getAssetBalance(assetId);
        lastSpendableA = Number(b?.spendable ?? -1);
        console.log(`[xPay] waitBal nodeA spendable=${lastSpendableA} expected=950`);
        if (lastSpendableA === 950) break;
      } catch (e: any) { console.warn(`[xPay] waitBal nodeA: ${e?.message}`); }
      try { await nodeA.refreshWallet(); } catch {}
      await sleep(2000);
    }
    if (lastSpendableA !== 950) throw new Error(`nodeA balance did not reach 950, last=${lastSpendableA}`);

    const balDeadlineB = Date.now() + 70000;
    let lastSpendableB = -1;
    while (Date.now() < balDeadlineB) {
      try {
        const b = await nodeB.getAssetBalance(assetId);
        lastSpendableB = Number(b?.spendable ?? -1);
        console.log(`[xPay] waitBal nodeB spendable=${lastSpendableB} expected=50`);
        if (lastSpendableB === 50) break;
      } catch (e: any) { console.warn(`[xPay] waitBal nodeB: ${e?.message}`); }
      try { await nodeB.refreshWallet(); } catch {}
      await sleep(2000);
    }
    if (lastSpendableB !== 50) throw new Error(`nodeB balance did not reach 50, last=${lastSpendableB}`);
    addStep('xPayWaitBalances', 'success', { expectedA: 950, expectedB: 50 });

    // TODO iteration 2: RGB on-chain sends to nodeC (A sends 925, B sends 25 → A=25, B=25, C=950)
    // addStep('xPayRgbSendA', 'running');
    // const invC1 = await nodeC.blindReceive({ minConfirmations: 1 });
    // await nodeA.send({ invoice: invC1.invoice, assetId, amount: 925, donation: true, feeRate: 1, minConfirmations: 1 });
    // await mine(1);
    // await nodeC.syncWallet();
    // await nodeC.refreshWallet();
    // await nodeC.refreshWallet();
    // await nodeA.refreshWallet();
    // addStep('xPayRgbSendA', 'success', { amount: 925, recipientId: invC1.recipientId.substring(0, 20) + '...' });

    // addStep('xPayRgbSendB', 'running');
    // const invC2 = await nodeC.blindReceive({ minConfirmations: 1 });
    // await nodeB.send({ invoice: invC2.invoice, assetId, amount: 25, donation: true, feeRate: 1, minConfirmations: 1 });
    // await mine(1);
    // await nodeC.syncWallet();
    // await nodeC.refreshWallet();
    // await nodeC.refreshWallet();
    // await nodeB.refreshWallet();
    // addStep('xPayRgbSendB', 'success', { amount: 25, recipientId: invC2.recipientId.substring(0, 20) + '...' });

    // TODO iteration 2: Final balances: A=25, B=25, C=950
    // addStep('xPayFinalBalances', 'running');
    // const [finalA, finalB, finalC] = await Promise.all([
    //   nodeA.getAssetBalance(assetId),
    //   nodeB.getAssetBalance(assetId),
    //   nodeC.getAssetBalance(assetId),
    // ]);
    // addStep('xPayFinalBalances', 'success', {
    //   spendableA: finalA?.spendable ?? null,
    //   spendableB: finalB?.spendable ?? null,
    //   spendableC: finalC?.spendable ?? null,
    // });

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (nodeA) { try { await nodeA.destroy(); } catch {} }
    if (nodeB) { try { await nodeB.destroy(); } catch {} }
    if (nodeC) { try { await nodeC.destroy(); } catch {} }
    endExclusiveFlow(flowName);
  }
}
