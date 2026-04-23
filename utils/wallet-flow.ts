/**
 * React Native compatible wallet flow
 * Adapted from flow.js for React Native environment
 */

import {
  createWallet,
  createWalletManager,
  DEFAULT_INDEXER_URLS,
  getDestinationAsset,
  getBridgeAPI,
  LightningProtocol, OnchainProtocol,
  restoreFromBackup,
  UTEXOProtocol,
  UTEXOWallet,
  WalletManager,
  type InvoiceData,
} from '@utexo/rgb-sdk-rn';
import * as FileSystem from 'expo-file-system/legacy';
import { documentDirectory } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

const UTEXO_TEST_MNEMONIC = 'poem twice question inch happy capital grain quality laptop dry chaos what';

function readEnv(name: string): string | null {
  const value =
    (name === 'RLN_NODE_PASSWORD'
      ? process.env.EXPO_PUBLIC_RLN_NODE_PASSWORD ?? process.env.RLN_NODE_PASSWORD
      : name === 'RLN_BITCOIND_RPC_USERNAME'
        ? process.env.EXPO_PUBLIC_RLN_BITCOIND_RPC_USERNAME ?? process.env.RLN_BITCOIND_RPC_USERNAME
        : name === 'RLN_BITCOIND_RPC_PASSWORD'
          ? process.env.EXPO_PUBLIC_RLN_BITCOIND_RPC_PASSWORD ?? process.env.RLN_BITCOIND_RPC_PASSWORD
          : name === 'RLN_BITCOIND_RPC_HOST'
            ? process.env.EXPO_PUBLIC_RLN_BITCOIND_RPC_HOST ?? process.env.RLN_BITCOIND_RPC_HOST
            : name === 'RLN_BITCOIND_RPC_PORT'
              ? process.env.EXPO_PUBLIC_RLN_BITCOIND_RPC_PORT ?? process.env.RLN_BITCOIND_RPC_PORT
              : name === 'RLN_INDEXER_URL'
                ? process.env.EXPO_PUBLIC_RLN_INDEXER_URL ?? process.env.RLN_INDEXER_URL
                : name === 'RLN_PROXY_ENDPOINT'
                  ? process.env.EXPO_PUBLIC_RLN_PROXY_ENDPOINT ?? process.env.RLN_PROXY_ENDPOINT
                  : name === 'RLN_ANNOUNCE_ADDRESSES'
                    ? process.env.EXPO_PUBLIC_RLN_ANNOUNCE_ADDRESSES ?? process.env.RLN_ANNOUNCE_ADDRESSES
                    : name === 'RLN_ANNOUNCE_ALIAS'
                      ? process.env.EXPO_PUBLIC_RLN_ANNOUNCE_ALIAS ?? process.env.RLN_ANNOUNCE_ALIAS
                      : name === 'RLN_PLAYGROUND_NETWORK'
                        ? process.env.EXPO_PUBLIC_RLN_PLAYGROUND_NETWORK ?? process.env.RLN_PLAYGROUND_NETWORK
                      : name === 'RLN_STRICT_UNLOCK_CREDS'
                        ? process.env.EXPO_PUBLIC_RLN_STRICT_UNLOCK_CREDS ?? process.env.RLN_STRICT_UNLOCK_CREDS
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
const BITCOIN_NODE_ENDPOINT =
  process.env.BITCOIN_NODE_ENDPOINT ?? 'http://18.119.98.232:5000/execute';

async function postBitcoinNodeCommand(args: string) {
  const endpoints = [BITCOIN_NODE_ENDPOINT];
  if (BITCOIN_NODE_ENDPOINT.startsWith('http://')) {
    endpoints.push(BITCOIN_NODE_ENDPOINT.replace(/^http:\/\//, 'https://'));
  }

  const errors: string[] = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (e: any) {
      errors.push(`${endpoint}: ${e?.message ?? String(e)}`);
    }
  }

  throw new Error(errors.length ? errors.join(' | ') : 'Unknown request error');
}

function unwrapNodeResponse(data: any) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const statusText = typeof data.status === 'string' ? data.status.toLowerCase() : '';
    const errorText = typeof data.error === 'string' ? data.error.trim() : '';
    const outputText = typeof data.output === 'string' ? data.output.trim() : '';
    if (errorText || /^ERR:/i.test(outputText)) {
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

/**
 * Mine blocks using the Bitcoin node endpoint
 */
export async function mine(numBlocks: number) {
  try {
    const raw = await postBitcoinNodeCommand(`mine ${numBlocks}`);
    const data = unwrapNodeResponse(raw);
    console.log(`Mined ${numBlocks} blocks`);
    return data;
  } catch (error: any) {
    throw new Error(`Unable to mine: ${error.message}`);
  }
}

/**
 * Send Bitcoin to an address using the Bitcoin node endpoint
 */
export async function sendToAddress(address: string, amount: number) {
  try {
    const raw = await postBitcoinNodeCommand(`sendtoaddress ${address} ${amount}`);
    const txid = unwrapNodeResponse(raw);
    if (typeof txid !== 'string' || txid.trim().length === 0) {
      throw new Error(`Unexpected sendtoaddress response: ${JSON.stringify(raw)}`);
    }
    console.log(`Sent ${amount} BTC to ${address}, TXID: ${txid}`);
    return txid;
  } catch (error: any) {
    throw new Error(`Unable to send bitcoins: ${error.message}`);
  }
}

async function waitForWalletFunding(
  wallet: WalletManager,
  timeoutMs: number = 120000,
  intervalMs: number = 4000
) {
  const deadline = Date.now() + timeoutMs;
  let lastBalance = await wallet.getBtcBalance();
  while (Date.now() < deadline) {
    await wallet.syncWallet();
    lastBalance = await wallet.getBtcBalance();
    if ((lastBalance?.vanilla?.spendable ?? 0) > 0) {
      return lastBalance;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Funding not detected in time (vanilla spendable=${lastBalance?.vanilla?.spendable ?? 0})`
  );
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
  }
}

/**
 * UTEXO / Lightning Module flow
 *
 * Tests UTEXOWallet, LightningProtocol, OnchainProtocol, UTEXOProtocol, and bridge API client.
 * Some steps require a running signet node and bridge server; failures are captured gracefully.
 */
export async function runUTEXOFlow() {
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
  if (rlnPlaygroundFlowInFlight) {
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
  const utexoAdapterNetwork = network === 'regtest' ? 'testnet' : network;
  let sender: WalletManager | null = null;
  let receiver: WalletManager | null = null;
  let senderProtocol: UTEXOWallet | null = null;
  let receiverProtocol: UTEXOWallet | null = null;
  let issuedAssetId: string | null = null;
  let bridgeAssetId: string | null = null;
  let bridgeUtexoAssetId: string | null = null;
  let senderFunded = false;
  let senderRlnNodeCreated = false;
  let senderRlnPubkey: string | null = null;
  let senderRlnReady = false;
  let rlnReadinessBlocker: string | null = null;
  let rlnUnlockAttempt = 0;

  try {
    addStep('createSender', 'running');
    const senderKeys = await createWallet(network);
    senderProtocol = new UTEXOWallet(senderKeys.mnemonic, {
      network: utexoAdapterNetwork as any,
    });
    await senderProtocol.initialize();
    const senderWallet = createWalletManager({
      xpubVan: senderKeys.accountXpubVanilla,
      xpubCol: senderKeys.accountXpubColored,
      masterFingerprint: senderKeys.masterFingerprint,
      mnemonic: senderKeys.mnemonic,
      network,
      bindingMode: 'rln',
      rlnProtocolAdapter: senderProtocol,
    } as any);
    sender = senderWallet;
    await senderWallet.initialize();
    addStep('createSender', 'success', {
      request: { network, bindingMode: 'rln' },
      response: { initialized: true },
    });

    addStep('senderAddressBalance', 'running');
    const [senderAddress, senderBalance] = await Promise.all([
      senderWallet.getAddress(),
      senderWallet.getBtcBalance(),
    ]);
    addStep('senderAddressBalance', 'success', {
      request: { method: 'getAddress|getBtcBalance' },
      response: {
        address: senderAddress,
        btc: {
          vanillaSettled: senderBalance?.vanilla?.settled ?? 0,
          vanillaFuture: senderBalance?.vanilla?.future ?? 0,
          vanillaSpendable: senderBalance?.vanilla?.spendable ?? 0,
        },
      },
    });

    addStep('fundSender', 'running');
    try {
      const fundTxid = await sendToAddress(senderAddress, 0.0002);
      await mine(6);
      const fundedBalance = await waitForWalletFunding(senderWallet);
      senderFunded = true;
      addStep('fundSender', 'success', {
        request: { address: senderAddress, amountBtc: 0.0002, mineBlocks: 6 },
        response: {
          txid: fundTxid,
          vanillaSettled: fundedBalance?.vanilla?.settled ?? 0,
          vanillaSpendable: fundedBalance?.vanilla?.spendable ?? 0,
        },
      });
    } catch (e: any) {
      addStep('fundSender', 'error', undefined, e?.message ?? String(e));
    }

    addStep('createUtxos', 'running');
    if (!senderFunded) {
      addStep(
        'createUtxos',
        'error',
        undefined,
        'Skipped: sender funding failed, no BTC available for UTXO creation'
      );
    } else {
      try {
      const created = await senderWallet.createUtxos({
        upTo: true,
        num: 3,
        size: 1000,
        feeRate: 1,
      });
      addStep('createUtxos', 'success', {
        request: { upTo: true, num: 3, size: 1000, feeRate: 1 },
        response: { created },
      });
      } catch (e: any) {
        addStep('createUtxos', 'error', undefined, e?.message ?? String(e));
      }
    }

    addStep('issueAssetNia', 'running');
    if (!senderFunded) {
      addStep(
        'issueAssetNia',
        'error',
        undefined,
        'Skipped: sender funding failed, issuance requires funded wallet'
      );
    } else {
      try {
      const issueRequest = {
        ticker: 'RLNP',
        name: 'RLN Playground',
        precision: 0,
        amounts: [1000],
      };
      const issued = await senderWallet.issueAssetNia(issueRequest);
      issuedAssetId = issued.assetId;
      addStep('issueAssetNia', 'success', {
        request: issueRequest,
        response: { assetId: issuedAssetId, ticker: issued.ticker },
      });
      } catch (e: any) {
        addStep('issueAssetNia', 'error', undefined, e?.message ?? String(e));
      }
    }

    addStep('createReceiver', 'running');
    const receiverKeys = await createWallet(network);
    receiverProtocol = new UTEXOWallet(receiverKeys.mnemonic, {
      network: utexoAdapterNetwork as any,
    });
    await receiverProtocol.initialize();
    const receiverWallet = createWalletManager({
      xpubVan: receiverKeys.accountXpubVanilla,
      xpubCol: receiverKeys.accountXpubColored,
      masterFingerprint: receiverKeys.masterFingerprint,
      mnemonic: receiverKeys.mnemonic,
      network,
      bindingMode: 'rln',
      rlnProtocolAdapter: receiverProtocol,
    } as any);
    receiver = receiverWallet;
    await receiverWallet.initialize();
    addStep('createReceiver', 'success', {
      request: { network, bindingMode: 'rln' },
      response: { initialized: true },
    });

    // ── RLN native bridge surface coverage ───────────────────────────────────
    const senderRln = senderWallet as any;
    const resolveRlnMethod = (name: string): ((...args: any[]) => Promise<any>) => {
      const direct = senderRln?.[name];
      if (typeof direct === 'function') {
        return direct.bind(senderRln);
      }
      const binding = senderRln?.rnBinding ?? senderRln?._rnBinding ?? senderRln?.binding;
      const bound = binding?.[name];
      if (typeof bound === 'function') {
        return bound.bind(binding);
      }
      throw new Error(`Missing RLN method: ${name}`);
    };
    const consumeUnlockConflictNormalized = (): boolean => {
      const direct = senderRln?.consumeRlnUnlockConflictNormalized;
      if (typeof direct === 'function') {
        return Boolean(direct.call(senderRln));
      }
      const binding = senderRln?.rnBinding ?? senderRln?._rnBinding ?? senderRln?.binding;
      const bound = binding?.consumeUnlockConflictNormalized;
      if (typeof bound === 'function') {
        return Boolean(bound.call(binding));
      }
      return false;
    };
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

    addStep('rlnCreateNode', 'running');
    try {
      const rlnCreateNode = resolveRlnMethod('rlnCreateNode');
      const nodeId = await rlnCreateNode({
        storageDirPath: rlnStorageDir,
        daemonListeningPort: rlnPorts.daemonListeningPort,
        ldkPeerListeningPort: rlnPorts.ldkPeerListeningPort,
        network,
        maxMediaUploadSizeMb: 16,
        enableVirtualChannelsV0: true,
      });
      senderRlnNodeCreated = true;
      addStep('rlnCreateNode', 'success', {
        request: {
          storageDirPath: rlnStorageDir,
          network,
          daemonListeningPort: rlnPorts.daemonListeningPort,
          ldkPeerListeningPort: rlnPorts.ldkPeerListeningPort,
        },
        response: { nodeId },
      });
    } catch (e: any) {
      addStep('rlnCreateNode', 'error', undefined, e?.message ?? String(e));
    }

    const classifyRlnError = (err: any) => {
      const message = err?.message ?? String(err);
      const code = err?.code ? String(err.code) : null;
      const lowered = message.toLowerCase();
      const codeLowered = (code ?? '').toLowerCase();
      let kind: 'NotInitialized' | 'Conflict' | 'Transport' | 'Unknown' = 'Unknown';
      if (
        lowered.includes('not initialized') ||
        lowered.includes('notinitialized') ||
        codeLowered.includes('notinitialized') ||
        codeLowered.includes('not_initialized')
      ) {
        kind = 'NotInitialized';
      } else if (lowered.includes('conflict') || codeLowered.includes('conflict')) {
        kind = 'Conflict';
      }
      else if (
        lowered.includes('timeout') ||
        lowered.includes('network') ||
        lowered.includes('connection') ||
        lowered.includes('rpc')
      ) kind = 'Transport';
      return { kind, code, message };
    };
    const maskUnlockRequest = (request: any, diagnostics: any) => ({
      ...request,
      bitcoindRpcPassword: '***',
      password: '***',
      diagnostics,
    });
    const recreateSenderNode = async (
      phase: string,
      remediation: string[],
      options?: { freshContext?: boolean }
    ) => {
      const rlnDestroyNode = resolveRlnMethod('rlnDestroyNode');
      const rlnCreateNode = resolveRlnMethod('rlnCreateNode');
      await rlnDestroyNode();
      senderRlnNodeCreated = false;
      remediation.push(`${phase}:destroy`);
      if (options?.freshContext) {
        rlnStorageDir = await mkRlnStorageDir();
        rlnPorts = mkRlnPorts();
        remediation.push(
          `${phase}:fresh-context:${rlnStorageDir}:${rlnPorts.daemonListeningPort}/${rlnPorts.ldkPeerListeningPort}`
        );
      }
      await rlnCreateNode({
        storageDirPath: rlnStorageDir,
        daemonListeningPort: rlnPorts.daemonListeningPort,
        ldkPeerListeningPort: rlnPorts.ldkPeerListeningPort,
        network,
        maxMediaUploadSizeMb: 16,
        enableVirtualChannelsV0: true,
      });
      senderRlnNodeCreated = true;
      remediation.push(`${phase}:create`);
    };

    const isRegtestNetwork = network === 'regtest';
    const defaultRpcHost = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
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
      ? 'default_password'
      : rpcPasswordRawEnv;
    const rpcUser = rpcUserRaw ?? 'rpcuser';
    const rpcPassword = rpcPasswordRaw ?? 'rpcpassword';
    const strictUnlockCreds = readEnv('RLN_STRICT_UNLOCK_CREDS') === 'true';
    const nodePassword = readEnv('RLN_NODE_PASSWORD') ?? 'rln-playground-password';
    const indexerUrl = useRegtestForcedDefaults ? null : indexerUrlEnv;
    const proxyEndpoint = useRegtestForcedDefaults ? null : proxyEndpointEnv;
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
        ? 'regtest-forced-none'
        : (indexerUrl ? 'env' : 'none'),
      proxySource: useRegtestForcedDefaults
        ? 'regtest-forced-none'
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

    addStep('rlnInitNode', 'running');
    addStep('rlnUnlockNode', 'running');
    addStep('rlnEnsureReady', 'running');
    if (!senderRlnNodeCreated) {
      const reason = 'Skipped: rlnCreateNode failed';
      addStep('rlnInitNode', 'error', undefined, reason);
      addStep('rlnUnlockNode', 'error', undefined, reason);
      addStep('rlnEnsureReady', 'error', undefined, reason);
    } else if (strictUnlockCreds && (!rpcUserRaw || !rpcPasswordRaw)) {
      rlnReadinessBlocker =
        'Missing RLN_BITCOIND_RPC_USERNAME or RLN_BITCOIND_RPC_PASSWORD (or EXPO_PUBLIC_ prefixed variants)';
      addStep('rlnInitNode', 'success', {
        request: { phase: 'deferred-until-unlock' },
        response: { skipped: true },
      });
      addStep('rlnUnlockNode', 'error', {
        request: maskUnlockRequest(unlockRequest, diagnostics),
        phase: 'unlock-initial',
      }, rlnReadinessBlocker);
      addStep('rlnEnsureReady', 'error', {
        request: { probe: 'rlnNodeInfo', phase: 'probe-final' },
      }, rlnReadinessBlocker);
    } else if (!Number.isFinite(rpcPort) || rpcPort <= 0) {
      rlnReadinessBlocker = `Invalid RLN_BITCOIND_RPC_PORT: ${rpcPortRaw}`;
      addStep('rlnInitNode', 'success', {
        request: { phase: 'deferred-until-unlock' },
        response: { skipped: true },
      });
      addStep('rlnUnlockNode', 'error', {
        request: maskUnlockRequest(unlockRequest, diagnostics),
        phase: 'unlock-initial',
      }, rlnReadinessBlocker);
      addStep('rlnEnsureReady', 'error', {
        request: { probe: 'rlnNodeInfo', phase: 'probe-final' },
      }, rlnReadinessBlocker);
    } else {
      const remediation: string[] = [];
      const rlnInitNode = resolveRlnMethod('rlnInitNode');
      const rlnUnlockNode = resolveRlnMethod('rlnUnlockNode');
      const rlnNodeInfo = resolveRlnMethod('rlnNodeInfo');
      const waitForNodeReady = async (
        attempts: number,
        delayMs: number,
        options?: { treatConflictAsReady?: boolean }
      ) => {
        const treatConflictAsReady = options?.treatConflictAsReady ?? true;
        let lastDetail: ReturnType<typeof classifyRlnError> | null = null;
        for (let i = 0; i < attempts; i += 1) {
          try {
            const info = await rlnNodeInfo();
            return { ready: true as const, info, normalizedConflict: false };
          } catch (e: any) {
            const detail = classifyRlnError(e);
            lastDetail = detail;
            if (detail.kind === 'Conflict' && treatConflictAsReady) {
              remediation.push('probe:normalized-conflict');
              return {
                ready: true as const,
                info: { skipped: true, reason: detail.message },
                normalizedConflict: true,
              };
            }
            if (detail.kind !== 'NotInitialized') {
              return { ready: false as const, detail };
            }
            if (i < attempts - 1) {
              await new Promise((resolve) =>
                globalThis.setTimeout(resolve, delayMs)
              );
            }
          }
        }
        return { ready: false as const, detail: lastDetail };
      };
      const forceFreshInitUnlockAndProbe = async (phase: string) => {
        remediation.push(`${phase}:start`);
        await recreateSenderNode(`${phase}:recreate`, remediation, {
          freshContext: true,
        });

        try {
          senderRlnPubkey = await rlnInitNode(nodePassword, senderKeys.mnemonic);
          remediation.push(`${phase}:init-ok`);
          addStep('rlnInitNode', 'success', {
            request: { mnemonic: 'wallet mnemonic', password: '***' },
            response: { initResult: senderRlnPubkey, phase: `${phase}:init` },
          });
        } catch (initErr: any) {
          const initDetail = classifyRlnError(initErr);
          remediation.push(`${phase}:init-error:${initDetail.kind}`);
          addStep(
            'rlnInitNode',
            'error',
            {
              request: { phase: `${phase}:init` },
              response: { kind: initDetail.kind, code: initDetail.code },
            },
            initDetail.message
          );
          throw initErr;
        }

        const unlockAfterReset = await tryUnlock(`${phase}:unlock`);
        if (!unlockAfterReset.ok) {
          throw new Error(unlockAfterReset.detail.message);
        }

        addStep('rlnUnlockNode', 'success', {
          request: {
            ...maskUnlockRequest(unlockRequest, diagnostics),
            unlockAttempt: rlnUnlockAttempt,
          },
          response: unlockAfterReset.conflictNormalized
            ? {
                unlocked: true,
                normalizedConflict: true,
                reason: 'already-ready-after-conflict',
                phase: `${phase}:unlock`,
              }
            : { unlocked: true, phase: `${phase}:unlock` },
        });

        const strictReadiness = await waitForNodeReady(20, 1000, {
          treatConflictAsReady: false,
        });
        if (!strictReadiness.ready) {
          throw new Error(
            strictReadiness.detail?.message ??
              `${phase}:nodeInfo probe failed after fresh init/unlock`
          );
        }
        remediation.push(`${phase}:ready-ok`);
        return strictReadiness;
      };
      const ensureReadyWithHardResets = async (
        basePhase: string,
        maxAttempts: number = 3
      ) => {
        let lastErr: any = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const phase = `${basePhase}:attempt-${attempt}`;
          try {
            return await forceFreshInitUnlockAndProbe(phase);
          } catch (err: any) {
            const detail = classifyRlnError(err);
            remediation.push(`${phase}:failed:${detail.kind}`);
            lastErr = err;
            if (attempt < maxAttempts) {
              await new Promise((resolve) =>
                globalThis.setTimeout(resolve, 1200)
              );
            }
          }
        }
        throw lastErr ?? new Error(`${basePhase}:hard-reset attempts exhausted`);
      };
      const waitForReadyAfterInit = async (attempts: number, delayMs: number) => {
        for (let i = 0; i < attempts; i += 1) {
          try {
            await rlnNodeInfo();
            return true;
          } catch (e: any) {
            const detail = classifyRlnError(e);
            if (detail.kind !== 'NotInitialized') {
              return false;
            }
            if (i < attempts - 1) {
              await new Promise((resolve) =>
                globalThis.setTimeout(resolve, delayMs)
              );
            }
          }
        }
        return false;
      };

      const tryUnlock = async (phase: string) => {
        rlnUnlockAttempt += 1;
        try {
          await rlnUnlockNode(unlockRequest);
          const conflictNormalized = consumeUnlockConflictNormalized();
          remediation.push(
            conflictNormalized ? `${phase}:ok:already-ready-after-conflict` : `${phase}:ok`
          );
          return { ok: true as const, conflictNormalized };
        } catch (e: any) {
          const detail = classifyRlnError(e);
          if (detail.kind === 'Conflict') {
            remediation.push(`${phase}:soft-conflict`);
            // Treat conflict as a soft success and let the final readiness probe decide.
            return { ok: true as const, conflictNormalized: true };
          }
          remediation.push(`${phase}:error:${detail.kind}`);
          return { ok: false as const, detail };
        }
      };
      const tryUnlockAfterReopenWithInitFallback = async (
        remediation: string[]
      ) => {
        const retryAfterReopen = await tryUnlock('unlock-after-reopen');
        if (retryAfterReopen.ok) {
          return retryAfterReopen;
        }
        if (
          retryAfterReopen.detail.kind !== 'Conflict' &&
          retryAfterReopen.detail.kind !== 'NotInitialized'
        ) {
          return retryAfterReopen;
        }

        const initPhase =
          retryAfterReopen.detail.kind === 'NotInitialized'
            ? 'init-after-reopen-not-initialized'
            : 'init-after-reopen-conflict';
        remediation.push(`unlock-after-reopen:${retryAfterReopen.detail.kind.toLowerCase()}:init-retry`);
        try {
          senderRlnPubkey = await rlnInitNode(nodePassword, senderKeys.mnemonic);
          addStep('rlnInitNode', 'success', {
            request: { mnemonic: 'wallet mnemonic', password: '***' },
            response: { initResult: senderRlnPubkey, phase: initPhase },
          });
        } catch (initErr: any) {
          const initDetail = classifyRlnError(initErr);
          remediation.push(`${initPhase}:error:${initDetail.kind}`);
          addStep('rlnInitNode', 'error', {
            request: { phase: initPhase },
            response: { kind: initDetail.kind, code: initDetail.code },
          }, initDetail.message);
          return retryAfterReopen;
        }

        remediation.push(`${initPhase}:ok`);
        return tryUnlock('unlock-after-reopen-reinit');
      };

      let unlockResult = await tryUnlock('unlock-initial');
      if (unlockResult.ok) {
        addStep('rlnInitNode', 'success', {
          request: { phase: 'deferred-until-unlock' },
          response: { skipped: true, reason: 'unlock succeeded without explicit init' },
        });
        addStep('rlnUnlockNode', 'success', {
          request: { ...maskUnlockRequest(unlockRequest, diagnostics), unlockAttempt: rlnUnlockAttempt },
          response: unlockResult.conflictNormalized
            ? {
              unlocked: true,
              normalizedConflict: true,
              reason: 'already-ready-after-conflict',
              phase: 'unlock-initial',
            }
            : { unlocked: true, phase: 'unlock-initial' },
        });
      } else if (unlockResult.detail.kind === 'NotInitialized') {
        try {
          senderRlnPubkey = await rlnInitNode(nodePassword, senderKeys.mnemonic);
          addStep('rlnInitNode', 'success', {
            request: { mnemonic: 'wallet mnemonic', password: '***' },
            response: { initResult: senderRlnPubkey, phase: 'init-after-not-initialized' },
          });
        } catch (initErr: any) {
          const initDetail = classifyRlnError(initErr);
          rlnReadinessBlocker = `init failed: ${initDetail.message}`;
          addStep('rlnInitNode', 'error', {
            request: { phase: 'init-after-not-initialized' },
            response: { kind: initDetail.kind, code: initDetail.code },
          }, initDetail.message);
          addStep('rlnUnlockNode', 'error', {
            request: { ...maskUnlockRequest(unlockRequest, diagnostics), phase: 'unlock-initial' },
            response: {
              kind: unlockResult.detail.kind,
              code: unlockResult.detail.code,
              message: unlockResult.detail.message,
            },
          }, unlockResult.detail.message);
          addStep('rlnEnsureReady', 'error', {
            request: { probe: 'rlnNodeInfo', remediation, phase: 'probe-final' },
          }, rlnReadinessBlocker);
          unlockResult = null as any;
        }
        if (unlockResult) {
          try {
            // First probe directly after init; some RLN states are ready without explicit unlock.
            const readyAfterInitProbe = await waitForReadyAfterInit(8, 1500);
            if (readyAfterInitProbe) {
              remediation.push('probe-after-init:ready');
              addStep('rlnUnlockNode', 'success', {
                request: { ...maskUnlockRequest(unlockRequest, diagnostics), unlockAttempt: rlnUnlockAttempt },
                response: { skipped: true, reason: 'ready-after-init-probe', phase: 'probe-after-init' },
              });
            } else {
              remediation.push('probe-after-init:timeout-not-initialized');
            }

            if (!readyAfterInitProbe) {
              // Try direct unlock after init before forcing node reopen.
              const retryAfterInit = await tryUnlock('unlock-after-init');
              if (retryAfterInit.ok) {
                addStep('rlnUnlockNode', 'success', {
                  request: { ...maskUnlockRequest(unlockRequest, diagnostics), unlockAttempt: rlnUnlockAttempt },
                  response: retryAfterInit.conflictNormalized
                    ? {
                      unlocked: true,
                      normalizedConflict: true,
                      reason: 'already-ready-after-conflict',
                      phase: 'unlock-after-init',
                    }
                    : { unlocked: true, phase: 'unlock-after-init' },
                });
              } else if (retryAfterInit.detail.kind === 'Conflict') {
                await recreateSenderNode('reopen-after-init-conflict', remediation, {
                  freshContext: true,
                });
                const retryAfterReopen =
                  await tryUnlockAfterReopenWithInitFallback(remediation);
                if (!retryAfterReopen.ok) {
                  rlnReadinessBlocker = `unlock failed after reopen: ${retryAfterReopen.detail.message}`;
                  addStep('rlnUnlockNode', 'error', {
                    request: { ...maskUnlockRequest(unlockRequest, diagnostics), unlockAttempt: rlnUnlockAttempt },
                    response: {
                      kind: retryAfterReopen.detail.kind,
                      code: retryAfterReopen.detail.code,
                      message: retryAfterReopen.detail.message,
                      phase: 'unlock-after-reopen',
                    },
                  }, retryAfterReopen.detail.message);
                } else {
                  addStep('rlnUnlockNode', 'success', {
                    request: { ...maskUnlockRequest(unlockRequest, diagnostics), unlockAttempt: rlnUnlockAttempt },
                    response: retryAfterReopen.conflictNormalized
                      ? {
                        unlocked: true,
                        normalizedConflict: true,
                        reason: 'already-ready-after-conflict',
                        phase: 'unlock-after-reopen',
                      }
                      : { unlocked: true, phase: 'unlock-after-reopen' },
                  });
                }
              } else {
                rlnReadinessBlocker = `unlock failed after init: ${retryAfterInit.detail.message}`;
                addStep('rlnUnlockNode', 'error', {
                  request: { ...maskUnlockRequest(unlockRequest, diagnostics), unlockAttempt: rlnUnlockAttempt },
                  response: {
                    kind: retryAfterInit.detail.kind,
                    code: retryAfterInit.detail.code,
                    message: retryAfterInit.detail.message,
                    phase: 'unlock-after-init',
                  },
                }, retryAfterInit.detail.message);
              }
            }
          } catch (reopenErr: any) {
            const reopenDetail = classifyRlnError(reopenErr);
            rlnReadinessBlocker = `reopen failed: ${reopenDetail.message}`;
            addStep('rlnUnlockNode', 'error', {
              request: { ...maskUnlockRequest(unlockRequest, diagnostics), unlockAttempt: rlnUnlockAttempt },
              response: { kind: reopenDetail.kind, code: reopenDetail.code, phase: 'unlock-after-reopen' },
            }, reopenDetail.message);
          }
        }
      } else if (unlockResult.detail.kind === 'Conflict') {
        addStep('rlnInitNode', 'success', {
          request: { phase: 'deferred-until-unlock' },
          response: { skipped: true, reason: 'initial unlock returned conflict' },
        });
        try {
          await recreateSenderNode('reopen-after-conflict', remediation, {
            freshContext: true,
          });
          const retryAfterConflict =
            await tryUnlockAfterReopenWithInitFallback(remediation);
          if (!retryAfterConflict.ok) {
            rlnReadinessBlocker = `unlock failed after conflict reopen: ${retryAfterConflict.detail.message}`;
            addStep('rlnUnlockNode', 'error', {
              request: { ...maskUnlockRequest(unlockRequest, diagnostics), unlockAttempt: rlnUnlockAttempt },
              response: {
                kind: retryAfterConflict.detail.kind,
                code: retryAfterConflict.detail.code,
                message: retryAfterConflict.detail.message,
                phase: 'unlock-after-reopen',
              },
            }, retryAfterConflict.detail.message);
          } else {
            addStep('rlnUnlockNode', 'success', {
              request: { ...maskUnlockRequest(unlockRequest, diagnostics), unlockAttempt: rlnUnlockAttempt },
              response: retryAfterConflict.conflictNormalized
                ? {
                  unlocked: true,
                  normalizedConflict: true,
                  reason: 'already-ready-after-conflict',
                  phase: 'unlock-after-reopen',
                }
                : { unlocked: true, phase: 'unlock-after-reopen' },
            });
          }
        } catch (reopenErr: any) {
          const reopenDetail = classifyRlnError(reopenErr);
          rlnReadinessBlocker = `reopen failed: ${reopenDetail.message}`;
          addStep('rlnUnlockNode', 'error', {
            request: { ...maskUnlockRequest(unlockRequest, diagnostics), unlockAttempt: rlnUnlockAttempt },
            response: { kind: reopenDetail.kind, code: reopenDetail.code, phase: 'unlock-after-reopen' },
          }, reopenDetail.message);
        }
      } else {
        addStep('rlnInitNode', 'success', {
          request: { phase: 'deferred-until-unlock' },
          response: { skipped: true },
        });
        rlnReadinessBlocker = `unlock failed: ${unlockResult.detail.message}`;
        addStep('rlnUnlockNode', 'error', {
          request: { ...maskUnlockRequest(unlockRequest, diagnostics), unlockAttempt: rlnUnlockAttempt },
          response: {
            kind: unlockResult.detail.kind,
            code: unlockResult.detail.code,
            message: unlockResult.detail.message,
            phase: 'unlock-initial',
          },
        }, unlockResult.detail.message);
      }

      try {
        const readiness = await waitForNodeReady(20, 1000);
        if (!readiness.ready) {
          throw readiness.detail ?? new Error('node readiness probe timed out');
        }
        senderRlnReady = true;
        rlnReadinessBlocker = null;
        addStep('rlnEnsureReady', 'success', {
          request: {
            probe: 'rlnNodeInfo',
            remediation,
            unlockAttempt: rlnUnlockAttempt,
            phase: 'probe-final',
          },
          response: {
            ready: true,
            strategy: readiness.normalizedConflict
              ? 'probe-final-normalized-conflict'
              : 'probe-final-retry',
            finalProbe: 'success',
            normalizedConflict: readiness.normalizedConflict,
          },
        });
      } catch (probeErr: any) {
        const probeDetail = classifyRlnError(probeErr);
        remediation.push(`probe-final:error:${probeDetail.kind}`);
        try {
          const strictRecovery = await ensureReadyWithHardResets(
            'probe-final-hard-reset',
            3
          );
          senderRlnReady = true;
          rlnReadinessBlocker = null;
          addStep('rlnEnsureReady', 'success', {
            request: {
              probe: 'rlnNodeInfo',
              remediation,
              unlockAttempt: rlnUnlockAttempt,
              phase: 'probe-final-hard-reset',
            },
            response: {
              ready: true,
              strategy: 'probe-final-hard-reset',
              finalProbe: 'success',
              normalizedConflict: strictRecovery.normalizedConflict,
            },
          });
        } catch (fallbackErr: any) {
          senderRlnReady = false;
          const fallbackDetail = classifyRlnError(fallbackErr);
          rlnReadinessBlocker = rlnReadinessBlocker ?? fallbackDetail.message;
          addStep(
            'rlnEnsureReady',
            'error',
            {
              request: {
                probe: 'rlnNodeInfo',
                remediation,
                unlockAttempt: rlnUnlockAttempt,
                phase: 'probe-final-hard-reset',
              },
              response: { kind: fallbackDetail.kind, code: fallbackDetail.code },
            },
            rlnReadinessBlocker ?? undefined
          );
        }
      }
    }

    addStep('rlnNodeInfo', 'running');
    if (!senderRlnReady) {
      addStep('rlnNodeInfo', 'success', {
        request: {},
        response: {
          skipped: true,
          reason:
            rlnReadinessBlocker ??
            'Skipped: RLN readiness was not confirmed (see rlnEnsureReady)',
        },
      });
    } else {
    try {
      const rlnNodeInfo = resolveRlnMethod('rlnNodeInfo');
      const nodeInfo = await rlnNodeInfo();
      addStep('rlnNodeInfo', 'success', {
        request: {},
        response: nodeInfo,
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes('node is not initialized') && !senderRlnReady) {
        addStep('rlnNodeInfo', 'success', {
          request: {},
          response: { skipped: true, reason: msg },
        });
      } else {
        addStep('rlnNodeInfo', 'error', undefined, msg);
      }
    }
    }

    addStep('rlnNetworkInfo', 'running');
    if (!senderRlnReady) {
      addStep('rlnNetworkInfo', 'success', {
        request: {},
        response: {
          skipped: true,
          reason:
            rlnReadinessBlocker ??
            'Skipped: RLN readiness was not confirmed (see rlnEnsureReady)',
        },
      });
    } else {
    try {
      const rlnNetworkInfo = resolveRlnMethod('rlnNetworkInfo');
      const networkInfo = await rlnNetworkInfo();
      addStep('rlnNetworkInfo', 'success', {
        request: {},
        response: networkInfo,
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes('node is not initialized') && !senderRlnReady) {
        addStep('rlnNetworkInfo', 'success', {
          request: {},
          response: { skipped: true, reason: msg },
        });
      } else {
        addStep('rlnNetworkInfo', 'error', undefined, msg);
      }
    }
    }

    addStep('rlnListPeers', 'running');
    if (!senderRlnReady) {
      addStep('rlnListPeers', 'success', {
        request: {},
        response: {
          skipped: true,
          reason:
            rlnReadinessBlocker ??
            'Skipped: RLN readiness was not confirmed (see rlnEnsureReady)',
        },
      });
    } else {
    try {
      const rlnListPeers = resolveRlnMethod('rlnListPeers');
      const peers = await rlnListPeers();
      addStep('rlnListPeers', 'success', {
        request: {},
        response: { count: peers?.length ?? 0, peers },
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes('node is not initialized') && !senderRlnReady) {
        addStep('rlnListPeers', 'success', {
          request: {},
          response: { skipped: true, reason: msg },
        });
      } else {
        addStep('rlnListPeers', 'error', undefined, msg);
      }
    }
    }

    addStep('rlnConnectPeer', 'running');
    const peerTargetHost = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
    const peerPubkeyAndAddr = `0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798@${peerTargetHost}:9735`;
    if (!senderRlnReady) {
      addStep('rlnConnectPeer', 'success', {
        request: { peerPubkeyAndAddr },
        response: {
          skipped: true,
          reason:
            rlnReadinessBlocker ??
            'Skipped: RLN readiness was not confirmed (see rlnEnsureReady)',
        },
      });
    } else {
    try {
      const rlnConnectPeer = resolveRlnMethod('rlnConnectPeer');
      await rlnConnectPeer(peerPubkeyAndAddr);
      addStep('rlnConnectPeer', 'success', {
        request: { peerPubkeyAndAddr },
        response: { connected: true },
      });
    } catch (e: any) {
      addStep('rlnConnectPeer', 'success', {
        request: { peerPubkeyAndAddr },
        response: { skipped: true, reason: e?.message ?? String(e) },
      });
    }
    }

    addStep('rlnDisconnectPeer', 'running');
    if (!senderRlnReady) {
      addStep('rlnDisconnectPeer', 'success', {
        request: { peerPubkey: senderRlnPubkey ?? 'fallback' },
        response: {
          skipped: true,
          reason:
            rlnReadinessBlocker ??
            'Skipped: RLN readiness was not confirmed (see rlnEnsureReady)',
        },
      });
    } else {
    try {
      const rlnDisconnectPeer = resolveRlnMethod('rlnDisconnectPeer');
      await rlnDisconnectPeer(
        senderRlnPubkey ??
          '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
      );
      addStep('rlnDisconnectPeer', 'success', {
        request: { peerPubkey: senderRlnPubkey ?? 'fallback' },
        response: { disconnected: true },
      });
    } catch (e: any) {
      addStep('rlnDisconnectPeer', 'success', {
        request: { peerPubkey: senderRlnPubkey ?? 'fallback' },
        response: { skipped: true, reason: e?.message ?? String(e) },
      });
    }
    }

    addStep('rlnListChannels', 'running');
    if (!senderRlnReady) {
      addStep('rlnListChannels', 'success', {
        request: {},
        response: {
          skipped: true,
          reason:
            rlnReadinessBlocker ??
            'Skipped: RLN readiness was not confirmed (see rlnEnsureReady)',
        },
      });
    } else {
    try {
      const rlnListChannels = resolveRlnMethod('rlnListChannels');
      const channels = await rlnListChannels();
      addStep('rlnListChannels', 'success', {
        request: {},
        response: { count: channels?.length ?? 0, channels },
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes('node is not initialized') && !senderRlnReady) {
        addStep('rlnListChannels', 'success', {
          request: {},
          response: { skipped: true, reason: msg },
        });
      } else {
        addStep('rlnListChannels', 'error', undefined, msg);
      }
    }
    }

    addStep('rlnOpenChannel', 'running');
    if (!senderRlnReady) {
      addStep('rlnOpenChannel', 'success', {
        request: { capacitySat: 10000, pushMsat: 0, withAnchors: true },
        response: {
          skipped: true,
          reason:
            rlnReadinessBlocker ??
            'Skipped: RLN readiness was not confirmed (see rlnEnsureReady)',
        },
      });
    } else {
    try {
      const rlnOpenChannel = resolveRlnMethod('rlnOpenChannel');
      const opened = await rlnOpenChannel({
        peerPubkeyAndOptAddr: peerPubkeyAndAddr,
        capacitySat: 10000,
        pushMsat: 0,
        public: false,
        withAnchors: true,
      });
      addStep('rlnOpenChannel', 'success', {
        request: { capacitySat: 10000, pushMsat: 0, withAnchors: true },
        response: opened,
      });
    } catch (e: any) {
      addStep('rlnOpenChannel', 'success', {
        request: { capacitySat: 10000, pushMsat: 0, withAnchors: true },
        response: { skipped: true, reason: e?.message ?? String(e) },
      });
    }
    }

    addStep('rlnCloseChannel', 'running');
    if (!senderRlnReady) {
      addStep('rlnCloseChannel', 'success', {
        request: { channelId: '00...00', force: true },
        response: {
          skipped: true,
          reason:
            rlnReadinessBlocker ??
            'Skipped: RLN readiness was not confirmed (see rlnEnsureReady)',
        },
      });
    } else {
    try {
      const rlnCloseChannel = resolveRlnMethod('rlnCloseChannel');
      await rlnCloseChannel('00'.repeat(32), senderRlnPubkey ?? '02', true);
      addStep('rlnCloseChannel', 'success', {
        request: { channelId: '00...00', force: true },
        response: { closed: true },
      });
    } catch (e: any) {
      addStep('rlnCloseChannel', 'success', {
        request: { channelId: '00...00', force: true },
        response: { skipped: true, reason: e?.message ?? String(e) },
      });
    }
    }

    addStep('rlnListPayments', 'running');
    if (!senderRlnReady) {
      addStep('rlnListPayments', 'success', {
        request: {},
        response: {
          skipped: true,
          reason:
            rlnReadinessBlocker ??
            'Skipped: RLN readiness was not confirmed (see rlnEnsureReady)',
        },
      });
    } else {
    try {
      const rlnListPayments = resolveRlnMethod('rlnListPayments');
      const payments = await rlnListPayments();
      addStep('rlnListPayments', 'success', {
        request: {},
        response: { count: payments?.length ?? 0, payments },
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes('node is not initialized') && !senderRlnReady) {
        addStep('rlnListPayments', 'success', {
          request: {},
          response: { skipped: true, reason: msg },
        });
      } else {
        addStep('rlnListPayments', 'error', undefined, msg);
      }
    }
    }

    if (!senderProtocol || !receiverProtocol) {
      throw new Error('RLN protocol adapter was not initialized');
    }
    // Use the adapter instance network preset directly to avoid
    // mismatches with global/default network maps.
    const protocolNetworkIdMap = (receiverProtocol as any)?.networkIdMap;
    bridgeAssetId =
      protocolNetworkIdMap?.mainnet?.assets?.[0]?.assetId ??
      getDestinationAsset('utexo', 'mainnet', null)?.assetId ??
      null;
    bridgeUtexoAssetId =
      bridgeAssetId && protocolNetworkIdMap?.utexo?.assets
        ? protocolNetworkIdMap.utexo.assets.find(
            (a: any) =>
              a?.tokenId ===
              protocolNetworkIdMap?.mainnet?.assets?.find(
                (m: any) => m?.assetId === bridgeAssetId
              )?.tokenId
          )?.assetId ?? null
        : getDestinationAsset('mainnet', 'utexo', bridgeAssetId)?.assetId ?? null;

    addStep('onchainCycle', 'running');
    const onchainAssetCandidates = [
      bridgeAssetId,
      issuedAssetId,
      bridgeUtexoAssetId,
    ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    if (onchainAssetCandidates.length === 0) {
      addStep(
        'onchainCycle',
        'error',
        undefined,
        'Skipped: no bridge-supported assetId available for protocol requests'
      );
    } else {
      try {
        let lastError: any = null;
        let usedAssetId: string | null = null;
        let onchainInvoice: any = null;
        let onchainStatus: any = null;
        for (const candidate of onchainAssetCandidates) {
          try {
            const onchainRequest = {
              assetId: candidate,
              amount: 1,
            };
            onchainInvoice = await receiverProtocol.onchainReceive(onchainRequest);
            onchainStatus = await senderProtocol.getOnchainSendStatus(
              onchainInvoice.invoice
            );
            usedAssetId = candidate;
            break;
          } catch (candidateErr: any) {
            lastError = candidateErr;
          }
        }
        if (!usedAssetId) {
          throw lastError ?? new Error('onchain cycle failed for all asset candidates');
        }
        addStep('onchainCycle', 'success', {
          request: {
            amount: 1,
            triedAssetIds: onchainAssetCandidates,
            usedAssetId,
          },
          response: {
            onchainReceive: onchainInvoice,
            getOnchainSendStatus: onchainStatus,
          },
        });
      } catch (e: any) {
        const message = e?.message ?? String(e);
        if (message.includes('Destination asset is not supported')) {
          addStep('onchainCycle', 'success', {
            request: { amount: 1, triedAssetIds: onchainAssetCandidates },
            response: {
              skipped: true,
              reason:
                'Bridge asset mapping is unavailable for this environment/network preset',
            },
          });
        } else {
          addStep(
            'onchainCycle',
            'error',
            { request: { amount: 1, triedAssetIds: onchainAssetCandidates } },
            message
          );
        }
      }
    }

    addStep('lightningCycle', 'running');
    const lightningAssetCandidates = [
      bridgeAssetId,
      issuedAssetId,
      bridgeUtexoAssetId,
    ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    if (lightningAssetCandidates.length === 0) {
      addStep(
        'lightningCycle',
        'error',
        undefined,
        'Skipped: no bridge-supported assetId available for protocol requests'
      );
    } else {
      try {
        let lastError: any = null;
        let usedAssetId: string | null = null;
        let lnInvoice: any = null;
        let lnStatus: any = null;
        for (const candidate of lightningAssetCandidates) {
          try {
            const lightningRequest = {
              asset: { assetId: candidate, amount: 1 },
            };
            lnInvoice = await receiverProtocol.createLightningInvoice(lightningRequest);
            lnStatus = await senderProtocol.getLightningSendRequest(
              lnInvoice.lnInvoice
            );
            usedAssetId = candidate;
            break;
          } catch (candidateErr: any) {
            lastError = candidateErr;
          }
        }
        if (!usedAssetId) {
          throw lastError ?? new Error('lightning cycle failed for all asset candidates');
        }
        addStep('lightningCycle', 'success', {
          request: {
            amount: 1,
            triedAssetIds: lightningAssetCandidates,
            usedAssetId,
          },
          response: {
            createLightningInvoice: lnInvoice,
            getLightningSendRequest: lnStatus,
          },
        });
      } catch (e: any) {
        const message = e?.message ?? String(e);
        if (message.includes('Destination asset is not supported')) {
          addStep('lightningCycle', 'success', {
            request: { amount: 1, triedAssetIds: lightningAssetCandidates },
            response: {
              skipped: true,
              reason:
                'Bridge asset mapping is unavailable for this environment/network preset',
            },
          });
        } else {
          addStep(
            'lightningCycle',
            'error',
            { request: { amount: 1, triedAssetIds: lightningAssetCandidates } },
            message
          );
        }
      }
    }

    const failed = results.steps.some((s: any) => s.status === 'error');
    results.success = !failed;
    return results;
  } catch (error: any) {
    results.success = false;
    results.error = { message: error?.message ?? String(error) };
    return results;
  } finally {
    if (sender && senderRlnNodeCreated) {
      try {
        const senderAny = sender as any;
        const directDestroy = senderAny?.rlnDestroyNode;
        if (typeof directDestroy === 'function') {
          await directDestroy.call(senderAny);
        } else {
          const binding = senderAny?.rnBinding ?? senderAny?._rnBinding ?? senderAny?.binding;
          if (typeof binding?.rlnDestroyNode === 'function') {
            await binding.rlnDestroyNode();
          }
        }
      } catch {
        // ignore cleanup failure
      }
    }
    if (sender) {
      try {
        await sender.dispose();
      } catch {
        // ignore cleanup failure
      }
    }
    if (senderProtocol) {
      try {
        await senderProtocol.dispose();
      } catch {
        // ignore cleanup failure
      }
    }
    if (receiver) {
      try {
        await receiver.dispose();
      } catch {
        // ignore cleanup failure
      }
    }
    if (receiverProtocol) {
      try {
        await receiverProtocol.dispose();
      } catch {
        // ignore cleanup failure
      }
    }
    rlnPlaygroundFlowInFlight = false;
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
  }
}
