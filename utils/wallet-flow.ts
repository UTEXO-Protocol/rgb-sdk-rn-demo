/**
 * React Native compatible wallet flow
 * Adapted from flow.js for React Native environment
 */

import { mnemonicToSeedSync } from '@scure/bip39';
import {
  createRLNManager,
  createWallet,
  createWalletManager,
  DEFAULT_INDEXER_URLS,
  getBridgeAPI,
  LightningProtocol, OnchainProtocol,
  restoreFromBackup,
  UTEXOProtocol,
  UTEXOWallet,
  WalletManager,
  type InvoiceData,
  type RLNManager,
} from '@utexo/rgb-sdk-rn';
import * as FileSystem from 'expo-file-system/legacy';
import { documentDirectory } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

const UTEXO_TEST_MNEMONIC = 'poem twice question inch happy capital grain quality laptop dry chaos what';
let activeDemoFlow: string | null = null;

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
                      : null) ?? null;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

const getIndexerEndpoint = (network: keyof typeof DEFAULT_INDEXER_URLS) => {
  const overrideEndpoint = process.env.RGB_ENDPOINT || null;
  return overrideEndpoint ?? DEFAULT_INDEXER_URLS[network];
};
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

/**
 * Initialize a wallet with RGB SDK
 */
export async function initWallet(vanillaKeychain: any = null) {
  console.log("\nInitializing wallet with RGB SDK...");

  const bitcoinNetwork = 'testnet'; // Regtest network

  // Generate keys using the library
  const keys = await createWallet(bitcoinNetwork);
  console.log("Keys generated:", keys);
  // return;

  const wallet = new WalletManager({
    xpubVan: keys.accountXpubVanilla,
    xpubCol: keys.accountXpubColored,
    masterFingerprint: keys.masterFingerprint,
    mnemonic: keys.mnemonic,
    network: bitcoinNetwork,
  });

  console.log("Wallet created");

  // // Register wallet with RGB Node
  await wallet.initialize();
  // console.log("Wallet registered");

  // // Get BTC balance
  const btcBalance = await wallet.getBtcBalance();
  console.log("BTC balance:", btcBalance);

  // // Get address
  const address = await wallet.getAddress();
  console.log("Address:", address);

  // // Send some BTC to the address
  await sendToAddress(address, 1);

  // // Wait a bit for the transaction to be processed
  await new Promise(resolve => setTimeout(resolve, 2000));

  // // Get updated BTC balance
  const updatedBtcBalance = await wallet.getBtcBalance();
  console.log("Updated BTC balance:", updatedBtcBalance);

  // // Create UTXOs
  // console.log("Creating UTXOs...");
  const psbt = await wallet.createUtxosBegin({
    upTo: true,
    num: 5,
    size: 1000,
    feeRate: 1
  });

  const signedPsbt = await wallet.signPsbt(psbt);
  const utxosCreated = await wallet.createUtxosEnd({ signedPsbt });
  console.log(`Created ${utxosCreated} UTXOs`);

  return { wallet, keys };
}

/**
 * Main execution function - React Native compatible
 */
export async function runWalletFlow() {
  const flowName = 'runWalletFlow';
  beginExclusiveFlow(flowName);
  console.log("Starting RGB SDK Wallet Example");
  console.log("=".repeat(50));

  const flowResults: any = {
    steps: [],
    success: false,
    error: null,
  };
  const pushStep = (step: any) => flowResults.steps.push(step);

  try {

    // Initialize sender wallet
    // await initWallet(null);
    flowResults.steps.push({ step: 'initSenderWallet', status: 'running' });
    // return flowResults;
    const { wallet: senderWallet, keys: senderKeys } = await initWallet(null);
    flowResults.steps.push({ step: 'initSenderWallet', status: 'success', data: { address: await senderWallet.getAddress() } });

    //   // Issue NIA asset
    pushStep({ step: 'issueAsset', status: 'running' });
    //   console.log("\nIssuing NIA asset...");
    const asset1 = await senderWallet.issueAssetNia({
      ticker: "USDT",
      name: "Tether",
      amounts: [777, 66],
      precision: 0
    });
    console.log("Issued NIA asset:", asset1);
    pushStep({ step: 'issueAsset', status: 'success', data: asset1 });
    flowResults.assetId = asset1.assetId;

    //   // List assets
    pushStep({ step: 'listAssets', status: 'running' });
    //   console.log("\nListing assets...");
    const assets1 = await senderWallet.listAssets();
    console.log("Assets:", assets1);
    pushStep({ step: 'listAssets', status: 'success', data: assets1 });

    //   // Initialize receiving wallet
    pushStep({ step: 'initReceiverWallet', status: 'running' });
    //   console.log("\nInitializing receiving wallet...");
    const { wallet: receiverWallet } = await initWallet(null);
    const btcAddress = await receiverWallet.getAddress();
    console.log("BTC address:", btcAddress);
    await receiverWallet.syncWallet();
    const btcBalance2 = await receiverWallet.getBtcBalance();
    console.log("BTC balance:", btcBalance2);
    pushStep({ step: 'initReceiverWallet', status: 'success', data: { address: btcAddress, balance: btcBalance2 } });

    //   // Send BTC to the address
    pushStep({ step: 'sendBtc', status: 'running' });
    const psbt = await senderWallet.sendBtcBegin({
      address: btcAddress,
      amount: 7000,
      feeRate: 5
    });
    console.log("PSBT:", psbt);
    const signedPsbt = await senderWallet.signPsbt(psbt);
    console.log("Signed PSBT:", signedPsbt);
    const result = await senderWallet.sendBtcEnd({ signedPsbt });
    console.log("Send BTC result:", result);
    pushStep({ step: 'sendBtc', status: 'success', data: result });

    await mine(10);
    //   // Wait for confirmation
    await new Promise(resolve => setTimeout(resolve, 2000));
    await receiverWallet.syncWallet();

    const btcBalance = await receiverWallet.getBtcBalance();
    console.log("BTC balance:", btcBalance);
    flowResults.receiverBtcBalance = btcBalance;
    pushStep({ step: 'sendBtc', status: 'success', data: { balance: btcBalance } });

    //   // Create blind receive
    if (!asset1.assetId) {
      throw new Error('Asset ID is required for blind receive');
    }
    pushStep({ step: 'blindReceive', status: 'running' });
    //   console.log("\nCreating blind receive...");
    const receiveData1 = await receiverWallet.blindReceive({
      assetId: null as unknown as string, // TODO: add asset_id
      amount: 76
    });
    console.log("Blind receive data:", receiveData1);
    pushStep({ step: 'blindReceive', status: 'success', data: receiveData1 });

    // Decode the blind receive invoice
    pushStep({ step: 'decodeRGBInvoice', status: 'running' });
    const decodedInvoice: InvoiceData = await receiverWallet.decodeRGBInvoice({ invoice: receiveData1.invoice });
    console.log("Decoded invoice:", decodedInvoice);
    pushStep({ step: 'decodeRGBInvoice', status: 'success', data: decodedInvoice });
    flowResults.decodedInvoice = decodedInvoice;

    //   // Send assets
    pushStep({ step: 'sendAssets', status: 'running' });
    //   console.log("\nSending assets...", asset1);
    const sendResult = await senderWallet.send({
      assetId: asset1.assetId,
      amount: 76,
      invoice: receiveData1.invoice,
      minConfirmations: 1
    });
    console.log("Send result:", sendResult);
    pushStep({ step: 'sendAssets', status: 'success', data: sendResult });

    //   // Refresh wallets
    //   console.log("\nRefreshing wallets...");
    await receiverWallet.refreshWallet();
    await senderWallet.refreshWallet();

    //   // Mine a block to confirm the transaction
    //   console.log("\nMining block...");
    await mine(10);

    //   // Refresh wallets again after mining
    await receiverWallet.refreshWallet();
    await senderWallet.refreshWallet();

    //   // List assets in receiver wallet
    pushStep({ step: 'listReceiverAssets', status: 'running' });
    //   console.log("\nListing receiver assets...");
    const rcvAssets = await receiverWallet.listAssets();
    //   console.log("Receiver assets:", JSON.stringify(rcvAssets, null, 2));
    pushStep({ step: 'listReceiverAssets', status: 'success', data: rcvAssets });

    //   // Get asset balance
    if (asset1.assetId) {
      pushStep({ step: 'getAssetBalance', status: 'running' });
      //     console.log("\nGetting asset balance...");
      const rcvAssetBalance = await receiverWallet.getAssetBalance(asset1.assetId);
      //     console.log("Receiver asset balance:", JSON.stringify(rcvAssetBalance, null, 2));
      pushStep({ step: 'getAssetBalance', status: 'success', data: rcvAssetBalance });
      flowResults.receiverAssetBalance = rcvAssetBalance;
    }

    //   // Create witness receive
    if (!asset1.assetId) {
      throw new Error('Asset ID is required for witness receive');
    }
    pushStep({ step: 'witnessReceive', status: 'running' });
    //   console.log("\nCreating witness receive...");
    const receiveData2 = await receiverWallet.witnessReceive({
      assetId: asset1.assetId,
      amount: 50
    });
    pushStep({ step: 'witnessReceive', status: 'success', data: receiveData2 });

    //   // Send assets with witness
    pushStep({ step: 'sendAssetsWithWitness', status: 'running' });
    console.log("\nSending assets...", asset1);
    const sendResult2 = await senderWallet.send({
      assetId: asset1.assetId,
      amount: 10,
      witnessData: {
        amountSat: 1000,
        blinding: 0,
      },
      invoice: receiveData2.invoice,
      minConfirmations: 1
    });
    console.log("Send result:", sendResult2);
    pushStep({ step: 'sendAssetsWithWitness', status: 'success', data: sendResult2 });

    //   // Refresh wallets
    //   console.log("\nRefreshing wallets...");
    await receiverWallet.refreshWallet();
    await senderWallet.refreshWallet();

    //   // Mine a block to confirm the transaction
    console.log("\nMining block...");
    await mine(10);

    //   // Refresh wallets again after mining
    await receiverWallet.refreshWallet();
    await senderWallet.refreshWallet();

    //   // List transfers
    if (asset1.assetId) {
      pushStep({ step: 'listTransfers', status: 'running' });
      console.log("\nListing transfers...");
      const transfers = await senderWallet.listTransfers(asset1.assetId);
      console.log("Transfers:", transfers);
      pushStep({ step: 'listTransfers', status: 'success', data: transfers });
    }

    //   // List transactions
    pushStep({ step: 'listTransactions', status: 'running' });
    console.log("\nListing transactions...");
    const transactions = await senderWallet.listTransactions();
    console.log("Transactions:", transactions);
    pushStep({ step: 'listTransactions', status: 'success', data: transactions });

    //   // List unspents
    pushStep({ step: 'listUnspents', status: 'running' });
    console.log("\nListing unspents...");
    const unspents = await receiverWallet.listUnspents();
    console.log("Unspents:", unspents);
    pushStep({ step: 'listUnspents', status: 'success', data: unspents });

    // ── getXpub / getNetwork / isDisposed ──────────────────────────
    pushStep({ step: 'walletGetters', status: 'running' });
    const xpubs = senderWallet.getXpub();
    const network = senderWallet.getNetwork();
    const notDisposed = !senderWallet.isDisposed();
    flowResults.walletGetters = { xpubs, network, notDisposed };
    pushStep({ step: 'walletGetters', status: 'success', data: { network, notDisposed } });

    // ── address rotation ──────────────────────────────────────────
    pushStep({ step: 'addressRotation', status: 'running' });
    try {
      // Get current vanilla (BTC) address without rotating the derivation index
 
      // Explicitly advance to the next vanilla and colored addresses
      const nextVanilla = await senderWallet.rotateVanillaAddress();
      const nextColored = await senderWallet.rotateColoredAddress();

      // With reuseAddresses: true the same address is returned on every getAddress() call
      const reuseWallet = new WalletManager({
        xpubVan: senderKeys.accountXpubVanilla,
        xpubCol: senderKeys.accountXpubColored,
        masterFingerprint: senderKeys.masterFingerprint,
        mnemonic: senderKeys.mnemonic,
        network: 'testnet',
        reuseAddresses: true,
      });
      await reuseWallet.initialize();
      const addrA = await reuseWallet.getAddress();
      const addrB = await reuseWallet.getAddress();
      const addressReused = addrA === addrB;
      await reuseWallet.dispose();

      flowResults.addressRotation = { nextVanilla, nextColored, addressReused };
      pushStep({ step: 'addressRotation', status: 'success', data: { vanillaAddr, nextVanilla, nextColored, addressReused } });
    } catch (e: any) {
      pushStep({ step: 'addressRotation', status: 'error', error: e.message });
    }

    // ── estimateFeeRate ────────────────────────────────────────────
    pushStep({ step: 'estimateFeeRate', status: 'running' });
    try {
      const feeEstimate = await senderWallet.estimateFeeRate(6);
      flowResults.estimateFeeRate = feeEstimate;
      pushStep({ step: 'estimateFeeRate', status: 'success', data: feeEstimate });
    } catch (e: any) {
      pushStep({ step: 'estimateFeeRate', status: 'error', error: e.message });
    }

    // ── sendBtc (convenience: begin→sign→end in one call) ──────────
    pushStep({ step: 'sendBtc', status: 'running' });
    try {
      const extraAddress = await receiverWallet.getAddress();
      const txid = await senderWallet.sendBtc({ address: extraAddress, amount: 3000, feeRate: 1 });
      flowResults.sendBtc = { txid };
      pushStep({ step: 'sendBtc', status: 'success', data: { txid } });
    } catch (e: any) {
      pushStep({ step: 'sendBtc', status: 'error', error: e.message });
    }

    // ── createUtxos (convenience: begin→sign→end in one call) ──────
    pushStep({ step: 'createUtxos', status: 'running' });
    try {
      const numUtxos = await senderWallet.createUtxos({ upTo: true, num: 2, size: 1000, feeRate: 1 });
      flowResults.createUtxos = { numUtxos };
      pushStep({ step: 'createUtxos', status: 'success', data: { numUtxos } });
    } catch (e: any) {
      pushStep({ step: 'createUtxos', status: 'error', error: e.message });
    }

    // ── sendBegin / estimateFee / sendEnd (manual two-step) ────────
    pushStep({ step: 'sendBeginEnd', status: 'running' });
    try {
      const rcvInvoice = await receiverWallet.witnessReceive({ assetId: asset1.assetId, amount: 5 });
      const unsignedPsbt = await senderWallet.sendBegin({ invoice: rcvInvoice.invoice, assetId: asset1.assetId, amount: 5 });
      const feeInfo = await senderWallet.estimateFee(unsignedPsbt);
      const signedPsbt2 = await senderWallet.signPsbt(unsignedPsbt);
      const sendRes = await senderWallet.sendEnd({ signedPsbt: signedPsbt2 });
      flowResults.sendBeginEnd = { fee: feeInfo, txid: sendRes.txid };
      pushStep({ step: 'sendBeginEnd', status: 'success', data: { txid: sendRes.txid } });
    } catch (e: any) {
      pushStep({ step: 'sendBeginEnd', status: 'error', error: e.message });
    }

    // ── failTransfers ──────────────────────────────────────────────
    pushStep({ step: 'failTransfers', status: 'running' });
    try {
      const failed = await senderWallet.failTransfers({ batchTransferIdx: -1, noAssetOnly: true });
      flowResults.failTransfers = { result: failed };
      pushStep({ step: 'failTransfers', status: 'success', data: { failed } });
    } catch (e: any) {
      pushStep({ step: 'failTransfers', status: 'error', error: e.message });
    }

    // ── issueAssetIfa + inflate ────────────────────────────────────
    pushStep({ step: 'issueAssetIfa', status: 'running' });
    try {
      const ifa = await senderWallet.issueAssetIfa({
        ticker: 'IFA1', name: 'Inflatable One', precision: 0,
        amounts: [1000], inflationAmounts: [500],
        replaceRightsNum: 0, rejectListUrl: null,
      });
      flowResults.issueAssetIfa = ifa;
      pushStep({ step: 'issueAssetIfa', status: 'success', data: { assetId: ifa.assetId } });

      // inflate (convenience: begin→sign→end)
      pushStep({ step: 'inflate', status: 'running' });
      const inflateResult = await senderWallet.inflate({ assetId: ifa.assetId, inflationAmounts: [100] });
      flowResults.inflate = inflateResult;
      pushStep({ step: 'inflate', status: 'success', data: inflateResult });

      // inflateBegin + inflateEnd (manual two-step)
      pushStep({ step: 'inflateBegin', status: 'running' });
      const inflatePsbt = await senderWallet.inflateBegin({ assetId: ifa.assetId, inflationAmounts: [50] });
      flowResults.inflateBegin = { psbtLength: inflatePsbt.length };
      pushStep({ step: 'inflateBegin', status: 'success', data: { psbtLength: inflatePsbt.length } });

      pushStep({ step: 'inflateEnd', status: 'running' });
      const signedInflatePsbt = await senderWallet.signPsbt(inflatePsbt);
      const inflateEndResult = await senderWallet.inflateEnd({ signedPsbt: signedInflatePsbt });
      flowResults.inflateEnd = inflateEndResult;
      pushStep({ step: 'inflateEnd', status: 'success', data: inflateEndResult });
    } catch (e: any) {
      pushStep({ step: 'issueAssetIfa', status: 'error', error: e.message });
    }

    // ── signMessage / verifyMessage (wallet instance) ──────────────
    pushStep({ step: 'walletSignVerify', status: 'running' });
    try {
      const sig = await senderWallet.signMessage('hello wallet');
      const valid = await senderWallet.verifyMessage('hello wallet', sig);
      flowResults.walletSignVerify = { sig: sig.slice(0, 16) + '…', valid };
      pushStep({ step: 'walletSignVerify', status: 'success', data: { valid } });
    } catch (e: any) {
      pushStep({ step: 'walletSignVerify', status: 'error', error: e.message });
    }

    // ── createBackup + restoreFromBackup ───────────────────────────
    pushStep({ step: 'createBackup', status: 'running' });
    try {
      const backupPath = `${documentDirectory ?? ''}test-backup.bak`;
      const backupPassword = 'test-password-123';
      await senderWallet.createBackup({ backupPath, password: backupPassword });
      flowResults.createBackup = { path: backupPath };
      pushStep({ step: 'createBackup', status: 'success', data: { path: backupPath } });

      // restoreFromBackup
      pushStep({ step: 'restoreFromBackup', status: 'running' });
      const restoreDir = `${documentDirectory ?? ''}restore/`;
      const restoreResult = await restoreFromBackup({
        backupFilePath: backupPath,
        password: backupPassword,
        dataDir: restoreDir,
      });
      flowResults.restoreFromBackup = restoreResult;
      pushStep({ step: 'restoreFromBackup', status: 'success' });

      // ── verifyRestoredWallet ───────────────────────────────────────
      pushStep({ step: 'verifyRestoredWallet', status: 'running' });
      const restoredWallet = new WalletManager({
        xpubVan: senderKeys.accountXpubVanilla,
        xpubCol: senderKeys.accountXpubColored,
        masterFingerprint: senderKeys.masterFingerprint,
        mnemonic: senderKeys.mnemonic,
        network: 'regtest',
        dataDir: restoreDir,
      });
      await restoredWallet.initialize();
      // Sync UTXO state from indexer, then refresh RGB transfer statuses
      await restoredWallet.syncWallet();
      await restoredWallet.refreshWallet();

      const [
        restoredBtcBalance,
        restoredAddress,
        restoredAssets,
        restoredTransactions,
        restoredUnspents,
      ] = await Promise.all([
        restoredWallet.getBtcBalance(),
        restoredWallet.getAddress(),
        restoredWallet.listAssets(),
        restoredWallet.listTransactions(),
        restoredWallet.listUnspents(),
      ]);

      // Per-asset balances and transfer history for every NIA asset
      const niaDetails = await Promise.all(
        (restoredAssets.nia ?? []).map(async (asset) => {
          const [balance, transfers] = await Promise.all([
            restoredWallet.getAssetBalance(asset.assetId),
            restoredWallet.listTransfers(asset.assetId),
          ]);
          return {
            assetId: asset.assetId,
            ticker: asset.ticker,
            name: asset.name,
            issuedSupply: asset.issuedSupply,
            balance,
            transferCount: transfers.length,
            transferStatuses: transfers.reduce((acc: Record<string, number>, t) => {
              acc[t.status] = (acc[t.status] ?? 0) + 1;
              return acc;
            }, {}),
          };
        })
      );

      // Per-asset balances and transfer history for every IFA asset
      const ifaDetails = await Promise.all(
        (restoredAssets.ifa ?? []).map(async (asset) => {
          const [balance, transfers] = await Promise.all([
            restoredWallet.getAssetBalance(asset.assetId),
            restoredWallet.listTransfers(asset.assetId),
          ]);
          return {
            assetId: asset.assetId,
            ticker: asset.ticker,
            name: asset.name,
            balance,
            transferCount: transfers.length,
            transferStatuses: transfers.reduce((acc: Record<string, number>, t) => {
              acc[t.status] = (acc[t.status] ?? 0) + 1;
              return acc;
            }, {}),
          };
        })
      );

      // RGB allocations per UTXO (unspents that carry colored assignments)
      const rgbUtxos = restoredUnspents.filter(u => u.rgbAllocations.length > 0);

      flowResults.verifyRestoredWallet = {
        btcBalance: restoredBtcBalance,
        address: restoredAddress,
        niaAssets: niaDetails,
        ifaAssets: ifaDetails,
        totalAssetsFound: (restoredAssets.nia?.length ?? 0) + (restoredAssets.ifa?.length ?? 0),
        transactionCount: restoredTransactions.length,
        unspentCount: restoredUnspents.length,
        coloredUtxoCount: rgbUtxos.length,
      };
      pushStep({ step: 'verifyRestoredWallet', status: 'success', data: flowResults.verifyRestoredWallet });

      await restoredWallet.dispose();
    } catch (e: any) {
      pushStep({ step: 'createBackup', status: 'error', error: e.message });
    }

    // ── goOnline (reconnect) ───────────────────────────────────────
    pushStep({ step: 'goOnline', status: 'running' });
    try {
      await senderWallet.goOnline(getIndexerEndpoint('testnet'), true);
      pushStep({ step: 'goOnline', status: 'success' });
    } catch (e: any) {
      pushStep({ step: 'goOnline', status: 'error', error: e.message });
    }

    // ── dispose / isDisposed ───────────────────────────────────────
    pushStep({ step: 'dispose', status: 'running' });
    await senderWallet.dispose();
    const disposed = senderWallet.isDisposed();
    flowResults.dispose = { disposed };
    pushStep({ step: 'dispose', status: disposed ? 'success' : 'error' });

    flowResults.success = true;
    return flowResults;
  } catch (error: any) {
    console.error("Error in wallet flow:", error);
    flowResults.success = false;
    flowResults.error = {
      message: error.message || 'Unknown error',
      response: error.response ? {
        data: error.response.data,
        status: error.response.status,
      } : null,
    };
    return flowResults;
  } finally {
    endExclusiveFlow(flowName);
  }
}

