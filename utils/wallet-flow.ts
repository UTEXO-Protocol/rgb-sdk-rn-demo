/**
 * React Native compatible wallet flow
 * Adapted from flow.js for React Native environment
 */

import {
  LightningProtocol, OnchainProtocol, UTEXOProtocol,
  UTEXOWallet,
  WalletManager,
  bridgeAPI,
  createWallet,
  restoreFromBackup, type InvoiceData,
} from '@utexo/rgb-sdk-rn';
import { documentDirectory } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

const UTEXO_TEST_MNEMONIC = 'poem twice question inch happy capital grain quality laptop dry chaos what';

// Configuration
// Network endpoint configuration for different platforms:
// - Android Emulator: use 10.0.2.2 to access host machine's localhost
// - iOS Simulator: use localhost or 127.0.0.1 (works fine)
// - Physical Device: use your computer's IP address (e.g., 192.168.1.100:8000)
//   You can find your IP with: ifconfig (Mac/Linux) or ipconfig (Windows)

// You can override this by setting an environment variable or changing the default
const getRGBManagerEndpoint = () => {


  // Check if there's an override (useful for physical devices)
  // You can set this in your app config or environment
  const overrideEndpoint = process.env.RGB_ENDPOINT || null;
  if (overrideEndpoint) {
    return overrideEndpoint;
  }

  if (Platform.OS === 'android') {
    // Android emulator uses 10.0.2.2 to access host machine's localhost
    // For physical Android device, you'll need to use your computer's IP
    return "http://10.0.2.2:8000";
  } else if (Platform.OS === 'ios') {
    // iOS simulator can use localhost
    // For physical iOS device, you'll need to use your computer's IP
    return "http://127.0.0.1:8000";
  } else {
    // Web or other platforms
    return "http://127.0.0.1:8000";
  }
};

const RGB_MANAGER_ENDPOINT = getRGBManagerEndpoint();
const BITCOIN_NODE_ENDPOINT = "http://18.119.98.232:5000/execute";

/**
 * Mine blocks using the Bitcoin node endpoint
 */
export async function mine(numBlocks: number) {
  try {
    const response = await fetch(BITCOIN_NODE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        args: `mine ${numBlocks}`
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
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
    const response = await fetch(BITCOIN_NODE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        args: `sendtoaddress ${address} ${amount}`
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const txid = data?.result || data;
    console.log(`Sent ${amount} BTC to ${address}, TXID: ${txid}`);
    return txid;
  } catch (error: any) {
    throw new Error(`Unable to send bitcoins: ${error.message}`);
  }
}

/**
 * Initialize a wallet with RGB SDK
 */
export async function initWallet(vanillaKeychain: any = null) {
  console.log("\nInitializing wallet with RGB SDK...");

  const bitcoinNetwork = 'regtest'; // Regtest network

  // Generate keys using the library
  const keys = await createWallet(bitcoinNetwork);
  console.log("Keys generated:", keys);
  // return;

  // // Initialize wallet manager
  // const rgbEndpoint = getRGBManagerEndpoint();
  // console.log(`Using RGB endpoint: ${rgbEndpoint} (Platform: ${Platform.OS})`);
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
      const restoreResult = await restoreFromBackup({
        backupFilePath: backupPath,
        password: backupPassword,
        dataDir: `${documentDirectory ?? ''}restore/`,
      });
      flowResults.restoreFromBackup = restoreResult;
      pushStep({ step: 'restoreFromBackup', status: 'success' });
    } catch (e: any) {
      pushStep({ step: 'createBackup', status: 'error', error: e.message });
    }

    // ── goOnline (reconnect) ───────────────────────────────────────
    pushStep({ step: 'goOnline', status: 'running' });
    try {
      await senderWallet.goOnline(RGB_MANAGER_ENDPOINT, true);
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
 * Tests UTEXOWallet, LightningProtocol, OnchainProtocol, UTEXOProtocol, and bridgeAPI.
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
    const utexoWallet = new UTEXOWallet(UTEXO_TEST_MNEMONIC);
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

    // ── bridgeAPI: configure and query ──────────────────────
    pushStep({ step: 'bridgeAPIConfig', status: 'running' });
    bridgeAPI.setBaseUrl('http://localhost:8081/');
    results.bridgeAPIConfigured = true;
    pushStep({ step: 'bridgeAPIConfig', status: 'success' });

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
