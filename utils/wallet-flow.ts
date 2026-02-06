/**
 * React Native compatible wallet flow
 * Adapted from flow.js for React Native environment
 */

import {
  createWallet, WalletManager
} from '@utexo/rgb-sdk-rn';
import { Platform } from 'react-native';

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

  try {

    // Initialize sender wallet
    // await initWallet(null);
    flowResults.steps.push({ step: 'initSenderWallet', status: 'running' });
    // return flowResults;
    const { wallet: senderWallet, keys: senderKeys } = await initWallet(null);
    flowResults.steps.push({ step: 'initSenderWallet', status: 'success', data: { address: await senderWallet.getAddress() } });

    //   // Issue NIA asset
    flowResults.steps.push({ step: 'issueAsset', status: 'running' });
    //   console.log("\nIssuing NIA asset...");
    const asset1 = await senderWallet.issueAssetNia({
      ticker: "USDT",
      name: "Tether",
      amounts: [777, 66],
      precision: 0
    });
    console.log("Issued NIA asset:", asset1);
    flowResults.steps.push({ step: 'issueAsset', status: 'success', data: asset1 });
    flowResults.assetId = asset1.assetId;

    //   // List assets
    flowResults.steps.push({ step: 'listAssets', status: 'running' });
    //   console.log("\nListing assets...");
    const assets1 = await senderWallet.listAssets();
    console.log("Assets:", assets1);
    flowResults.steps.push({ step: 'listAssets', status: 'success', data: assets1 });

    //   // Initialize receiving wallet
    flowResults.steps.push({ step: 'initReceiverWallet', status: 'running' });
    //   console.log("\nInitializing receiving wallet...");
    const { wallet: receiverWallet } = await initWallet(null);
    const btcAddress = await receiverWallet.getAddress();
    console.log("BTC address:", btcAddress);
    await receiverWallet.syncWallet();
    const btcBalance2 = await receiverWallet.getBtcBalance();
    console.log("BTC balance:", btcBalance2);
    flowResults.steps.push({ step: 'initReceiverWallet', status: 'success', data: { address: btcAddress, balance: btcBalance2 } });

    //   // Send BTC to the address
    flowResults.steps.push({ step: 'sendBtc', status: 'running' });
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
    flowResults.steps.push({ step: 'sendBtc', status: 'success', data: result });

    await mine(10);
    //   // Wait for confirmation
    await new Promise(resolve => setTimeout(resolve, 2000));
    await receiverWallet.syncWallet();

    const btcBalance = await receiverWallet.getBtcBalance();
    console.log("BTC balance:", btcBalance);
    flowResults.receiverBtcBalance = btcBalance;
    flowResults.steps.push({ step: 'sendBtc', status: 'success', data: { balance: btcBalance } });

    //   // Create blind receive
    if (!asset1.assetId) {
      throw new Error('Asset ID is required for blind receive');
    }
    flowResults.steps.push({ step: 'blindReceive', status: 'running' });
    //   console.log("\nCreating blind receive...");
    const receiveData1 = await receiverWallet.blindReceive({
      assetId: null as unknown as string, // TODO: add asset_id
      amount: 76
    });
    console.log("Blind receive data:", receiveData1);
    flowResults.steps.push({ step: 'blindReceive', status: 'success', data: receiveData1 });

    //   // Send assets
    flowResults.steps.push({ step: 'sendAssets', status: 'running' });
    //   console.log("\nSending assets...", asset1);
    const sendResult = await senderWallet.send({
      assetId: asset1.assetId,
      amount: 76,
      invoice: receiveData1.invoice,
      minConfirmations: 1
    });
    console.log("Send result:", sendResult);
    flowResults.steps.push({ step: 'sendAssets', status: 'success', data: sendResult });

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
    flowResults.steps.push({ step: 'listReceiverAssets', status: 'running' });
    //   console.log("\nListing receiver assets...");
    const rcvAssets = await receiverWallet.listAssets();
    //   console.log("Receiver assets:", JSON.stringify(rcvAssets, null, 2));
    flowResults.steps.push({ step: 'listReceiverAssets', status: 'success', data: rcvAssets });

    //   // Get asset balance
    if (asset1.assetId) {
      flowResults.steps.push({ step: 'getAssetBalance', status: 'running' });
      //     console.log("\nGetting asset balance...");
      const rcvAssetBalance = await receiverWallet.getAssetBalance(asset1.assetId);
      //     console.log("Receiver asset balance:", JSON.stringify(rcvAssetBalance, null, 2));
      flowResults.steps.push({ step: 'getAssetBalance', status: 'success', data: rcvAssetBalance });
      flowResults.receiverAssetBalance = rcvAssetBalance;
    }

    //   // Create witness receive
    if (!asset1.assetId) {
      throw new Error('Asset ID is required for witness receive');
    }
    flowResults.steps.push({ step: 'witnessReceive', status: 'running' });
    //   console.log("\nCreating witness receive...");
    const receiveData2 = await receiverWallet.witnessReceive({
      assetId: asset1.assetId,
      amount: 50
    });
    flowResults.steps.push({ step: 'witnessReceive', status: 'success', data: receiveData2 });

    //   // Send assets with witness
    flowResults.steps.push({ step: 'sendAssetsWithWitness', status: 'running' });
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
    flowResults.steps.push({ step: 'sendAssetsWithWitness', status: 'success', data: sendResult2 });

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
      flowResults.steps.push({ step: 'listTransfers', status: 'running' });
      console.log("\nListing transfers...");
      const transfers = await senderWallet.listTransfers(asset1.assetId);
      console.log("Transfers:", transfers);
      flowResults.steps.push({ step: 'listTransfers', status: 'success', data: transfers });
    }

    //   // List transactions
    flowResults.steps.push({ step: 'listTransactions', status: 'running' });
    console.log("\nListing transactions...");
    const transactions = await senderWallet.listTransactions();
    console.log("Transactions:", transactions);
    flowResults.steps.push({ step: 'listTransactions', status: 'success', data: transactions });

    //   // List unspents
    flowResults.steps.push({ step: 'listUnspents', status: 'running' });
    console.log("\nListing unspents...");
    const unspents = await receiverWallet.listUnspents();
    console.log("Unspents:", unspents);
    flowResults.steps.push({ step: 'listUnspents', status: 'success', data: unspents });

    // Backup/restore functionality skipped for React Native testing
    // console.log("\nExample completed successfully!");
    // console.log("=".repeat(50));

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