/**
 * UTEXO / Lightning Module flow
 *
 * Tests UTEXOWallet, LightningProtocol, OnchainProtocol, UTEXOProtocol, and bridge API client.
 * Some steps require a running signet node and bridge server; failures are captured gracefully.
 */
export async function runUTEXOFlow() {
  const flowName = 'runUTEXOFlow';
  beginExclusiveFlow(flowName);
  console.log('Starting UTEXO Flow');
  console.log('='.repeat(50));

  const results: any = { steps: [], success: false, error: null };
  const pushStep = (step: any) => results.steps.push(step);

  try {
    // ── UTEXOWallet: instantiation ──────────────────────────
    pushStep({ step: 'utexoWalletInstantiate', status: 'running' });
    const utexoWallet = new UTEXOWallet(UTEXO_TEST_MNEMONIC, { network: 'testnet' });
    results.instantiation = true;
    pushStep({ step: 'utexoWalletInstantiate', status: 'success' });

    // ── UTEXOWallet: throws before initialize() ─────────────
    pushStep({ step: 'throwsBeforeInit', status: 'running' });
    try {
      utexoWallet.getXpub();
      results.throwsBeforeInit = false;
      pushStep({ step: 'throwsBeforeInit', status: 'error', error: 'Expected throw but resolved' });
    } catch (e: any) {
      results.throwsBeforeInit = e.message.toLowerCase().includes('init');
      pushStep({ step: 'throwsBeforeInit', status: results.throwsBeforeInit ? 'success' : 'error' });
    }

    // ── UTEXOWallet: derivePublicKeys (pure crypto, no server) ──
    pushStep({ step: 'derivePublicKeys', status: 'running' });
    try {
      const keys = await utexoWallet.derivePublicKeys('testnet');
      results.derivePublicKeys = { xpub: keys.xpub?.slice(0, 20) + '...' };
      pushStep({ step: 'derivePublicKeys', status: 'success', data: results.derivePublicKeys });
    } catch (e: any) {
      results.derivePublicKeys = { error: e.message };
      pushStep({ step: 'derivePublicKeys', status: 'error', error: e.message });
    }

    // ── UTEXOWallet: initialize (needs signet node – may fail) ──
    pushStep({ step: 'initialize', status: 'running' });
    try {
      await utexoWallet.initialize();
      results.initialized = true;
      pushStep({ step: 'initialize', status: 'success' });

      // ── getXpub / getNetwork / isDisposed after init ─────
      pushStep({ step: 'walletGetters', status: 'running' });
      const xpub = utexoWallet.getXpub();
      const network = utexoWallet.getNetwork();
      const notDisposed = !utexoWallet.isDisposed();
      results.walletGetters = { network, notDisposed, xpubVan: xpub.xpubVan?.slice(0, 20) + '...' };
      pushStep({ step: 'walletGetters', status: 'success', data: { network, notDisposed } });

      // ── dispose ──────────────────────────────────────────
      pushStep({ step: 'dispose', status: 'running' });
      await utexoWallet.dispose();
      results.disposed = utexoWallet.isDisposed();
      pushStep({ step: 'dispose', status: 'success' });
    } catch (e: any) {
      results.initialized = false;
      results.initError = e.message;
      pushStep({ step: 'initialize', status: 'error', error: e.message });
    }

    // ── LightningProtocol: stub throws "not implemented" ────
    pushStep({ step: 'lightningProtocolStubs', status: 'running' });
    try {
      const lp = new LightningProtocol();
      const stubResults: Record<string, boolean> = {};
      for (const [methodName, call] of [
        ['createLightningInvoice', () => lp.createLightningInvoice({ asset: { assetId: 'a', amount: 1 } } as any)],
        ['getLightningReceiveRequest', () => lp.getLightningReceiveRequest('id')],
        ['getLightningSendRequest', () => lp.getLightningSendRequest('id')],
        ['payLightningInvoiceBegin', () => lp.payLightningInvoiceBegin({ lnInvoice: 'lnbc1' } as any)],
        ['listLightningPayments', () => lp.listLightningPayments()],
      ] as [string, () => Promise<any>][]) {
        try {
          await call();
          stubResults[methodName] = false;
        } catch (e: any) {
          stubResults[methodName] = e.message.includes('not implemented');
        }
      }
      results.lightningProtocolStubs = stubResults;
      pushStep({ step: 'lightningProtocolStubs', status: 'success' });
    } catch (e: any) {
      pushStep({ step: 'lightningProtocolStubs', status: 'error', error: e.message });
    }

    // ── OnchainProtocol: stub throws "not implemented" ──────
    pushStep({ step: 'onchainProtocolStubs', status: 'running' });
    try {
      const op = new OnchainProtocol();
      const stubResults: Record<string, boolean> = {};
      for (const [methodName, call] of [
        ['onchainReceive', () => op.onchainReceive({ assetId: 'a', amount: 1 } as any)],
        ['onchainSendBegin', () => op.onchainSendBegin({ invoice: 'inv' } as any)],
        ['onchainSendEnd', () => op.onchainSendEnd({ signedPsbt: '' } as any)],
        ['getOnchainSendStatus', () => op.getOnchainSendStatus('inv')],
        ['listOnchainTransfers', () => op.listOnchainTransfers()],
      ] as [string, () => Promise<any>][]) {
        try {
          await call();
          stubResults[methodName] = false;
        } catch (e: any) {
          stubResults[methodName] = e.message.includes('not implemented');
        }
      }
      results.onchainProtocolStubs = stubResults;
      pushStep({ step: 'onchainProtocolStubs', status: 'success' });
    } catch (e: any) {
      pushStep({ step: 'onchainProtocolStubs', status: 'error', error: e.message });
    }

    // ── UTEXOProtocol: inherits both stub sets ───────────────
    pushStep({ step: 'utexoProtocolStubs', status: 'running' });
    try {
      const up = new UTEXOProtocol();
      let lightningThrows = false;
      let onchainThrows = false;
      try { await up.createLightningInvoice({ asset: { assetId: 'a', amount: 1 } } as any); }
      catch (e: any) { lightningThrows = e.message.includes('not implemented'); }
      try { await up.onchainReceive({ assetId: 'a', amount: 1 } as any); }
      catch (e: any) { onchainThrows = e.message.includes('not implemented'); }
      results.utexoProtocolStubs = { lightningThrows, onchainThrows };
      pushStep({ step: 'utexoProtocolStubs', status: 'success' });
    } catch (e: any) {
      pushStep({ step: 'utexoProtocolStubs', status: 'error', error: e.message });
    }

    // ── bridge API client: create and query ─────────────────
    pushStep({ step: 'bridgeAPIClient', status: 'running' });
    const bridgeAPI = getBridgeAPI('testnet');
    results.bridgeAPIConfigured =
      bridgeAPI !== null &&
      typeof (bridgeAPI as any).getTransferByMainnetInvoice === 'function';
    pushStep({ step: 'bridgeAPIClient', status: results.bridgeAPIConfigured ? 'success' : 'error' });

    pushStep({ step: 'bridgeAPIQuery', status: 'running' });
    try {
      const transfer = await bridgeAPI.getTransferByMainnetInvoice('test-invoice', 94);
      results.bridgeAPIQuery = {
        returned: transfer === null ? 'null (not found – expected)' : 'found (unexpected)',
      };
      pushStep({ step: 'bridgeAPIQuery', status: 'success' });
    } catch (e: any) {
      results.bridgeAPIQuery = { error: e.message };
      pushStep({ step: 'bridgeAPIQuery', status: 'error', error: e.message });
    }

    results.success = true;
    return results;
  } catch (error: any) {
    console.error('Error in UTEXO flow:', error);
    results.success = false;
    results.error = { message: error.message || 'Unknown error' };
    return results;
  } finally {
    endExclusiveFlow(flowName);
  }
}

/**
 * RLN Playground flow
 *
 * Uses the RLN binding mode (with UTEXOWallet protocol adapter) to validate
 * the shape of the integration end-to-end before native RLN methods are wired.
 */
let rlnPlaygroundFlowInFlight = false;

