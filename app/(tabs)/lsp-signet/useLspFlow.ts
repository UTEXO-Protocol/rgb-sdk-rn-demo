import * as FileSystem from 'expo-file-system/legacy';
import { documentDirectory } from 'expo-file-system/legacy';
import { useCallback, useRef, useState } from 'react';

import {
  createWallet,
  PasswordRLNSigner,
  UTEXOWallet,
} from '@utexo/rgb-sdk-rn';

import {
  ASSET_TOTAL_SUPPLY, CHANNEL_TIMEOUT_MS, FAUCET_AMOUNT_SAT,
  FAUCET_TOKEN, FAUCET_URL, FUND_TIMEOUT_MS, LSP_URL,
  PAYMENT_ASSET_AMOUNT, PAYMENT_MSAT, POLL_MS,
  satStr,
  SETTLE_TIMEOUT_MS,
  short, sleep,
  UNLOCK,
  type LogEntry, type Phase,
} from './config';

export function useLspFlow() {
  const [phase, setPhase]                   = useState<Phase>('idle');
  const [log,   setLog]                     = useState<LogEntry[]>([]);
  const [lspInfo,        setLspInfo]        = useState<any>(null);
  const [addrA,          setAddrA]          = useState('');
  const [addrB,          setAddrB]          = useState('');
  const [balA,           setBalA]           = useState<any>(null);
  const [balB,           setBalB]           = useState<any>(null);
  const [assetInfo,      setAssetInfo]      = useState<any>(null);
  const [channelA,       setChannelA]       = useState<any>(null);
  const [channelB,       setChannelB]       = useState<any>(null);
  const [lnInvoiceA,     setLnInvoiceA]     = useState('');
  const [rgbInvoiceLsp,  setRgbInvoiceLsp]  = useState('');
  const [invoiceStatus,  setInvoiceStatus]  = useState('');
  const [lnInvoiceB,     setLnInvoiceB]     = useState('');
  const [invoiceStatusB, setInvoiceStatusB] = useState('');
  const [finalBalA,      setFinalBalA]      = useState<any>(null);
  const [finalBalB,      setFinalBalB]      = useState<any>(null);
  const [errorMsg,       setErrorMsg]       = useState('');

  const walletARef = useRef<UTEXOWallet | null>(null);
  const walletBRef = useRef<UTEXOWallet | null>(null);
  const abortRef   = useRef(false);

  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
    const time = new Date().toLocaleTimeString('en', { hour12: false });
    setLog(prev => [...prev.slice(-400), { time, msg, type }]);
    console.log(`[lsp-signet][${type}] ${msg}`);
  }, []);

  const run = useCallback(async () => {
    abortRef.current = false;
    setLog([]); setLspInfo(null);
    setAddrA(''); setAddrB(''); setBalA(null); setBalB(null);
    setAssetInfo(null); setChannelA(null); setChannelB(null);
    setLnInvoiceA(''); setRgbInvoiceLsp(''); setInvoiceStatus('');
    setLnInvoiceB(''); setInvoiceStatusB(''); setFinalBalA(null); setFinalBalB(null);
    setErrorMsg('');
    setPhase('init');

    const req = (label: string, p?: Record<string, any>) =>
      addLog(`→ ${label}${p ? '  ' + Object.entries(p).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : ''}`);
    const res = (label: string, d?: Record<string, any>) =>
      addLog(`← ${label}${d ? '  ' + Object.entries(d).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : ''}`, 'success');

    try {
      // ── Health probe ──────────────────────────────────────────────────────
      addLog(`LSP_URL = ${LSP_URL}`);
      try {
        const probe = await fetch(`${LSP_URL}/health`);
        addLog(`LSP health: ${probe.status}`, probe.ok ? 'success' : 'error');
      } catch (e: any) {
        addLog(`LSP health error: ${e?.message ?? String(e)}`, 'error');
      }

      // ── Init Node A + Node B ──────────────────────────────────────────────
      req('createWallet nodeA');
      const keysA = await createWallet('signet' as any);
      res('createWallet nodeA', { fingerprint: keysA.masterFingerprint });

      req('createWallet nodeB');
      const keysB = await createWallet('signet' as any);
      res('createWallet nodeB', { fingerprint: keysB.masterFingerprint });

      const ts    = Date.now();
      const portA = 33000 + Math.floor(Math.random() * 2000);
      const portB = portA + 100;

      const mkDir = async (name: string) => {
        const uri = `${documentDirectory ?? ''}lsp_sig_${name}_${ts}`;
        await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
        return uri.replace('file://', '');
      };

      // Both wallets get lspBaseUrl — required for no-arg createLsp()
      const wA = new UTEXOWallet(
        { storageDirPath: await mkDir('a'), daemonListeningPort: portA, ldkPeerListeningPort: portA + 1,
          network: 'signet', maxMediaUploadSizeMb: 20, lspBaseUrl: LSP_URL,
          xpubVan: keysA.accountXpubVanilla, xpubCol: keysA.accountXpubColored, masterFingerprint: keysA.masterFingerprint },
        new PasswordRLNSigner('password', keysA.mnemonic),
      );
      const wB = new UTEXOWallet(
        { storageDirPath: await mkDir('b'), daemonListeningPort: portB, ldkPeerListeningPort: portB + 1,
          network: 'signet', maxMediaUploadSizeMb: 20, lspBaseUrl: LSP_URL,
          xpubVan: keysB.accountXpubVanilla, xpubCol: keysB.accountXpubColored, masterFingerprint: keysB.masterFingerprint },
        new PasswordRLNSigner('password', keysB.mnemonic),
      );
      walletARef.current = wA;
      walletBRef.current = wB;

      for (const [w, label] of [[wA, 'nodeA'], [wB, 'nodeB']] as [UTEXOWallet, string][]) {
        req(`${label}.init`); await w.init(); res(`${label}.init`);
        req(`${label}.unlock`); await w.unlock(UNLOCK); res(`${label}.unlock`);
      }

      // Discover LSP peer from lspBaseUrl — pubkey from GET /get_info, host from URL
      const lspA = await wA.createLsp();
      const lspB = await wB.createLsp();

      req('lsp.getInfo');
      const info = await lspA.http.getInfo();
      setLspInfo(info);
      res('lsp.getInfo', { pubkey: short(info.pubkey), channels: info.numChannels, usable: info.numUsableChannels });

      req('nodeA.getAddress'); const adA = await wA.getAddress(); setAddrA(adA); res('nodeA.getAddress', { address: adA });
      req('nodeB.getAddress'); const adB = await wB.getAddress(); setAddrB(adB); res('nodeB.getAddress', { address: adB });

      // ── Fund both via thunderstack faucet ─────────────────────────────────
      setPhase('fund');

      for (const [address, label] of [[adA, 'nodeA'], [adB, 'nodeB']] as [string, string][]) {
        addLog(`Faucet → ${label} (${FAUCET_AMOUNT_SAT} sat)`);
        try {
          const r = await fetch(FAUCET_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${FAUCET_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: FAUCET_AMOUNT_SAT, address, fee_rate: 5, skip_sync: false }),
            signal: (AbortSignal as any).timeout?.(30_000),
          });
          if (r.ok) addLog(`Faucet ${label} ok`, 'success');
          else addLog(`Faucet ${label} ${r.status} — continuing`);
        } catch (e: any) {
          addLog(`Faucet ${label} timeout — continuing`);
        }
        await sleep(3_000);
      }

      addLog('Polling for confirmed balance on both nodes …');
      let stA = 0, stB = 0;
      const fundDeadline = Date.now() + FUND_TIMEOUT_MS;
      while (Date.now() < fundDeadline) {
        if (abortRef.current) throw new Error('Cancelled');
        await sleep(POLL_MS);
        try {
          if (stA === 0) { await wA.syncWallet(); const b = await wA.getBtcBalance() as any; setBalA(b); stA = (b?.vanilla?.settled ?? 0) + (b?.colored?.settled ?? 0); addLog(`nodeA settled: ${satStr(stA)}`); }
          if (stB === 0) { await wB.syncWallet(); const b = await wB.getBtcBalance() as any; setBalB(b); stB = (b?.vanilla?.settled ?? 0) + (b?.colored?.settled ?? 0); addLog(`nodeB settled: ${satStr(stB)}`); }
          if (stA > 0 && stB > 0) break;
        } catch (e: any) { console.error('[lsp-signet] fund poll', e?.message ?? e); }
      }
      if (stA === 0 || stB === 0) throw new Error(`Timed out waiting for funds — A:${satStr(stA)} B:${satStr(stB)}`);
      addLog(`Both funded ✓  A:${satStr(stA)}  B:${satStr(stB)}`, 'success');

      // ── Create UTXOs ──────────────────────────────────────────────────────
      setPhase('utxos');
      for (const [w, label] of [[wA, 'nodeA'], [wB, 'nodeB']] as [UTEXOWallet, string][]) {
        req(`${label}.syncWallet`); await w.syncWallet(); res(`${label}.syncWallet`);
        req(`${label}.refreshWallet`); await w.refreshWallet(); res(`${label}.refreshWallet`);
        req(`${label}.createUtxos`, { num: 5, feeRate: 2 });
        await w.createUtxos({ upTo: false, num: 5, feeRate: 2 });
        res(`${label}.createUtxos`);
      }

      addLog('Waiting for UTXO txs to confirm …');
      const utxoDeadline = Date.now() + FUND_TIMEOUT_MS;
      let confA = false, confB = false;
      while (Date.now() < utxoDeadline) {
        if (abortRef.current) throw new Error('Cancelled');
        await sleep(POLL_MS);
        try {
          if (!confA) { await wA.syncWallet(); const b = await wA.getBtcBalance() as any; setBalA(b); const sp = (b?.vanilla?.spendable ?? 0) + (b?.colored?.spendable ?? 0); if (sp > 0 && sp < stA) { confA = true; addLog('nodeA UTXOs confirmed', 'success'); } }
          if (!confB) { await wB.syncWallet(); const b = await wB.getBtcBalance() as any; setBalB(b); const sp = (b?.vanilla?.spendable ?? 0) + (b?.colored?.spendable ?? 0); if (sp > 0 && sp < stB) { confB = true; addLog('nodeB UTXOs confirmed', 'success'); } }
          if (confA && confB) break;
        } catch (e: any) { console.error('[lsp-signet] utxo poll', e?.message ?? e); }
      }

      // ── Node B issues RGB asset ───────────────────────────────────────────
      setPhase('asset');
      req('nodeB.issueAssetNia', { ticker: 'UTST', supply: ASSET_TOTAL_SUPPLY });
      const asset   = await wB.issueAssetNia({ ticker: 'UTST', name: 'UTEXO LSP Test', precision: 0, amounts: [ASSET_TOTAL_SUPPLY] });
      const assetId = String(asset?.assetId ?? '');
      if (!assetId) throw new Error('issueAssetNia returned no assetId');
      setAssetInfo(asset);
      res('nodeB.issueAssetNia', { assetId: short(assetId), supply: asset?.issuedSupply });

      // ── Node A connects to LSP → wait for RGB channel ─────────────────────
      // Signet: no onEachPoll — blocks arrive naturally.
      // Both channels opened before lightning_receive flow (mirrors regtest conftest).
      setPhase('channel');

      req('lspA.connect');
      await lspA.connect();
      res('lspA.connect');

      addLog(`Waiting for LSP → Node A RGB channel (asset: ${short(assetId)}) …`);
      const chanA = await lspA.waitForChannel(assetId, {
        timeoutMs:      CHANNEL_TIMEOUT_MS,
        pollIntervalMs: POLL_MS,
        onProgress:     (msg) => addLog(`nodeA ${msg}`),
      });
      setChannelA(chanA);
      addLog(`Node A RGB channel usable ✓  cap=${chanA.capacitySat} sat`, 'success');

      // ── Node B connects to LSP → wait for RGB channel ─────────────────────
      setPhase('b_channel');

      req('lspB.connect');
      await lspB.connect();
      res('lspB.connect');

      addLog('Waiting for LSP → Node B RGB channel …');
      const chanB = await lspB.waitForChannel(assetId, {
        timeoutMs:      CHANNEL_TIMEOUT_MS,
        pollIntervalMs: POLL_MS,
        onProgress:     (msg) => addLog(`nodeB ${msg}`),
      });
      setChannelB(chanB);
      addLog('Node B RGB channel usable ✓', 'success');

      await wA.syncWallet();
      await wB.syncWallet();

      // ── lightning_receive: Node A receives RGB over Lightning ──────────────
      setPhase('lsp_flow');

      req('lspA.receiveAsset', { assetId: short(assetId), amountSats: PAYMENT_MSAT / 1000, amountRgb: PAYMENT_ASSET_AMOUNT });
      const { lnInvoice: aInvoice, rgbInvoice } = await lspA.receiveAsset({
        assetId,
        amountSats: PAYMENT_MSAT / 1000,
        amountRgb:  PAYMENT_ASSET_AMOUNT,
      });
      setLnInvoiceA(aInvoice);
      setRgbInvoiceLsp(rgbInvoice);
      res('lspA.receiveAsset', { lnInvoice: short(aInvoice, 32), rgbInvoice: short(rgbInvoice, 32) });

      // ── Node B sends RGB on-chain to LSP's RGB invoice ────────────────────
      setPhase('rgb_send');

      req('nodeB.onchainSend', { amount: PAYMENT_ASSET_AMOUNT, feeRate: 2 });
      await wB.onchainSend({ invoice: rgbInvoice, amount: PAYMENT_ASSET_AMOUNT, feeRate: 2, minConfirmations: 1, skipSync: false });
      res('nodeB.onchainSend');
      addLog(`Node B sent ${PAYMENT_ASSET_AMOUNT} ${asset?.ticker} to LSP`, 'success');

      // ── Poll Node B Send transfer until Settled ───────────────────────────
      setPhase('settle');
      addLog('Polling Node B Send transfer to settle …');
      const sendDeadline = Date.now() + SETTLE_TIMEOUT_MS;
      let rgbSettled = false;
      while (Date.now() < sendDeadline) {
        if (abortRef.current) throw new Error('Cancelled');
        await sleep(POLL_MS);
        try {
          await wB.syncWallet();
          await wB.refreshWallet();
          const transfers = await wB.listOnchainTransfers(assetId);
          const latest    = [...(transfers ?? [])].reverse().find((t: any) => t.kind === 'Send');
          addLog(`nodeB Send: ${latest?.status ?? 'none'}`);
          if (latest?.status === 'Settled') { rgbSettled = true; break; }
          if (latest?.status === 'Failed') throw new Error('Node B RGB send failed');
        } catch (e: any) { if ((e?.message ?? '').includes('failed')) throw e; console.error('[lsp-signet] rgb poll', e?.message ?? e); }
      }
      if (!rgbSettled) addLog('RGB settlement timeout — LSP may still be processing');
      else addLog('Node B RGB send settled ✓', 'success');

      // ── Wait for Node A LN invoice to settle ──────────────────────────────
      addLog('Waiting for Node A LN invoice to settle …');
      setInvoiceStatus('Pending');
      await lspA.awaitReceiveSettlement(aInvoice, {
        timeoutMs:      SETTLE_TIMEOUT_MS,
        pollIntervalMs: POLL_MS,
        onProgress:     (s) => { setInvoiceStatus(s); addLog(`nodeA invoice: ${s}`); },
      });
      addLog('Node A LN invoice Settled ✓ — LSP paid via RGB channel!', 'success');

      try {
        await wA.syncWallet();
        const bal = await wA.getAssetBalance(assetId);
        setFinalBalA(bal);
        addLog(`nodeA asset balance: settled=${bal?.settled ?? 0} offchainInbound=${bal?.offchainInbound ?? 0}`, 'success');
      } catch {}

      // ── Part 2: Node A pays Node B ────────────────────────────────────────
      addLog('── Part 2: Node A → Node B payment ──');

      addLog('Waiting for Node A outbound RGB balance to cover payment …');
      await lspA.waitForOutboundLiquidity(PAYMENT_MSAT, {
        timeoutMs:      CHANNEL_TIMEOUT_MS,
        pollIntervalMs: POLL_MS,
        onProgress:     (msg) => addLog(msg),
      });
      addLog('Node A outbound balance ready ✓', 'success');

      await wA.syncWallet();
      await wB.syncWallet();

      setPhase('p2_pay');

      req('nodeB.createLightningInvoice', { amtMsat: PAYMENT_MSAT, assetId: short(assetId), assetAmount: PAYMENT_ASSET_AMOUNT });
      const { lnInvoice: bInvoice } = await wB.createLightningInvoice({
        amountSats:    PAYMENT_MSAT / 1000,
        expirySeconds: 3_600,
        asset: { assetId, amount: PAYMENT_ASSET_AMOUNT },
      });
      setLnInvoiceB(bInvoice);
      res('nodeB.createLightningInvoice', { invoice: short(bInvoice, 32) });

      req('nodeA.payLightningInvoice → nodeB');
      const payResult = await wA.payLightningInvoice({ lnInvoice: bInvoice });
      const payStatus = String((payResult as any)?.status ?? '').toLowerCase();
      res('nodeA.payLightningInvoice', { status: (payResult as any)?.status ?? 'sent' });
      if (payStatus === 'failed') throw new Error('nodeA.payLightningInvoice failed — check channel balance and route');

      setPhase('p2_settle');
      addLog('Waiting for Node B invoice to settle …');
      setInvoiceStatusB('Pending');
      await lspB.awaitReceiveSettlement(bInvoice, {
        timeoutMs:      SETTLE_TIMEOUT_MS,
        pollIntervalMs: POLL_MS,
        onProgress:     (s) => { setInvoiceStatusB(s); addLog(`nodeB invoice: ${s}`); },
      });
      addLog('Node B LN invoice Settled ✓ — Node A paid Node B via RGB Lightning!', 'success');

      try {
        await wB.syncWallet();
        const bal = await wB.getAssetBalance(assetId);
        setFinalBalB(bal);
        addLog(`nodeB asset balance: offchainInbound=${bal?.offchainInbound ?? 0}`, 'success');
      } catch {}

      setPhase('done');

    } catch (e: any) {
      const msg = e?.message ?? String(e);
      addLog(`Fatal: ${msg}`, 'error');
      setErrorMsg(msg);
      setPhase('error');
    }
  }, [addLog]);

  const reset = useCallback(async () => {
    abortRef.current = true;
    if (walletARef.current) { try { await walletARef.current.destroy(); } catch {} walletARef.current = null; }
    if (walletBRef.current) { try { await walletBRef.current.destroy(); } catch {} walletBRef.current = null; }
    setPhase('idle'); setLog([]); setLspInfo(null);
    setAddrA(''); setAddrB(''); setBalA(null); setBalB(null);
    setAssetInfo(null); setChannelA(null); setChannelB(null);
    setLnInvoiceA(''); setRgbInvoiceLsp(''); setInvoiceStatus('');
    setLnInvoiceB(''); setInvoiceStatusB(''); setFinalBalA(null); setFinalBalB(null);
    setErrorMsg('');
  }, []);

  return {
    phase, log, lspInfo,
    addrA, addrB, balA, balB,
    assetInfo, channelA, channelB,
    lnInvoiceA, rgbInvoiceLsp, invoiceStatus, finalBalA,
    lnInvoiceB, invoiceStatusB, finalBalB,
    errorMsg,
    run, reset,
  };
}
