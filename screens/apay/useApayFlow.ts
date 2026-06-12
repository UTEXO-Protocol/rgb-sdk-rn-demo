/**
 * APay integration reference — mirrors useLspFlow style.
 *
 * Utexo / signet (production):
 *   new UTEXOWallet({ lspBaseUrl: 'https://…', network: 'utexo', … })
 *   const lsp = await wallet.createLsp();  // pubkey + host from GET /get_info
 *   await lsp.connect();
 *   await lsp.waitForChannel(assetId, { … });
 *   const { address } = await lsp.enableLightningAddress();
 *
 * Regtest local demo (this file):
 *   wallet params include lspBaseUrl + enableVirtualChannelsV0 (regtest-only).
 *   createLsp(undefined, LSP_LDK_PORT) — LDK port 9737, not default 9735.
 *   Pubkey fetched once at start for virtualPeerPubkeys (stack restarts rotate identity).
 *   Explicit LspPeer { baseUrl, peerPubkey, peerHost, peerPort } is only needed
 *   when you cannot set lspBaseUrl on the wallet (see lsp-regtest/useLspFlow.ts).
 *
 * Buyer app:
 *   await lsp.connect(); await lsp.waitForChannel(…);
 *   // Deposit outbound balance — the LSP never pushes RGB at open. The buyer
 *   // receives RGB over the channel via lightning_receive (receiveAsset →
 *   // external on-chain send to the LSP → awaitReceiveSettlement). In this
 *   // regtest demo the faucet node plays the external sender.
 *   await lsp.receiveAsset({ assetId, amountSats, amountRgb }); // + on-chain send + settlement
 *   await lsp.waitForOutboundLiquidity(…);
 *   await lsp.payAddress({ address, amtMsat, asset: { assetId, assetAmount } });
 *   // Poll wallet.getLightningSendRequest(paymentHash) until Settled
 *
 * Merchant never calls claimHodlInvoice for APay — LSP outbox + auto-claim handles delivery.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { documentDirectory } from 'expo-file-system/legacy';
import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { mine, sendToAddress } from '@/utils/wallet-flow';
import {
  createWallet,
  PasswordRLNSigner,
  UTEXOWallet,
} from '@utexo/rgb-sdk-rn';

import { faucet, lspDaemon } from '../lsp-regtest/daemons';
import {
  logRgbBalanceDelta,
  logRgbBalanceSnap,
  logSettlementDiagnostics,
  snapshotRgbBalances,
} from './balance';
import {
  ASSET_ID,
  CHANNEL_TIMEOUT_S,
  host,
  LSP_DAEMON_URL,
  LSP_LDK_PORT,
  LSP_URL,
  MERCHANT_KEEPALIVE_MS,
  normHash,
  PAYMENT_ASSET_AMOUNT,
  PAYMENT_MSAT,
  POLL_INTERVAL_MS,
  REGTEST_UNLOCK,
  SETTLE_TIMEOUT_S,
  sleep,
  short,
  type ApayFlowVariant,
  type LogEntry,
  type Phase,
} from './config';

export type UseApayFlowOptions = {
  variant?: ApayFlowVariant;
  storagePrefix?: string;
  merchantPortBase?: number;
  buyerPortBase?: number;
  /** Cart: merchant calls lsp.connect() every 15s during buyer checkout */
  merchantKeepalive?: boolean;
  settlementDiagnostics?: boolean;
  setupScriptHint?: string;
};