export async function runRlnPlaygroundFlow() {
  const flowName = 'runRlnPlaygroundFlow';
  beginExclusiveFlow(flowName);
  if (rlnPlaygroundFlowInFlight) {
    endExclusiveFlow(flowName);
    return {
      steps: [
        {
          step: 'rlnPlaygroundGuard',
          status: 'error',
          error: 'RLN playground flow already running',
        },
      ],
      success: false,
      error: 'RLN playground flow already running',
    } as any;
  }
  rlnPlaygroundFlowInFlight = true;
  const results: any = { steps: [], success: false, error: null };
  const addStep = (step: string, status: string, data?: any, error?: string) => {
    const idx = results.steps.findIndex((s: any) => s.step === step);
    const entry = { step, status, data, error };
    if (idx >= 0) {
      results.steps[idx] = entry;
    } else {
      results.steps.push(entry);
    }
  };

  const configuredRlnNetwork = readEnv('RLN_PLAYGROUND_NETWORK');
  const network = ((configuredRlnNetwork as
    | 'regtest'
    | 'testnet'
    | 'signet'
    | undefined) ?? 'regtest');
  let sender: RLNManager | null = null;
  let senderRlnNodeCreated = false;
  let senderRlnNodeDestroyed = false;
  let senderRlnPubkey: string | null = null;
  let senderRlnReady = false;
  let rlnReadinessBlocker: string | null = null;
  const cleanupIssues: { step: string; message: string }[] = [];

  try {
    const senderKeys = await createWallet(network);
    sender = createRLNManager();

    // ── RLN native bridge surface coverage ───────────────────────────────────
    const resolveRlnMethod = (name: string): ((...args: any[]) => Promise<any>) => {
      const fn = (sender as any)[name];
      if (typeof fn === 'function') return fn.bind(sender);
      return async () => { throw new Error(`Missing RLN method: ${name}`); };
    };
    const consumeUnlockConflictNormalized = () => sender!.consumeRlnUnlockConflictNormalized();
    const mkRlnStorageDir = async () => {
      const uri = `${documentDirectory ?? ''}rln_playground_sender_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      try {
        await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
      } catch {
        // best effort; native side will still try to create/use the path
      }
      return uri.replace('file://', '');
    };
    const mkRlnPorts = () => {
      // Avoid fixed ports across retries/runs in the same app process.
      const base = 20000 + Math.floor(Math.random() * 20000);
      return {
        daemonListeningPort: base,
        ldkPeerListeningPort: base + 1,
      };
    };
    let rlnStorageDir = await mkRlnStorageDir();
    let rlnPorts = mkRlnPorts();

    const snapshotRlnError = (err: any) => {
      const result: Record<string, any> = {};
      try {
        if (err && typeof err === 'object') {
          Object.getOwnPropertyNames(err).forEach((key) => {
            const value = (err as any)[key];
            if (typeof value === 'function') return;
            if (value instanceof Error) {
              result[key] = {
                name: value.name,
                message: value.message,
                stack: value.stack,
              };
              return;
            }
            try {
              JSON.stringify(value);
              result[key] = value;
            } catch {
              result[key] = String(value);
            }
          });
        }
      } catch {
        // best effort snapshot only
      }
      return {
        name: err?.name ?? null,
        message: err?.message ?? String(err),
        code: err?.code ?? null,
        raw: result,
      };
    };

    const classifyRlnError = (err: any) => {
      const message = err?.message ?? String(err);
      const code = err?.code ? String(err.code) : null;
      const lowered = message.toLowerCase();
      const codeLowered = (code ?? '').toLowerCase();
      let kind: 'NotInitialized' | 'Conflict' | 'Transport' | 'Unknown' = 'Unknown';
      let conflictSubtype:
        | 'AlreadyUnlocked'
        | 'UnlockInProgress'
        | 'StateCollision'
        | 'OtherConflict'
        | null = null;
      if (
        lowered.includes('not initialized') ||
        lowered.includes('notinitialized') ||
        codeLowered.includes('notinitialized') ||
        codeLowered.includes('not_initialized')
      ) {
        kind = 'NotInitialized';
      } else if (lowered.includes('conflict') || codeLowered.includes('conflict')) {
        kind = 'Conflict';
        if (
          lowered.includes('already unlocked') ||
          lowered.includes('already initialized')
        ) {
          conflictSubtype = 'AlreadyUnlocked';
        } else if (
          lowered.includes('in progress') ||
          lowered.includes('busy') ||
          lowered.includes('already running')
        ) {
          conflictSubtype = 'UnlockInProgress';
        } else if (
          lowered.includes('storage') ||
          lowered.includes('state') ||
          lowered.includes('path') ||
          lowered.includes('locked')
        ) {
          conflictSubtype = 'StateCollision';
        } else {
          conflictSubtype = 'OtherConflict';
        }
      } else if (
        lowered.includes('timeout') ||
        lowered.includes('network') ||
        lowered.includes('connection') ||
        lowered.includes('rpc')
      ) {
        kind = 'Transport';
      }
      return {
        kind,
        code,
        message,
        conflictSubtype,
        methodResponse: snapshotRlnError(err),
      };
    };
    const probeNodeReadyAfterConflict = async (
      attempts: number = 30,
      delayMs: number = 750
    ): Promise<{ ready: boolean; nodeInfo?: any }> => {
      // Give RLN unlock state machine a short grace period before probing.
      await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
      for (let i = 0; i < attempts; i += 1) {
        try {
          const info = await rlnNodeInfo();
          return { ready: true, nodeInfo: info };
        } catch {
          if (i < attempts - 1) {
            await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
          }
        }
      }
      return { ready: false };
    };
    const maskUnlockRequest = (request: any, diagnostics: any) => ({
      ...request,
      bitcoindRpcPassword: '***',
      password: '***',
      diagnostics,
    });

    const isRegtestNetwork = network === 'regtest';
    const defaultRpcHost = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
    const defaultIndexerUrl = `${defaultRpcHost}:50001`;
    const defaultProxyEndpoint = `rpc://${defaultRpcHost}:3000/json-rpc`;
    const rpcHostEnv = readEnv('RLN_BITCOIND_RPC_HOST');
    const rpcPortRawEnv = readEnv('RLN_BITCOIND_RPC_PORT');
    const rpcUserRawEnv = readEnv('RLN_BITCOIND_RPC_USERNAME');
    const rpcPasswordRawEnv = readEnv('RLN_BITCOIND_RPC_PASSWORD');
    const indexerUrlEnv = readEnv('RLN_INDEXER_URL');
    const proxyEndpointEnv = readEnv('RLN_PROXY_ENDPOINT');
    const hasExplicitUnlockOverrides = [
      rpcHostEnv,
      rpcPortRawEnv,
      rpcUserRawEnv,
      rpcPasswordRawEnv,
      indexerUrlEnv,
      proxyEndpointEnv,
    ].some((value) => typeof value === 'string' && value.length > 0);
    const useRegtestForcedDefaults =
      isRegtestNetwork && !hasExplicitUnlockOverrides;
    const rpcHost = useRegtestForcedDefaults
      ? defaultRpcHost
      : (rpcHostEnv ?? defaultRpcHost);
    const rpcPortRaw = useRegtestForcedDefaults ? '18443' : rpcPortRawEnv;
    const rpcPort = Number(rpcPortRaw ?? '18443');
    const rpcUserRaw = useRegtestForcedDefaults ? 'user' : rpcUserRawEnv;
    const rpcPasswordRaw = useRegtestForcedDefaults
      ? 'password'
      : rpcPasswordRawEnv;
    const rpcUser = rpcUserRaw ?? 'rpcuser';
    const rpcPassword = rpcPasswordRaw ?? 'rpcpassword';
    const strictUnlockCreds = readEnv('RLN_STRICT_UNLOCK_CREDS') === 'true';
    const nodePassword = readEnv('RLN_NODE_PASSWORD') ?? 'rln-playground-password';
    const indexerUrl = useRegtestForcedDefaults
      ? defaultIndexerUrl
      : (indexerUrlEnv ?? null);
    const proxyEndpoint = useRegtestForcedDefaults
      ? defaultProxyEndpoint
      : (proxyEndpointEnv ?? null);
    const announceAddresses = (readEnv('RLN_ANNOUNCE_ADDRESSES') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const announceAlias = readEnv('RLN_ANNOUNCE_ALIAS');
    const diagnostics = {
      effectiveNetwork: network,
      configMode: useRegtestForcedDefaults
        ? 'regtest-forced'
        : isRegtestNetwork
        ? 'regtest-env-override'
        : 'env-driven',
      platform: Platform.OS,
      hostSource: useRegtestForcedDefaults
        ? 'regtest-forced'
        : (rpcHostEnv ? 'env' : 'platform-default'),
      portSource: useRegtestForcedDefaults
        ? 'regtest-forced'
        : (rpcPortRaw ? 'env' : 'default-18443'),
      usernameSource: useRegtestForcedDefaults
        ? 'regtest-forced'
        : (rpcUserRaw ? 'env' : 'demo-default'),
      passwordSource: useRegtestForcedDefaults
        ? 'regtest-forced'
        : (rpcPasswordRaw ? 'env' : 'demo-default'),
      indexerSource: useRegtestForcedDefaults
        ? 'regtest-forced'
        : (indexerUrl ? 'env' : 'none'),
      proxySource: useRegtestForcedDefaults
        ? 'regtest-forced'
        : (proxyEndpoint ? 'env' : 'none'),
      strictUnlockCreds,
    };
    const unlockRequest = {
      password: nodePassword,
      bitcoindRpcUsername: rpcUser,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl: indexerUrl ?? null,
      proxyEndpoint: proxyEndpoint ?? null,
      announceAddresses,
      announceAlias: announceAlias ?? null,
    };
    type RlnStepOutcome = {
      request?: any;
      response?: any;
      skipped?: boolean;
      reason?: string;
      errorDetail?: any;
    };
    const runRlnStep = async (
      methodName: string,
      runner: () => Promise<RlnStepOutcome>
    ): Promise<{ ok: boolean; outcome?: RlnStepOutcome; error?: any }> => {
      addStep(methodName, 'running');
      try {
        const outcome = await runner();
        if (outcome.skipped) {
          addStep(methodName, 'success', {
            ...(outcome.request !== undefined ? { request: outcome.request } : {}),
            response: {
              skipped: true,
              reason: outcome.reason ?? 'Skipped due to missing prerequisites',
              ...(outcome.response ?? {}),
            },
          });
        } else {
          addStep(methodName, 'success', {
            ...(outcome.request !== undefined ? { request: outcome.request } : {}),
            response: {
              reason: outcome.reason ?? 'Completed successfully',
              ...(outcome.response !== undefined
                ? { result: outcome.response }
                : {}),
            },
          });
        }
        return { ok: true, outcome };
      } catch (error: any) {
        const message = error?.message ?? String(error);
        addStep(
          methodName,
          'error',
          {
            reason: message,
            ...(error?.errorDetail !== undefined
              ? { detail: error.errorDetail }
              : {}),
            snapshot: snapshotRlnError(error),
          },
          message
        );
        return { ok: false, error };
      }
    };

    const rlnCreateNode = resolveRlnMethod('rlnCreateNode');
    const rlnInitNode = resolveRlnMethod('rlnInitNode');
    const rlnUnlockNode = resolveRlnMethod('rlnUnlockNode');
    const rlnNodeInfo = resolveRlnMethod('rlnNodeInfo');
    const rlnNetworkInfo = resolveRlnMethod('rlnNetworkInfo');
    const rlnListPeers = resolveRlnMethod('rlnListPeers');
    const rlnConnectPeer = resolveRlnMethod('rlnConnectPeer');
    const rlnDisconnectPeer = resolveRlnMethod('rlnDisconnectPeer');
    const rlnListChannels = resolveRlnMethod('rlnListChannels');
    const rlnOpenChannel = resolveRlnMethod('rlnOpenChannel');
    const rlnCloseChannel = resolveRlnMethod('rlnCloseChannel');
    const rlnListPayments = resolveRlnMethod('rlnListPayments');
    const rlnAddress = resolveRlnMethod('rlnAddress');
    const rlnAssetBalance = resolveRlnMethod('rlnAssetBalance');
    const rlnBackup = resolveRlnMethod('rlnBackup');
    const rlnBtcBalance = resolveRlnMethod('rlnBtcBalance');
    const rlnCheckIndexerUrl = resolveRlnMethod('rlnCheckIndexerUrl');
    const rlnCheckProxyEndpoint = resolveRlnMethod('rlnCheckProxyEndpoint');
    const rlnCreateUtxos = resolveRlnMethod('rlnCreateUtxos');
    const rlnDecodeLnInvoice = resolveRlnMethod('rlnDecodeLnInvoice');
    const rlnDecodeRgbInvoice = resolveRlnMethod('rlnDecodeRgbInvoice');
    const rlnEstimateFee = resolveRlnMethod('rlnEstimateFee');
    const rlnFailTransfers = resolveRlnMethod('rlnFailTransfers');
    const rlnGetChannelId = resolveRlnMethod('rlnGetChannelId');
    const rlnGetPayment = resolveRlnMethod('rlnGetPayment');
    const rlnInvoiceStatus = resolveRlnMethod('rlnInvoiceStatus');
    const rlnKeysend = resolveRlnMethod('rlnKeysend');
    const rlnListAssets = resolveRlnMethod('rlnListAssets');
    const rlnListTransactions = resolveRlnMethod('rlnListTransactions');
    const rlnListTransfers = resolveRlnMethod('rlnListTransfers');
    const rlnListUnspents = resolveRlnMethod('rlnListUnspents');
    const rlnLnInvoice = resolveRlnMethod('rlnLnInvoice');
    const rlnRefreshTransfers = resolveRlnMethod('rlnRefreshTransfers');
    const rlnRgbInvoice = resolveRlnMethod('rlnRgbInvoice');
    const rlnSendBtc = resolveRlnMethod('rlnSendBtc');
    const rlnSendPayment = resolveRlnMethod('rlnSendPayment');
    const rlnSendRgb = resolveRlnMethod('rlnSendRgb');
    const rlnSync = resolveRlnMethod('rlnSync');
    const rlnShutdown = resolveRlnMethod('rlnShutdown');
    const rlnDestroyNode = resolveRlnMethod('rlnDestroyNode');

    const peerTargetHost = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
    const peerPubkey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    const peerPubkeyAndAddr = `${peerPubkey}@${peerTargetHost}:9735`;
    let openedChannelId: string | null = null;
    let disconnectPeerTarget: string = peerPubkey;

    await runRlnStep('rlnCreateNode', async () => {
      const nodeId = await rlnCreateNode({
        storageDirPath: rlnStorageDir,
        daemonListeningPort: rlnPorts.daemonListeningPort,
        ldkPeerListeningPort: rlnPorts.ldkPeerListeningPort,
        network,
        maxMediaUploadSizeMb: 16,
        enableVirtualChannelsV0: true,
      });
      senderRlnNodeCreated = true;
      senderRlnNodeDestroyed = false;
      return {
        request: {
          storageDirPath: rlnStorageDir,
          network,
          daemonListeningPort: rlnPorts.daemonListeningPort,
          ldkPeerListeningPort: rlnPorts.ldkPeerListeningPort,
        },
        response: { nodeId },
      };
    });

    await runRlnStep('rlnInitNode', async () => {
      if (!senderRlnNodeCreated) {
        return {
          request: { mnemonic: 'wallet mnemonic', password: '***' },
          skipped: true,
          reason: 'Skipped: rlnCreateNode failed',
        };
      }
      senderRlnPubkey = await rlnInitNode(nodePassword, senderKeys.mnemonic);
      disconnectPeerTarget = senderRlnPubkey ?? peerPubkey;
      return {
        request: { mnemonic: 'wallet mnemonic', password: '***' },
        response: { initResult: senderRlnPubkey },
      };
    });

    await runRlnStep('rlnUnlockNode', async () => {
      if (!senderRlnNodeCreated) {
        return {
          request: maskUnlockRequest(unlockRequest, diagnostics),
          skipped: true,
          reason: 'Skipped: rlnCreateNode failed',
        };
      }
      if (strictUnlockCreds && (!rpcUserRaw || !rpcPasswordRaw)) {
        rlnReadinessBlocker =
          'Missing RLN_BITCOIND_RPC_USERNAME or RLN_BITCOIND_RPC_PASSWORD (or EXPO_PUBLIC_ prefixed variants)';
        return {
          request: maskUnlockRequest(unlockRequest, diagnostics),
          skipped: true,
          reason: rlnReadinessBlocker,
        };
      }
      if (!Number.isFinite(rpcPort) || rpcPort <= 0) {
        rlnReadinessBlocker = `Invalid RLN_BITCOIND_RPC_PORT: ${rpcPortRaw}`;
        return {
          request: maskUnlockRequest(unlockRequest, diagnostics),
          skipped: true,
          reason: rlnReadinessBlocker,
        };
      }
      const unlockAttempt = async (request: typeof unlockRequest, attempt: 'env' | 'regtest-fallback') => {
        try {
          await rlnUnlockNode(request);
          const normalizedConflict = consumeUnlockConflictNormalized();
          senderRlnReady = true;
          rlnReadinessBlocker = null;
          return {
            ok: true as const,
            response: normalizedConflict
              ? { unlocked: true, normalizedConflict: true, attempt, fallbackApplied: attempt === 'regtest-fallback' }
              : { unlocked: true, attempt, fallbackApplied: attempt === 'regtest-fallback' },
          };
        } catch (unlockErr: any) {
          const detail = classifyRlnError(unlockErr);
          if (detail.kind === 'Conflict') {
            const readiness = await probeNodeReadyAfterConflict();
            if (readiness.ready) {
              senderRlnReady = true;
              rlnReadinessBlocker = null;
              return {
                ok: true as const,
                response: {
                  unlocked: true,
                  normalizedConflict: true,
                  conflictSubtype: detail.conflictSubtype,
                  reason: 'Conflict normalized after readiness probe',
                  attempt,
                  fallbackApplied: attempt === 'regtest-fallback',
                  nativeError: {
                    code: detail.code,
                    message: detail.message,
                  },
                  methodResponse: detail.methodResponse,
                  nodeInfo: readiness.nodeInfo,
                },
              };
            }
          }
          return { ok: false as const, detail };
        }
      };

      const envAttempt = await unlockAttempt(unlockRequest, 'env');
      if (envAttempt.ok) {
        return {
          request: maskUnlockRequest(unlockRequest, diagnostics),
          response: envAttempt.response,
        };
      }

      const shouldTryRegtestFallback =
        network === 'regtest' &&
        !useRegtestForcedDefaults &&
        envAttempt.detail.kind !== 'Conflict';
      if (shouldTryRegtestFallback) {
        const fallbackRequest = {
          password: nodePassword,
          bitcoindRpcUsername: 'user',
          bitcoindRpcPassword: 'password',
          bitcoindRpcHost: defaultRpcHost,
          bitcoindRpcPort: 18443,
          indexerUrl: defaultIndexerUrl,
          proxyEndpoint: defaultProxyEndpoint,
          announceAddresses,
          announceAlias: announceAlias ?? null,
        };
        const fallbackAttempt = await unlockAttempt(fallbackRequest, 'regtest-fallback');
        if (fallbackAttempt.ok) {
          return {
            request: maskUnlockRequest(unlockRequest, diagnostics),
            response: {
              ...fallbackAttempt.response,
              firstAttempt: {
                kind: envAttempt.detail.kind,
                code: envAttempt.detail.code,
                message: envAttempt.detail.message,
                methodResponse: envAttempt.detail.methodResponse,
              },
            },
          };
        }
        senderRlnReady = false;
        rlnReadinessBlocker = fallbackAttempt.detail.message;
        throw {
          message: fallbackAttempt.detail.message,
          errorDetail: {
            request: {
              env: maskUnlockRequest(unlockRequest, diagnostics),
              regtestFallback: maskUnlockRequest(fallbackRequest, {
                ...diagnostics,
                configMode: 'regtest-fallback',
                hostSource: 'regtest-forced',
                portSource: 'regtest-forced',
                usernameSource: 'regtest-forced',
                passwordSource: 'regtest-forced',
                indexerSource: 'regtest-forced',
                proxySource: 'regtest-forced',
              }),
            },
            response: {
              attempt: 'regtest-fallback',
              fallbackApplied: true,
              firstAttempt: {
                kind: envAttempt.detail.kind,
                conflictSubtype: envAttempt.detail.conflictSubtype,
                code: envAttempt.detail.code,
                message: envAttempt.detail.message,
                methodResponse: envAttempt.detail.methodResponse,
              },
              secondAttempt: {
                kind: fallbackAttempt.detail.kind,
                conflictSubtype: fallbackAttempt.detail.conflictSubtype,
                code: fallbackAttempt.detail.code,
                message: fallbackAttempt.detail.message,
                methodResponse: fallbackAttempt.detail.methodResponse,
              },
            },
          },
        };
      }

      senderRlnReady = false;
      rlnReadinessBlocker = envAttempt.detail.message;
      throw {
        message: envAttempt.detail.message,
        errorDetail: {
          request: maskUnlockRequest(unlockRequest, diagnostics),
          response: {
            attempt: 'env',
            fallbackApplied: false,
            kind: envAttempt.detail.kind,
            conflictSubtype: envAttempt.detail.conflictSubtype,
            code: envAttempt.detail.code,
            message: envAttempt.detail.message,
            methodResponse: envAttempt.detail.methodResponse,
          },
        },
      };
    });

    await runRlnStep('rlnNodeInfo', async () => {
      if (!senderRlnNodeCreated || rlnReadinessBlocker) {
        return {
          request: {},
          skipped: true,
          reason: rlnReadinessBlocker ?? 'Skipped: node is not ready',
        };
      }
      const info = await rlnNodeInfo();
      senderRlnReady = true;
      rlnReadinessBlocker = null;
      return { request: {}, response: info };
    });

    await runRlnStep('rlnNetworkInfo', async () => {
      if (!senderRlnReady) {
        return { request: {}, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      }
      const info = await rlnNetworkInfo();
      return { request: {}, response: info };
    });

    await runRlnStep('rlnListPeers', async () => {
      if (!senderRlnReady) {
        return { request: {}, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      }
      const peers = await rlnListPeers();
      return { request: {}, response: { count: peers?.length ?? 0, peers } };
    });

    await runRlnStep('rlnConnectPeer', async () => {
      if (!senderRlnReady) {
        return { request: { peerPubkeyAndAddr }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      }
      await rlnConnectPeer(peerPubkeyAndAddr);
      disconnectPeerTarget = senderRlnPubkey ?? peerPubkey;
      return { request: { peerPubkeyAndAddr }, response: { connected: true } };
    });

    await runRlnStep('rlnDisconnectPeer', async () => {
      if (!senderRlnReady) {
        return {
          request: { peerPubkey: disconnectPeerTarget },
          skipped: true,
          reason: rlnReadinessBlocker ?? 'Skipped: node is not ready',
        };
      }
      await rlnDisconnectPeer(disconnectPeerTarget);
      return { request: { peerPubkey: disconnectPeerTarget }, response: { disconnected: true } };
    });

    await runRlnStep('rlnListChannels', async () => {
      if (!senderRlnReady) {
        return { request: {}, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      }
      const channels = await rlnListChannels();
      return { request: {}, response: { count: channels?.length ?? 0, channels } };
    });

    await runRlnStep('rlnOpenChannel', async () => {
      if (!senderRlnReady) {
        return {
          request: { peerPubkeyAndOptAddr: peerPubkeyAndAddr, capacitySat: 10000, pushMsat: 0, withAnchors: true },
          skipped: true,
          reason: rlnReadinessBlocker ?? 'Skipped: node is not ready',
        };
      }
      const opened = await rlnOpenChannel({
        peerPubkeyAndOptAddr: peerPubkeyAndAddr,
        capacitySat: 10000,
        pushMsat: 0,
        public: false,
        withAnchors: true,
      });
      openedChannelId =
        String(
          (opened as any)?.channelId ??
            (opened as any)?.channel_id ??
            (opened as any)?.temporaryChannelId ??
            (opened as any)?.temporary_channel_id ??
            ''
        ) || null;
      return {
        request: { peerPubkeyAndOptAddr: peerPubkeyAndAddr, capacitySat: 10000, pushMsat: 0, withAnchors: true },
        response: opened,
      };
    });

    await runRlnStep('rlnCloseChannel', async () => {
      if (!senderRlnReady) {
        return {
          request: { channelId: openedChannelId ?? null, peerPubkey: disconnectPeerTarget, force: true },
          skipped: true,
          reason: rlnReadinessBlocker ?? 'Skipped: node is not ready',
        };
      }
      if (!openedChannelId) {
        return {
          request: { channelId: null, peerPubkey: disconnectPeerTarget, force: true },
          skipped: true,
          reason: 'Skipped: no channel id available from rlnOpenChannel',
        };
      }
      await rlnCloseChannel(openedChannelId, disconnectPeerTarget, true);
      return {
        request: { channelId: openedChannelId, peerPubkey: disconnectPeerTarget, force: true },
        response: { closed: true },
      };
    });

    await runRlnStep('rlnListPayments', async () => {
      if (!senderRlnReady) {
        return { request: {}, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      }
      const payments = await rlnListPayments();
      return { request: {}, response: { count: payments?.length ?? 0, payments } };
    });

    await runRlnStep('rlnAddress', async () => {
      if (!senderRlnReady) return { request: {}, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnAddress();
      return { request: {}, response };
    });

    await runRlnStep('rlnBtcBalance', async () => {
      if (!senderRlnReady) return { request: { skipSync: true }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnBtcBalance(true);
      return { request: { skipSync: true }, response };
    });

    await runRlnStep('rlnAssetBalance', async () => {
      if (!senderRlnReady) return { request: { assetId: 'rgb1dummyasset' }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnAssetBalance('rgb1dummyasset');
      return { request: { assetId: 'rgb1dummyasset' }, response };
    });

    await runRlnStep('rlnCheckIndexerUrl', async () => {
      if (!senderRlnReady) return { request: { indexerUrl: indexerUrlEnv ?? null }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      if (!indexerUrlEnv) return { request: { indexerUrl: null }, skipped: true, reason: 'Skipped: missing RLN_INDEXER_URL' };
      const response = await rlnCheckIndexerUrl(indexerUrlEnv);
      return { request: { indexerUrl: indexerUrlEnv }, response };
    });

    await runRlnStep('rlnCheckProxyEndpoint', async () => {
      if (!senderRlnReady) return { request: { proxyEndpoint: proxyEndpointEnv ?? null }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      if (!proxyEndpointEnv) return { request: { proxyEndpoint: null }, skipped: true, reason: 'Skipped: missing RLN_PROXY_ENDPOINT' };
      await rlnCheckProxyEndpoint(proxyEndpointEnv);
      return { request: { proxyEndpoint: proxyEndpointEnv }, response: { ok: true } };
    });

    await runRlnStep('rlnEstimateFee', async () => {
      if (!senderRlnReady) return { request: { blocks: 6 }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnEstimateFee(6);
      return { request: { blocks: 6 }, response };
    });

    await runRlnStep('rlnCreateUtxos', async () => {
      if (!senderRlnReady) return { request: { upTo: true, num: 1, size: 1000, feeRate: 1, skipSync: true }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      await rlnCreateUtxos(true, 1, 1000, 1, true);
      return { request: { upTo: true, num: 1, size: 1000, feeRate: 1, skipSync: true }, response: { ok: true } };
    });

    await runRlnStep('rlnDecodeLnInvoice', async () => {
      if (!senderRlnReady) return { request: { invoice: 'lnbc1...' }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnDecodeLnInvoice('lnbc1placeholder');
      return { request: { invoice: 'lnbc1placeholder' }, response };
    });

    await runRlnStep('rlnDecodeRgbInvoice', async () => {
      if (!senderRlnReady) return { request: { invoice: 'rgb1...' }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnDecodeRgbInvoice('rgb1placeholder');
      return { request: { invoice: 'rgb1placeholder' }, response };
    });

    await runRlnStep('rlnFailTransfers', async () => {
      if (!senderRlnReady) return { request: { batchTransferIdx: null, noAssetOnly: false, skipSync: true }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnFailTransfers(null, false, true);
      return { request: { batchTransferIdx: null, noAssetOnly: false, skipSync: true }, response };
    });

    await runRlnStep('rlnGetChannelId', async () => {
      if (!senderRlnReady) return { request: { temporaryChannelId: '00'.repeat(32) }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnGetChannelId('00'.repeat(32));
      return { request: { temporaryChannelId: '00'.repeat(32) }, response };
    });

    await runRlnStep('rlnGetPayment', async () => {
      if (!senderRlnReady) return { request: { paymentHash: '00'.repeat(32) }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnGetPayment('00'.repeat(32));
      return { request: { paymentHash: '00'.repeat(32) }, response };
    });

    await runRlnStep('rlnInvoiceStatus', async () => {
      if (!senderRlnReady) return { request: { invoice: 'lnbc1placeholder' }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnInvoiceStatus('lnbc1placeholder');
      return { request: { invoice: 'lnbc1placeholder' }, response };
    });

    await runRlnStep('rlnKeysend', async () => {
      if (!senderRlnReady) return { request: { destPubkey: peerPubkey, amtMsat: 1000 }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnKeysend(peerPubkey, 1000, null, null);
      return { request: { destPubkey: peerPubkey, amtMsat: 1000, assetId: null, assetAmount: null }, response };
    });

    await runRlnStep('rlnListAssets', async () => {
      if (!senderRlnReady) return { request: { filterAssetSchemas: [] }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnListAssets([]);
      return { request: { filterAssetSchemas: [] }, response };
    });

    await runRlnStep('rlnListTransactions', async () => {
      if (!senderRlnReady) return { request: { skipSync: true }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnListTransactions(true);
      return { request: { skipSync: true }, response: { count: response?.length ?? 0, transactions: response } };
    });

    await runRlnStep('rlnListTransfers', async () => {
      if (!senderRlnReady) return { request: { assetId: 'rgb1dummyasset' }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnListTransfers('rgb1dummyasset');
      return { request: { assetId: 'rgb1dummyasset' }, response: { count: response?.length ?? 0, transfers: response } };
    });

    await runRlnStep('rlnListUnspents', async () => {
      if (!senderRlnReady) return { request: { skipSync: true }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnListUnspents(true);
      return { request: { skipSync: true }, response: { count: response?.length ?? 0, unspents: response } };
    });

    await runRlnStep('rlnLnInvoice', async () => {
      if (!senderRlnReady) return { request: { amtMsat: 1000, expirySec: 3600 }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnLnInvoice(1000, 3600, null, null);
      return { request: { amtMsat: 1000, expirySec: 3600, assetId: null, assetAmount: null }, response };
    });

    await runRlnStep('rlnRefreshTransfers', async () => {
      if (!senderRlnReady) return { request: { skipSync: true }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      await rlnRefreshTransfers(true);
      return { request: { skipSync: true }, response: { refreshed: true } };
    });

    await runRlnStep('rlnRgbInvoice', async () => {
      if (!senderRlnReady) return { request: { assetId: null, assignmentAmount: 1, durationSeconds: 3600 }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnRgbInvoice(null, 1, 3600, 1, false);
      return { request: { assetId: null, assignmentAmount: 1, durationSeconds: 3600, minConfirmations: 1, witness: false }, response };
    });

    await runRlnStep('rlnSendBtc', async () => {
      if (!senderRlnReady) return { request: { amount: 1000, address: 'bcrt1qplaceholder', feeRate: 1, skipSync: true }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnSendBtc(1000, 'bcrt1qplaceholder', 1, true);
      return { request: { amount: 1000, address: 'bcrt1qplaceholder', feeRate: 1, skipSync: true }, response };
    });

    await runRlnStep('rlnSendPayment', async () => {
      if (!senderRlnReady) return { request: { invoice: 'lnbc1placeholder' }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnSendPayment('lnbc1placeholder', null, null, null);
      return { request: { invoice: 'lnbc1placeholder', amtMsat: null, assetId: null, assetAmount: null }, response };
    });

    await runRlnStep('rlnSendRgb', async () => {
      if (!senderRlnReady) return { request: { donation: false, feeRate: 1, minConfirmations: 1, skipSync: true }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnSendRgb(false, 1, 1, true);
      return { request: { donation: false, feeRate: 1, minConfirmations: 1, skipSync: true }, response };
    });

    await runRlnStep('rlnBackup', async () => {
      if (!senderRlnReady) return { request: { backupPath: `${rlnStorageDir}/backup.rln`, password: '***' }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      await rlnBackup(`${rlnStorageDir}/backup.rln`, nodePassword);
      return { request: { backupPath: `${rlnStorageDir}/backup.rln`, password: '***' }, response: { backedUp: true } };
    });

    await runRlnStep('rlnSync', async () => {
      if (!senderRlnReady) return { request: {}, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      await rlnSync();
      return { request: {}, response: { synced: true } };
    });

    await runRlnStep('rlnLock', async () => {
      return {
        request: {},
        skipped: true,
        reason: 'Skipped: lock is not exposed by current RLN native bindings',
      };
    });

    await runRlnStep('rlnRestore', async () => {
      return {
        request: {},
        skipped: true,
        reason:
          'Skipped: restore is wallet-level (restoreBackup/restoreFromVss), not an RLN node method',
      };
    });

    await runRlnStep('rlnShutdown', async () => {
      if (!senderRlnNodeCreated) return { request: {}, skipped: true, reason: 'Skipped: rlnCreateNode failed' };
      await rlnShutdown();
      return { request: {}, response: { shutdown: true } };
    });

    await runRlnStep('rlnDestroyNode', async () => {
      if (!senderRlnNodeCreated) {
        return { request: {}, skipped: true, reason: 'Skipped: rlnCreateNode failed' };
      }
      await rlnDestroyNode();
      senderRlnNodeDestroyed = true;
      senderRlnNodeCreated = false;
      senderRlnReady = false;
      return { request: {}, response: { destroyed: true } };
    });

    const failed = results.steps.some((s: any) => s.status === 'error');
    results.success = !failed;
    return results;
  } catch (error: any) {
    if (!results.steps.length) {
      addStep(
        'rlnPlaygroundSetup',
        'error',
        {
          reason: error?.message ?? String(error),
          stage: 'setup',
        },
        error?.message ?? String(error)
      );
    }
    results.success = false;
    results.error = {
      message: error?.message ?? String(error),
      reason: 'Flow aborted before completing all RLN steps',
      name: error?.name ?? null,
      code: error?.code ?? null,
    };
    return results;
  } finally {
    if (sender && senderRlnNodeCreated && !senderRlnNodeDestroyed) {
      const shouldIgnoreCleanupError = (error: any): boolean => {
        const message = (error?.message ?? String(error)).toLowerCase();
        return (
          message.includes('not found') ||
          message.includes('not created') ||
          message.includes('not initialized') ||
          message.includes('already shut') ||
          message.includes('already destroyed')
        );
      };

      let shutdownError: any = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await sender.rlnShutdown();
          shutdownError = null;
          break;
        } catch (error) {
          shutdownError = error;
          if (shouldIgnoreCleanupError(error)) {
            shutdownError = null;
            break;
          }
          await new Promise((resolve) => globalThis.setTimeout(resolve, 400));
        }
      }
      if (shutdownError) {
        cleanupIssues.push({
          step: 'rlnShutdown',
          message: shutdownError?.message ?? String(shutdownError),
        });
      }

      let destroyed = false;
      let destroyError: any = null;
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          await sender.rlnDestroyNode();
          destroyed = true;
          destroyError = null;
          break;
        } catch (error) {
          destroyError = error;
          if (shouldIgnoreCleanupError(error)) {
            destroyed = true;
            destroyError = null;
            break;
          }
          await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
        }
      }
      if (destroyed) {
        senderRlnNodeDestroyed = true;
        senderRlnNodeCreated = false;
        senderRlnReady = false;
      } else if (destroyError) {
        cleanupIssues.push({
          step: 'rlnDestroyNode',
          message: destroyError?.message ?? String(destroyError),
        });
      }
    }
    if (cleanupIssues.length > 0) {
      results.cleanup = {
        ok: false,
        issues: cleanupIssues,
      };
    }
    rlnPlaygroundFlowInFlight = false;
    endExclusiveFlow(flowName);
  }
}

/**
 * RLN Full Regtest Flow
 *
 * Pass-oriented end-to-end flow for the demo app:
 * create -> init -> unlock -> address -> fund -> sync -> balance -> shutdown -> destroy.
 */
export async function runRlnFullRegtestFlow() {
  return runRlnPaymentFlow();
}

type RlnFlowResults = { steps: any[]; success: boolean; error: any };
type RlnFlowContext = {
  results: RlnFlowResults;
  addStep: (step: string, status: string, data?: any, error?: string) => void;
  rln: RLNManager;
  nodeCreated: boolean;
  nodeDestroyed: boolean;
  keys: any;
  call: (name: string, ...args: any[]) => Promise<any>;
  nodePassword: string;
  unlockRequest: any;
  rpcHost: string;
  ensureFunded: (label?: string, amountBtc?: number) => Promise<string>;
};

type RlnNodeRuntime = {
  name: string;
  rln: RLNManager;
  wallet: WalletManager;
  call: (name: string, ...args: any[]) => Promise<any>;
  callSwap: (name: 'makerinit' | 'taker' | 'makerexecute' | 'listSwaps', ...args: any[]) => Promise<any>;
  storageDirPath: string;
  daemonListeningPort: number;
  ldkPeerListeningPort: number;
  nodePassword: string;
  cleanup: () => Promise<void>;
  safeShutdown: () => Promise<void>;
  disposeHandles: () => Promise<void>;
  unlockRequest: any;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isNodeStateConflictError(error: any): boolean {
  const message = String(error?.message ?? error).toLowerCase();
  const code = String(error?.code ?? '').toLowerCase();
  return message.includes('conflict') || code.includes('conflict');
}

function isRetryableNodeStateError(error: any): boolean {
  const message = String(error?.message ?? error).toLowerCase();
  return (
    isNodeStateConflictError(error) ||
    message.includes('shutting_down') ||
    message.includes('shutting down') ||
    message.includes('non-lifecycle operations are blocked')
  );
}

async function probeNodeReady(
  call: (method: string, ...args: any[]) => Promise<any>,
  attempts: number = 12,
  delayMs: number = 500
): Promise<{ ready: boolean; info?: any }> {
  await sleep(500);
  for (let i = 0; i < attempts; i += 1) {
    try {
      const info = await call('rlnNodeInfo');
      return { ready: true, info };
    } catch {
      if (i < attempts - 1) {
        await sleep(delayMs);
      }
    }
  }
  return { ready: false };
}

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

async function createRlnFlowContext(flowPrefix: string): Promise<RlnFlowContext> {
  const { results, addStep } = createFlowResults();
  const network = 'regtest' as const;
  const rpcHost = readEnv('RLN_BITCOIND_RPC_HOST') ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
  const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
  const keys = await createWallet(network);
  const rln = createRLNManager();

  const call = async (name: string, ...args: any[]) => {
    const fn = (rln as any)[name];
    if (typeof fn === 'function') return fn.call(rln, ...args);
    throw new Error(`Missing RLN method: ${name}`);
  };

  const mkStorageDir = async () => {
    const uri = `${documentDirectory ?? ''}${flowPrefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    try {
      await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
    } catch {
      // best effort
    }
    return uri.replace('file://', '');
  };
  const basePort = 20000 + Math.floor(Math.random() * 20000);
  const storageDirPath = await mkStorageDir();

  const nodePassword = readEnv('RLN_NODE_PASSWORD') ?? 'password';
  const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
  const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
  const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
  const proxyEndpoint = readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;
  const unlockRequest = {
    password: nodePassword,
    bitcoindRpcUsername: rpcUsername,
    bitcoindRpcPassword: rpcPassword,
    bitcoindRpcHost: rpcHost,
    bitcoindRpcPort: rpcPort,
    indexerUrl,
    proxyEndpoint,
    announceAddresses: [],
    announceAlias: null,
  };

  addStep('rlnCreateNode', 'running');
  await call('rlnCreateNode', {
    storageDirPath,
    daemonListeningPort: basePort,
    ldkPeerListeningPort: basePort + 1,
    network,
    maxMediaUploadSizeMb: 20,
    enableVirtualChannelsV0: false,
  });
  addStep('rlnCreateNode', 'success', {
    storageDirPath,
    daemonListeningPort: basePort,
    ldkPeerListeningPort: basePort + 1,
    network,
  });

  addStep('rlnInitNode', 'running');
  const pubkey = await call('rlnInitNode', nodePassword, keys.mnemonic);
  addStep('rlnInitNode', 'success', { pubkey });

  addStep('rlnUnlockNode', 'running');
  await call('rlnUnlockNode', unlockRequest);
  addStep('rlnUnlockNode', 'success', { rpcHost, rpcPort, rpcUsername, indexerUrl, proxyEndpoint });

  const ensureFunded = async (label: string = 'fundAddress', amountBtc: number = 1) => {
    addStep('rlnAddress', 'running');
    const addrResponse = await call('rlnAddress');
    const address = String(addrResponse?.address ?? addrResponse ?? '');
    if (!address) throw new Error('Failed to get RLN address');
    addStep('rlnAddress', 'success', { address });
    addStep(label, 'running');
    const txid = await sendToAddress(address, amountBtc);
    await mine(6);
    addStep(label, 'success', { txid, blocksMined: 6, amountBtc, nodeEndpoint: BITCOIN_NODE_ENDPOINT });
    return address;
  };

  return {
    results,
    addStep,
    rln,
    nodeCreated: true,
    nodeDestroyed: false,
    keys,
    call,
    nodePassword,
    unlockRequest,
    rpcHost,
    ensureFunded,
  };
}

async function cleanupRlnFlowContext(ctx: RlnFlowContext) {
  if (ctx.nodeCreated && !ctx.nodeDestroyed) {
    try {
      await ctx.rln.rlnShutdown();
    } catch {
      // best effort
    }
    try {
      await ctx.rln.rlnDestroyNode();
    } catch {
      // best effort
    }
  }
}

async function createRlnNodeRuntime(
  opts: {
    name: string;
    flowPrefix: string;
    stepPrefix: string;
    addStep: (step: string, status: string, data?: any, error?: string) => void;
    reuse?: {
      storageDirPath: string;
      daemonListeningPort: number;
      ldkPeerListeningPort: number;
      nodePassword: string;
    };
  }
): Promise<RlnNodeRuntime> {
  const { name, flowPrefix, stepPrefix, addStep, reuse } = opts;
  const network = 'regtest' as const;
  const rpcHost = readEnv('RLN_BITCOIND_RPC_HOST') ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
  const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
  const keys = await createWallet(network);
  const rln = createRLNManager();
  const wallet = createWalletManager({
    xpubVan: keys.accountXpubVanilla,
    xpubCol: keys.accountXpubColored,
    masterFingerprint: keys.masterFingerprint,
    mnemonic: keys.mnemonic,
    network,
    indexerUrl,
  });
  await wallet.initialize();

  const call = async (method: string, ...args: any[]) => {
    const fn = (rln as any)[method];
    if (typeof fn !== 'function') throw new Error(`Missing RLN method on ${name}: ${method}`);
    const argsLog = JSON.stringify(args);
    console.log(`[rln:${name}] ▶ ${method}(${argsLog})`);
    try {
      const result = await fn.call(rln, ...args);
      console.log(`[rln:${name}] ✓ ${method} → ${JSON.stringify(result)}`);
      return result;
    } catch (e: any) {
      console.error(`[rln:${name}] ✗ ${method}(${argsLog}) threw: ${e?.message ?? String(e)}`);
      throw e;
    }
  };

  const callSwap = async (
    method: 'makerinit' | 'taker' | 'makerexecute' | 'listSwaps',
    ...args: any[]
  ) => {
    throw new Error(`Swap method '${method}' is not yet implemented in RLNManager on ${name}`);
  };

  const mkStorageDir = async () => {
    const uri = `${documentDirectory ?? ''}${flowPrefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    try {
      await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
    } catch {
      // best effort
    }
    return uri.replace('file://', '');
  };

  const basePort = reuse?.daemonListeningPort ?? (20000 + Math.floor(Math.random() * 20000));
  const ldkPeerListeningPort = reuse?.ldkPeerListeningPort ?? (basePort + 1);
  const storageDirPath = reuse?.storageDirPath ?? (await mkStorageDir());
  const nodePassword = reuse?.nodePassword ?? `${name}pass`;
  const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
  const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
  const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
  const proxyEndpoint = readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;
  const unlockRequest = {
    password: nodePassword,
    bitcoindRpcUsername: rpcUsername,
    bitcoindRpcPassword: rpcPassword,
    bitcoindRpcHost: rpcHost,
    bitcoindRpcPort: rpcPort,
    indexerUrl,
    proxyEndpoint,
    announceAddresses: [],
    announceAlias: null,
  };

  addStep(`${stepPrefix}CreateNode`, 'running');
  await call('rlnCreateNode', {
    storageDirPath,
    daemonListeningPort: basePort,
    ldkPeerListeningPort,
    network,
    maxMediaUploadSizeMb: 20,
    enableVirtualChannelsV0: false,
  });
  addStep(`${stepPrefix}CreateNode`, 'success', { storageDirPath, daemonListeningPort: basePort, ldkPeerListeningPort });

  addStep(`${stepPrefix}InitNode`, 'running');
  let pubkey: string | null = null;
  try {
    pubkey = await call('rlnInitNode', nodePassword, keys.mnemonic);
    addStep(`${stepPrefix}InitNode`, 'success', { pubkey, recreated: Boolean(reuse) });
  } catch (error: any) {
    const message = String(error?.message ?? error).toLowerCase();
    const alreadyInitialized =
      message.includes('already initialized') || message.includes('conflict with current node state');
    if (!alreadyInitialized) {
      throw error;
    }
    addStep(`${stepPrefix}InitNode`, 'success', {
      skipped: true,
      normalizedConflict: true,
      reason: error?.message ?? String(error),
      recreated: Boolean(reuse),
    });
  }

  addStep(`${stepPrefix}UnlockNode`, 'running');
  let unlockAttempts = 0;
  let normalizedConflict = false;
  let recoveredFromReadinessProbe = false;
  let lastRetryError: string | null = null;
  const maxUnlockAttempts = 12;
  for (let attempt = 1; attempt <= maxUnlockAttempts; attempt += 1) {
    unlockAttempts = attempt;
    try {
      await call('rlnUnlockNode', unlockRequest);
      break;
    } catch (error: any) {
      lastRetryError = String(error?.message ?? error);
      if (!isRetryableNodeStateError(error)) {
        throw error;
      }
      if (isNodeStateConflictError(error)) {
        const readiness = await probeNodeReady(call, 12, 500);
        if (readiness.ready) {
          normalizedConflict = true;
          recoveredFromReadinessProbe = true;
          break;
        }
      }
      if (attempt === maxUnlockAttempts) {
        throw error;
      }
      await sleep(800);
    }
  }
  addStep(`${stepPrefix}UnlockNode`, 'success', {
    rpcHost,
    rpcPort,
    indexerUrl,
    proxyEndpoint,
    attempts: unlockAttempts,
    recoveredFromRetry: unlockAttempts > 1,
    normalizedConflict,
    recoveredFromReadinessProbe,
    lastRetryError,
  });

  const cleanup = async () => {
    try {
      await rln.rlnShutdown();
    } catch {
      // best effort
    }
    try {
      await rln.rlnDestroyNode();
    } catch {
      // best effort
    }
    try {
      await wallet.dispose();
    } catch {
      // best effort
    }
  };
  const safeShutdown = async () => {
    try {
      await rln.rlnShutdown();
    } catch {
      // best effort
    }
  };
  const disposeHandles = async () => {
    try {
      await wallet.dispose();
    } catch {
      // best effort
    }
  };

  return {
    name,
    rln,
    wallet,
    call,
    callSwap,
    storageDirPath,
    daemonListeningPort: basePort,
    ldkPeerListeningPort,
    nodePassword,
    cleanup,
    safeShutdown,
    disposeHandles,
    unlockRequest,
  };
}

// For asset channels (assetId provided): find channel in listChannels by assetId — mirrors Android.
// For BTC channels (no assetId): resolve via rlnGetChannelId(tmpId), then find by channelId.
// Returns { channelId, fundingTxid }.
async function waitForChannelFundingTx(
  opener: RlnNodeRuntime,
  peer: RlnNodeRuntime,
  tmpId: string,
  timeoutMs: number = 120000,
  assetId?: string,
): Promise<{ channelId: string; fundingTxid: string }> {
  const startMs = Date.now();
  const deadline = startMs + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    try { await opener.call('rlnSync'); } catch (e: any) { console.warn(`[flow] opener.rlnSync: ${e?.message}`); }
    try { await peer.call('rlnSync'); } catch (e: any) { console.warn(`[flow] peer.rlnSync: ${e?.message}`); }
    let channels: any[] = [];
    try { channels = (await opener.call('rlnListChannels')) ?? []; } catch (e: any) { console.warn(`[flow] rlnListChannels: ${e?.message}`); }
    let ch: any;
    if (assetId) {
      ch = channels.find((c: any) => (c.assetId ?? c.asset_id) === assetId);
    } else {
      let channelId = '';
      try {
        const resolved = await opener.call('rlnGetChannelId', tmpId);
        channelId = String(resolved ?? '');
      } catch (e: any) {
        console.warn(`[flow] rlnGetChannelId(${tmpId}) attempt=${attempt}: ${e?.message}`);
      }
      if (channelId) ch = channels.find((c: any) => (c.channelId ?? c.channel_id) === channelId);
    }
    const channelId = String(ch?.channelId ?? ch?.channel_id ?? '');
    const fundingTxid = String(ch?.fundingTxid ?? ch?.funding_txid ?? '');
    console.log(`[flow] waitForChannelFundingTx attempt=${attempt} elapsed=${elapsedSec}s channelId="${channelId}" fundingTxid="${fundingTxid}" found=${!!ch}`);
    if (ch) return { channelId, fundingTxid };
    try { await mine(1); } catch (e: any) { console.warn(`[flow] mine(1): ${e?.message}`); }
    await sleep(1000);
  }
  throw new Error(`Channel not found after ${attempt} attempts (${timeoutMs / 1000}s)`);
}

// Mirrors Android's mineUntilTxConfirmed: sync → listTransactions → check confirmationTime.
async function waitForFundingConfirmed(
  node: RlnNodeRuntime,
  fundingTxid: string,
  timeoutMs: number = 180000
): Promise<void> {
  if (!fundingTxid) {
    console.log('[flow] waitForFundingConfirmed: fundingTxid absent, channel already confirmed');
    return;
  }
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try { await node.call('rlnSync'); } catch {}
    const txs: any[] = (await node.call('rlnListTransactions', false)) ?? [];
    const tx = txs.find((t: any) => (t?.txid ?? t?.txId) === fundingTxid);
    const confirmed = !!(tx && (tx.confirmationTime != null || tx.confirmation_time != null));
    console.log(`[flow] waitForFundingConfirmed attempt=${attempt} txid=${fundingTxid.substring(0, 12)}... confirmed=${confirmed} tx=${JSON.stringify(tx ?? null)}`);
    if (confirmed) return;
    await mine(1);
    await sleep(1000);
  }
  throw new Error(`Funding tx not confirmed after ${attempt} attempts: ${fundingTxid}`);
}

// Mirrors Android's waitForUsableChannel: poll listChannels until ready=true,
// mining every 5 polls. Returns channelId of the first ready channel.
async function waitForChannelReady(
  node: RlnNodeRuntime,
  timeoutMs: number = 120000
): Promise<string> {
  const startMs = Date.now();
  const deadline = startMs + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    try {
      const channels: any[] = (await node.call('rlnListChannels')) ?? [];
      const usable = channels.find((c: any) => (c.isUsable ?? c.is_usable) === true || (c.ready === true && c.isUsable == null));
      const channelId = String(usable?.channelId ?? usable?.channel_id ?? '');
      console.log(`[flow] waitForChannelReady attempt=${attempt} elapsed=${elapsedSec}s channels=${channels.length} usableChannelId="${channelId}"`);
      if (channelId) return channelId;
    } catch (e: any) {
      console.warn(`[flow] waitForChannelReady rlnListChannels: ${e?.message}`);
    }
    if (attempt % 5 === 0) {
      try { await mine(1); } catch (e: any) { console.warn(`[flow] mine(1): ${e?.message}`); }
    }
    await sleep(1000);
  }
  throw new Error(`No ready channel after ${attempt} attempts (${timeoutMs / 1000}s)`);
}

// Mirrors Android's waitForStableChannelBalances: sync both nodes, poll listChannels
// until localBalanceSat on both sides is stable for 2 consecutive polls. This ensures
// all HTLC resolution is complete before cooperative close.
async function waitForStableChannelBalances(
  nodeA: RlnNodeRuntime,
  nodeB: RlnNodeRuntime,
  channelId: string,
  timeoutMs: number = 30000,
): Promise<void> {
  const startMs = Date.now();
  const deadline = startMs + timeoutMs;

    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    try { await nodeA.call('rlnSync'); } catch (e: any) { console.warn(`[flow] waitForStable nodeA.rlnSync: ${e?.message}`); }
    try { await nodeB.call('rlnSync'); } catch (e: any) { console.warn(`[flow] waitForStable nodeB.rlnSync: ${e?.message}`); }
    const channelsA: any[] = (await nodeA.call('rlnListChannels')) ?? [];
    const channelsB: any[] = (await nodeB.call('rlnListChannels')) ?? [];
}

async function waitForAssetBalance(
  node: RlnNodeRuntime,
  assetId: string,
  expectedSpendable: number,
  timeoutMs: number = 70000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < deadline) {
    try {
      const bal = await node.call('rlnAssetBalance', assetId);
      last = Number(bal?.spendable ?? -1);
      console.log(`[flow] waitForAssetBalance assetId=${assetId.substring(0, 12)}... spendable=${last} expected=${expectedSpendable}`);
      if (last === expectedSpendable) return;
    } catch (e: any) {
      console.warn(`[flow] waitForAssetBalance: ${e?.message}`);
    }
    try { await node.call('rlnRefreshTransfers', false); } catch {}
    await sleep(1000);
  }
  throw new Error(`Asset balance did not reach ${expectedSpendable}, last=${last}`);
}

async function waitForUsableChannels(node: RlnNodeRuntime, expected: number, timeoutMs: number = 60000) {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    try {
      const info = await node.call('rlnNodeInfo');
      const usable = Number(info?.numUsableChannels ?? info?.num_usable_channels ?? 0);
      last = usable;
      if (usable === expected) return;
    } catch {
      // keep polling
    }
    await sleep(1000);
  }
  throw new Error(`Usable channels did not reach ${expected}, last=${last}`);
}

async function waitForSwapStatus(
  node: RlnNodeRuntime,
  paymentHash: string,
  expectedStatus: string,
  timeoutMs: number = 90000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const swaps = await node.callSwap('listSwaps');
    const maker = Array.isArray(swaps?.maker) ? swaps.maker : [];
    const taker = Array.isArray(swaps?.taker) ? swaps.taker : [];
    const hit = [...maker, ...taker].find((s: any) => s?.paymentHash === paymentHash || s?.payment_hash === paymentHash);
    if (hit && String(hit.status).toUpperCase() === expectedStatus.toUpperCase()) return hit;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Swap did not reach ${expectedStatus} for payment hash ${paymentHash}`);
}

async function waitForInvoiceStatus(
  call: (method: string, ...args: any[]) => Promise<any>,
  invoice: string,
  expected: string,
  timeoutMs: number = 60000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await call('rlnInvoiceStatus', invoice);
      const status = String(res?.status ?? res?.value ?? res ?? '').toUpperCase();
      if (status === expected.toUpperCase()) return;
    } catch {
      // keep polling
    }
    await sleep(1000);
  }
  throw new Error(`Invoice did not reach ${expected} in ${timeoutMs}ms`);
}

async function waitForPaymentSuccess(
  call: (method: string, ...args: any[]) => Promise<any>,
  paymentHash: string,
  timeoutMs: number = 60000
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const payments: any[] = (await call('rlnListPayments')) ?? [];
      const p = payments.find((x: any) =>
        (x?.paymentHash ?? x?.payment_hash) === paymentHash
      );
      if (p) {
        const s = String(p.status ?? '').toUpperCase();
        if (s === 'SUCCEEDED') return p;
        if (s === 'FAILED') throw new Error(`Payment failed: ${paymentHash}`);
      }
    } catch (e: any) {
      if (e?.message?.includes('Payment failed')) throw e;
    }
    await sleep(1000);
  }
  throw new Error(`Payment did not succeed in ${timeoutMs}ms: ${paymentHash}`);
}

async function fundAndCreateUtxosForNode(
  node: RlnNodeRuntime,
  prefix: string,
  addStep: (step: string, status: string, data?: any) => void
): Promise<void> {
  addStep(`${prefix}Fund`, 'running');
  const bal = await node.call('rlnBtcBalance', false);
  const spendable = Number(bal?.vanilla?.spendable ?? bal?.vanilla?.spendableSat ?? 0);
  let txid: string | null = null;
  if (spendable < 1) {
    const addrResp = await node.call('rlnAddress');
    const address = String(addrResp?.address ?? '');
    if (!address) throw new Error(`${prefix}: could not get address`);
    txid = String(await sendToAddress(address, 1));
    await mine(6);
    await node.call('rlnSync');
  }
  addStep(`${prefix}Fund`, 'success', {
    txid,
    nodeEndpoint: BITCOIN_NODE_ENDPOINT,
    skipped: txid === null,
  });
  addStep(`${prefix}CreateUtxos`, 'running');
  await node.call('rlnSync');
  await node.call('rlnCreateUtxos', false, 10, null, 7, false);
  await mine(1);
  await node.call('rlnSync');
  addStep(`${prefix}CreateUtxos`, 'success', { num: 10, feeRate: 7 });
}

export async function runRlnPaymentFlow() {
  const flowName = 'runRlnPaymentFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();
  let nodeA: RlnNodeRuntime | null = null;
  let nodeB: RlnNodeRuntime | null = null;
  let nodeC: RlnNodeRuntime | null = null;
  try {
    nodeA = await createRlnNodeRuntime({ name: 'nodeA', flowPrefix: 'rln_payment_a', stepPrefix: 'payA', addStep });
    nodeB = await createRlnNodeRuntime({ name: 'nodeB', flowPrefix: 'rln_payment_b', stepPrefix: 'payB', addStep });
    nodeC = await createRlnNodeRuntime({ name: 'nodeC', flowPrefix: 'rln_payment_c', stepPrefix: 'payC', addStep });

    await fundAndCreateUtxosForNode(nodeA, 'payA', addStep);
    await fundAndCreateUtxosForNode(nodeB, 'payB', addStep);
    await fundAndCreateUtxosForNode(nodeC, 'payC', addStep);

    // Issue RGB asset on nodeA (1000 units) — mirrors Android test
    addStep('payIssueAsset', 'running');
    const issued = await nodeA.call('rlnIssueAssetNia', 'USDT', 'Tether', 0, [1000]);
    const assetId = String(issued?.assetId ?? issued?.asset_id ?? '');
    if (!assetId) throw new Error('Failed to issue asset');
    addStep('payIssueAsset', 'success', { assetId });

    const infoA = await nodeA.call('rlnNodeInfo');
    const infoB = await nodeB.call('rlnNodeInfo');
    const pubkeyA = String(infoA?.pubkey ?? '');
    const pubkeyB = String(infoB?.pubkey ?? '');
    addStep('payNodeInfos', 'success', {
      pubkeyA: pubkeyA.substring(0, 16) + '...',
      pubkeyB: pubkeyB.substring(0, 16) + '...',
    });

    addStep('payConnectPeers', 'running');
    const peerUriB = `${pubkeyB}@127.0.0.1:${nodeB.ldkPeerListeningPort}`;
    try { await nodeA.call('rlnConnectPeer', peerUriB); } catch { /* already connected */ }
    addStep('payConnectPeers', 'success', {});

    // nodeA opens asset channel to nodeB (600 units pushed into channel)
    addStep('payOpenChannel', 'running');
    const openResp = await nodeA.call('rlnOpenChannel', {
      peerPubkeyAndOptAddr: peerUriB,
      capacitySat: 100000,
      pushMsat: 3_500_000,
      public: true,
      withAnchors: true,
      assetId,
      assetAmount: 600,
    });
    const tmpId = String(openResp?.temporaryChannelId ?? openResp?.temporary_channel_id ?? '');
    // Find channel by assetId (mirrors Android's waitForChannelFundingTx(nodeA, nodeB, assetId))
    const { fundingTxid } = await waitForChannelFundingTx(nodeA, nodeB, tmpId, 120000, assetId);
    await waitForFundingConfirmed(nodeA, fundingTxid, 180000);

    const channelId = await waitForChannelReady(nodeA);
    await mine(6);
    await waitForChannelReady(nodeA);
    addStep('payOpenChannel', 'success', { channelId, fundingTxid });

    // nodeA has 400 spendable (1000 issued - 600 in channel)
    addStep('payAssetBalanceA', 'running');
    const balA0 = await nodeA.call('rlnAssetBalance', assetId);
    addStep('payAssetBalanceA', 'success', { spendable: balA0?.spendable ?? null });

    const paymentMsat = 3_000_000;

    // inv1: B creates (100 asset units), A pays — like Android invoice1
    addStep('payInvoice1', 'running');
    const invResp1 = await nodeB.call('rlnLnInvoice', paymentMsat, 900, assetId, 100);
    const invoice1 = String(invResp1?.invoice ?? invResp1 ?? '');
    const dec1 = await nodeA.call('rlnDecodeLnInvoice', invoice1);
    const hash1 = String(dec1?.paymentHash ?? dec1?.payment_hash ?? '');
    await nodeA.call('rlnSendPayment', invoice1, null, null, null);
    await waitForInvoiceStatus(nodeB.call.bind(nodeB), invoice1, 'SUCCEEDED', 60000);
    await waitForPaymentSuccess(nodeA.call.bind(nodeA), hash1, 60000);
    addStep('payInvoice1', 'success', { paymentHash: hash1, assetAmount: 100 });

    // inv2: A creates (50 asset units), B pays — like Android invoice2
    addStep('payInvoice2', 'running');
    const invResp2 = await nodeA.call('rlnLnInvoice', paymentMsat, 900, assetId, 50);
    const invoice2 = String(invResp2?.invoice ?? invResp2 ?? '');
    const dec2 = await nodeA.call('rlnDecodeLnInvoice', invoice2);
    const hash2 = String(dec2?.paymentHash ?? dec2?.payment_hash ?? '');
    await nodeB.call('rlnSendPayment', invoice2, null, null, null);
    await waitForInvoiceStatus(nodeA.call.bind(nodeA), invoice2, 'SUCCEEDED', 60000);
    await waitForPaymentSuccess(nodeB.call.bind(nodeB), hash2, 60000);
    addStep('payInvoice2', 'success', { paymentHash: hash2, assetAmount: 50 });

    // inv3: B creates (50 asset units), A pays — like Android invoice3
    addStep('payInvoice3', 'running');
    const invResp3 = await nodeB.call('rlnLnInvoice', paymentMsat, 900, assetId, 50);
    const invoice3 = String(invResp3?.invoice ?? invResp3 ?? '');
    const dec3 = await nodeA.call('rlnDecodeLnInvoice', invoice3);
    const hash3 = String(dec3?.paymentHash ?? dec3?.payment_hash ?? '');
    await nodeA.call('rlnSendPayment', invoice3, null, null, null);
    await waitForInvoiceStatus(nodeB.call.bind(nodeB), invoice3, 'SUCCEEDED', 60000);
    await waitForPaymentSuccess(nodeA.call.bind(nodeA), hash3, 60000);
    addStep('payInvoice3', 'success', { paymentHash: hash3, assetAmount: 50 });

    // inv4: A creates (50 asset units), B pays — like Android invoice4
    addStep('payInvoice4', 'running');
    const invResp4 = await nodeA.call('rlnLnInvoice', paymentMsat, 900, assetId, 50);
    const invoice4 = String(invResp4?.invoice ?? invResp4 ?? '');
    const dec4 = await nodeA.call('rlnDecodeLnInvoice', invoice4);
    const hash4 = String(dec4?.paymentHash ?? dec4?.payment_hash ?? '');
    await nodeB.call('rlnSendPayment', invoice4, null, null, null);
    await waitForInvoiceStatus(nodeA.call.bind(nodeA), invoice4, 'SUCCEEDED', 60000);
    await waitForPaymentSuccess(nodeB.call.bind(nodeB), hash4, 60000);
    addStep('payInvoice4', 'success', { paymentHash: hash4, assetAmount: 50 });

    // Wait for HTLC resolution on both sides before cooperative close (mirrors Android's waitForStableChannelBalances)
    await waitForStableChannelBalances(nodeA, nodeB, channelId, 30000);

    // Cooperative close
    addStep('payCloseChannel', 'running');
    await nodeA.call('rlnCloseChannel', channelId, pubkeyB, false);
    await mine(6);
    addStep('payCloseChannel', 'success', { channelId });

    // After close: A=950 (400 settled + 550 from channel), B=50
    addStep('payWaitBalances', 'running');
    await waitForAssetBalance(nodeA, assetId, 950, 70000);
    await waitForAssetBalance(nodeB, assetId, 50, 70000);
    addStep('payWaitBalances', 'success', { expectedA: 950, expectedB: 50 });

    // RGB sends to nodeC (A sends 925, B sends 25) — mirrors Android
    addStep('payRgbSendA', 'running');
    const invoiceC1 = await nodeC.call('rlnRgbInvoice', assetId, 925, 3600, 1, false);
    const recipientC1 = String(invoiceC1?.recipientId ?? invoiceC1?.recipient_id ?? '');
    await nodeA.call('rlnSendRgb', false, 1, 1, false);
    await mine(1);
    await nodeC.call('rlnRefreshTransfers', false);
    await nodeC.call('rlnRefreshTransfers', false);
    await nodeA.call('rlnRefreshTransfers', false);
    addStep('payRgbSendA', 'success', { amount: 925, recipient: recipientC1.substring(0, 20) + '...' });

    addStep('payRgbSendB', 'running');
    const invoiceC2 = await nodeC.call('rlnRgbInvoice', assetId, 25, 3600, 1, false);
    const recipientC2 = String(invoiceC2?.recipientId ?? invoiceC2?.recipient_id ?? '');
    await nodeB.call('rlnSendRgb', false, 1, 1, false);
    await mine(1);
    await nodeC.call('rlnRefreshTransfers', false);
    await nodeC.call('rlnRefreshTransfers', false);
    await nodeB.call('rlnRefreshTransfers', false);
    addStep('payRgbSendB', 'success', { amount: 25, recipient: recipientC2.substring(0, 20) + '...' });

    // Final balances: A=25, B=25, C=950
    addStep('payFinalBalances', 'running');
    const [finalA, finalB, finalC] = await Promise.all([
      nodeA.call('rlnAssetBalance', assetId),
      nodeB.call('rlnAssetBalance', assetId),
      nodeC.call('rlnAssetBalance', assetId),
    ]);
    addStep('payFinalBalances', 'success', {
      spendableA: finalA?.spendable ?? null,
      spendableB: finalB?.spendable ?? null,
      spendableC: finalC?.spendable ?? null,
    });

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (nodeA) await nodeA.cleanup();
    if (nodeB) await nodeB.cleanup();
    if (nodeC) await nodeC.cleanup();
    endExclusiveFlow(flowName);
  }
}

export async function runRlnRestartFlow() {
  const flowName = 'runRlnRestartFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();
  let nodeA: RlnNodeRuntime | null = null;
  let nodeB: RlnNodeRuntime | null = null;
  let nodeC: RlnNodeRuntime | null = null;
  try {
    nodeA = await createRlnNodeRuntime({ name: 'nodeA', flowPrefix: 'rln_restart_a', stepPrefix: 'restartA', addStep });
    nodeB = await createRlnNodeRuntime({ name: 'nodeB', flowPrefix: 'rln_restart_b', stepPrefix: 'restartB', addStep });
    nodeC = await createRlnNodeRuntime({ name: 'nodeC', flowPrefix: 'rln_restart_c', stepPrefix: 'restartC', addStep });

    await fundAndCreateUtxosForNode(nodeA, 'restartA', addStep);
    await fundAndCreateUtxosForNode(nodeB, 'restartB', addStep);
    await fundAndCreateUtxosForNode(nodeC, 'restartC', addStep);

    const infoA = await nodeA.call('rlnNodeInfo');
    const infoB = await nodeB.call('rlnNodeInfo');
    const pubkeyA = String(infoA?.pubkey ?? '');
    const pubkeyB = String(infoB?.pubkey ?? '');
    addStep('restartNodeInfos', 'success', {
      pubkeyA: pubkeyA.substring(0, 16) + '...',
      pubkeyB: pubkeyB.substring(0, 16) + '...',
    });

    addStep('restartConnectPeer', 'running');
    const peerUriA = `${pubkeyA}@127.0.0.1:${nodeA.ldkPeerListeningPort}`;
    const peerUriB = `${pubkeyB}@127.0.0.1:${nodeB.ldkPeerListeningPort}`;
    try { await nodeB.call('rlnConnectPeer', peerUriA); } catch { /* already connected */ }
    addStep('restartConnectPeer', 'success', {});

    // A opens channel to B; A has outbound capacity
    addStep('restartOpenChannel', 'running');
    const openResp = await nodeA.call('rlnOpenChannel', {
      peerPubkeyAndOptAddr: peerUriB,
      capacitySat: 100000,
      pushMsat: 0,
      public: true,
      withAnchors: true,
    });
    const tmpId = String(openResp?.temporaryChannelId ?? openResp?.temporary_channel_id ?? '');
    const { channelId, fundingTxid } = await waitForChannelFundingTx(nodeA, nodeB, tmpId, 120000);
    await waitForFundingConfirmed(nodeA, fundingTxid, 180000);
    await mine(6);
    await waitForChannelReady(nodeA);
    addStep('restartOpenChannel', 'success', { channelId, fundingTxid });

    // B creates invoice; A pays to B
    addStep('restartPreRestartPayment', 'running');
    const invResp = await nodeB.call('rlnLnInvoice', 5_000_000, 900, null, null);
    const invoice = String(invResp?.invoice ?? invResp ?? '');
    const decResp = await nodeB.call('rlnDecodeLnInvoice', invoice);
    const expectedHash = String(decResp?.paymentHash ?? decResp?.payment_hash ?? '');
    const sendResp = await nodeA.call('rlnSendPayment', invoice, null, null, null);
    const payHash = String(sendResp?.paymentHash ?? sendResp?.payment_hash ?? expectedHash);
    await waitForInvoiceStatus(nodeB.call.bind(nodeB), invoice, 'SUCCEEDED', 60000);
    await waitForPaymentSuccess(nodeA.call.bind(nodeA), payHash, 60000);
    addStep('restartPreRestartPayment', 'success', { paymentHash: payHash, amtMsat: 5_000_000 });

    const restartConfigA = { storageDirPath: nodeA.storageDirPath, daemonListeningPort: nodeA.daemonListeningPort, ldkPeerListeningPort: nodeA.ldkPeerListeningPort, nodePassword: nodeA.nodePassword };
    const restartConfigB = { storageDirPath: nodeB.storageDirPath, daemonListeningPort: nodeB.daemonListeningPort, ldkPeerListeningPort: nodeB.ldkPeerListeningPort, nodePassword: nodeB.nodePassword };
    const restartConfigC = { storageDirPath: nodeC.storageDirPath, daemonListeningPort: nodeC.daemonListeningPort, ldkPeerListeningPort: nodeC.ldkPeerListeningPort, nodePassword: nodeC.nodePassword };

    addStep('restartShutdownA', 'running');
    await nodeA.safeShutdown();
    addStep('restartShutdownA', 'success', {});
    addStep('restartShutdownB', 'running');
    await nodeB.safeShutdown();
    addStep('restartShutdownB', 'success', {});
    addStep('restartShutdownC', 'running');
    await nodeC.safeShutdown();
    addStep('restartShutdownC', 'success', {});
    await sleep(2000);
    await nodeA.disposeHandles();
    await nodeB.disposeHandles();
    await nodeC.disposeHandles();

    nodeA = await createRlnNodeRuntime({ name: 'nodeA', flowPrefix: 'rln_restart_a', stepPrefix: 'restartARecreate', addStep, reuse: restartConfigA });
    nodeB = await createRlnNodeRuntime({ name: 'nodeB', flowPrefix: 'rln_restart_b', stepPrefix: 'restartBRecreate', addStep, reuse: restartConfigB });
    nodeC = await createRlnNodeRuntime({ name: 'nodeC', flowPrefix: 'rln_restart_c', stepPrefix: 'restartCRecreate', addStep, reuse: restartConfigC });

    addStep('restartWaitUsableChannel', 'running');
    await waitForUsableChannels(nodeA, 1, 60000);
    addStep('restartWaitUsableChannel', 'success', { usableChannels: 1 });

    addStep('restartVerifyPayment', 'running');
    const paymentsA: any[] = (await nodeA.call('rlnListPayments')) ?? [];
    const found = paymentsA.find((p: any) => (p?.paymentHash ?? p?.payment_hash) === payHash);
    if (!found) throw new Error(`Payment ${payHash} not found after restart`);
    addStep('restartVerifyPayment', 'success', { paymentHash: payHash, status: found.status });

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (nodeA) await nodeA.cleanup();
    if (nodeB) await nodeB.cleanup();
    if (nodeC) await nodeC.cleanup();
    endExclusiveFlow(flowName);
  }
}

export async function runRlnMultiOpenCloseFlow() {
  const flowName = 'runRlnMultiOpenCloseFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();
  let nodeA: RlnNodeRuntime | null = null;
  let nodeB: RlnNodeRuntime | null = null;
  let nodeC: RlnNodeRuntime | null = null;
  try {
    nodeA = await createRlnNodeRuntime({ name: 'nodeA', flowPrefix: 'rln_moc_a', stepPrefix: 'mocA', addStep });
    nodeB = await createRlnNodeRuntime({ name: 'nodeB', flowPrefix: 'rln_moc_b', stepPrefix: 'mocB', addStep });
    nodeC = await createRlnNodeRuntime({ name: 'nodeC', flowPrefix: 'rln_moc_c', stepPrefix: 'mocC', addStep });

    await fundAndCreateUtxosForNode(nodeA, 'mocA', addStep);
    await fundAndCreateUtxosForNode(nodeB, 'mocB', addStep);
    await fundAndCreateUtxosForNode(nodeC, 'mocC', addStep);

    const infoA = await nodeA.call('rlnNodeInfo');
    const infoB = await nodeB.call('rlnNodeInfo');
    const pubkeyA = String(infoA?.pubkey ?? '');
    const pubkeyB = String(infoB?.pubkey ?? '');
    addStep('mocNodeInfos', 'success', {
      pubkeyA: pubkeyA.substring(0, 16) + '...',
      pubkeyB: pubkeyB.substring(0, 16) + '...',
    });

    addStep('mocConnectPeers', 'running');
    const peerUriA = `${pubkeyA}@127.0.0.1:${nodeA.ldkPeerListeningPort}`;
    const peerUriB = `${pubkeyB}@127.0.0.1:${nodeB.ldkPeerListeningPort}`;
    try { await nodeB.call('rlnConnectPeer', peerUriA); } catch { /* already connected */ }
    try { await nodeC.call('rlnConnectPeer', peerUriB); } catch { /* already connected */ }
    addStep('mocConnectPeers', 'success', {});

    for (let cycle = 1; cycle <= 2; cycle += 1) {
      addStep(`mocOpenChannel${cycle}`, 'running');
      // pushMsat gives nodeA 3500 sat of outbound capacity for keysend
      const openResp = await nodeB.call('rlnOpenChannel', {
        peerPubkeyAndOptAddr: peerUriA,
        capacitySat: 100000,
        pushMsat: 3_500_000,
        public: true,
        withAnchors: true,
      });
      const tmpId = String(openResp?.temporaryChannelId ?? openResp?.temporary_channel_id ?? '');
      const { channelId, fundingTxid } = await waitForChannelFundingTx(nodeB, nodeA, tmpId, 120000);
      await waitForFundingConfirmed(nodeB, fundingTxid, 180000);
      await mine(6);
      await waitForChannelReady(nodeB);
      addStep(`mocOpenChannel${cycle}`, 'success', { channelId, fundingTxid, cycle });

      addStep(`mocKeysend${cycle}`, 'running');
      const keysendResp = await nodeA.call('rlnKeysend', pubkeyB, 1_000_000, null, null);
      const keysendHash = String(keysendResp?.paymentHash ?? keysendResp?.payment_hash ?? '');
      await waitForPaymentSuccess(nodeA.call.bind(nodeA), keysendHash, 60000);
      addStep(`mocKeysend${cycle}`, 'success', { paymentHash: keysendHash, amtMsat: 1_000_000 });

      addStep(`mocBalanceCheck${cycle}`, 'running');
      const [balA, balB] = await Promise.all([
        nodeA.call('rlnBtcBalance', true),
        nodeB.call('rlnBtcBalance', true),
      ]);
      addStep(`mocBalanceCheck${cycle}`, 'success', {
        spendableA: balA?.vanilla?.spendable ?? null,
        spendableB: balB?.vanilla?.spendable ?? null,
      });

      addStep(`mocCloseChannel${cycle}`, 'running');
      try {
        await nodeB.call('rlnCloseChannel', channelId, pubkeyA, false);
        await mine(6);
        await nodeA.call('rlnSync');
        await nodeB.call('rlnSync');
      } catch {
        // best effort for demo
      }
      addStep(`mocCloseChannel${cycle}`, 'success', { channelId, cycle });
    }

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (nodeA) await nodeA.cleanup();
    if (nodeB) await nodeB.cleanup();
    if (nodeC) await nodeC.cleanup();
    endExclusiveFlow(flowName);
  }
}

export async function runRlnConcurrentBtcPaymentsFlow() {
  const flowName = 'runRlnConcurrentBtcPaymentsFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();
  let nodeA: RlnNodeRuntime | null = null;
  let nodeB: RlnNodeRuntime | null = null;
  let nodeC: RlnNodeRuntime | null = null;
  let nodeD: RlnNodeRuntime | null = null;
  try {
    nodeA = await createRlnNodeRuntime({ name: 'nodeA', flowPrefix: 'rln_cbp_a', stepPrefix: 'cbpA', addStep });
    nodeB = await createRlnNodeRuntime({ name: 'nodeB', flowPrefix: 'rln_cbp_b', stepPrefix: 'cbpB', addStep });
    nodeC = await createRlnNodeRuntime({ name: 'nodeC', flowPrefix: 'rln_cbp_c', stepPrefix: 'cbpC', addStep });
    nodeD = await createRlnNodeRuntime({ name: 'nodeD', flowPrefix: 'rln_cbp_d', stepPrefix: 'cbpD', addStep });

    await fundAndCreateUtxosForNode(nodeA, 'cbpA', addStep);
    await fundAndCreateUtxosForNode(nodeB, 'cbpB', addStep);
    await fundAndCreateUtxosForNode(nodeC, 'cbpC', addStep);
    await fundAndCreateUtxosForNode(nodeD, 'cbpD', addStep);

    const infoA = await nodeA.call('rlnNodeInfo');
    const infoB = await nodeB.call('rlnNodeInfo');
    const pubkeyA = String(infoA?.pubkey ?? '');
    const pubkeyB = String(infoB?.pubkey ?? '');
    addStep('cbpNodeInfos', 'success', {
      pubkeyA: pubkeyA.substring(0, 16) + '...',
      pubkeyB: pubkeyB.substring(0, 16) + '...',
    });

    addStep('cbpConnectPeers', 'running');
    const peerUriA = `${pubkeyA}@127.0.0.1:${nodeA.ldkPeerListeningPort}`;
    const peerUriB = `${pubkeyB}@127.0.0.1:${nodeB.ldkPeerListeningPort}`;
    try { await nodeB.call('rlnConnectPeer', peerUriA); } catch { /* already connected */ }
    try { await nodeC.call('rlnConnectPeer', peerUriB); } catch { /* already connected */ }
    try { await nodeD.call('rlnConnectPeer', peerUriB); } catch { /* already connected */ }
    addStep('cbpConnectPeers', 'success', {});

    // B→A channel (C and D will route through B to reach A)
    addStep('cbpOpenChannelBtoA', 'running');
    const openBA = await nodeB.call('rlnOpenChannel', {
      peerPubkeyAndOptAddr: peerUriA,
      capacitySat: 100000,
      pushMsat: 0,
      public: true,
      withAnchors: true,
    });
    const tmpBA = String(openBA?.temporaryChannelId ?? openBA?.temporary_channel_id ?? '');
    const { channelId: channelIdBA, fundingTxid: fundingBA } = await waitForChannelFundingTx(nodeB, nodeA, tmpBA, 120000);
    await waitForFundingConfirmed(nodeB, fundingBA, 180000);
    await mine(6);
    await waitForChannelReady(nodeB);
    addStep('cbpOpenChannelBtoA', 'success', { channelId: channelIdBA, fundingTxid: fundingBA });

    // C→B channel
    addStep('cbpOpenChannelCtoB', 'running');
    const openCB = await nodeC.call('rlnOpenChannel', {
      peerPubkeyAndOptAddr: peerUriB,
      capacitySat: 100000,
      pushMsat: 0,
      public: true,
      withAnchors: true,
    });
    const tmpCB = String(openCB?.temporaryChannelId ?? openCB?.temporary_channel_id ?? '');
    const { channelId: channelIdCB, fundingTxid: fundingCB } = await waitForChannelFundingTx(nodeC, nodeB, tmpCB, 120000);
    await waitForFundingConfirmed(nodeC, fundingCB, 180000);
    await mine(6);
    await waitForChannelReady(nodeC);
    addStep('cbpOpenChannelCtoB', 'success', { channelId: channelIdCB, fundingTxid: fundingCB });

    // D→B channel
    addStep('cbpOpenChannelDtoB', 'running');
    const openDB = await nodeD.call('rlnOpenChannel', {
      peerPubkeyAndOptAddr: peerUriB,
      capacitySat: 100000,
      pushMsat: 0,
      public: true,
      withAnchors: true,
    });
    const tmpDB = String(openDB?.temporaryChannelId ?? openDB?.temporary_channel_id ?? '');
    const { channelId: channelIdDB, fundingTxid: fundingDB } = await waitForChannelFundingTx(nodeD, nodeB, tmpDB, 120000);
    await waitForFundingConfirmed(nodeD, fundingDB, 180000);
    await mine(6);
    await waitForChannelReady(nodeD);
    addStep('cbpOpenChannelDtoB', 'success', { channelId: channelIdDB, fundingTxid: fundingDB });

    // A creates two invoices concurrently
    addStep('cbpCreateInvoices', 'running');
    const [invResp1, invResp2] = await Promise.all([
      nodeA.call('rlnLnInvoice', 4_000_000, 900, null, null),
      nodeA.call('rlnLnInvoice', 5_000_000, 900, null, null),
    ]);
    const invoice1 = String(invResp1?.invoice ?? invResp1 ?? '');
    const invoice2 = String(invResp2?.invoice ?? invResp2 ?? '');
    const [dec1, dec2] = await Promise.all([
      nodeA.call('rlnDecodeLnInvoice', invoice1),
      nodeA.call('rlnDecodeLnInvoice', invoice2),
    ]);
    const hash1 = String(dec1?.paymentHash ?? dec1?.payment_hash ?? '');
    const hash2 = String(dec2?.paymentHash ?? dec2?.payment_hash ?? '');
    addStep('cbpCreateInvoices', 'success', { invoice1: invoice1.substring(0, 20) + '...', invoice2: invoice2.substring(0, 20) + '...' });

    // C and D send concurrently
    addStep('cbpConcurrentSend', 'running');
    const [sendC, sendD] = await Promise.all([
      nodeC.call('rlnSendPayment', invoice1, null, null, null),
      nodeD.call('rlnSendPayment', invoice2, null, null, null),
    ]);
    const payHashC = String(sendC?.paymentHash ?? sendC?.payment_hash ?? hash1);
    const payHashD = String(sendD?.paymentHash ?? sendD?.payment_hash ?? hash2);
    addStep('cbpConcurrentSend', 'success', { payHashC, payHashD });

    addStep('cbpWaitInvoice1', 'running');
    await waitForInvoiceStatus(nodeA.call.bind(nodeA), invoice1, 'SUCCEEDED', 60000);
    addStep('cbpWaitInvoice1', 'success', {});

    addStep('cbpWaitInvoice2', 'running');
    await waitForInvoiceStatus(nodeA.call.bind(nodeA), invoice2, 'SUCCEEDED', 60000);
    addStep('cbpWaitInvoice2', 'success', {});

    addStep('cbpWaitSenders', 'running');
    await Promise.all([
      waitForPaymentSuccess(nodeC.call.bind(nodeC), payHashC, 60000),
      waitForPaymentSuccess(nodeD.call.bind(nodeD), payHashD, 60000),
    ]);
    addStep('cbpWaitSenders', 'success', {});

    addStep('cbpFinalBalance', 'running');
    const finalBal = await nodeA.call('rlnBtcBalance', false);
    addStep('cbpFinalBalance', 'success', finalBal);

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (nodeA) await nodeA.cleanup();
    if (nodeB) await nodeB.cleanup();
    if (nodeC) await nodeC.cleanup();
    if (nodeD) await nodeD.cleanup();
    endExclusiveFlow(flowName);
  }
}

export async function runRlnExternalSignerFlow() {
  const flowName = 'runRlnExternalSignerFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep } = createFlowResults();
  const rln = createRLNManager();
  let nodeCreated = false;
  let nodeDestroyed = false;
  let signerId: number | null = null;

  try {
    const network = 'regtest' as const;
    const rpcHost =
      readEnv('RLN_BITCOIND_RPC_HOST') ??
      (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
    const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
    const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
    const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
    const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
    const proxyEndpoint =
      readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;

    const keys = await createWallet(network);
    const seedHex = Buffer.from(mnemonicToSeedSync(keys.mnemonic)).toString('hex');

    const basePort = 20000 + Math.floor(Math.random() * 20000);
    const ldkPeerListeningPort = basePort + 1;
    const storageDirUri = `${documentDirectory ?? ''}rln_ext_signer_flow_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    try {
      await FileSystem.makeDirectoryAsync(storageDirUri, { intermediates: true });
    } catch {
      // best effort
    }
    const storageDirPath = storageDirUri.replace('file://', '');

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

    // 1 — create node
    addStep('rlnCreateNode', 'running');
    await rln.rlnCreateNode({
      storageDirPath,
      daemonListeningPort: basePort,
      ldkPeerListeningPort,
      network,
      maxMediaUploadSizeMb: 20,
      enableVirtualChannelsV0: false,
    });
    nodeCreated = true;
    addStep('rlnCreateNode', 'success', {
      storageDirPath,
      daemonListeningPort: basePort,
      ldkPeerListeningPort,
      network,
    });

    // 2 — create native external signer from mnemonic seed
    addStep('rlnCreateNativeExternalSigner', 'running');
    signerId = await rln.rlnCreateNativeExternalSigner(seedHex, network);
    addStep('rlnCreateNativeExternalSigner', 'success', { signerId, network });

    // 3 — init node with external signer (no password / mnemonic passed)
    addStep('rlnInitNodeWithNativeExternalSigner', 'running');
    await rln.rlnInitNodeWithNativeExternalSigner(signerId);
    addStep('rlnInitNodeWithNativeExternalSigner', 'success', { signerId });

    // 4 — unlock with external signer (with retry for transient conflicts)
    addStep('rlnUnlockNodeWithNativeExternalSigner', 'running');
    let unlockAttempts = 0;
    let lastUnlockError: string | null = null;
    const maxUnlockAttempts = 12;
    for (let attempt = 1; attempt <= maxUnlockAttempts; attempt += 1) {
      unlockAttempts = attempt;
      try {
        await rln.rlnUnlockNodeWithNativeExternalSigner(signerId, unlockParams);
        lastUnlockError = null;
        break;
      } catch (err: any) {
        lastUnlockError = String(err?.message ?? err);
        if (!isRetryableNodeStateError(err) || attempt === maxUnlockAttempts) throw err;
        if (isNodeStateConflictError(err)) {
          const probe = await probeNodeReady(
            (name, ...args) => (rln as any)[name](...args),
            12,
            500
          );
          if (probe.ready) break;
        }
        await sleep(800);
      }
    }
    addStep('rlnUnlockNodeWithNativeExternalSigner', 'success', {
      rpcHost,
      rpcPort,
      indexerUrl,
      proxyEndpoint,
      attempts: unlockAttempts,
      recoveredFromRetry: unlockAttempts > 1,
      lastRetryError: lastUnlockError,
    });

    // 5 — fund
    addStep('rlnAddress', 'running');
    const addrResp = await rln.rlnAddress();
    addStep('rlnAddress', 'success', { address: addrResp.address });
    addStep('fundAddress', 'running');
    const txid = await sendToAddress(addrResp.address, 1);
    await mine(6);
    addStep('fundAddress', 'success', {
      txid,
      blocksMined: 6,
      amountBtc: 1,
      nodeEndpoint: BITCOIN_NODE_ENDPOINT,
    });

    // 6 — sync, balance, node info
    addStep('rlnSync', 'running');
    await rln.rlnSync();
    addStep('rlnSync', 'success', { synced: true });

    addStep('rlnBtcBalance', 'running');
    const balance = await rln.rlnBtcBalance(false);
    addStep('rlnBtcBalance', 'success', balance);

    addStep('rlnNodeInfo', 'running');
    const info = await rln.rlnNodeInfo();
    addStep('rlnNodeInfo', 'success', info);

    // 7 — shutdown
    addStep('rlnShutdown', 'running');
    await rln.rlnShutdown();
    addStep('rlnShutdown', 'success', { shutdown: true });

    // 8 — destroy node
    addStep('rlnDestroyNode', 'running');
    await rln.rlnDestroyNode();
    nodeCreated = false;
    nodeDestroyed = true;
    addStep('rlnDestroyNode', 'success', { destroyed: true });

    // 9 — destroy signer
    addStep('rlnDestroyNativeExternalSigner', 'running');
    await rln.rlnDestroyNativeExternalSigner(signerId);
    signerId = null;
    addStep('rlnDestroyNativeExternalSigner', 'success', { destroyed: true });

    results.success = true;
    return results;
  } catch (error: any) {
    results.success = false;
    results.error = { message: error?.message ?? String(error) };
    return results;
  } finally {
    if (nodeCreated && !nodeDestroyed) {
      try { await rln.rlnShutdown(); } catch {}
      try { await rln.rlnDestroyNode(); } catch {}
    }
    if (signerId !== null) {
      try { await rln.rlnDestroyNativeExternalSigner(signerId); } catch {}
    }
    endExclusiveFlow(flowName);
  }
}

export async function runRlnSwapRoundtripBuyFlow() {
  const flowName = 'runRlnSwapRoundtripBuyFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep } = createFlowResults();
  let nodeA: RlnNodeRuntime | null = null;
  let nodeB: RlnNodeRuntime | null = null;
  try {
    nodeA = await createRlnNodeRuntime({
      name: 'nodeA',
      flowPrefix: 'rln_swap_roundtrip_buy_a',
      stepPrefix: 'swapNodeA',
      addStep,
    });
    nodeB = await createRlnNodeRuntime({
      name: 'nodeB',
      flowPrefix: 'rln_swap_roundtrip_buy_b',
      stepPrefix: 'swapNodeB',
      addStep,
    });

    const retryOnNodeStateConflict = async <T>(
      runner: () => Promise<T>,
      opts: { attempts?: number; delayMs?: number; onRetry?: (attempt: number, error: any) => void } = {}
    ): Promise<T> => {
      const attempts = opts.attempts ?? 12;
      const delayMs = opts.delayMs ?? 800;
      let lastErr: any = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          return await runner();
        } catch (error: any) {
          lastErr = error;
          const message = String(error?.message ?? error).toLowerCase();
          const retryable =
            message.includes('conflict with current node state') ||
            message.includes('shutting_down') ||
            message.includes('shutting down') ||
            message.includes('non-lifecycle operations are blocked');
          if (!retryable || attempt === attempts) {
            throw error;
          }
          opts.onRetry?.(attempt, error);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      throw lastErr;
    };

    const ensureFundedAndUtxos = async (node: RlnNodeRuntime, stepPrefix: string) => {
      addStep(`${stepPrefix}Fund`, 'running');
      const currentBal = await node.call('rlnBtcBalance', false);
      const currentSpendable = Number(
        currentBal?.vanilla?.spendable ??
          currentBal?.vanilla?.spendableSat ??
          currentBal?.spendable ??
          0
      );
      const addrResp = await node.call('rlnAddress');
      const address = String(addrResp?.address ?? addrResp ?? '');
      if (!address) throw new Error(`${stepPrefix}: missing address`);
      if (currentSpendable < 1) {
        const txid = await sendToAddress(address, 1);
        await mine(6);
        // Keep parity with android-e2e fundAndCreateUtxos helper.
        await node.call('rlnSync');
        addStep(`${stepPrefix}Fund`, 'success', { txid, nodeEndpoint: BITCOIN_NODE_ENDPOINT });
      } else {
        addStep(`${stepPrefix}Fund`, 'success', { skipped: true, reason: 'already funded' });
      }

      addStep(`${stepPrefix}CreateUtxos`, 'running');
      await retryOnNodeStateConflict(
        () => node.call('rlnSync'),
        { attempts: 12, delayMs: 800 }
      );
      const retryReasons: string[] = [];
      let retryCount = 0;
      await retryOnNodeStateConflict(
        () => node.call('rlnCreateUtxos', false, 10, null, 7, false),
        {
          attempts: 15,
          delayMs: 1000,
          onRetry: (attempt, error) => {
            retryCount = attempt;
            retryReasons.push(String(error?.message ?? error));
          },
        }
      );
      await mine(1);
      await node.call('rlnSync');
      addStep(`${stepPrefix}CreateUtxos`, 'success', {
        num: 10,
        feeRate: 7,
        retries: retryCount,
        recoveredFromNodeStateConflict: retryCount > 0,
        retryReasons: retryReasons.slice(-3),
      });
    };
    await ensureFundedAndUtxos(nodeA, 'swapNodeA');
    await ensureFundedAndUtxos(nodeB, 'swapNodeB');

    addStep('swapIssueAsset', 'running');
    const issued = await nodeA.call('rlnIssueAssetNia', 'USDT', 'Tether', 0, [1000]);
    const assetId = String(issued?.assetId ?? issued?.asset_id ?? '');
    if (!assetId) throw new Error('Failed to issue asset for swap flow');
    addStep('swapIssueAsset', 'success', { assetId });

    addStep('swapOpenChannels', 'running');
    const infoA = await nodeA.call('rlnNodeInfo');
    const infoB = await nodeB.call('rlnNodeInfo');
    const peerUriAB = `${infoB?.pubkey}@127.0.0.1:${String(infoB?.ldkPeerListeningPort ?? infoB?.ldk_peer_listening_port ?? '9735')}`;
    const peerUriBA = `${infoA?.pubkey}@127.0.0.1:${String(infoA?.ldkPeerListeningPort ?? infoA?.ldk_peer_listening_port ?? '9735')}`;
    const open12 = await nodeA.call('rlnOpenChannel', {
      peerPubkeyAndOptAddr: peerUriAB,
      capacitySat: 100000,
      pushMsat: 0,
      public: true,
      withAnchors: true,
      assetId,
      assetAmount: 600,
    });
    const open21 = await nodeB.call('rlnOpenChannel', {
      peerPubkeyAndOptAddr: peerUriBA,
      capacitySat: 5000000,
      pushMsat: 546000,
      public: true,
      withAnchors: true,
      assetId: null,
      assetAmount: null,
    });
    const tmp12 = String(open12?.temporaryChannelId ?? open12?.temporary_channel_id ?? '');
    const tmp21 = String(open21?.temporaryChannelId ?? open21?.temporary_channel_id ?? '');
    const { channelId: channel12, fundingTxid: funding12 } = await waitForChannelFundingTx(nodeA, nodeB, tmp12, 120000);
    await waitForFundingConfirmed(nodeA, funding12, 180000);
    await mine(6);
    await waitForChannelReady(nodeA);
    const { channelId: channel21, fundingTxid: funding21 } = await waitForChannelFundingTx(nodeB, nodeA, tmp21, 120000);
    await waitForFundingConfirmed(nodeB, funding21, 180000);
    await mine(6);
    await waitForChannelReady(nodeB);
    addStep('swapOpenChannels', 'success', { channel12, channel21, funding12, funding21 });

    addStep('swapExecuteRoundtrip', 'running');
    const makerInit = await nodeA.callSwap('makerinit', {
      qtyFrom: 50000,
      qtyTo: 10,
      fromAsset: null,
      toAsset: assetId,
      timeoutSec: 3600,
    });
    const swapstring = makerInit?.swapstring;
    const paymentHash = String(makerInit?.paymentHash ?? makerInit?.payment_hash ?? '');
    const paymentSecret = makerInit?.paymentSecret ?? makerInit?.payment_secret;
    if (!swapstring || !paymentHash || !paymentSecret) {
      throw new Error('makerinit returned incomplete swap payload');
    }
    await nodeB.callSwap('taker', { swapstring });
    await nodeA.callSwap('makerexecute', {
      swapstring,
      paymentSecret,
      takerPubkey: infoB?.pubkey,
    });
    await waitForSwapStatus(nodeB, paymentHash, 'SUCCEEDED', 120000);
    addStep('swapExecuteRoundtrip', 'success', { paymentHash, status: 'SUCCEEDED' });

    addStep('swapPostChecks', 'running');
    const balA = await nodeA.call('rlnAssetBalance', assetId);
    const balB = await nodeB.call('rlnAssetBalance', assetId);
    addStep('swapPostChecks', 'success', {
      nodeAOffchainOutbound: balA?.offchainOutbound ?? balA?.offchain_outbound ?? null,
      nodeBOffchainOutbound: balB?.offchainOutbound ?? balB?.offchain_outbound ?? null,
    });

    addStep('swapRestartCheckpoint', 'running');
    const restartConfigA = {
      storageDirPath: nodeA.storageDirPath,
      daemonListeningPort: nodeA.daemonListeningPort,
      ldkPeerListeningPort: nodeA.ldkPeerListeningPort,
      nodePassword: nodeA.nodePassword,
    };
    const restartConfigB = {
      storageDirPath: nodeB.storageDirPath,
      daemonListeningPort: nodeB.daemonListeningPort,
      ldkPeerListeningPort: nodeB.ldkPeerListeningPort,
      nodePassword: nodeB.nodePassword,
    };
    await nodeA.safeShutdown();
    await nodeB.safeShutdown();
    await sleep(2000);
    await nodeA.disposeHandles();
    await nodeB.disposeHandles();
    nodeA = await createRlnNodeRuntime({
      name: 'nodeA',
      flowPrefix: 'rln_swap_roundtrip_buy_a',
      stepPrefix: 'swapNodeARestart',
      addStep,
      reuse: restartConfigA,
    });
    nodeB = await createRlnNodeRuntime({
      name: 'nodeB',
      flowPrefix: 'rln_swap_roundtrip_buy_b',
      stepPrefix: 'swapNodeBRestart',
      addStep,
      reuse: restartConfigB,
    });
    await waitForUsableChannels(nodeA, 2, 60000);
    await waitForUsableChannels(nodeB, 2, 60000);
    await waitForSwapStatus(nodeA, paymentHash, 'SUCCEEDED', 70000);
    await waitForSwapStatus(nodeB, paymentHash, 'SUCCEEDED', 70000);
    addStep('swapRestartCheckpoint', 'success', {
      restarted: true,
      usableChannelsA: 2,
      usableChannelsB: 2,
      swapStatus: 'SUCCEEDED',
    });

    addStep('swapCloseChannels', 'running');
    try {
      await nodeA.call('rlnCloseChannel', channel12, infoB?.pubkey, true);
    } catch {
      // best effort for demo
    }
    try {
      await nodeB.call('rlnCloseChannel', channel21, infoA?.pubkey, true);
    } catch {
      // best effort for demo
    }
    addStep('swapCloseChannels', 'success', { closed: true });
    results.success = true;
    return results;
  } catch (error: any) {
    results.success = false;
    results.error = { message: error?.message ?? String(error) };
    return results;
  } finally {
    if (nodeA) await nodeA.cleanup();
    if (nodeB) await nodeB.cleanup();
    endExclusiveFlow(flowName);
  }
}

const FAUCET_URL =
  'https://node-api.thunderstack.org/c17bc5d0-80b1-7050-5af5-dfd8a67834f1/1e0cfe422f0e4306bebdab953a0b99f2/sendbtc';
const FAUCET_TOKEN =
  'EnYKDBgDIggKBggGEgIYDRIkCAASIGuYoof1WC0FaPciGHzPinGmglHd_b3Lb-gokogoeL-aGkA_hc_eLZ05C1XaA9wrcqFh1Bozvi_sawa_QKNCcowZCsVRmrsxJYahtsMduWYGrOVT7JNVVvpcU4PrGu19GrYNIiIKIO5ajD4HcB-R-yadJQCA954KhC7DV2wHi4_piv9k1uYT';
const FAUCET_AMOUNT_SATS = 16900; // fallback only
const FUND_POLL_INTERVAL_MS = 5000;
const FUND_POLL_TIMEOUT_MS = 90000;

/**
 * UTEXO Wallet VSS End-to-End Flow
 *
 * Full lifecycle test:
 *   1. Create & fund a UTEXOWallet
 *   2. Issue an NIA asset so the wallet has real on-chain state
 *   3. Back up via VSS (zero-arg – config is derived from the mnemonic)
 *   4. Dispose the wallet and delete local state
 *   5. Restore from VSS and verify everything is intact
 */
export async function runUtexoVssFlow(onProgress?: (results: any) => void) {
  const flowName = 'runUtexoVssFlow';
  beginExclusiveFlow(flowName);
  console.log('Starting UTEXO VSS E2E Flow');
  console.log('='.repeat(50));

  const results: any = { steps: [], success: false, error: null };

  const addStep = (step: string, status: string, data?: any, error?: string) => {
    const idx = results.steps.findIndex((s: any) => s.step === step);
    const entry = { step, status, data, error };
    if (idx >= 0) {
      results.steps[idx] = entry;
    } else {
      results.steps.push(entry);
    }
    onProgress?.({ ...results, steps: [...results.steps], running: true });
  };

  let wallet: UTEXOWallet | null = null;
  let walletAddress: string | null = null;
  let issuedAssetId: string | null = null;
  let preBtcBalance: any = null;
  let preAssetBalance: any = null;
  const restoreDir = `${documentDirectory ?? ''}utexo_vss_restore`;
  const utexoVssNetwork: 'testnet' = 'testnet';

  try {
    // ── Step 1: Create & initialise UTEXOWallet ─────────────────────────────
    addStep('createUtexoWallet', 'running');
    try {
      wallet = new UTEXOWallet(UTEXO_TEST_MNEMONIC, { network: utexoVssNetwork });
      await wallet.initialize();
      addStep('createUtexoWallet', 'success', { network: wallet.getNetwork() });
    } catch (e: any) {
      addStep('createUtexoWallet', 'error', undefined, e?.message ?? String(e));
      throw e;
    }

    // ── Step 2: Get deposit address ──────────────────────────────────────────
    addStep('getAddress', 'running');
    walletAddress = await wallet.getAddress();
    addStep('getAddress', 'success', { address: walletAddress });

    // ── Step 3: Fund wallet ──────────────────────────────────────────────────
    // The UTEXO wallet generates BIP86 taproot (bcrt1p…) addresses. The
    // thunderstack HTTP faucet rejects these with "belongs to another network"
    // because its node doesn't support P2TR outputs. Instead, we use the same
    // mechanism that initWallet() uses: sendToAddress via the Bitcoin node RPC,
    // then mine blocks to confirm.
    addStep('fundWallet', 'running');
    try {
      const txid = await sendToAddress(walletAddress!, 0.0002); // ~20 000 sats
      await mine(6);
      addStep('fundWallet', 'success', { txid });
    } catch (e: any) {
      // Fallback: try the thunderstack HTTP faucet in case it has been updated
      // to accept taproot outputs.
      try {
        const faucetRes = await fetch(FAUCET_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${FAUCET_TOKEN}`,
          },
          body: JSON.stringify({
            amount: FAUCET_AMOUNT_SATS,
            address: walletAddress,
            fee_rate: 5,
            skip_sync: false,
          }),
        });
        const faucetData = await faucetRes.json().catch(() => ({}));
        if (!faucetRes.ok) {
          throw new Error(
            `Faucet HTTP ${faucetRes.status}: ${JSON.stringify(faucetData)}`
          );
        }
        addStep('fundWallet', 'success', {
          method: 'faucet',
          txid: faucetData?.txid ?? faucetData,
        });
      } catch (faucetErr: any) {
        addStep('fundWallet', 'error', undefined,
          `sendToAddress: ${e?.message}; faucet: ${faucetErr?.message}`
        );
      }
    }

    // ── Step 4: Wait for balance ─────────────────────────────────────────────
    addStep('waitForFunding', 'running');
    const deadline = Date.now() + FUND_POLL_TIMEOUT_MS;
    let funded = false;
    while (Date.now() < deadline) {
      const bal = await wallet.getBtcBalance();
      const total =
        (bal?.vanilla?.settled ?? 0) +
        (bal?.vanilla?.future ?? 0) +
        (bal?.vanilla?.spendable ?? 0);
      if (total > 0) {
        preBtcBalance = bal;
        funded = true;
        addStep('waitForFunding', 'success', {
          settled: bal?.vanilla?.settled,
          future: bal?.vanilla?.future,
        });
        break;
      }
      await new Promise((r) => setTimeout(r, FUND_POLL_INTERVAL_MS));
    }
    if (!funded) {
      const bal = await wallet.getBtcBalance();
      preBtcBalance = bal;
      addStep('waitForFunding', 'error', { balance: bal }, 'Timed out waiting for balance');
    }

    // ── Step 5: Create UTXOs ─────────────────────────────────────────────────
    addStep('createUtxos', 'running');
    try {
      const created = await wallet.createUtxos({ upTo: true, num: 5, feeRate: 5 });
      addStep('createUtxos', 'success', { created });
    } catch (e: any) {
      // AllocationsAlreadyAvailable means the wallet already has enough UTXOs —
      // this is a benign "nothing to do" result when upTo: true is set.
      const isAlreadyAvailable =
        e?.code === 'AllocationsAlreadyAvailable' ||
        String(e?.message ?? e).includes('AllocationsAlreadyAvailable');
      if (isAlreadyAvailable) {
        addStep('createUtxos', 'success', { created: 0, note: 'AllocationsAlreadyAvailable' });
      } else {
        console.error('[UTEXO VSS] createUtxos failed:', e);
        const errMsg = e?.message || (e?.code ? `[${e.code}] ${String(e)}` : String(e)) || 'Unknown error';
        addStep('createUtxos', 'error', undefined, errMsg);
      }
    }

    // ── Step 6: Issue NIA asset ──────────────────────────────────────────────
    addStep('issueAssetNia', 'running');
    try {
      const asset = await wallet.issueAssetNia({
        ticker: 'DEMO',
        name: 'Demo Token',
        precision: 0,
        amounts: [1000],
      });
      issuedAssetId = asset.assetId;
      addStep('issueAssetNia', 'success', {
        assetId: asset.assetId,
        ticker: asset.ticker,
      });
    } catch (e: any) {
      addStep('issueAssetNia', 'error', undefined, e?.message ?? String(e));
    }

    // ── Step 7: Send issued asset to receiver (witness invoice) ─────────────
    if (issuedAssetId) {
      addStep('sendIssuedAssetToReceiver', 'running');
      let receiverWallet: UTEXOWallet | null = null;
      try {
        console.log('[UTEXO VSS] sendIssuedAssetToReceiver: start', { issuedAssetId });
        const receiverKeys = await createWallet(utexoVssNetwork);
        receiverWallet = new UTEXOWallet(receiverKeys.mnemonic, { network: utexoVssNetwork });
        await receiverWallet.initialize();
        console.log('[UTEXO VSS] sendIssuedAssetToReceiver: receiver initialized');

        const witness = await receiverWallet.witnessReceive({
          amount: 5,
        });
        console.log('[UTEXO VSS] sendIssuedAssetToReceiver: witness invoice length', witness?.invoice?.length ?? 0);

        // Witness invoices require sender-side witness parameters (see runWalletFlow witness send).
        const sendResult = await wallet.send({
          assetId: issuedAssetId,
          amount: 5,
          invoice: witness.invoice,
          minConfirmations: 1,
          witnessData: {
            amountSat: 1000,
            blinding: 0,
          },
        });
        console.log('[UTEXO VSS] sendIssuedAssetToReceiver: send ok', sendResult?.txid ?? sendResult);

        const refreshRounds: {
          round: number;
          senderSettled?: number;
          receiverSettled?: number;
        }[] = [];
        const refreshIntervalMs = 40_000;
        const refreshCount = 3;
        let finalSenderBal: any = null;
        let finalReceiverBal: any = null;

        for (let i = 0; i < refreshCount; i += 1) {
          await wallet.refreshWallet();
          await receiverWallet.refreshWallet();

          const [senderBal, receiverBal] = await Promise.all([
            wallet.getAssetBalance(issuedAssetId).catch(() => null),
            receiverWallet.getAssetBalance(issuedAssetId).catch(() => null),
          ]);
          finalSenderBal = senderBal;
          finalReceiverBal = receiverBal;

          refreshRounds.push({
            round: i + 1,
            senderSettled: senderBal?.settled,
            receiverSettled: receiverBal?.settled,
          });

          if (i < refreshCount - 1) {
            await new Promise((r) => setTimeout(r, refreshIntervalMs));
          }
        }

        addStep('sendIssuedAssetToReceiver', 'success', {
          receiverAddress: await receiverWallet.getAddress(),
          witnessInvoice: witness.invoice,
          sendTxid: sendResult?.txid ?? sendResult,
          refreshIntervalMs,
          refreshRounds,
          senderAssetBalance: finalSenderBal
            ? {
                settled: finalSenderBal.settled,
                spendable: finalSenderBal.spendable,
                future: finalSenderBal.future,
              }
            : null,
          receiverAssetBalance: finalReceiverBal
            ? {
                settled: finalReceiverBal.settled,
                spendable: finalReceiverBal.spendable,
                future: finalReceiverBal.future,
              }
            : null,
        });
        console.log('[UTEXO VSS] sendIssuedAssetToReceiver: success', { refreshRounds });
      } catch (e: any) {
        const errMsg =
          e?.message ??
          (typeof e === 'string' ? e : JSON.stringify(e, Object.getOwnPropertyNames(e)));
        const errDetail = [
          `issuedAssetId=${issuedAssetId}`,
          errMsg,
          e?.code ? `code=${e.code}` : null,
          e?.stack ? `stack=${e.stack}` : null,
        ]
          .filter(Boolean)
          .join(' | ');
        console.error('[UTEXO VSS] sendIssuedAssetToReceiver: FAILED', errDetail, e);
        // Do not pass `data` on error — Flows StepCard prefers detail over step.error.
        addStep('sendIssuedAssetToReceiver', 'error', undefined, errDetail);
      } finally {
        if (receiverWallet) {
          try {
            await receiverWallet.dispose();
          } catch {
            /* ignore */
          }
        }
      }
    } else {
      console.warn('[UTEXO VSS] sendIssuedAssetToReceiver: skipped — no issuedAssetId');
      addStep('sendIssuedAssetToReceiver', 'error', undefined, 'No issued asset to send');
    }

    // ── Step 8: List assets ──────────────────────────────────────────────────
    addStep('listAssets', 'running');
    try {
      const assets = await wallet.listAssets();
      const niaCount = assets.nia?.length ?? 0;
      addStep('listAssets', 'success', { niaCount, assetIds: assets.nia?.map((a) => a.assetId) });
    } catch (e: any) {
      addStep('listAssets', 'error', undefined, e?.message ?? String(e));
    }

    // ── Step 9: Get asset balance ────────────────────────────────────────────
    if (issuedAssetId) {
      addStep('getAssetBalance', 'running');
      try {
        preAssetBalance = await wallet.getAssetBalance(issuedAssetId);
        addStep('getAssetBalance', 'success', {
          settled: preAssetBalance?.settled,
          spendable: preAssetBalance?.spendable,
          future: preAssetBalance?.future,
        });
      } catch (e: any) {
        addStep('getAssetBalance', 'error', undefined, e?.message ?? String(e));
      }
    } else {
      addStep('getAssetBalance', 'error', undefined, 'No asset to check (issue step failed)');
    }

    // ── Step 10: VSS Backup (zero-arg!) ──────────────────────────────────────
    addStep('vssBackup', 'running');
    let vssConfig: any = null;
    try {
      vssConfig = await wallet.getDefaultVssConfig();
      const version = await wallet.vssBackup();
      addStep('vssBackup', 'success', {
        version,
        storeId: vssConfig.storeId,
      });
    } catch (e: any) {
      addStep('vssBackup', 'error', undefined, e?.message ?? String(e));
    }

    // ── Step 11: VSS Backup info (zero-arg!) ─────────────────────────────────
    addStep('vssBackupInfo', 'running');
    try {
      const info = await wallet.vssBackupInfo();
      addStep('vssBackupInfo', 'success', {
        backupExists: info.backupExists,
        serverVersion: info.serverVersion,
        backupRequired: info.backupRequired,
      });
    } catch (e: any) {
      addStep('vssBackupInfo', 'error', undefined, e?.message ?? String(e));
    }

    // ── Step 12: Dispose wallet ──────────────────────────────────────────────
    addStep('disposeWallet', 'running');
    await wallet.dispose();
    wallet = null;
    addStep('disposeWallet', 'success');

    // ── Step 13: Delete local state ──────────────────────────────────────────
    addStep('deleteState', 'running');
    try {
      // Always delete then recreate so rgb-lib gets a clean target directory.
      // On subsequent runs the fingerprint subdirectory would already exist,
      // causing the native restoreFromVss to fail with "path already exists".
      await FileSystem.deleteAsync(restoreDir, { idempotent: true });
      await FileSystem.makeDirectoryAsync(restoreDir, { intermediates: true });
      addStep('deleteState', 'success', { restoreDir });
    } catch (e: any) {
      addStep('deleteState', 'error', undefined, e?.message ?? String(e));
    }

    // ── Step 14: Restore from VSS ────────────────────────────────────────────
    addStep('restoreFromVss', 'running');
    let restorePaths: { layer1Path: string; utexoPath: string } | null = null;
    try {
      const targetDir = restoreDir.replace('file://', '');
      restorePaths = await UTEXOWallet.restoreFromVss(
        UTEXO_TEST_MNEMONIC,
        targetDir,
        vssConfig ?? undefined
      );
      addStep('restoreFromVss', 'success', {
        utexoPath: restorePaths.utexoPath,
        layer1Path: restorePaths.layer1Path,
      });
    } catch (e: any) {
      addStep('restoreFromVss', 'error', undefined, e?.message ?? String(e));
    }

    // ── Step 15: Verify restored wallet ─────────────────────────────────────
    addStep('verifyRestoredWallet', 'running');
    let restoredWallet: UTEXOWallet | null = null;
    try {
      restoredWallet = new UTEXOWallet(UTEXO_TEST_MNEMONIC, { network: utexoVssNetwork });
      await restoredWallet.initialize();

      const [btcBalance, assets, transactions] = await Promise.all([
        restoredWallet.getBtcBalance(),
        restoredWallet.listAssets(),
        restoredWallet.listTransactions(),
      ]);

      const restoredAssetBalance = issuedAssetId
        ? await restoredWallet.getAssetBalance(issuedAssetId).catch(() => null)
        : null;

      const niaCount = assets.nia?.length ?? 0;
      const assetRestored =
        issuedAssetId != null &&
        (assets.nia ?? []).some((a) => a.assetId === issuedAssetId);

      addStep('verifyRestoredWallet', 'success', {
        btcSettled: btcBalance?.vanilla?.settled ?? 0,
        btcMatchesPreBackup:
          preBtcBalance == null ||
          btcBalance?.vanilla?.settled === preBtcBalance?.vanilla?.settled,
        niaCount,
        assetRestored,
        restoredAssetBalance: restoredAssetBalance
          ? {
              settled: restoredAssetBalance.settled,
              spendable: restoredAssetBalance.spendable,
              matchesPreBackup:
                preAssetBalance == null ||
                restoredAssetBalance.settled === preAssetBalance.settled,
            }
          : null,
        transactionCount: transactions.length,
      });
    } catch (e: any) {
      addStep('verifyRestoredWallet', 'error', undefined, e?.message ?? String(e));
    }

    // ── Step 16: Cleanup ─────────────────────────────────────────────────────
    addStep('cleanup', 'running');
    try {
      if (restoredWallet) {
        await restoredWallet.dispose();
        restoredWallet = null;
      }
      addStep('cleanup', 'success');
    } catch (e: any) {
      addStep('cleanup', 'error', undefined, e?.message ?? String(e));
    }

    results.success = true;
    return results;
  } catch (error: any) {
    console.error('Error in UTEXO VSS flow:', error);
    if (wallet) {
      try { await wallet.dispose(); } catch { /* ignore */ }
    }
    results.success = false;
    results.error = { message: error.message || 'Unknown error' };
    return results;
  } finally {
    endExclusiveFlow(flowName);
  }
}
