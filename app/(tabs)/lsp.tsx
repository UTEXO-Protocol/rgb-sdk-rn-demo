/**
 * LSP tab — lightning_receive flow on UTEXO signet
 *
 * Two embedded SDK nodes + utexo-lsp at lsp-signet.utexo.com:
 *   Node A (recipient): creates LN invoice → gets RGB invoice from LSP
 *   Node B (sender):    issues RGB asset → sends RGB to LSP's address
 *   LSP:                RGB settles → pays Node A's LN invoice
 *
 * Funded via thunderstack faucet (16,900 sat each).
 * No mining — polls for confirmations.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { documentDirectory } from 'expo-file-system/legacy';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  createWallet,
  PasswordRLNSigner,
  UTEXOWallet,
  UtexoLSPClient,
} from '@utexo/rgb-sdk-rn';
import { AppColors } from '@/constants/theme';

// ── Config ────────────────────────────────────────────────────────────────────

const LSP_URL     = process.env.EXPO_PUBLIC_LSP_URL?.trim()            || 'https://lsp-signet.utexo.com';
const FAUCET_URL  = process.env.EXPO_PUBLIC_FAUCET_URL?.trim()         || '';
const FAUCET_TOKEN= process.env.EXPO_PUBLIC_FAUCET_BEARER_TOKEN?.trim()|| '';

const UNLOCK = {
  bitcoindRpcUsername: process.env.EXPO_PUBLIC_UTEXO_BITCOIND_RPC_USERNAME?.trim() || '',
  bitcoindRpcPassword: process.env.EXPO_PUBLIC_UTEXO_BITCOIND_RPC_PASSWORD?.trim() || '',
  bitcoindRpcHost:     process.env.EXPO_PUBLIC_UTEXO_BITCOIND_RPC_HOST?.trim()     || '',
  bitcoindRpcPort:     Number(process.env.EXPO_PUBLIC_UTEXO_BITCOIND_RPC_PORT?.trim() || '38332'),
  indexerUrl:          process.env.EXPO_PUBLIC_UTEXO_INDEXER_URL?.trim()            || 'https://esplora-api.utexo.com',
  proxyEndpoint:       process.env.EXPO_PUBLIC_UTEXO_PROXY_ENDPOINT?.trim()         || 'rpcs://rgb-proxy-utexo.utexo.com/json-rpc',
  announceAddresses:   [] as string[],
  announceAlias:       null as string | null,
};

const PAYMENT_MSAT         = 3_000_000;
const PAYMENT_ASSET_AMOUNT = 100;
const FAUCET_PAY_AMOUNT    = 100;
const ASSET_TOTAL_SUPPLY   = 1000;
const FAUCET_AMOUNT_SAT    = 16_900;

const POLL_MS          = 20_000;
const FUND_TIMEOUT_MS  = 15 * 60 * 1000;
const SETTLE_TIMEOUT_MS= 30 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase =
  | 'idle' | 'init' | 'fund' | 'utxos' | 'asset'
  | 'lsp_setup' | 'rgb_send' | 'settle' | 'done' | 'error';

interface LogEntry { time: string; msg: string; type: 'info' | 'success' | 'error' }

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const satStr = (n: number) => n === 0 ? '0 sat' : `${(n / 1e8).toFixed(8)} BTC`;
const short = (s: string, n = 24) => (s || '').slice(0, n) + ((s || '').length > n ? '…' : '');

// ── Sub-components ────────────────────────────────────────────────────────────

const PHASES: Phase[] = ['init','fund','utxos','asset','lsp_setup','rgb_send','settle','done'];
const PHASE_LABELS: Record<string,string> = {
  init:'Init', fund:'Fund', utxos:'UTXOs', asset:'Asset',
  lsp_setup:'LSP', rgb_send:'Send', settle:'Settle', done:'Done',
};

function PhaseBar({ phase }: { phase: Phase }) {
  const idx = PHASES.indexOf(phase);
  return (
    <View style={pb.row}>
      {PHASES.map((s, i) => {
        const done = idx > i;
        const active = idx === i;
        const err = phase === 'error' && active;
        const color = err ? AppColors.error : done ? AppColors.success : active ? AppColors.primary : AppColors.textTertiary;
        return (
          <React.Fragment key={s}>
            <View style={pb.step}>
              <View style={[pb.dot, { borderColor: color, backgroundColor: active ? color + '20' : 'transparent' }]}>
                {active && phase !== 'error'
                  ? <ActivityIndicator size={8} color={color} />
                  : <Text style={[pb.dotText, { color }]}>{done ? '✓' : err ? '✗' : i + 1}</Text>}
              </View>
              <Text style={[pb.label, { color }]}>{PHASE_LABELS[s]}</Text>
            </View>
            {i < PHASES.length - 1 && (
              <View style={[pb.line, { backgroundColor: done ? AppColors.success + '60' : AppColors.border }]} />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

function InfoCard({ title, rows, accent }: { title: string; rows: [string,string][]; accent?: string }) {
  return (
    <View style={[ic.card, accent ? { borderColor: accent + '60' } : undefined]}>
      <Text style={[ic.title, accent ? { color: accent } : undefined]}>{title}</Text>
      {rows.map(([k,v],i) => (
        <View key={i} style={ic.row}>
          <Text style={ic.key}>{k}</Text>
          <Text selectable style={ic.val}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

function LogPane({ entries }: { entries: LogEntry[] }) {
  return (
    <View style={lp.box}>
      <Text style={lp.header}>Console</Text>
      {entries.length === 0
        ? <Text style={lp.empty}>No output yet</Text>
        : entries.map((e,i) => (
          <Text key={i} style={[lp.entry,
            e.type === 'success' && { color: AppColors.success },
            e.type === 'error'   && { color: AppColors.error },
          ]}>
            {e.time}  {e.msg}
          </Text>
        ))}
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function LspScreen() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [lspInfo, setLspInfo]           = useState<any>(null);
  const [addrA, setAddrA]               = useState('');
  const [addrB, setAddrB]               = useState('');
  const [balA, setBalA]                 = useState<any>(null);
  const [balB, setBalB]                 = useState<any>(null);
  const [assetInfo, setAssetInfo]       = useState<any>(null);
  const [lnInvoiceA, setLnInvoiceA]     = useState('');
  const [rgbInvoiceLsp, setRgbInvoiceLsp]= useState('');
  const [invoiceStatus, setInvoiceStatus]= useState('');
  const [errorMsg, setErrorMsg]         = useState('');

  const walletARef = useRef<UTEXOWallet | null>(null);
  const walletBRef = useRef<UTEXOWallet | null>(null);
  const abortRef   = useRef(false);

  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
    const time = new Date().toLocaleTimeString('en', { hour12: false });
    setLog(prev => [...prev.slice(-400), { time, msg, type }]);
    console.log(`[lsp][${type}] ${msg}`);
  }, []);

  const run = useCallback(async () => {
    abortRef.current = false;
    setLog([]); setLspInfo(null);
    setAddrA(''); setAddrB('');
    setBalA(null); setBalB(null);
    setAssetInfo(null); setLnInvoiceA(''); setRgbInvoiceLsp('');
    setInvoiceStatus(''); setErrorMsg('');
    setPhase('init');

    const req = (label: string, p?: Record<string,any>) =>
      addLog(`→ ${label}${p ? '  '+Object.entries(p).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join(' ') : ''}`);
    const res = (label: string, d?: Record<string,any>) =>
      addLog(`← ${label}${d ? '  '+Object.entries(d).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join(' ') : ''}`, 'success');

    try {
      // ── diagnostic: log resolved config values ─────────────────────────────
      addLog(`LSP_URL = ${LSP_URL}`);
      addLog(`UtexoLSPClient type = ${typeof UtexoLSPClient}`);

      // ── diagnostic: raw fetch to confirm network works ─────────────────────
      addLog('raw fetch test → https://lsp-signet.utexo.com/health');
      try {
        const probe = await fetch('https://lsp-signet.utexo.com/health');
        addLog(`raw fetch status = ${probe.status} ok=${probe.ok}`, probe.ok ? 'success' : 'error');
      } catch (fetchErr: any) {
        addLog(`raw fetch error: ${fetchErr?.message ?? String(fetchErr)}`, 'error');
        addLog(`typeof fetch = ${typeof fetch}`);
      }

      const lsp = new UtexoLSPClient({ baseUrl: LSP_URL });
      addLog(`lsp instance created: ${typeof lsp}`);

      // ── 1. LSP connectivity ────────────────────────────────────────────────
      req('lsp.getInfo');
      const info = await lsp.getInfo();
      setLspInfo(info);
      res('lsp.getInfo', { pubkey: short(info.pubkey), channels: info.num_channels, usable: info.num_usable_channels });

      // ── 2. Create Node A and Node B ────────────────────────────────────────
      req('createWallet nodeA (recipient)');
      const keysA = await createWallet('signet' as any);
      res('createWallet nodeA', { fingerprint: keysA.masterFingerprint });

      req('createWallet nodeB (RGB sender)');
      const keysB = await createWallet('signet' as any);
      res('createWallet nodeB', { fingerprint: keysB.masterFingerprint });

      const ts = Date.now();
      const portA = 33000 + Math.floor(Math.random() * 2000);
      const portB = portA + 100;

      const mkDir = async (name: string) => {
        const uri = `${documentDirectory ?? ''}lsp_${name}_${ts}`;
        await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
        return uri.replace('file://', '');
      };

      const wA = new UTEXOWallet(
        { storageDirPath: await mkDir('a'), daemonListeningPort: portA, ldkPeerListeningPort: portA + 1,
          network: 'signet', maxMediaUploadSizeMb: 20, lspBaseUrl: LSP_URL,
          xpubVan: keysA.accountXpubVanilla, xpubCol: keysA.accountXpubColored, masterFingerprint: keysA.masterFingerprint },
        new PasswordRLNSigner('passA', keysA.mnemonic),
      );
      const wB = new UTEXOWallet(
        { storageDirPath: await mkDir('b'), daemonListeningPort: portB, ldkPeerListeningPort: portB + 1,
          network: 'signet', maxMediaUploadSizeMb: 20,
          xpubVan: keysB.accountXpubVanilla, xpubCol: keysB.accountXpubColored, masterFingerprint: keysB.masterFingerprint },
        new PasswordRLNSigner('passB', keysB.mnemonic),
      );
      walletARef.current = wA;
      walletBRef.current = wB;

      for (const [w, label] of [[wA,'nodeA'],[wB,'nodeB']] as [UTEXOWallet,string][]) {
        req(`${label}.init`); await w.init(); res(`${label}.init`);
        req(`${label}.unlock`); await w.unlock(UNLOCK); res(`${label}.unlock`);
      }

      req('nodeA.getAddress'); const adA = await wA.getAddress(); setAddrA(adA); res('nodeA.getAddress', { address: adA });
      req('nodeB.getAddress'); const adB = await wB.getAddress(); setAddrB(adB); res('nodeB.getAddress', { address: adB });

      // ── 3. Fund both via faucet ────────────────────────────────────────────
      setPhase('fund');

      for (const [address, label] of [[adA,'nodeA'],[adB,'nodeB']] as [string,string][]) {
        addLog(`Faucet → ${label} (${FAUCET_AMOUNT_SAT} sat)`);
        try {
          const r = await fetch(FAUCET_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${FAUCET_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: FAUCET_AMOUNT_SAT, address, fee_rate: 5, skip_sync: false }),
            signal: (AbortSignal as any).timeout?.(30_000),
          });
          const body = await r.text();
          if (r.ok) addLog(`Faucet ${label} ok: ${body.slice(0,60)}`, 'success');
          else { console.error(`[lsp] faucet ${label}`, r.status, body); addLog(`Faucet ${label} ${r.status} — continuing`); }
        } catch (e: any) {
          console.error(`[lsp] faucet ${label}`, e?.message ?? e);
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
          if (stA === 0) { await wA.syncWallet(); const b = await wA.getBtcBalance() as any; setBalA(b); stA=(b?.vanilla?.settled??0)+(b?.colored?.settled??0); addLog(`nodeA settled: ${satStr(stA)}`); }
          if (stB === 0) { await wB.syncWallet(); const b = await wB.getBtcBalance() as any; setBalB(b); stB=(b?.vanilla?.settled??0)+(b?.colored?.settled??0); addLog(`nodeB settled: ${satStr(stB)}`); }
          if (stA > 0 && stB > 0) break;
        } catch (e: any) { console.error('[lsp] fund poll', e?.message ?? e); }
      }
      if (stA === 0 || stB === 0) throw new Error(`Timed out waiting for funds — A:${satStr(stA)} B:${satStr(stB)}`);
      addLog(`Both funded ✓  A:${satStr(stA)}  B:${satStr(stB)}`, 'success');

      // ── 4. Create UTXOs ────────────────────────────────────────────────────
      setPhase('utxos');
      for (const [w, label] of [[wA,'nodeA'],[wB,'nodeB']] as [UTEXOWallet,string][]) {
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
          if (!confA) { await wA.syncWallet(); const b=await wA.getBtcBalance() as any; setBalA(b); if(((b?.vanilla?.spendable??0)+(b?.colored?.spendable??0))>0&&((b?.vanilla?.spendable??0)+(b?.colored?.spendable??0))<stA){confA=true;addLog('nodeA UTXOs confirmed','success');} }
          if (!confB) { await wB.syncWallet(); const b=await wB.getBtcBalance() as any; setBalB(b); if(((b?.vanilla?.spendable??0)+(b?.colored?.spendable??0))>0&&((b?.vanilla?.spendable??0)+(b?.colored?.spendable??0))<stB){confB=true;addLog('nodeB UTXOs confirmed','success');} }
          if (confA && confB) break;
        } catch (e: any) { console.error('[lsp] utxo poll', e?.message ?? e); }
      }

      // ── 5. Issue RGB asset on Node B ───────────────────────────────────────
      setPhase('asset');
      req('nodeB.issueAssetNia', { ticker: 'UTST', supply: ASSET_TOTAL_SUPPLY });
      const asset = await wB.issueAssetNia({ ticker: 'UTST', name: 'UTEXO LSP Test', precision: 0, amounts: [ASSET_TOTAL_SUPPLY] });
      const assetId = String(asset?.assetId ?? '');
      if (!assetId) throw new Error('issueAssetNia returned no assetId');
      setAssetInfo(asset);
      res('nodeB.issueAssetNia', { assetId: short(assetId), supply: asset?.issuedSupply });

      // ── 6. Node A creates LN invoice → lightningReceive ────────────────────
      setPhase('lsp_setup');

      req('nodeA.createLightningInvoice', { amtMsat: PAYMENT_MSAT, assetAmount: PAYMENT_ASSET_AMOUNT });
      const invResult = await wA.createLightningInvoice({
        amountSats: PAYMENT_MSAT / 1000,
        expirySeconds: 3600,
        asset: { assetId, amount: PAYMENT_ASSET_AMOUNT },
      });
      const aInvoice = invResult.lnInvoice;
      setLnInvoiceA(aInvoice);
      res('nodeA.createLightningInvoice', { invoice: short(aInvoice, 32) });

      req('lsp.lightningReceive', { assetId: short(assetId) });
      const lr = await lsp.lightningReceive({ lnInvoice: aInvoice, rgb: { assetId, durationSeconds: 3600 } });
      const rgbInvoice = lr.rgbInvoice;
      setRgbInvoiceLsp(rgbInvoice);
      res('lsp.lightningReceive', { rgbInvoice: short(rgbInvoice, 32), mappingId: lr.mappingId });

      // ── 7. Node B sends RGB to LSP's address ──────────────────────────────
      setPhase('rgb_send');

      req('nodeB.onchainSend', { amount: FAUCET_PAY_AMOUNT, feeRate: 7 });
      await wB.onchainSend({ invoice: rgbInvoice, amount: FAUCET_PAY_AMOUNT, feeRate: 7, minConfirmations: 1, skipSync: false });
      res('nodeB.onchainSend');
      addLog(`Node B sent ${FAUCET_PAY_AMOUNT} ${asset?.ticker} to LSP`, 'success');

      // ── 8. Poll for RGB send settled on Node B ─────────────────────────────
      setPhase('settle');
      addLog('Polling Node B Send transfer to settle …');
      const sendDeadline = Date.now() + SETTLE_TIMEOUT_MS;
      let rgbSettled = false;
      while (Date.now() < sendDeadline) {
        if (abortRef.current) throw new Error('Cancelled');
        await sleep(POLL_MS);
        try {
          await wB.syncWallet(); await wB.refreshWallet();
          const transfers = await wB.listOnchainTransfers(assetId);
          const latest = [...(transfers??[])].reverse().find((t:any)=>t.kind==='Send');
          addLog(`nodeB Send: ${latest?.status ?? 'none'}`);
          if (latest?.status === 'Settled') { rgbSettled = true; break; }
          if (latest?.status === 'Failed') throw new Error('Node B RGB send failed');
        } catch (e: any) { if ((e?.message??'').includes('failed')) throw e; console.error('[lsp] rgb poll', e?.message??e); }
      }
      if (!rgbSettled) addLog('RGB settlement timeout — LSP may still process');
      else addLog('Node B RGB send settled ✓', 'success');

      // ── 9. Poll Node A LN invoice ─────────────────────────────────────────
      addLog('Polling Node A invoice status …');
      setInvoiceStatus('Pending');
      const payDeadline = Date.now() + SETTLE_TIMEOUT_MS;
      let lnSettled = false;
      while (Date.now() < payDeadline) {
        if (abortRef.current) throw new Error('Cancelled');
        await sleep(POLL_MS);
        try {
          await wA.syncWallet();
          const status = await wA.getLightningReceiveRequest(aInvoice);
          setInvoiceStatus(status ?? 'Pending');
          addLog(`nodeA invoice: ${status}`);
          if (status === 'Settled') { lnSettled = true; break; }
          if (status === 'Failed') throw new Error('Node A LN invoice failed');
        } catch (e: any) { if ((e?.message??'').includes('failed')) throw e; console.error('[lsp] ln poll', e?.message??e); }
      }

      if (lnSettled) addLog('Node A LN invoice Settled ✓ — LSP paid!', 'success');
      else addLog('LN settlement timeout — needs active LSP channel on signet', 'error');

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
    for (const ref of [walletARef, walletBRef]) {
      if (ref.current) { try { await ref.current.destroy(); } catch {} ref.current = null; }
    }
    setPhase('idle'); setLog([]); setLspInfo(null);
    setAddrA(''); setAddrB(''); setBalA(null); setBalB(null);
    setAssetInfo(null); setLnInvoiceA(''); setRgbInvoiceLsp('');
    setInvoiceStatus(''); setErrorMsg('');
  }, []);

  const isRunning = !['idle','done','error'].includes(phase);
  const spA = (balA?.vanilla?.spendable??0)+(balA?.colored?.spendable??0);
  const stA = (balA?.vanilla?.settled??0)+(balA?.colored?.settled??0);
  const spB = (balB?.vanilla?.spendable??0)+(balB?.colored?.spendable??0);
  const stB2= (balB?.vanilla?.settled??0)+(balB?.colored?.settled??0);

  return (
    <SafeAreaView style={s.safe} edges={['top','left','right']}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content}>

        <View style={s.header}>
          <Text style={s.title}>LSP · lightning_receive</Text>
          <Text style={s.subtitle}>Signet · lsp-signet.utexo.com</Text>
          <View style={s.badge}>
            <View style={[s.dot, { backgroundColor: lspInfo ? AppColors.success : AppColors.textTertiary }]} />
            <Text style={s.badgeTxt}>{lspInfo ? `LSP connected · ${lspInfo.num_channels} ch` : 'Not connected'}</Text>
          </View>
        </View>

        {phase !== 'idle' && <PhaseBar phase={phase} />}

        {phase === 'idle' && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Flow overview (signet)</Text>
            <Text style={s.cardDesc}>
              {'1. Check LSP · get_info\n' +
               '2. Node A (recipient) + Node B (RGB sender)\n' +
               '3. Fund both via thunderstack faucet\n' +
               '4. UTXOs on both nodes\n' +
               '5. Node B issues RGB asset (UTST)\n' +
               '6. Node A: createLightningInvoice (asset_id + amount)\n' +
               '7. lsp.lightningReceive → RGB invoice\n' +
               '8. Node B.onchainSend → sends RGB to LSP\n' +
               '9. Poll: RGB settled on Node B\n' +
               '10. Poll: Node A LN invoice = Settled\n\n' +
               'Note: requires LSP to have a usable channel with Node A.\n' +
               'LSP opens channels automatically to connected peers (cron 30s).'}
            </Text>
            <View style={s.paramCard}>
              <Text style={s.paramTitle}>Parameters</Text>
              <Text style={s.paramLine}>Payment  {PAYMENT_MSAT/1000} sat + {PAYMENT_ASSET_AMOUNT} UTST</Text>
              <Text style={s.paramLine}>Send     {FAUCET_PAY_AMOUNT} UTST → LSP</Text>
              <Text style={s.paramLine}>LSP      {LSP_URL}</Text>
            </View>
            <TouchableOpacity style={s.startBtn} onPress={run} activeOpacity={0.8}>
              <Text style={s.startBtnTxt}>▶  Run on Signet</Text>
            </TouchableOpacity>
          </View>
        )}

        {isRunning && ['init','utxos','asset','lsp_setup'].includes(phase) && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>
              {phase==='init' ? 'Initializing Node A + B on signet …'
                : phase==='utxos' ? 'Creating UTXOs on both nodes …'
                : phase==='asset' ? 'Issuing RGB asset on Node B …'
                : 'Creating LN invoice + LSP lightningReceive …'}
            </Text>
          </View>
        )}

        {phase === 'fund' && (
          <View style={s.card}>
            <ActivityIndicator size="large" color={AppColors.primary} style={{ marginBottom: 12 }} />
            <Text style={s.cardTitle}>Funding via faucet</Text>
            <Text style={s.cardDesc}>Polling every 20s for confirmed balance …</Text>
          </View>
        )}

        {(phase === 'rgb_send' || phase === 'settle') && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>
              {phase === 'rgb_send' ? 'Node B sending RGB to LSP …' : `Waiting for settlement … invoice: ${invoiceStatus||'Pending'}`}
            </Text>
          </View>
        )}

        {lspInfo && (
          <InfoCard title="LSP" accent={AppColors.success} rows={[
            ['Pubkey', short(lspInfo.pubkey, 28)],
            ['Channels', `${lspInfo.num_channels} total · ${lspInfo.num_usable_channels} usable`],
            ['Balance', satStr(lspInfo.local_balance_sat ?? 0)],
          ]} />
        )}

        {(addrA||addrB) && (
          <View>
            {addrA?<View style={nc.card}><Text style={[nc.label,{color:AppColors.primary}]}>Node A — Recipient</Text><Text selectable style={nc.addr}>{addrA}</Text><Text style={nc.stat}>Settled: {satStr(stA)}  Spendable: {satStr(spA)}</Text></View>:null}
            {addrB?<View style={nc.card}><Text style={[nc.label,{color:AppColors.running}]}>Node B — RGB Sender</Text><Text selectable style={nc.addr}>{addrB}</Text><Text style={nc.stat}>Settled: {satStr(stB2)}  Spendable: {satStr(spB)}</Text></View>:null}
          </View>
        )}

        {assetInfo && (
          <InfoCard title="RGB Asset (Node B issued)" accent={AppColors.running} rows={[
            ['Asset ID', short(assetInfo.assetId, 28)],
            ['Ticker', assetInfo.ticker],
            ['Supply', String(assetInfo.issuedSupply)],
          ]} />
        )}

        {lnInvoiceA && (
          <InfoCard title="Node A — LN Invoice" rows={[
            ['BOLT11', short(lnInvoiceA, 32)],
            ['Amount', `${PAYMENT_MSAT/1000} sat + ${PAYMENT_ASSET_AMOUNT} UTST`],
            ['Status', invoiceStatus||'Pending'],
          ]} />
        )}

        {rgbInvoiceLsp && (
          <InfoCard title="LSP → RGB Invoice (Node B pays)" rows={[
            ['RGB Invoice', short(rgbInvoiceLsp, 32)],
            ['Send amount', `${FAUCET_PAY_AMOUNT} UTST`],
          ]} />
        )}

        {phase === 'done' && (
          <View style={[s.card, { borderColor: invoiceStatus==='Settled' ? AppColors.successBorder : AppColors.border }]}>
            <Text style={[s.cardTitle, { color: invoiceStatus==='Settled' ? AppColors.success : AppColors.textPrimary }]}>
              {invoiceStatus==='Settled' ? '✓ lightning_receive complete' : '⚠ Done — check settlement'}
            </Text>
            <Text style={s.cardDesc}>
              {invoiceStatus==='Settled'
                ? 'Node B sent RGB to LSP → LSP paid Node A\'s LN invoice.'
                : 'RGB sent. LN settlement: ' + (invoiceStatus||'pending') + '.\nNeeds active LSP channel (signet may not have one).'}
            </Text>
          </View>
        )}

        {phase === 'error' && (
          <View style={[s.card, { borderColor: AppColors.errorBorder, backgroundColor: AppColors.errorBg }]}>
            <Text style={[s.cardTitle, { color: AppColors.error }]}>Flow failed</Text>
            <Text style={[s.cardDesc, { color: '#FCA5A5' }]}>{errorMsg}</Text>
          </View>
        )}

        {(phase==='done'||phase==='error') && (
          <TouchableOpacity style={s.resetBtn} onPress={reset} activeOpacity={0.8}>
            <Text style={s.resetBtnTxt}>↺  Reset</Text>
          </TouchableOpacity>
        )}
        {isRunning && (
          <TouchableOpacity style={s.cancelBtn} onPress={reset} activeOpacity={0.8}>
            <Text style={s.cancelBtnTxt}>✕  Cancel</Text>
          </TouchableOpacity>
        )}

        {log.length > 0 && <LogPane entries={log} />}

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.bgBase },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 60 },
  header: { marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '700', color: AppColors.textPrimary, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, color: AppColors.textSecondary, marginTop: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: AppColors.bgCard, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', borderWidth: 1, borderColor: AppColors.border },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  badgeTxt: { fontSize: 11, color: AppColors.textSecondary, fontFamily: AppColors.mono },
  card: { backgroundColor: AppColors.bgCard, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: AppColors.border, marginBottom: 16 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: AppColors.textPrimary, marginBottom: 8 },
  cardDesc: { fontSize: 13, color: AppColors.textSecondary, lineHeight: 22 },
  paramCard: { backgroundColor: AppColors.bgCardElevated, borderRadius: 8, padding: 12, marginVertical: 14 },
  paramTitle: { fontSize: 11, color: AppColors.textTertiary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 },
  paramLine: { fontSize: 12, color: AppColors.textSecondary, fontFamily: AppColors.mono, marginBottom: 2 },
  startBtn: { backgroundColor: AppColors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  startBtnTxt: { fontSize: 15, fontWeight: '700', color: AppColors.black },
  spinnerCard: { backgroundColor: AppColors.bgCard, borderRadius: 12, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: AppColors.border, marginBottom: 16 },
  spinnerTxt: { fontSize: 14, color: AppColors.textSecondary, marginTop: 14, textAlign: 'center' },
  resetBtn: { borderWidth: 1, borderColor: AppColors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 16 },
  resetBtnTxt: { fontSize: 14, fontWeight: '600', color: AppColors.primary },
  cancelBtn: { borderWidth: 1, borderColor: AppColors.error, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginBottom: 16 },
  cancelBtnTxt: { fontSize: 13, color: AppColors.error },
});

const pb = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, backgroundColor: AppColors.bgCard, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: AppColors.border },
  step: { alignItems: 'center', flex: 0 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  dotText: { fontSize: 8, fontWeight: '700' },
  label: { fontSize: 7, fontWeight: '600', letterSpacing: 0.3 },
  line: { flex: 1, height: 2, marginBottom: 10, marginHorizontal: 1 },
});

const nc = StyleSheet.create({
  card: { backgroundColor: AppColors.bgCard, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: AppColors.border, marginBottom: 10 },
  label: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  addr: { fontSize: 11, color: AppColors.textAccent, fontFamily: AppColors.mono, marginBottom: 8 },
  stat: { fontSize: 12, color: AppColors.textTertiary },
});

const ic = StyleSheet.create({
  card: { backgroundColor: AppColors.bgCard, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: AppColors.border, marginBottom: 10 },
  title: { fontSize: 11, color: AppColors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderTopColor: AppColors.border },
  key: { fontSize: 12, color: AppColors.textTertiary, flex: 1 },
  val: { fontSize: 12, color: AppColors.textAccent, fontFamily: AppColors.mono, flex: 2, textAlign: 'right' },
});

const lp = StyleSheet.create({
  box: { backgroundColor: AppColors.bgCard, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: AppColors.border, marginTop: 8 },
  header: { fontSize: 11, color: AppColors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  empty: { fontSize: 12, color: AppColors.textTertiary, fontStyle: 'italic' },
  entry: { fontSize: 11, color: AppColors.textSecondary, fontFamily: AppColors.mono, lineHeight: 18 },
});
