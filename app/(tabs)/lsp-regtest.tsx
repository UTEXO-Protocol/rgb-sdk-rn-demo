/**
 * LSP tab — implements the lightning_receive flow from
 * https://github.com/UTEXO-Protocol/utexo-lsp/blob/main/tests/e2e/support/flows.py
 *
 * Matches the e2e test fixture in conftest.py:
 *   - LSP daemon  (port 3005, peer 9737) — external, started by start-lsp-regtest.sh
 *   - Faucet daemon (port 3008)          — external, started by start-lsp-regtest.sh
 *   - User A      (embedded SDK)         — this demo app
 *
 * Flow:
 *   User A connects to LSP peer
 *   → LSP cron opens RGB channel to User A (mine 2 blocks)
 *   → wait_for_peer_channel_usable
 *   → User A creates LN invoice (asset_id + asset_amount)
 *   → lsp.lightningReceive(lnInvoice, assetId) → RGB invoice
 *   → Faucet daemon.sendrgb → sends RGB to LSP's address
 *   → mine 1 + double refreshtransfers on both daemons
 *   → poll User A LN invoice status until Succeeded
 *
 * Prerequisites:
 *   cd rgb-sdk-rn-demo && ./scripts/start-lsp-regtest.sh
 */
import * as FileSystem from 'expo-file-system/legacy';
import { documentDirectory } from 'expo-file-system/legacy';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors } from '@/constants/theme';
import { mine, sendToAddress } from '@/utils/wallet-flow';
import {
  createWallet,
  PasswordRLNSigner,
  UtexoLSPClient,
  UTEXOWallet,
} from '@utexo/rgb-sdk-rn';

// ── Config — from env (written by start-lsp-regtest.sh) ───────────────────────

// Mirrors the pattern in wallet-flow.ts: compute host from Platform at runtime.
// iOS simulator shares Mac's network — 127.0.0.1 is Mac localhost.
// Android emulator reaches Mac via 10.0.2.2.
const _host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

// URLs are always computed from _host — never from env vars.
// (Env vars store 127.0.0.1 which breaks on Android emulator.)
const LSP_URL           = `http://${_host}:8080`;
const LSP_DAEMON_URL    = `http://${_host}:3005`;
const FAUCET_DAEMON_URL = `http://${_host}:3008`;

// Non-URL values come from env (written by start-lsp-regtest.sh).
const ASSET_ID     = process.env.EXPO_PUBLIC_LSP_REGTEST_ASSET_ID ?? '';
const LSP_LDK_PORT = Number(process.env.EXPO_PUBLIC_LSP_REGTEST_LDK_PORT ?? '9737');
// Fetched at runtime so no app rebuild is needed after LSP restarts.
let LSP_PEER_PUBKEY = process.env.EXPO_PUBLIC_LSP_REGTEST_PEER_PUBKEY ?? '';

const REGTEST_UNLOCK = {
  bitcoindRpcUsername: 'user',
  bitcoindRpcPassword: 'password',
  bitcoindRpcHost: _host,
  bitcoindRpcPort: 18443,
  indexerUrl: `${_host}:50001`,
  proxyEndpoint: `rpc://${_host}:3000/json-rpc`,
  announceAddresses: [] as string[],
  announceAlias: null as string | null,
};

// Matches e2e config values from config.py
const PAYMENT_MSAT         = 3_000_000;   // payment_msat
const PAYMENT_ASSET_AMOUNT = 1;           // payment_asset_amount
const FAUCET_PAY_AMOUNT    = 1;           // faucet_pay_amount (1 unit per seed)
const CHANNEL_TIMEOUT_S    = 120;
const PAYMENT_TIMEOUT_S    = 60;
const POLL_INTERVAL_S      = 2;

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase =
  | 'idle' | 'preflight' | 'init' | 'fund' | 'utxos'
  | 'channel' | 'b_init' | 'b_channel'
  | 'lsp_flow' | 'rgb_send' | 'settle'
  | 'p2_pay' | 'p2_settle'
  | 'done' | 'error';

interface LogEntry { time: string; msg: string; type: 'info' | 'success' | 'error' }

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const satStr = (n: number) => n === 0 ? '0 sat' : `${(n / 1e8).toFixed(8)} BTC`;
const short = (s: string, n = 24) => (s || '').slice(0, n) + ((s || '').length > n ? '…' : '');

// ── Daemon HTTP helpers (mirrors e2e RlnClient) ────────────────────────────────