export function useApayFlow(options: UseApayFlowOptions = {}) {
  const {
    variant = 'cart',
    storagePrefix = variant === 'cart' ? 'apay_reg' : 'apay',
    merchantPortBase = variant === 'cart' ? 44000 : 40000,
    buyerPortBase = variant === 'cart' ? 46000 : 42000,
    merchantKeepalive = variant === 'cart',
    settlementDiagnostics = variant === 'cart',
    setupScriptHint = variant === 'cart' ? './scripts/start-lsp-local.sh' : './scripts/start-lsp-regtest.sh',
  } = options;

  const logTag = variant === 'cart' ? 'apay-reg' : 'apay';
  const merchantLabel = variant === 'cart' ? 'merchant' : 'userB';
  const buyerLabel = variant === 'cart' ? 'buyer' : 'userA';

  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const [pubkeyB, setPubkeyB] = useState('');
  const [lnaddrUsername, setLnaddrUsername] = useState('');
  const [lnaddrDomain, setLnaddrDomain] = useState('');
  const [lightningAddress, setLightningAddress] = useState('');
  const [hashPoolInfo, setHashPoolInfo] = useState<any>(null);
  const [channelB, setChannelB] = useState<any>(null);
  const [channelA, setChannelA] = useState<any>(null);
  const [hodlBolt11, setHodlBolt11] = useState('');
  const [paymentHash, setPaymentHash] = useState('');
  const [sendStatus, setSendStatus] = useState('');
  const [merchantOnline, setMerchantOnline] = useState(false);
  const [finalBalB, setFinalBalB] = useState<any>(null);

  const walletARef = useRef<UTEXOWallet | null>(null);
  const walletBRef = useRef<UTEXOWallet | null>(null);
  const abortRef = useRef(false);
  const keepaliveActiveRef = useRef(false);

  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
    const time = new Date().toLocaleTimeString('en', { hour12: false });
    setLog(prev => [...prev.slice(-500), { time, msg, type }]);
    console.log(`[${logTag}][${type}] ${msg}`);
  }, [logTag]);

  const run = useCallback(async () => {
    abortRef.current = false;
    keepaliveActiveRef.current = false;
    setLog([]); setErrorMsg('');
    setPubkeyB(''); setLnaddrUsername(''); setLnaddrDomain('');
    setLightningAddress(''); setHashPoolInfo(null);
    setChannelB(null); setChannelA(null);
    setHodlBolt11(''); setPaymentHash(''); setSendStatus('');
    setMerchantOnline(false); setFinalBalB(null);

    const req = (label: string, p?: Record<string, any>) =>
      addLog(`→ ${label}${p ? '  ' + Object.entries(p).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : ''}`);
    const res = (label: string, d?: Record<string, any>) =>
      addLog(`← ${label}${d ? '  ' + Object.entries(d).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : ''}`, 'success');

    try {
      // ── Preflight ──────────────────────────────────────────────────────────
      setPhase('b_init');
      addLog(`Platform=${Platform.OS}  host=${host}`);
      addLog(`LSP_URL=${LSP_URL}`);
      if (!ASSET_ID) throw new Error(`EXPO_PUBLIC_LSP_REGTEST_ASSET_ID not set — run ${setupScriptHint}`);

      // Regtest only: fetch LSP pubkey for virtualPeerPubkeys (identity rotates on stack restart).
      // Utexo/signet: skip — createLsp() loads pubkey from GET /get_info via wallet.lspBaseUrl.
      req('GET /get_info (regtest virtualPeerPubkeys)');
      const lspInfoPre = await fetch(`${LSP_URL}/get_info`).then(r => r.json()) as { pubkey?: string };
      let lspPeerPubkey = lspInfoPre?.pubkey ?? '';
      if (!lspPeerPubkey) {
        const daemonInfo = await fetch(`${LSP_DAEMON_URL}/nodeinfo`).then(r => r.json()) as { pubkey?: string };
        lspPeerPubkey = daemonInfo?.pubkey ?? '';
      }
      if (!lspPeerPubkey) throw new Error('Could not fetch LSP pubkey — is the LSP stack running?');
      res('LSP pubkey', { pubkey: short(lspPeerPubkey) });

      // Regtest demo: 0-conf virtual channels (not used on utexo/signet production LSP).
      const regtestVirtualOpts = {
        enableVirtualChannelsV0: true as const,
        virtualPeerPubkeys: [lspPeerPubkey],
      };

      // ── Merchant wallet (recipient) ────────────────────────────────────────
      const keysB = await createWallet('regtest' as any);
      const portB = merchantPortBase + Math.floor(Math.random() * 2000);
      const dirB = `${documentDirectory ?? ''}${storagePrefix}_b_${Date.now()}`;
      await FileSystem.makeDirectoryAsync(dirB, { intermediates: true });

      const wB = new UTEXOWallet(
        {
          storageDirPath: dirB.replace('file://', ''),
          daemonListeningPort: portB,
          ldkPeerListeningPort: portB + 1,
          network: 'regtest',
          maxMediaUploadSizeMb: 20,
          lspBaseUrl: LSP_URL,
          ...regtestVirtualOpts,
        },
        new PasswordRLNSigner(variant === 'cart' ? 'apayregB' : 'apaypassB', keysB.mnemonic),
      );
      walletBRef.current = wB;
      // createLsp() — same as signet; regtest passes LDK port 9737 (default is 9735)
      const lspB = await wB.createLsp(undefined, LSP_LDK_PORT);
      await wB.init();
      await wB.unlock(REGTEST_UNLOCK);

      const bPubkey = String((await wB.getNodeInfo())?.pubkey ?? '');
      setPubkeyB(bPubkey);
      res(`${merchantLabel}.init`, { pubkey: short(bPubkey) });

      setPhase('b_fund');
      const addrB = await wB.getAddress();
      req(`sendToAddress ${merchantLabel} 1 BTC`);
      await sendToAddress(addrB, 1);
      await mine(6);
      await sleep(3000);
      await wB.syncWallet();
      res(`${merchantLabel}.funded`);

      setPhase('b_utxos');
      req(`${merchantLabel}.createUtxos`);
      await wB.syncWallet();
      await wB.refreshWallet();
      await wB.createUtxos({ upTo: false, num: 10, feeRate: 7 });
      await mine(1);
      await wB.syncWallet();
      res(`${merchantLabel}.createUtxos`);

      // SDK: lsp.connect() → waitForChannel() — same pattern as useLspFlow
      setPhase('b_channel');
      req('lspB.connect');
      await lspB.connect();
      res('lspB.connect');

      addLog('Mining 2 blocks to trigger LSP channel open for merchant…');
      await mine(2);
      await sleep(6000);

      addLog(`Waiting for RGB channel usable (asset: ${short(ASSET_ID)})…`);
      const chanB = await lspB.waitForChannel(ASSET_ID, {
        timeoutMs: CHANNEL_TIMEOUT_S * 1000,
        pollIntervalMs: POLL_INTERVAL_MS,
        onProgress: (msg) => addLog(`merchant ${msg}`),
        onEachPoll: () => mine(1),
      });
      setChannelB(chanB);
      addLog(`Merchant RGB channel usable ✓  cap=${chanB.capacitySat} sat`, 'success');

      logRgbBalanceSnap(
        merchantLabel,
        'START (after channel)',
        await snapshotRgbBalances(wB, ASSET_ID, lspPeerPubkey),
        addLog,
      );

      await wB.syncWallet();
      await mine(2);
      await sleep(5000);

      // SDK: enableLightningAddress() = apayNew + getLightningAddressByPubkey
      setPhase('register');
      req('lspB.connect'); // re-connect before P2P apay (virtual channels may drop TCP)
      await lspB.connect();
      res('lspB.connect');
      await sleep(1000);

      req('lspB.enableLightningAddress');
      const lnAddr = await lspB.enableLightningAddress();
      setLnaddrUsername(lnAddr.username);
      setLnaddrDomain(lnAddr.domain);
      setLightningAddress(lnAddr.address);
      setHashPoolInfo({ address: lnAddr.address, username: lnAddr.username, domain: lnAddr.domain });
      res('enableLightningAddress', { address: lnAddr.address });
      addLog(`Merchant Lightning Address: ${lnAddr.address}`, 'success');

      // Integrator: keep merchant reachable for LSP outbox (request_outbound_invoice)
      if (merchantKeepalive) {
        keepaliveActiveRef.current = true;
        addLog('Merchant keepalive: lsp.connect() every 15s while buyer checks out', 'info');
        (async () => {
          while (keepaliveActiveRef.current && !abortRef.current) {
            await sleep(MERCHANT_KEEPALIVE_MS);
            if (!keepaliveActiveRef.current || abortRef.current) break;
            try { await lspB.connect(); } catch { /* already connected */ }
          }
        })();
      }

      try {
        // ── Buyer wallet (sender) ────────────────────────────────────────────
        setPhase('a_init');

        const keysA = await createWallet('regtest' as any);
        const portA = buyerPortBase + Math.floor(Math.random() * 2000);
        const dirA = `${documentDirectory ?? ''}${storagePrefix}_a_${Date.now()}`;
        await FileSystem.makeDirectoryAsync(dirA, { intermediates: true });

        const wA = new UTEXOWallet(
          {
            storageDirPath: dirA.replace('file://', ''),
            daemonListeningPort: portA,
            ldkPeerListeningPort: portA + 1,
            network: 'regtest',
            maxMediaUploadSizeMb: 20,
            lspBaseUrl: LSP_URL,
            ...regtestVirtualOpts,
          },
          new PasswordRLNSigner(variant === 'cart' ? 'apayregA' : 'apaypassA', keysA.mnemonic),
        );
        walletARef.current = wA;
        const lspA = await wA.createLsp(undefined, LSP_LDK_PORT);
        await wA.init();
        await wA.unlock(REGTEST_UNLOCK);
        res(`${buyerLabel}.init`, { pubkey: short(String((await wA.getNodeInfo())?.pubkey ?? '')) });

        setPhase('a_fund');
        const addrA = await wA.getAddress();
        req(`sendToAddress ${buyerLabel} 1 BTC`);
        await sendToAddress(addrA, 1);
        await mine(6);
        await sleep(3000);
        await wA.syncWallet();
        res(`${buyerLabel}.funded`);

        setPhase('a_utxos');
        req(`${buyerLabel}.createUtxos`);
        await wA.syncWallet();
        await wA.refreshWallet();
        await wA.createUtxos({ upTo: false, num: 10, feeRate: 7 });
        await mine(1);
        await wA.syncWallet();
        res(`${buyerLabel}.createUtxos`);

        setPhase('a_channel');
        req('lspA.connect');
        await lspA.connect();
        res('lspA.connect');

        addLog('Mining 2 blocks to trigger LSP channel open for buyer…');
        await mine(2);
        await sleep(6000);

        const chanA = await lspA.waitForChannel(ASSET_ID, {
          timeoutMs: CHANNEL_TIMEOUT_S * 1000,
          pollIntervalMs: POLL_INTERVAL_MS,
          onProgress: (msg) => addLog(`buyer ${msg}`),
          onEachPoll: () => mine(1),
        });
        setChannelA(chanA);
        addLog('Buyer RGB channel usable ✓', 'success');

        // ── Buyer top-up: deposit RGB via lightning_receive ──────────────────
        // The LSP (origin/main) never pushes RGB at channel open — the buyer starts
        // with 0 local RGB and acquires outbound balance by *receiving* a payment
        // over the channel (production: funded by the buyer's own on-chain RGB;
        // regtest stand-in for the external sender: faucet node).
        setPhase('a_topup');
        req('lspA.receiveAsset', { assetId: short(ASSET_ID), amountSats: PAYMENT_MSAT / 1000, amountRgb: PAYMENT_ASSET_AMOUNT });
        const { lnInvoice: topupInvoice, rgbInvoice: topupRgbInvoice } = await lspA.receiveAsset({
          assetId:    ASSET_ID,
          amountSats: PAYMENT_MSAT / 1000,
          amountRgb:  PAYMENT_ASSET_AMOUNT,
        });
        res('lspA.receiveAsset', { lnInvoice: short(topupInvoice, 32), rgbInvoice: short(topupRgbInvoice, 32) });

        req('faucet.decodergbinvoice');
        const topupDecoded = await faucet.decodeRgbInvoice(topupRgbInvoice);
        const topupRecipientId = topupDecoded.recipient_id;
        const topupEndpoints = topupDecoded.transport_endpoints ?? [`rpc://${host}:3000/json-rpc`];
        const topupAssignment = (topupDecoded.assignment?.type === 'Fungible' && topupDecoded.assignment?.value > 0)
          ? topupDecoded.assignment
          : { type: 'Fungible', value: PAYMENT_ASSET_AMOUNT };
        res('faucet.decodergbinvoice', { recipientId: short(topupRecipientId, 24) });

        req('faucet.sendrgb', { amount: topupAssignment.value, recipientId: short(topupRecipientId, 20) });
        await faucet.sendRgb({
          donation: false, fee_rate: 7, min_confirmations: 1, skip_sync: false,
          recipient_map: {
            [ASSET_ID]: [{ recipient_id: topupRecipientId, assignment: topupAssignment, transport_endpoints: topupEndpoints }],
          },
        });
        res('faucet.sendrgb');

        await mine(1);
        await sleep(2000);
        await lspDaemon.refresh();
        await faucet.refresh();

        addLog('Waiting for faucet Send + LSP receive to settle …');
        const topupDeadline = Date.now() + SETTLE_TIMEOUT_S * 1000;
        let topupSettled = false;
        while (Date.now() < topupDeadline) {
          if (abortRef.current) throw new Error('Cancelled');
          await mine(1);
          await sleep(POLL_INTERVAL_MS);
          try {
            await lspDaemon.refresh();
            await faucet.refresh();
            const faucetTransfers = await faucet.listTransfers(ASSET_ID);
            const lspTransfers    = await lspDaemon.listTransfers(ASSET_ID);
            const faucetSend = [...(faucetTransfers.transfers ?? [])].reverse().find((t: any) => t.kind === 'Send');
            const lspReceive = [...(lspTransfers.transfers    ?? [])].reverse().find((t: any) => t.kind === 'ReceiveBlind');
            addLog(`faucet Send: ${faucetSend?.status ?? 'none'}  LSP receive: ${lspReceive?.status ?? 'none'}`);
            if (faucetSend?.status === 'Failed') throw new Error('Faucet RGB send transfer failed');
            if (faucetSend?.status === 'Settled' && lspReceive?.status === 'Settled') { topupSettled = true; break; }
          } catch (e: any) {
            if ((e?.message ?? '').includes('failed')) throw e;
            console.error(`[${logTag}] topup settle poll:`, e?.message ?? e);
          }
        }
        if (!topupSettled) addLog('RGB delivery settlement timeout — LSP may still be processing');
        else addLog('Faucet Send + LSP receive Settled ✓', 'success');

        addLog('Waiting for buyer top-up LN invoice to settle …');
        let topupLastStatus = '';
        await lspA.awaitReceiveSettlement(topupInvoice, {
          timeoutMs:      SETTLE_TIMEOUT_S * 1000,
          pollIntervalMs: POLL_INTERVAL_MS,
          onProgress: (s) => { topupLastStatus = s; addLog(`${buyerLabel} top-up invoice: ${s}`); },
        });
        // compiled SDK returns 'Succeeded' on both success and timeout — verify via onProgress
        if (topupLastStatus !== 'Succeeded') throw new Error(
          `Buyer top-up did not settle (last status: ${topupLastStatus}) — check LSP RGB inventory and proxy reachability`
        );
        addLog(`Buyer deposited ${PAYMENT_ASSET_AMOUNT} RGB via lightning_receive ✓`, 'success');
        await wA.syncWallet();

        const buyerSnapStart = await snapshotRgbBalances(wA, ASSET_ID, lspPeerPubkey);
        const merchantSnapCheckout = await snapshotRgbBalances(wB, ASSET_ID, lspPeerPubkey);
        logRgbBalanceSnap(buyerLabel, 'START (pre-checkout)', buyerSnapStart, addLog);
        logRgbBalanceSnap(merchantLabel, 'START (pre-checkout)', merchantSnapCheckout, addLog);

        // SDK: confirm buyer can route before payAddress
        req('lspA.waitForOutboundLiquidity', { minMsat: PAYMENT_MSAT });
        await lspA.waitForOutboundLiquidity(PAYMENT_MSAT, {
          timeoutMs: CHANNEL_TIMEOUT_S * 1000,
          pollIntervalMs: POLL_INTERVAL_MS,
          onProgress: (msg) => addLog(msg),
          onEachPoll: () => mine(1),
        });
        res('lspA.waitForOutboundLiquidity');
        addLog('Buyer outbound liquidity ready ✓', 'success');

        let balBefore = Number((await wB.getAssetBalance(ASSET_ID))?.offchainOutbound ?? 0);

        // ── LNURL-pay + HODL payment (resolveAddress + payLightningInvoice) ──
        req('lspB.connect'); // merchant reachable before buyer pays
        await lspB.connect();
        res('lspB.connect');
        await wB.syncWallet();

        if (!lnAddr.address) throw new Error('Lightning Address missing');

        setPhase('send');
        req('lspA.payAddress', { address: lnAddr.address, amtMsat: PAYMENT_MSAT, assetAmount: PAYMENT_ASSET_AMOUNT });
        const { invoice, sendResult: payRes } = await lspA.payAddress({
          address: lnAddr.address,
          amtMsat: PAYMENT_MSAT,
          asset: { assetId: ASSET_ID, assetAmount: PAYMENT_ASSET_AMOUNT },
        });
        if (!invoice) throw new Error('payAddress returned no invoice');
        setHodlBolt11(invoice);
        const pHash = payRes.txid ?? '';
        const payStatus = String(payRes.status ?? '').toLowerCase();
        setPaymentHash(pHash);
        res('payAddress', { invoice: short(invoice, 32), status: payRes.status, paymentHash: short(pHash) });

        if (payStatus === 'failed') {
          throw new Error(
            'payAddress failed — buyer has no spendable RGB on the LSP channel (top-up via lightning_receive may not have settled).',
          );
        }
        if (variant === 'async' && payStatus !== 'pending') {
          addLog(`pay status ${payRes.status} (expected Pending while HTLC held at LSP)`, 'info');
        }
        addLog(
          variant === 'async'
            ? 'HTLC held at LSP — merchant offline (not settled yet)'
            : 'Cart paid — HTLC held at LSP, waiting for outbox…',
          'success',
        );
        await sleep(3000);

        // ── LSP outbox settlement — poll until buyer Settled ─────────────────
        // Integrator: merchant calls lsp.connect() when app foregrounds; no claimHodlInvoice
        setPhase('settle');
        setMerchantOnline(true);
        addLog(
          variant === 'async'
            ? 'Merchant online — lsp.connect() then wait for LSP outbox…'
            : 'Waiting for LSP outbox settlement…',
        );

        req('lspB.connect');
        await lspB.connect();
        res('lspB.connect');
        await wB.syncWallet();
        await wB.refreshWallet();
        await mine(1);
        if (settlementDiagnostics) {
          await logSettlementDiagnostics(wA, wB, pHash, lspPeerPubkey, addLog);
        }

        const deadline = Date.now() + SETTLE_TIMEOUT_S * 1000;
        let settled = false;
        let reconnectEvery = 0;
        let diagEvery = 0;

        while (Date.now() < deadline) {
          if (abortRef.current) throw new Error('Cancelled');
          await sleep(POLL_INTERVAL_MS);
          await mine(1);

          reconnectEvery += POLL_INTERVAL_MS;
          if (reconnectEvery >= MERCHANT_KEEPALIVE_MS) {
            reconnectEvery = 0;
            await lspB.connect(); // integrator: periodic lsp.connect() during settle
            addLog('lspB.connect (settle keepalive)');
          }

          await wA.syncWallet();
          await wB.syncWallet();
          await wB.refreshWallet();

          const status = pHash ? await wA.getLightningSendRequest(pHash) : 'Pending';
          setSendStatus(status ?? 'Pending');
          addLog(`${buyerLabel} getLightningSendRequest: ${status}`);

          let balAfter = balBefore;
          const b1 = await wB.getAssetBalance(ASSET_ID).catch(() => null);
          if (b1) {
            balAfter = Number(b1.offchainOutbound ?? 0);
            setFinalBalB(b1);
            if (settlementDiagnostics) {
              addLog(`merchant offchainOutbound: ${balAfter} (was ${balBefore})`);
            }
          }

          const pays = await wB.listPaymentsRaw().catch(() => []);
          const mp = pays.find(p => normHash(p.paymentHash) === normHash(pHash));
          if (mp) addLog(`${merchantLabel} inbound: ${mp.paymentType}/${mp.status}`, 'info');

          if (settlementDiagnostics) {
            diagEvery += POLL_INTERVAL_MS;
            if (diagEvery >= MERCHANT_KEEPALIVE_MS) {
              diagEvery = 0;
              await logSettlementDiagnostics(wA, wB, pHash, lspPeerPubkey, addLog);
            }
          }

          const merchantOk = mp && ['succeeded', 'claimable'].includes(String(mp.status ?? '').toLowerCase());
          if (status === 'Settled' && balAfter > balBefore) {
            settled = true;
            addLog(`merchant received +${balAfter - balBefore} RGB`, 'success');
            break;
          }
          if (status === 'Settled' && merchantOk) {
            settled = true;
            addLog('buyer Settled + merchant inbound SUCCEEDED — APay complete ✓', 'success');
            break;
          }
          if (status === 'Failed') {
            throw new Error('buyer payment Failed during LSP settlement');
          }
        }

        if (!settled) {
          throw new Error(
            'Timeout — poll getLightningSendRequest until Settled; ensure merchant lsp.connect().',
          );
        }

        addLog('LSP claimed buyer HTLC — checkout complete ✓', 'success');

        const buyerSnapEnd = await snapshotRgbBalances(wA, ASSET_ID, lspPeerPubkey);
        const merchantSnapEnd = await snapshotRgbBalances(wB, ASSET_ID, lspPeerPubkey);
        logRgbBalanceSnap(buyerLabel, 'END (settled)', buyerSnapEnd, addLog);
        logRgbBalanceSnap(merchantLabel, 'END (settled)', merchantSnapEnd, addLog);
        logRgbBalanceDelta(buyerLabel, buyerSnapStart, buyerSnapEnd, addLog);
        logRgbBalanceDelta(merchantLabel, merchantSnapCheckout, merchantSnapEnd, addLog);

        setPhase('done');
      } finally {
        keepaliveActiveRef.current = false;
      }
    } catch (e: any) {
      addLog(`Fatal: ${e?.message ?? String(e)}`, 'error');
      setErrorMsg(e?.message ?? String(e));
      setPhase('error');
    }
  }, [
    addLog,
    buyerPortBase,
    buyerLabel,
    merchantKeepalive,
    merchantLabel,
    merchantPortBase,
    settlementDiagnostics,
    setupScriptHint,
    storagePrefix,
    variant,
  ]);

  const reset = useCallback(async () => {
    abortRef.current = true;
    keepaliveActiveRef.current = false;
    if (walletARef.current) { try { await walletARef.current.destroy(); } catch {} walletARef.current = null; }
    if (walletBRef.current) { try { await walletBRef.current.destroy(); } catch {} walletBRef.current = null; }
    setPhase('idle');
    setLog([]); setErrorMsg('');
    setPubkeyB(''); setLnaddrUsername(''); setLnaddrDomain('');
    setLightningAddress(''); setHashPoolInfo(null);
    setChannelB(null); setChannelA(null);
    setHodlBolt11(''); setPaymentHash('');
    setSendStatus(''); setMerchantOnline(false); setFinalBalB(null);
  }, []);

  const lnAddress = lightningAddress
    || (lnaddrUsername && lnaddrDomain ? `${lnaddrUsername}@${lnaddrDomain}` : '');

  return {
    variant,
    phase,
    log,
    errorMsg,
    run,
    reset,
    pubkeyB,
    lnaddrUsername,
    lnaddrDomain,
    lnAddress,
    hashPoolInfo,
    channelB,
    channelA,
    hodlBolt11,
    paymentHash,
    sendStatus,
    merchantOnline,
    finalBalB,
    envReady: !!ASSET_ID,
    setupScriptHint,
    isRunning: !['idle', 'done', 'error'].includes(phase),
  };
}
