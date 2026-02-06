import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { WalletManager, createWallet } from './dist/index.mjs';

// Configuration
const RGB_MANAGER_ENDPOINT = "http://127.0.0.1:8000";
const BITCOIN_NODE_ENDPOINT = "http://18.119.98.232:5000/execute";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Mine blocks using the Bitcoin node endpoint
 */
async function mine(numBlocks) {
    try {
        const response = await axios.post(BITCOIN_NODE_ENDPOINT, {
            args: `mine ${numBlocks}`
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log(`Mined ${numBlocks} blocks`);
        return response.data;
    } catch (error) {
        throw new Error(`Unable to mine: ${error.message}`);
    }
}

/**
 * Send Bitcoin to an address using the Bitcoin node endpoint
 */
async function sendToAddress(address, amount) {
    try {
        const response = await axios.post(BITCOIN_NODE_ENDPOINT, {
            args: `sendtoaddress ${address} ${amount}`
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const txid = response.data?.result || response.data;
        console.log(`Sent ${amount} BTC to ${address}, TXID: ${txid}`);
        return txid;
    } catch (error) {
        throw new Error(`Unable to send bitcoins: ${error.message}`);
    }
}

/**
 * Initialize a wallet with RGB SDK
 */
async function initWallet(vanillaKeychain = null) {
    console.log("\nInitializing wallet with RGB SDK...");

    const bitcoinNetwork = 'regtest'; // Regtest network

    // Generate keys using the library
    const keys = await createWallet(bitcoinNetwork);
    console.log("Keys generated:", {
        accountXpubVanilla: keys.account_xpub_vanilla,
        accountXpubColored: keys.account_xpub_colored,
        masterFingerprint: keys.master_fingerprint,
        mnemonic: keys.mnemonic
    });

    // Restore keys to verify they match
    const restoredKeys = await createWallet(bitcoinNetwork);
    // In the original example, they restore from mnemonic, but we'll skip that for now
    // since we just generated them

    // Initialize wallet manager
    const wallet = new WalletManager({
        xpub_van: keys.account_xpub_vanilla,
        xpub_col: keys.account_xpub_colored,
        master_fingerprint: keys.master_fingerprint,
        mnemonic: keys.mnemonic,
        network: bitcoinNetwork,
        rgb_node_endpoint: RGB_MANAGER_ENDPOINT
    });

    console.log("Wallet created");

    // Register wallet with RGB Node
    await wallet.registerWallet();
    console.log("Wallet registered");

    // Get BTC balance
    const btcBalance = await wallet.getBtcBalance();
    console.log("BTC balance:", JSON.stringify(btcBalance));

    // Get address
    const address = await wallet.getAddress();
    console.log("Address:", address);

    // Send some BTC to the address
    await sendToAddress(address, 1);

    // Wait a bit for the transaction to be processed
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get updated BTC balance
    const updatedBtcBalance = await wallet.getBtcBalance();
    console.log("Updated BTC balance:", JSON.stringify(updatedBtcBalance));

    // Create UTXOs
    console.log("Creating UTXOs...");
    const psbt = await wallet.createUtxosBegin({
        up_to: true,
        num: 5,
        size: 1000,
        fee_rate: 1
    });

    const signedPsbt = await wallet.signPsbt(psbt);
    const utxosCreated = await wallet.createUtxosEnd({ signed_psbt: signedPsbt });
    console.log(`Created ${utxosCreated} UTXOs`);

    return { wallet, keys };
}

/**
 * Main execution function
 */
async function main() {
    console.log("Starting RGB SDK Wallet Example");
    console.log("=".repeat(50));

    try {
        // Initialize sender wallet
        const { wallet: senderWallet, keys: senderKeys } = await initWallet(null);

        // Issue NIA asset
        console.log("\nIssuing NIA asset...");
        const asset1 = await senderWallet.issueAssetNia({
            ticker: "USDT",
            name: "Tether",
            amounts: [777, 66],
            precision: 0
        });
        console.log("Issued NIA asset:", JSON.stringify(asset1));

        // Issue CFA asset (if supported)
        // Note: CFA issuance might not be available in the current API
        // console.log("\nIssuing CFA asset...");
        // const asset2 = await senderWallet.issueAssetCfa({
        //     ticker: "CFA",
        //     name: "Cfa",
        //     amounts: [777],
        //     precision: 2
        // });
        // console.log("Issued CFA asset:", JSON.stringify(asset2));

        // List assets
        console.log("\nListing assets...");
        const assets1 = await senderWallet.listAssets();
        console.log("Assets:", JSON.stringify(assets1, null, 2));

        // Initialize receiving wallet
        console.log("\nInitializing receiving wallet...");
        const { wallet: receiverWallet } = await initWallet(null);


        const btcAddress = await receiverWallet.getAddress();
        console.log("BTC address:", btcAddress);
        await receiverWallet.syncWallet();
        const btcBalance2 = await receiverWallet.getBtcBalance();
        console.log("BTC balance:", JSON.stringify(btcBalance2));

        // Send BTC to the address
        const psbt = await senderWallet.sendBtcBegin({
            address: btcAddress,
            amount: 7000,
            fee_rate: 1
        });
        console.log("PSBT:", psbt);
        // const btcEstimate = await senderWallet.estimatePsbtCost(psbt);
        // console.log("BTC send estimate:", btcEstimate);
        const signedPsbt = await senderWallet.signPsbt(psbt);
        console.log("Signed PSBT:", signedPsbt);
        const result = await senderWallet.sendBtcEnd({ signed_psbt: signedPsbt });
        console.log("Send BTC result:", result);
    //    const result = await senderWallet.sendBtc({
    //         address: btcAddress,
    //         amount: 7000,
    //         fee_rate: 1
    //     });

        console.log("Send BTC result:", result);

        mine(10);
        // Wait for confirmation
        await new Promise(resolve => setTimeout(resolve, 2000));
        await receiverWallet.syncWallet();


        const btcBalance = await receiverWallet.getBtcBalance();
        console.log("BTC balance:", JSON.stringify(btcBalance));
// return;
        // Create blind receive
        console.log("\nCreating blind receive...");
        const receiveData1 = await receiverWallet.blindReceive({
            // asset_id: asset1.asset?.asset_id || '',
            amount: 76
        });
        console.log("Blind receive data:", JSON.stringify(receiveData1, null, 2));


        // Send assets
        console.log("\nSending assets...", asset1);
        const sendResult = await senderWallet.send({
            asset_id: asset1.asset_id,
            amount: 76,
            invoice: receiveData1.invoice,
            min_confirmations: 1
        });
        console.log("Send result:", sendResult);

        // Refresh wallets
        console.log("\nRefreshing wallets...");
        await receiverWallet.refreshWallet();
        await senderWallet.refreshWallet();

        // Mine a block to confirm the transaction
        console.log("\nMining block...");
        await mine(10);

        // Refresh wallets again after mining
        await receiverWallet.refreshWallet();
        await senderWallet.refreshWallet();

        // List assets in receiver wallet
        console.log("\nListing receiver assets...");
        const rcvAssets = await receiverWallet.listAssets();
        console.log("Receiver assets:", JSON.stringify(rcvAssets, null, 2));

        // Get asset balance
        if (asset1.asset_id) {
            console.log("\nGetting asset balance...");
            const rcvAssetBalance = await receiverWallet.getAssetBalance(asset1.asset_id);
            console.log("Receiver asset balance:", JSON.stringify(rcvAssetBalance, null, 2));
        }
        //   Create witness receive
        console.log("\nCreating witness receive...");
        const receiveData2 = await receiverWallet.witnessReceive({
            // asset_id: asset1.asset?.asset_id || '',
            amount: 50
        });
        // Send assets
        console.log("\nSending assets...", asset1);
        const sendResult2 = await senderWallet.send({
            asset_id: asset1.asset_id,
            amount: 10,
            witness_data: {
                amount_sat: 1000,
                blinding: null,
            },
            invoice: receiveData2.invoice,
            min_confirmations: 1
        });
        console.log("Send result:", sendResult2);
        console.log("Witness receive data:", JSON.stringify(receiveData2, null, 2));
        // Refresh wallets
        console.log("\nRefreshing wallets...");
        await receiverWallet.refreshWallet();
        await senderWallet.refreshWallet();

        // Mine a block to confirm the transaction
        console.log("\nMining block...");
        await mine(10);

        // Refresh wallets again after mining
        await receiverWallet.refreshWallet();
        await senderWallet.refreshWallet();

        // Sync wallet (if available)
        // await senderWallet.sync();

        // List transfers
        if (asset1.asset_id) {
            console.log("\nListing transfers...");
            const transfers = await senderWallet.listTransfers(asset1.asset_id);
            console.log("Transfers:", JSON.stringify(transfers, null, 2));
        }

        // List transactions
        console.log("\nListing transactions...");
        const transactions = await senderWallet.listTransactions();
        console.log("Transactions:", JSON.stringify(transactions, null, 2));

        // List unspents
        console.log("\nListing unspents...");
        const unspents = await receiverWallet.listUnspents();
        console.log("Unspents:", JSON.stringify(unspents, null, 2));

        // Send BTC (similar to sendBtc in original example)
        console.log("\nSending BTC...");
        const receiverAddress = await receiverWallet.getAddress();
        const btcTxid = await sendToAddress(receiverAddress, 0.0007);
        console.log("Sent BTC, TXID:", btcTxid);

        // Wait for confirmation
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Refresh wallets
        await senderWallet.refreshWallet();
        await receiverWallet.refreshWallet();

        console.log("\nCreating wallet backup...");
        const backupPassword = "test-backup-password";
        const backupInfo = await senderWallet.createBackup(backupPassword);
        console.log("Backup info:", backupInfo);

        console.log("Downloading backup file...");
        const backupBinary = await senderWallet.downloadBackup();
        const backupBuffer = backupBinary instanceof ArrayBuffer ? Buffer.from(backupBinary) : backupBinary;
        const backupFileName = `${senderKeys.account_xpub_vanilla}.backup`;
        const backupFilePath = path.join(__dirname, backupFileName);
        await fs.writeFile(backupFilePath, backupBuffer);
        console.log(`Backup saved to ${backupFilePath}`);

        console.log("\nRestoring wallet from backup...");
        const restoreResult = await senderWallet.restoreFromBackup({
            backup: backupBuffer,
            password: backupPassword,
            filename: backupFileName
        });
        console.log("Restore result:", restoreResult);

        console.log("\nExample completed successfully!");
        console.log("=".repeat(50));

    } catch (error) {
        console.error("Error in main execution:", error);
        if (error.response) {
            console.error("Response data:", error.response.data);
            console.error("Response status:", error.response.status);
        }
        process.exit(1);
    }
}

// Run the example
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url.endsWith('example-flow.mjs') ||
    process.argv[1]?.endsWith('example-flow.mjs');

if (isMainModule || process.argv[1]?.includes('example-flow.mjs')) {
    console.log("RGB SDK Wallet Complete Example");
    console.log("This example demonstrates:");
    console.log("- Wallet creation and initialization");
    console.log("- UTXO creation and management");
    console.log("- RGB asset issuance");
    console.log("- Asset transfers between wallets");
    console.log("- Transaction and transfer listing");
    console.log("");

    main()
        .then(() => {
            console.log("All operations completed successfully!");
            process.exit(0);
        })
        .catch((error) => {
            console.error("Fatal error:", error);
            process.exit(1);
        });
}

export {
    initWallet, main, mine,
    sendToAddress
};