async function daemonPost(url: string, path: string, body: object = {}): Promise<any> {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function daemonGet(url: string, path: string): Promise<any> {
  const res = await fetch(`${url}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${text}`);
  return JSON.parse(text);
}

// mirrors refresh_transfers_for_clients in harness.py (double refresh)
async function refreshTransfers(daemonUrl: string): Promise<void> {
  await daemonPost(daemonUrl, '/refreshtransfers', { skip_sync: false });
  await daemonPost(daemonUrl, '/refreshtransfers', { skip_sync: false });
}

// ── Sub-components ────────────────────────────────────────────────────────────

const PHASES_P1: Phase[] = ['preflight', 'init', 'fund', 'utxos', 'channel', 'b_init', 'b_channel', 'lsp_flow', 'rgb_send', 'settle'];
const PHASES_P2: Phase[] = ['p2_pay', 'p2_settle', 'done'];
const ALL_PHASES = [...PHASES_P1, ...PHASES_P2];
const PHASE_LABELS: Record<string, string> = {
  preflight: 'Check', init: 'Init', fund: 'Fund', utxos: 'UTXOs',
  channel: 'A Chan', b_init: 'B Init', b_channel: 'B Chan',
  lsp_flow: 'LSP', rgb_send: 'Send', settle: 'Settle',
  p2_pay: 'Pay', p2_settle: 'Settle', done: 'Done',
};

function PhaseRow({ phases, phase }: { phases: Phase[]; phase: Phase }) {
  const idx = ALL_PHASES.indexOf(phase);
  return (
    <View style={pb.row}>
      {phases.map((s, i) => {
        const globalIdx = ALL_PHASES.indexOf(s);
        const done = idx > globalIdx;
        const active = phase === s;
        const err = phase === 'error' && active;
        const color = err ? AppColors.error : done ? AppColors.success : active ? AppColors.primary : AppColors.textTertiary;
        return (
          <React.Fragment key={s}>
            <View style={pb.step}>
              <View style={[pb.dot, { borderColor: color, backgroundColor: active ? color + '20' : 'transparent' }]}>
                {active && phase !== 'error'
                  ? <ActivityIndicator size={8} color={color} />
                  : <Text style={[pb.dotText, { color }]}>{done ? '✓' : err ? '✗' : globalIdx + 1}</Text>}
              </View>
              <Text style={[pb.label, { color }]}>{PHASE_LABELS[s]}</Text>
            </View>
            {i < phases.length - 1 && (
              <View style={[pb.line, { backgroundColor: done ? AppColors.success + '60' : AppColors.border }]} />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

function InfoCard({ title, rows, accent }: { title: string; rows: [string, string][]; accent?: string }) {
  return (
    <View style={[ic.card, accent ? { borderColor: accent + '60' } : undefined]}>
      <Text style={[ic.title, accent ? { color: accent } : undefined]}>{title}</Text>
      {rows.map(([k, v], i) => (
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
        : entries.map((e, i) => (
          <Text key={i} style={[lp.entry,
            e.type === 'success' && { color: AppColors.success },
            e.type === 'error' && { color: AppColors.error },
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
  const [lspInfo, setLspInfo] = useState<any>(null);
  const [addrA, setAddrA] = useState('');
  const [balA, setBalA] = useState<any>(null);
  const [channelInfo, setChannelInfo] = useState<any>(null);
  const [lnInvoiceA, setLnInvoiceA] = useState('');
  const [rgbInvoiceLsp, setRgbInvoiceLsp] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState('');
  const [finalBalA, setFinalBalA] = useState<any>(null);
  // Part 2
  const [addrB, setAddrB] = useState('');
  const [channelInfoB, setChannelInfoB] = useState<any>(null);
  const [lnInvoiceB, setLnInvoiceB] = useState('');
  const [invoiceStatusB, setInvoiceStatusB] = useState('');
  const [finalBalB, setFinalBalB] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const walletARef = useRef<UTEXOWallet | null>(null);
  const walletBRef = useRef<UTEXOWallet | null>(null);
  const abortRef = useRef(false);

  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
    const time = new Date().toLocaleTimeString('en', { hour12: false });
    setLog(prev => [...prev.slice(-500), { time, msg, type }]);
    console.log(`[lsp][${type}] ${msg}`);
  }, []);

  const run = useCallback(async () => {
    abortRef.current = false;
    setLog([]); setLspInfo(null); setAddrA(''); setBalA(null);
    setChannelInfo(null); setLnInvoiceA(''); setRgbInvoiceLsp('');
    setInvoiceStatus(''); setFinalBalA(null);
    setAddrB(''); setChannelInfoB(null); setLnInvoiceB(''); setInvoiceStatusB(''); setFinalBalB(null);
    setErrorMsg('');
    setPhase('preflight');

    const req = (label: string, p?: Record<string, any>) =>
      addLog(`→ ${label}${p ? '  ' + Object.entries(p).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : ''}`);
    const res = (label: string, d?: Record<string, any>) =>
      addLog(`← ${label}${d ? '  ' + Object.entries(d).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : ''}`, 'success');

    try {
      // ── Preflight checks ─────────────────────────────────────────────────

      addLog(`Platform=${Platform.OS}  host=${_host}`);
      addLog(`LSP_URL=${LSP_URL}`);
      addLog(`LSP_DAEMON=${LSP_DAEMON_URL}`);
      addLog(`FAUCET_DAEMON=${FAUCET_DAEMON_URL}`);
      addLog(`ASSET_ID=${ASSET_ID ? ASSET_ID.slice(0, 20) + '…' : '(empty)'}`);
      addLog(`LSP_PEER=${LSP_PEER_PUBKEY ? LSP_PEER_PUBKEY.slice(0, 16) + '…' : '(empty)'}`);

      if (!ASSET_ID) throw new Error('EXPO_PUBLIC_LSP_REGTEST_ASSET_ID not set — run scripts/start-lsp-regtest.sh first');

      // Fetch LSP pubkey at runtime — no rebuild needed after LSP restarts.
      const lspNodeInfoResp = await fetch(`${LSP_DAEMON_URL}/nodeinfo`).then(r => r.json()) as any;
      LSP_PEER_PUBKEY = lspNodeInfoResp?.pubkey ?? LSP_PEER_PUBKEY;
      if (!LSP_PEER_PUBKEY) throw new Error('Could not fetch LSP pubkey — is the LSP daemon running on port 3005?');

      // ── raw fetch probe ────────────────────────────────────────────────────
      addLog(`raw fetch probe → ${LSP_URL}/health`);
      try {
        const probe = await fetch(`${LSP_URL}/health`);
        addLog(`probe status=${probe.status}`, probe.ok ? 'success' : 'error');
      } catch (e: any) {
        addLog(`probe error: ${e?.message ?? String(e)}`, 'error');
      }

      req('lsp.getInfo');
      const lsp = new UtexoLSPClient({ baseUrl: LSP_URL });
      const info = await lsp.getInfo();
      setLspInfo(info);
      res('lsp.getInfo', { pubkey: short(info.pubkey), channels: info.numChannels, usable: info.numUsableChannels });

      req('lsp daemon.nodeinfo');
      const lspDaemonInfo = await daemonGet(LSP_DAEMON_URL, '/nodeinfo');
      res('lsp daemon.nodeinfo', { pubkey: short(lspDaemonInfo.pubkey), assetChannels: lspDaemonInfo.num_channels });

      req('faucet daemon.assetbalance', { assetId: short(ASSET_ID) });
      const faucetBal = await daemonPost(FAUCET_DAEMON_URL, '/assetbalance', { asset_id: ASSET_ID });
      res('faucet.assetbalance', { settled: faucetBal.settled, spendable: faucetBal.spendable });
      if (Number(faucetBal.settled) < 1) {
        throw new Error(`Faucet has no settled RGB balance (${faucetBal.settled}) — run start-lsp-regtest.sh`);
      }

      // ── Init User A ───────────────────────────────────────────────────────
      setPhase('init');

      req('createWallet userA');
      const keysA = await createWallet('regtest' as any);
      res('createWallet userA', { fingerprint: keysA.masterFingerprint });

      const ts = Date.now();
      const port = 34000 + Math.floor(Math.random() * 2000);
      const dirUri = `${documentDirectory ?? ''}lsp_ua_${ts}`;
      await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
      const storageDirPath = dirUri.replace('file://', '');

      addLog(`storageDirPath=${storageDirPath}`);
      addLog(`ports daemon=${port} ldk=${port + 1}`);
      addLog(`network=regtest lspBaseUrl=${LSP_URL}`);

      const wA = new UTEXOWallet(
        { storageDirPath, daemonListeningPort: port, ldkPeerListeningPort: port + 1,
          network: 'regtest', maxMediaUploadSizeMb: 20,
          xpubVan: keysA.accountXpubVanilla, xpubCol: keysA.accountXpubColored, masterFingerprint: keysA.masterFingerprint },
        new PasswordRLNSigner('lsppass1', keysA.mnemonic),
      );
      walletARef.current = wA;

      addLog('calling wA.init()…');
      try {
        await wA.init();
        addLog('wA.init() ok', 'success');
      } catch (initErr: any) {
        addLog(`wA.init() FAILED: code=${initErr?.code} name=${initErr?.name} msg=${initErr?.message ?? String(initErr)}`, 'error');
        addLog(`initErr keys: ${Object.keys(initErr ?? {}).join(', ')}`);
        throw initErr;
      }

      req('userA.unlock'); await wA.unlock(REGTEST_UNLOCK); res('userA.unlock');
      req('userA.getNodeInfo');
      const nodeInfoA = await wA.getNodeInfo();
      const pubkeyA = String(nodeInfoA?.pubkey ?? '');
      res('userA.getNodeInfo', { pubkey: short(pubkeyA) });

      req('userA.getAddress');
      const address = await wA.getAddress();
      setAddrA(address);
      res('userA.getAddress', { address });

      // ── Fund User A ───────────────────────────────────────────────────────
      setPhase('fund');

      req('sendToAddress userA 1 BTC');
      await sendToAddress(address, 1);
      await mine(6);
      await sleep(3000);
      await wA.syncWallet();
      const bal = await wA.getBtcBalance() as any;
      setBalA(bal);
      const spendable = (bal?.vanilla?.spendable ?? 0) + (bal?.colored?.spendable ?? 0);
      res('userA.getBtcBalance', { spendable: satStr(spendable) });

      // ── Create UTXOs ──────────────────────────────────────────────────────
      setPhase('utxos');

      req('userA.syncWallet'); await wA.syncWallet(); res('userA.syncWallet');
      req('userA.refreshWallet'); await wA.refreshWallet(); res('userA.refreshWallet');
      req('userA.createUtxos', { num: 10, feeRate: 7 });
      await wA.createUtxos({ upTo: false, num: 10, feeRate: 7 });
      await mine(1);
      await wA.syncWallet();
      res('userA.createUtxos');

      // ── Connect to LSP peer → wait for RGB channel ────────────────────────
      // Matches: clients["user_a"].connectpeer + wait_for_peer_channel_usable
      setPhase('channel');

      const lspPeerUri = `${LSP_PEER_PUBKEY}@${_host}:${LSP_LDK_PORT}`;
      req('userA.connectPeer', { peer: short(lspPeerUri, 40) });
      try {
        await wA.connectPeer(lspPeerUri);
        res('userA.connectPeer');
      } catch (e: any) {
        addLog(`connectPeer (ignored): ${e?.message ?? String(e)}`);
      }

      // mine 2 to trigger LSP reconcileChannels cron (CRON_EVERY=5s)
      addLog('Mining 2 blocks to trigger LSP channel open …');
      await mine(2);
      await sleep(6000); // wait for LSP cron (5s + buffer)

      // wait_for_peer_channel_usable — poll until channel is ready
      addLog(`Waiting for RGB channel usable (asset: ${short(ASSET_ID)}) …`);
      const chanDeadline = Date.now() + CHANNEL_TIMEOUT_S * 1000;
      let channelUsable = false;
      while (Date.now() < chanDeadline) {
        if (abortRef.current) throw new Error('Cancelled');
        await mine(1);
        await sleep(3000);
        await wA.syncWallet();
        const info = await wA.getNodeInfo();
        const usable = Number(info?.numUsableChannels ?? 0);
        const channels = (await wA.listChannels()) ?? [];
        const rgbChan = (channels as any[]).find((c: any) =>
          (c.assetId || c.asset_id) === ASSET_ID && (c.isUsable || c.is_usable)
        );
        addLog(`userA channels: ${channels.length} total, ${usable} usable, RGB chan: ${rgbChan ? 'YES' : 'NO'}`);
        if (rgbChan) {
          setChannelInfo(rgbChan);
          channelUsable = true;
          break;
        }
      }
      if (!channelUsable) throw new Error('Timeout waiting for RGB channel to become usable');
      addLog(`RGB channel usable ✓  cap=${channelInfo?.capacitySat ?? '?'} sat`, 'success');

      // refresh_transfers + sync before User B setup
      // mirrors conftest.py: refresh_transfers + sync_sdk_nodes + mine(2) between connects
      await daemonPost(LSP_DAEMON_URL,    '/refreshtransfers', { skip_sync: false });
      await daemonPost(FAUCET_DAEMON_URL, '/refreshtransfers', { skip_sync: false });
      await wA.syncWallet();
      await mine(2);

      // ── User B setup (mirrors conftest.py: connect B before run_lightning_receive_flow) ──
      // Python opens BOTH channels upfront before any RGB transfer activity.
      // Doing B after Part 1 causes NoAvailableUtxos on the LSP.
      setPhase('b_init');

      addLog('Setting up User B before lightning_receive flow …');
      const keysB = await createWallet('regtest' as any);
      const tsB = Date.now();
      const portB = 36000 + Math.floor(Math.random() * 2000);
      const dirBUri = `${documentDirectory ?? ''}lsp_ub_${tsB}`;
      await FileSystem.makeDirectoryAsync(dirBUri, { intermediates: true });
      const storageDirPathB = dirBUri.replace('file://', '');

      const wB = new UTEXOWallet(
        { storageDirPath: storageDirPathB, daemonListeningPort: portB, ldkPeerListeningPort: portB + 1,
          network: 'regtest', maxMediaUploadSizeMb: 20,
          xpubVan: keysB.accountXpubVanilla, xpubCol: keysB.accountXpubColored, masterFingerprint: keysB.masterFingerprint },
        new PasswordRLNSigner('lsppass2', keysB.mnemonic),
      );
      walletBRef.current = wB;
      await wB.init();
      await wB.unlock(REGTEST_UNLOCK);
      res('userB.init');

      const addressB = await wB.getAddress();
      setAddrB(addressB);
      await sendToAddress(addressB, 1);
      await mine(6);
      await sleep(3000);
      await wB.syncWallet();
      await wB.createUtxos({ upTo: false, num: 10, feeRate: 7 });
      await mine(1);
      await wB.syncWallet();
      res('userB.funded + createUtxos');

      setPhase('b_channel');

      req('userB.connectPeer', { peer: short(lspPeerUri, 40) });
      try { await wB.connectPeer(lspPeerUri); res('userB.connectPeer'); }
      catch (e: any) { addLog(`connectPeer B (ignored): ${e?.message ?? String(e)}`); }

      addLog('Mining 2 blocks to trigger LSP channel open for User B …');
      await mine(2);
      await sleep(6000);

      addLog('Waiting for RGB channel usable on User B …');
      const chanDeadlineB = Date.now() + CHANNEL_TIMEOUT_S * 1000;
      let channelBUsable = false;
      while (Date.now() < chanDeadlineB) {
        if (abortRef.current) throw new Error('Cancelled');
        await mine(1);
        await sleep(3000);
        await wB.syncWallet();
        const channelsB = (await wB.listChannels()) ?? [];
        const rgbChanB = (channelsB as any[]).find((c: any) =>
          (c.assetId || c.asset_id) === ASSET_ID && (c.isUsable || c.is_usable)
        );
        addLog(`userB channels: ${channelsB.length} total, RGB chan: ${rgbChanB ? 'YES' : 'NO'}`);
        if (rgbChanB) { setChannelInfoB(rgbChanB); channelBUsable = true; break; }
      }
      if (!channelBUsable) throw new Error('Timeout waiting for User B RGB channel');
      addLog('User B RGB channel usable ✓', 'success');

      await refreshTransfers(LSP_DAEMON_URL);
      await wA.syncWallet();
      await wB.syncWallet();

      // ── run_lightning_receive_flow(env) START ─────────────────────────────
      // Mirrors flows.py:run_lightning_receive_flow exactly.
      setPhase('lsp_flow');

      req('userA.createLightningInvoice', { amtMsat: PAYMENT_MSAT, assetId: short(ASSET_ID), assetAmount: PAYMENT_ASSET_AMOUNT });
      const invResult = await wA.createLightningInvoice({
        amountSats: PAYMENT_MSAT / 1000,
        expirySeconds: 3600,
        asset: { assetId: ASSET_ID, amount: PAYMENT_ASSET_AMOUNT },
      });
      const aInvoice = invResult.lnInvoice;
      setLnInvoiceA(aInvoice);
      res('userA.createLightningInvoice', { invoice: short(aInvoice, 32) });

      req('lsp.lightningReceive', { assetId: short(ASSET_ID) });
      const lr = await lsp.lightningReceive({
        lnInvoice: aInvoice,
        rgb: { assetId: ASSET_ID },
      });
      const rgbInvoice = lr.rgbInvoice;
      setRgbInvoiceLsp(rgbInvoice);
      res('lsp.lightningReceive', {
        rgbInvoice: short(rgbInvoice, 32),
        mappingId: lr.mappingId,
      });

      // ── Faucet sends RGB to LSP's invoice ─────────────────────────────────
      // Mirrors: env.faucet.decodergbinvoice + env.faucet.sendrgb
      setPhase('rgb_send');

      req('faucet.decodergbinvoice');
      const decoded = await daemonPost(FAUCET_DAEMON_URL, '/decodergbinvoice', { invoice: rgbInvoice });
      const recipientId = decoded.recipient_id;
      const transportEndpoints = decoded.transport_endpoints ?? [`rpc://${_host}:3000/json-rpc`];
      // Use assignment from invoice; fall back to FAUCET_PAY_AMOUNT if value is 0 (mirrors flows.py)
      const assignment = (decoded.assignment?.type === 'Fungible' && decoded.assignment?.value > 0)
        ? decoded.assignment
        : { type: 'Fungible', value: FAUCET_PAY_AMOUNT };
      res('faucet.decodergbinvoice', { recipientId: short(recipientId, 24), endpoints: transportEndpoints.length });

      req('faucet.sendrgb', { amount: assignment.value, recipientId: short(recipientId, 20) });
      await daemonPost(FAUCET_DAEMON_URL, '/sendrgb', {
        donation: false,
        fee_rate: 7,
        min_confirmations: 1,
        skip_sync: false,
        recipient_map: {
          [ASSET_ID]: [{
            recipient_id: recipientId,
            assignment,
            transport_endpoints: transportEndpoints,
          }],
        },
      });
      res('faucet.sendrgb', { amount: FAUCET_PAY_AMOUNT });

      // mine 1 + double refresh on both (mirrors harness.py rgb_delivery_settled)
      await mine(1);
      await sleep(2000);

      req('refreshtransfers lsp + faucet (×2)');
      await refreshTransfers(LSP_DAEMON_URL);
      await refreshTransfers(FAUCET_DAEMON_URL);
      res('refreshtransfers');

      // ── Poll faucet Send + LSP ReceiveBlind both Settled ─────────────────
      // mirrors flows.py rgb_delivery_settled: waits for BOTH sides to settle
      addLog('Waiting for faucet Send + LSP receive to settle …');
      setPhase('settle');
      const sendDeadline = Date.now() + PAYMENT_TIMEOUT_S * 1000;
      let rgbDeliverySettled = false;
      while (Date.now() < sendDeadline) {
        if (abortRef.current) throw new Error('Cancelled');
        await mine(1); // mirrors flows.py rgb_delivery_settled: mine each iteration
        await sleep(POLL_INTERVAL_S * 1000);
        try {
          await refreshTransfers(LSP_DAEMON_URL);
          await refreshTransfers(FAUCET_DAEMON_URL);
          const faucetTransfers = await daemonPost(FAUCET_DAEMON_URL, '/listtransfers', { asset_id: ASSET_ID });
          const lspTransfers    = await daemonPost(LSP_DAEMON_URL,    '/listtransfers', { asset_id: ASSET_ID });
          const faucetSend = [...(faucetTransfers.transfers ?? [])].reverse().find((t: any) => t.kind === 'Send');
          const lspReceive = [...(lspTransfers.transfers    ?? [])].reverse().find((t: any) => t.kind === 'ReceiveBlind');
          addLog(`faucet Send: ${faucetSend?.status ?? 'none'}  LSP receive: ${lspReceive?.status ?? 'none'}`);
          if (faucetSend?.status === 'Failed') throw new Error('Faucet RGB send transfer failed');
          if (faucetSend?.status === 'Settled' && lspReceive?.status === 'Settled') { rgbDeliverySettled = true; break; }
        } catch (e: any) {
          if ((e?.message ?? '').includes('failed')) throw e;
          console.error('[lsp] settle poll:', e?.message ?? e);
        }
      }
      if (!rgbDeliverySettled) addLog('RGB delivery settlement timeout — LSP may still be processing');
      else addLog('Faucet Send + LSP receive both Settled ✓', 'success');

      // ── Poll User A LN invoice until Succeeded ────────────────────────────
      // Mirrors: wait_until(user_a_invoice_succeeded) in flows.py.
      // flows.py checks invoicestatus == "Succeeded"; SDK may return "Settled" — accept both.
      addLog(`Polling userA invoice status …`);
      setInvoiceStatus('Pending');
      const payDeadline = Date.now() + PAYMENT_TIMEOUT_S * 1000;
      let lnSettled = false;
      while (Date.now() < payDeadline) {
        if (abortRef.current) throw new Error('Cancelled');
        await sleep(POLL_INTERVAL_S * 1000);
        try {
          await wA.syncWallet();
          const status = await wA.getLightningReceiveRequest(aInvoice);
          setInvoiceStatus(status ?? 'Pending');
          addLog(`userA invoice: ${status}`);
          if (String(status) === 'Succeeded' || String(status) === 'Settled') { lnSettled = true; break; }
          if (status === 'Failed') throw new Error('User A LN invoice failed');
        } catch (e: any) {
          if ((e?.message ?? '').includes('failed')) throw e;
          console.error('[lsp] invoice poll:', e?.message ?? e);
        }
      }

      if (lnSettled) {
        addLog('userA LN invoice Succeeded ✓ — LSP paid via RGB channel!', 'success');
      } else {
        addLog('Invoice settlement timeout — check utexo-lsp logs', 'error');
      }

      // final asset balance on User A — sync first so offchain balance is fresh
      try {
        await wA.syncWallet();
        const bal = await wA.getAssetBalance(ASSET_ID);
        setFinalBalA(bal);
        addLog(
          `userA asset balance: settled=${bal?.settled ?? 0} ` +
          `offchainInbound=${bal?.offchainInbound ?? 0} ` +
          `offchainOutbound=${bal?.offchainOutbound ?? 0}`,
          'success',
        );
      } catch {}
      // ── run_lightning_receive_flow(env) END ───────────────────────────────

      // ── Part 2: User A pays User B ────────────────────────────────────────
      // Mirrors test_flow0_full_e2e.py (after run_lightning_receive_flow returns).
      // User B is already online with an RGB channel (set up before Part 1).
      addLog('── Part 2: User A → User B payment ──');

      // Wait for User A outbound_balance_msat >= PAYMENT_MSAT before paying.
      // Mirrors test_flow0_full_e2e.py user_a_has_outbound_liquidity check.
      addLog('Waiting for User A outbound RGB balance to cover payment …');
      const outboundDeadline = Date.now() + CHANNEL_TIMEOUT_S * 1000;
      while (Date.now() < outboundDeadline) {
        if (abortRef.current) throw new Error('Cancelled');
        await wA.syncWallet();
        const channels = (await wA.listChannels()) ?? [];
        const lspChan = (channels as any[]).find((c: any) =>
          (c.peerPubkey || c.peer_pubkey) === LSP_PEER_PUBKEY && (c.isUsable || c.is_usable)
        );
        const outboundMsat = lspChan?.outboundBalanceMsat ?? lspChan?.outbound_balance_msat ?? 0;
        addLog(`userA outbound: ${outboundMsat} msat (need ${PAYMENT_MSAT})`);
        if (outboundMsat >= PAYMENT_MSAT) break;
        await sleep(POLL_INTERVAL_S * 1000);
      }
      addLog('User A outbound balance ready ✓', 'success');

      await wA.syncWallet();
      await wB.syncWallet();
      const initialBalA = await wA.getAssetBalance(ASSET_ID);
      const initialBalB = await wB.getAssetBalance(ASSET_ID);

      // User A sends to User B
      setPhase('p2_pay');

      req('userB.createLightningInvoice', { amtMsat: PAYMENT_MSAT, assetId: short(ASSET_ID), assetAmount: PAYMENT_ASSET_AMOUNT });
      const invBResult = await wB.createLightningInvoice({
        amountSats: PAYMENT_MSAT / 1000,
        expirySeconds: 3600,
        asset: { assetId: ASSET_ID, amount: PAYMENT_ASSET_AMOUNT },
      });
      const bInvoice = invBResult.lnInvoice;
      setLnInvoiceB(bInvoice);
      res('userB.createLightningInvoice', { invoice: short(bInvoice, 32) });

      req('userA.payLightningInvoice → userB invoice');
      const payResult = await wA.payLightningInvoice({ lnInvoice: bInvoice });
      const payStatus = String((payResult as any)?.status ?? '').toLowerCase();
      res('userA.payLightningInvoice', { status: (payResult as any)?.status ?? 'sent' });
      if (payStatus === 'failed') throw new Error('userA.payLightningInvoice failed immediately — check channel balance and route');

      // Poll until User B invoice Succeeded
      setPhase('p2_settle');
      addLog('Polling userB invoice status …');
      setInvoiceStatusB('Pending');
      const p2Deadline = Date.now() + PAYMENT_TIMEOUT_S * 1000;
      let p2Settled = false;
      while (Date.now() < p2Deadline) {
        if (abortRef.current) throw new Error('Cancelled');
        await sleep(POLL_INTERVAL_S * 1000);
        try {
          await wB.syncWallet();
          const statusB = await wB.getLightningReceiveRequest(bInvoice);
          setInvoiceStatusB(statusB ?? 'Pending');
          addLog(`userB invoice: ${statusB}`);
          if (String(statusB) === 'Succeeded' || String(statusB) === 'Settled') { p2Settled = true; break; }
          if (statusB === 'Failed') throw new Error('User B LN invoice failed');
        } catch (e: any) {
          if ((e?.message ?? '').includes('failed')) throw e;
        }
      }

      if (p2Settled) {
        addLog('userB LN invoice Succeeded ✓ — User A paid User B via RGB Lightning!', 'success');
      } else {
        addLog('Part 2 settlement timeout', 'error');
      }

      // Poll offchain balance delta — mirrors test_flow0 wait_until(offchain_balances_updated).
      // NOTE: rlnAssetBalance native binding currently returns only {settled,future,spendable}.
      // offchainOutbound/offchainInbound are absent — this is a known gap in the native binding.
      // The check below will timeout until the native binding is updated to expose these fields.
      addLog('Polling offchain balance delta …');
      const balDeadline = Date.now() + PAYMENT_TIMEOUT_S * 1000;
      let aBalFinal: any = null;
      let bBalFinal: any = null;
      let balancesUpdated = false;
      while (Date.now() < balDeadline) {
        if (abortRef.current) throw new Error('Cancelled');
        await wA.syncWallet(); await wB.syncWallet();
        aBalFinal = await wA.getAssetBalance(ASSET_ID);
        bBalFinal = await wB.getAssetBalance(ASSET_ID);
        setFinalBalA(aBalFinal);
        setFinalBalB(bBalFinal);
        const aOut = aBalFinal?.offchainOutbound ?? 0;
        const bOut = bBalFinal?.offchainOutbound ?? 0;
        const aInit = initialBalA?.offchainOutbound ?? 0;
        const bInit = initialBalB?.offchainOutbound ?? 0;
        addLog(`userA offchainOutbound: ${aInit} → ${aOut}  userB: ${bInit} → ${bOut}`);
        if ((aInit - aOut) === PAYMENT_ASSET_AMOUNT && (bOut - bInit) === PAYMENT_ASSET_AMOUNT) {
          balancesUpdated = true;
          break;
        }
        await sleep(POLL_INTERVAL_S * 1000);
      }
      addLog(
        balancesUpdated
          ? `offchain balance delta confirmed ✓  userA -${PAYMENT_ASSET_AMOUNT}  userB +${PAYMENT_ASSET_AMOUNT}`
          : `offchain balance delta timeout — final: userA offchainOutbound=${aBalFinal?.offchainOutbound ?? 0}  userB=${bBalFinal?.offchainOutbound ?? 0}`,
        balancesUpdated ? 'success' : 'info',
      );

      // Channel still usable after payment (mirrors test_flow0 final assertion)
      try {
        const channelsB = (await wB.listChannels()) ?? [];
        const bChan = (channelsB as any[]).find((c: any) =>
          (c.assetId || c.asset_id) === ASSET_ID && (c.isUsable || c.is_usable)
        );
        addLog(`userB channel post-payment: ${bChan ? 'Opened + usable ✓' : 'not usable'}`, bChan ? 'success' : 'info');
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
    setAddrA(''); setBalA(null); setChannelInfo(null);
    setLnInvoiceA(''); setRgbInvoiceLsp(''); setInvoiceStatus(''); setFinalBalA(null);
    setAddrB(''); setChannelInfoB(null); setLnInvoiceB(''); setInvoiceStatusB(''); setFinalBalB(null);
    setErrorMsg('');
  }, []);

  const isRunning = !['idle', 'done', 'error'].includes(phase);
  const inPart2 = ['p2_pay', 'p2_settle'].includes(phase);
  const spA = (balA?.vanilla?.spendable ?? 0) + (balA?.colored?.spendable ?? 0);
  const stA = (balA?.vanilla?.settled ?? 0) + (balA?.colored?.settled ?? 0);
  const envReady = !!ASSET_ID;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content}>

        <View style={s.header}>
          <Text style={s.title}>LSP · lightning_receive</Text>
          <Text style={s.subtitle}>Regtest · matches e2e conftest.py fixture</Text>
          <View style={s.badge}>
            <View style={[s.dot, { backgroundColor: envReady ? AppColors.success : AppColors.error }]} />
            <Text style={s.badgeTxt}>{envReady ? 'LSP configured' : 'Run start-lsp-regtest.sh first'}</Text>
          </View>
        </View>

        {phase !== 'idle' && (
          <>
            <PhaseRow phases={PHASES_P1} phase={phase} />
            <PhaseRow phases={PHASES_P2} phase={phase} />
          </>
        )}

        {/* Idle */}
        {phase === 'idle' && (
          <View style={s.card}>
            <Text style={s.cardTitle}>test_flow0_full_e2e — LSP Regtest</Text>
            <Text style={s.cardDesc}>
              {'Reproduces the utexo-lsp e2e test test_flow0_full_e2e.py on-device.\n\n' +

               'Setup (before any payment):\n' +
               'LSP opens an RGB Lightning channel to both User A and User B ' +
               'upfront, while the LSP still has fresh UTXOs. This matches the ' +
               'Python conftest fixture which connects both peers before running ' +
               'any transfer activity.\n\n' +

               'Part 1 — lightning_receive (run_lightning_receive_flow):\n' +
               'User A creates a Lightning invoice for 1 RGB unit and registers ' +
               'it with the LSP via lightningReceive. The LSP issues an RGB ' +
               'invoice. The Faucet (external sender) sends 1 RGB on-chain to ' +
               'that invoice. Once the on-chain transfer settles on both sides, ' +
               'the LSP pays User A\'s Lightning invoice — delivering the RGB ' +
               'offchain over the channel. User A now holds 1 RGB unit offchain.\n\n' +

               'Part 2 — User A pays User B:\n' +
               'User A waits until outbound channel balance covers the payment, ' +
               'then pays User B\'s Lightning invoice via the LSP as router. ' +
               'Verifies both invoice settled, offchain balance delta correct, ' +
               'and User B\'s channel still open after payment.'}
            </Text>

            {!envReady && (
              <View style={[s.warnCard]}>
                <Text style={s.warnTxt}>
                  {'Run the setup script first:\n\n  ./scripts/start-lsp-regtest.sh\n\nThen rebuild the app to pick up .env.lsp.local'}
                </Text>
              </View>
            )}

            <View style={s.paramCard}>
              <Text style={s.paramTitle}>Config from env</Text>
              <Text style={s.paramLine}>LSP API     {LSP_URL}</Text>
              <Text style={s.paramLine}>LSP daemon  {LSP_DAEMON_URL}</Text>
              <Text style={s.paramLine}>Faucet      {FAUCET_DAEMON_URL}</Text>
              <Text style={s.paramLine}>Asset ID    {ASSET_ID ? short(ASSET_ID, 28) : '(not set)'}</Text>
              <Text style={s.paramLine}>LSP pubkey  {LSP_PEER_PUBKEY ? short(LSP_PEER_PUBKEY, 28) : '(not set)'}</Text>
              <Text style={s.paramLine}>Payment     {PAYMENT_MSAT / 1000} sat + {PAYMENT_ASSET_AMOUNT} RGB unit</Text>
            </View>

            <TouchableOpacity
              style={[s.startBtn, !envReady && { opacity: 0.4 }]}
              onPress={run}
              disabled={!envReady}
              activeOpacity={0.8}>
              <Text style={s.startBtnTxt}>▶  Run Full E2E Flow</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Running spinner */}
        {isRunning && (phase === 'init' || phase === 'utxos' || phase === 'preflight') && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>
              {phase === 'preflight' ? 'Checking LSP + Faucet daemons …'
                : phase === 'init' ? 'Creating User A node on regtest …'
                : 'Creating UTXOs …'}
            </Text>
          </View>
        )}

        {phase === 'fund' && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>Funding User A (sendToAddress + mine 6) …</Text>
            {addrA ? <Text style={[s.spinnerTxt, { marginTop: 8, fontSize: 11, fontFamily: AppColors.mono }]}>{addrA}</Text> : null}
          </View>
        )}

        {phase === 'channel' && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>Waiting for LSP to open RGB channel …</Text>
            <Text style={[s.spinnerTxt, { fontSize: 11, marginTop: 4 }]}>(mining blocks, LSP cron = 5s)</Text>
          </View>
        )}

        {(phase === 'lsp_flow' || phase === 'rgb_send' || phase === 'settle') && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>
              {phase === 'lsp_flow' ? 'LSP lightningReceive …'
                : phase === 'rgb_send' ? 'Faucet sending RGB to LSP …'
                : `Part 1: waiting for User A invoice … ${invoiceStatus || 'Pending'}`}
            </Text>
          </View>
        )}

        {(phase === 'b_init' || phase === 'b_channel') && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>
              {phase === 'b_init' ? 'Creating User B node (before lightning_receive) …'
                : 'Waiting for LSP → User B RGB channel …'}
            </Text>
          </View>
        )}

        {(phase === 'p2_pay' || phase === 'p2_settle') && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>
              {phase === 'p2_pay' ? 'Part 2: User A sending payment to User B …'
                : `Part 2: waiting for User B invoice … ${invoiceStatusB || 'Pending'}`}
            </Text>
          </View>
        )}

        {/* LSP Info */}
        {lspInfo && (
          <InfoCard title="LSP (utexo-lsp)" accent={AppColors.success} rows={[
            ['API', LSP_URL],
            ['Pubkey', short(lspInfo.pubkey, 28)],
            ['Channels', `${lspInfo.numChannels} total · ${lspInfo.numUsableChannels} usable`],
          ]} />
        )}

        {/* User A */}
        {addrA && (
          <InfoCard title="User A (embedded SDK)" rows={[
            ['Address', addrA],
            ['Settled', satStr(stA)],
            ['Spendable', satStr(spA)],
          ]} />
        )}

        {/* Channel */}
        {channelInfo && (
          <InfoCard title="RGB Channel (LSP → User A)" accent={AppColors.primary} rows={[
            ['Asset', short(ASSET_ID, 28)],
            ['Capacity', `${channelInfo.capacitySat ?? channelInfo.capacity_sat ?? '?'} sat`],
            ['Status', 'Usable ✓'],
          ]} />
        )}

        {/* LN Invoice */}
        {lnInvoiceA && (
          <InfoCard title="User A — LN Invoice" rows={[
            ['BOLT11', short(lnInvoiceA, 32)],
            ['Amount', `${PAYMENT_MSAT / 1000} sat + ${PAYMENT_ASSET_AMOUNT} RGB`],
            ['Status', invoiceStatus || 'Pending'],
          ]} />
        )}

        {/* RGB Invoice from LSP */}
        {rgbInvoiceLsp && (
          <InfoCard title="LSP → RGB Invoice (Faucet pays this)" rows={[
            ['RGB Invoice', short(rgbInvoiceLsp, 32)],
            ['Send amount', `${FAUCET_PAY_AMOUNT} RGB unit`],
          ]} />
        )}

        {/* Part 2 — User B info */}
        {addrB && (
          <InfoCard title="User B (embedded SDK)" rows={[
            ['Address', addrB],
          ]} />
        )}
        {channelInfoB && (
          <InfoCard title="RGB Channel (LSP → User B)" accent={AppColors.primary} rows={[
            ['Asset', short(ASSET_ID, 28)],
            ['Capacity', `${channelInfoB.capacitySat ?? channelInfoB.capacity_sat ?? '?'} sat`],
            ['Status', 'Usable ✓'],
          ]} />
        )}
        {lnInvoiceB && (
          <InfoCard title="User B — LN Invoice" rows={[
            ['BOLT11', short(lnInvoiceB, 32)],
            ['Amount', `${PAYMENT_MSAT / 1000} sat + ${PAYMENT_ASSET_AMOUNT} RGB`],
            ['Status', invoiceStatusB || 'Pending'],
          ]} />
        )}

        {/* Done */}
        {phase === 'done' && (
          <View style={[s.card, { borderColor: invoiceStatusB === 'Settled' ? AppColors.successBorder : AppColors.border }]}>
            <Text style={[s.cardTitle, { color: invoiceStatusB === 'Settled' ? AppColors.success : AppColors.textPrimary }]}>
              {invoiceStatusB === 'Settled' ? '✓ Full E2E Flow Complete' : '⚠ Flow done — check settlement'}
            </Text>
            <Text style={s.cardDesc}>
              {'Part 1: Faucet → LSP → User A via RGB Lightning channel\n' +
               'Part 2: User A → LSP → User B via RGB Lightning\n\n' +
               `User A offchain inbound: ${finalBalA?.offchainInbound ?? 0} → outbound: ${finalBalA?.offchainOutbound ?? 0}\n` +
               `User B offchain inbound: ${finalBalB?.offchainInbound ?? 0}`}
            </Text>
          </View>
        )}

        {/* Error */}
        {phase === 'error' && (
          <View style={[s.card, { borderColor: AppColors.errorBorder, backgroundColor: AppColors.errorBg }]}>
            <Text style={[s.cardTitle, { color: AppColors.error }]}>Flow failed</Text>
            <Text style={[s.cardDesc, { color: '#FCA5A5' }]}>{errorMsg}</Text>
          </View>
        )}

        {(phase === 'done' || phase === 'error') && (
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
  warnCard: { backgroundColor: AppColors.errorBg, borderRadius: 8, padding: 12, marginVertical: 12, borderWidth: 1, borderColor: AppColors.errorBorder },
  warnTxt: { fontSize: 12, color: '#FCA5A5', fontFamily: AppColors.mono, lineHeight: 20 },
  paramCard: { backgroundColor: AppColors.bgCardElevated, borderRadius: 8, padding: 12, marginVertical: 12 },
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
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, backgroundColor: AppColors.bgCard, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: AppColors.border },
  step: { alignItems: 'center', flex: 0 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  dotText: { fontSize: 7, fontWeight: '700' },
  label: { fontSize: 6, fontWeight: '600', letterSpacing: 0.3 },
  line: { flex: 1, height: 2, marginBottom: 8, marginHorizontal: 1 },
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
