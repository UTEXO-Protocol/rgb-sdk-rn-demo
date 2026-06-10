/**
 * Async Payment tab — demonstrates the full apay flow:
 *
 * Phase 1 — Recipient (User B) registers a hash pool with the LSP:
 *   wallet.apayNew(lspNodePubkey)
 *   Internally: Recipient RLN → Host RLN (P2P) → utexo-lsp /internal/async_order/new
 *   GET ${LSP_URL}/lightning_address/by_pubkey/${userBPubkey} → username + domain
 *
 * Phase 2 — Sender (User A) discovers User B's Lightning Address and pays:
 *   GET ${LSP_URL}/.well-known/lnurlp/${username}   → LNURL callback
 *   GET ${callback}?amount=${amtMsat}                   → HODL BOLT11
 *   wallet.payLightningInvoice({ lnInvoice: hodlBolt11, assetId, assetAmount })
 *   → HTLC is held at the LSP (payment NOT yet settled)
 *
 * Phase 3 — LSP outbox settlement (merchant stays peer-connected; no manual claim):
 *   User B reconnects to LSP; poll User A payment until Settled.
 *   Merchant inbound auto-claims (APay); LSP claims buyer HTLC with preimage.
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
  UtexoLsp,
  UTEXOWallet,
  type LspPeer,
} from '@utexo/rgb-sdk-rn';

// ── Config ────────────────────────────────────────────────────────────────────

const _host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

const LSP_URL        = `http://${_host}:8080`;
const LSP_DAEMON_URL = `http://${_host}:3005`;

const ASSET_ID    = process.env.EXPO_PUBLIC_LSP_REGTEST_ASSET_ID ?? '';
const LSP_LDK_PORT = Number(process.env.EXPO_PUBLIC_LSP_REGTEST_LDK_PORT ?? '9737');
// LSP pubkey is fetched at runtime from /nodeinfo so no rebuild is needed
// after restarting the LSP stack (each restart generates a new identity).
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

const PAYMENT_MSAT         = 3_000_000;
const PAYMENT_ASSET_AMOUNT = 1;
const CHANNEL_TIMEOUT_S    = 120;
const SETTLE_TIMEOUT_S     = 90;
const POLL_INTERVAL_MS     = 3_000;

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase =
  | 'idle'
  | 'b_init' | 'b_fund' | 'b_utxos' | 'b_channel' | 'register'
  | 'a_init' | 'a_fund' | 'a_utxos' | 'a_channel'
  | 'lnurlp' | 'send' | 'settle'
  | 'done' | 'error';

interface LogEntry { time: string; msg: string; type: 'info' | 'success' | 'error' }

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const short = (s: string, n = 24) => (s || '').slice(0, n) + ((s || '').length > n ? '…' : '');

const PHASE_LABELS: Record<Phase, string> = {
  idle: 'Idle',
  b_init: 'B Init', b_fund: 'B Fund', b_utxos: 'B UTXOs', b_channel: 'B Chan', register: 'Register',
  a_init: 'A Init', a_fund: 'A Fund', a_utxos: 'A UTXOs', a_channel: 'A Chan',
  lnurlp: 'LNURL', send: 'Send', settle: 'Settle',
  done: 'Done', error: 'Error',
};

const PHASES_P1: Phase[] = ['b_init', 'b_fund', 'b_utxos', 'b_channel', 'register'];
const PHASES_P2: Phase[] = ['a_init', 'a_fund', 'a_utxos', 'a_channel', 'lnurlp', 'send', 'settle', 'done'];

function chanField<T>(c: Record<string, unknown>, camel: string, snake: string): T | undefined {
  return (c[camel] ?? c[snake]) as T | undefined;
}

type RgbBalanceSnap = {
  offchainOutbound: number;
  offchainInbound: number;
  settled: number;
  spendable: number;
  localRgb?: number;
  remoteRgb?: number;
};

async function snapshotRgbBalances(
  wallet: UTEXOWallet,
  assetId: string,
  lspPubkey: string,
): Promise<RgbBalanceSnap> {
  const bal = await wallet.getAssetBalance(assetId).catch(() => null);
  const chans = await wallet.listChannels().catch(() => []);
  const ch = chans.find(c => {
    const row = c as unknown as Record<string, unknown>;
    const peer = String(chanField<string>(row, 'peerPubkey', 'peer_pubkey') ?? '');
    const asset = String(chanField<string>(row, 'assetId', 'asset_id') ?? '');
    return peer === lspPubkey && asset === assetId;
  });
  const chRow = ch != null ? (ch as unknown as Record<string, unknown>) : null;
  return {
    offchainOutbound: Number(bal?.offchainOutbound ?? 0),
    offchainInbound: Number(bal?.offchainInbound ?? 0),
    settled: Number(bal?.settled ?? 0),
    spendable: Number(bal?.spendable ?? 0),
    localRgb: chRow != null
      ? Number(chanField<number>(chRow, 'assetLocalAmount', 'asset_local_amount') ?? 0)
      : undefined,
    remoteRgb: chRow != null
      ? Number(chanField<number>(chRow, 'assetRemoteAmount', 'asset_remote_amount') ?? 0)
      : undefined,
  };
}

function logRgbBalanceSnap(
  role: string,
  when: 'START (after channel)' | 'START (pre-checkout)' | 'END (settled)',
  snap: RgbBalanceSnap,
  addLog: (msg: string, type?: LogEntry['type']) => void,
): void {
  const chan =
    snap.localRgb != null
      ? ` | chan local=${snap.localRgb} remote=${snap.remoteRgb}`
      : '';
  addLog(
    `balance ${when} — ${role}: offchainOutbound(local)=${snap.offchainOutbound} ` +
      `offchainInbound(remote)=${snap.offchainInbound} settled=${snap.settled} spendable=${snap.spendable}${chan}`,
    when.startsWith('END') ? 'success' : 'info',
  );
}

function logRgbBalanceDelta(
  role: string,
  before: RgbBalanceSnap,
  after: RgbBalanceSnap,
  addLog: (msg: string, type?: LogEntry['type']) => void,
): void {
  const dOut = after.offchainOutbound - before.offchainOutbound;
  const dIn = after.offchainInbound - before.offchainInbound;
  addLog(
    `balance Δ ${role}: offchainOutbound ${before.offchainOutbound}→${after.offchainOutbound} (${dOut >= 0 ? '+' : ''}${dOut}) ` +
      `offchainInbound ${before.offchainInbound}→${after.offchainInbound} (${dIn >= 0 ? '+' : ''}${dIn})`,
    'success',
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PhaseRow({ phases, phase }: { phases: Phase[]; phase: Phase }) {
  const allPhases: Phase[] = [...PHASES_P1, ...PHASES_P2];
  const idx = allPhases.indexOf(phase);
  return (
    <View style={pb.row}>
      {phases.map((s, i) => {
        const gIdx = allPhases.indexOf(s);
        const done = idx > gIdx;
        const active = phase === s;
        const err = phase === 'error';
        const color = (err && active) ? AppColors.error
          : done ? AppColors.success
          : active ? AppColors.primary
          : AppColors.textTertiary;
        return (
          <React.Fragment key={s}>
            <View style={pb.step}>
              <View style={[pb.dot, { borderColor: color, backgroundColor: active ? color + '20' : 'transparent' }]}>
                {active && phase !== 'error'
                  ? <ActivityIndicator size={8} color={color} />
                  : <Text style={[pb.dotText, { color }]}>{done ? '✓' : (err && active) ? '✗' : gIdx + 1}</Text>}
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
          <Text key={i} style={[lp.line,
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

export default function AsyncPayScreen({ embedded = false }: { embedded?: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog]     = useState<LogEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  // Recipient (User B) state
  const [pubkeyB, setPubkeyB] = useState('');
  const [lnaddrUsername, setLnaddrUsername] = useState('');
  const [lnaddrDomain, setLnaddrDomain] = useState('');
  const [hashPoolInfo, setHashPoolInfo] = useState<any>(null);
  const [channelB, setChannelB] = useState<any>(null);

  // Sender (User A) state
  const [channelA, setChannelA] = useState<any>(null);
  const [hodlBolt11, setHodlBolt11] = useState('');
  const [paymentHash, setPaymentHash] = useState('');

  // Claim state
  const [claimResult, setClaimResult] = useState<any>(null);
  const [finalBalB, setFinalBalB] = useState<any>(null);

  const walletARef = useRef<UTEXOWallet | null>(null);
  const walletBRef = useRef<UTEXOWallet | null>(null);
  const abortRef   = useRef(false);

  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
    const time = new Date().toLocaleTimeString('en', { hour12: false });
    setLog(prev => [...prev.slice(-500), { time, msg, type }]);
    console.log(`[apay][${type}] ${msg}`);
  }, []);

  const run = useCallback(async () => {
    abortRef.current = false;
    setLog([]); setErrorMsg('');
    setPubkeyB(''); setLnaddrUsername(''); setLnaddrDomain('');
    setHashPoolInfo(null); setChannelB(null);
    setChannelA(null); setHodlBolt11(''); setPaymentHash('');
    setClaimResult(null); setFinalBalB(null);

    const req = (label: string, p?: Record<string, any>) =>
      addLog(`→ ${label}${p ? '  ' + Object.entries(p).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : ''}`);
    const res = (label: string, d?: Record<string, any>) =>
      addLog(`← ${label}${d ? '  ' + Object.entries(d).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : ''}`, 'success');

    try {
      // ─────────────────────────────────────────────────────────────────────
      // PHASE 1 — Recipient (User B)
      // ─────────────────────────────────────────────────────────────────────

      setPhase('b_init');
      addLog(`Platform=${Platform.OS}  host=${_host}`);
      addLog(`LSP_URL=${LSP_URL}`);
      if (!ASSET_ID) throw new Error('EXPO_PUBLIC_LSP_REGTEST_ASSET_ID not set — run start-lsp-regtest.sh');

      // Fetch LSP pubkey at runtime so no app rebuild is needed after LSP restarts.
      addLog('Fetching LSP pubkey from /nodeinfo…');
      const lspNodeInfo = await fetch(`${LSP_DAEMON_URL}/nodeinfo`).then(r => r.json()) as any;
      LSP_PEER_PUBKEY = lspNodeInfo?.pubkey ?? LSP_PEER_PUBKEY;
      if (!LSP_PEER_PUBKEY) throw new Error('Could not fetch LSP pubkey — is the LSP daemon running?');
      addLog(`LSP pubkey (full): ${LSP_PEER_PUBKEY}`, 'success');

      const LSP_PEER: LspPeer = {
        baseUrl:    LSP_URL,
        peerPubkey: LSP_PEER_PUBKEY,
        peerHost:   _host,
        peerPort:   LSP_LDK_PORT,
      };

      const keysB = await createWallet('regtest' as any);
      const tsB   = Date.now();
      const portB = 40000 + Math.floor(Math.random() * 2000);
      const dirB  = `${documentDirectory ?? ''}apay_b_${tsB}`;
      await FileSystem.makeDirectoryAsync(dirB, { intermediates: true });

      // enableVirtualChannelsV0: required so User B accepts the 0-conf virtual
      // channel offer from the LSP (DEFAULT_VIRTUAL_OPEN_MODE=trusted_no_broadcast).
      // Without it the LSP's FundingGenerationReady fails with
      // "ChannelFundingType::Virtual requires a negotiated 0-conf channel".
      const wB = new UTEXOWallet(
        {
          storageDirPath: dirB.replace('file://', ''),
          daemonListeningPort: portB,
          ldkPeerListeningPort: portB + 1,
          network: 'regtest',
          maxMediaUploadSizeMb: 20,
          enableVirtualChannelsV0: true,
          // Must allowlist the LSP so User B accepts the virtual channel offer.
          // Without this, the LSP's trusted_no_broadcast open is rejected.
          virtualPeerPubkeys: [LSP_PEER_PUBKEY],
        },
        new PasswordRLNSigner('apaypassB', keysB.mnemonic),
      );
      walletBRef.current = wB;
      const lspB = await wB.createLsp(LSP_PEER);
      await wB.init();
      await wB.unlock(REGTEST_UNLOCK);

      const nodeInfoB = await wB.getNodeInfo();
      const bPubkey   = String(nodeInfoB?.pubkey ?? '');
      setPubkeyB(bPubkey);
      res('userB.init', { pubkey: short(bPubkey) });

      // ── Fund User B ───────────────────────────────────────────────────────
      setPhase('b_fund');

      const addrB = await wB.getAddress();
      req('sendToAddress userB 1 BTC');
      await sendToAddress(addrB, 1);
      await mine(6);
      await sleep(3000);
      await wB.syncWallet();
      res('userB.funded');

      // ── UTXOs ─────────────────────────────────────────────────────────────
      setPhase('b_utxos');

      req('userB.createUtxos');
      await wB.syncWallet();
      await wB.refreshWallet();
      await wB.createUtxos({ upTo: false, num: 10, feeRate: 7 });
      await mine(1);
      await wB.syncWallet();
      res('userB.createUtxos');

      // ── Connect User B to LSP, wait for RGB channel ───────────────────────
      setPhase('b_channel');

      const lspPeerUri = `${LSP_PEER_PUBKEY}@${_host}:${LSP_LDK_PORT}`;
      req('lspB.connect');
      await lspB.connect();
      res('lspB.connect');

      addLog('Mining 2 blocks to trigger LSP channel open for User B…');
      await mine(2);
      await sleep(6000);

      addLog('Waiting for RGB channel usable on User B…');
      const chanB = await lspB.waitForChannel(ASSET_ID, {
        timeoutMs:      CHANNEL_TIMEOUT_S * 1000,
        pollIntervalMs: 3_000,
        onProgress:  (msg) => addLog(`userB ${msg}`),
        onEachPoll:  () => mine(1),
      });
      setChannelB(chanB);
      addLog('User B RGB channel usable ✓', 'success');
      const merchantSnapStart = await snapshotRgbBalances(wB, ASSET_ID, LSP_PEER_PUBKEY);
      logRgbBalanceSnap('userB (merchant)', 'START (after channel)', merchantSnapStart, addLog);

      // Give the node a moment to stabilise onion messaging after channel open.
      addLog('Syncing and waiting for P2P onion path to stabilise (5s)…');
      await wB.syncWallet();
      await mine(2);
      await sleep(5000);
      await wB.syncWallet();

      // ── Register hash pool with LSP ───────────────────────────────────────
      // Triggers: Recipient RLN → Host RLN (P2P) → utexo-lsp /internal/async_order/new
      // Result:   LSP creates Lightning Address for User B keyed by their pubkey.
      setPhase('register');

      const nodeInfoBeforeApay = await wB.getNodeInfo();
      addLog(`nodeInfoB: ${JSON.stringify(nodeInfoBeforeApay)}`);
      addLog(`hostNodeId (LSP pubkey fetched at runtime): ${LSP_PEER_PUBKEY}`);
      // Log actual LDK peer list to verify the connection is live
      const peers = await (wB as any).rln.rlnListPeers();
      addLog(`LDK peers: ${JSON.stringify(peers)}`);
      addLog(`peers match: ${(nodeInfoBeforeApay as any)?.numPeers} peers connected`);

      // Re-connect right before apay to ensure live TCP peer connection.
      // Virtual (0-conf trusted) channels may not maintain active TCP after handshake.
      addLog('Re-connecting to LSP peer before apayNew…');
      const lspPeerUriForApay = `${LSP_PEER_PUBKEY}@${_host}:${LSP_LDK_PORT}`;
      try { await wB.connectPeer(lspPeerUriForApay); addLog('re-connect ok', 'success'); }
      catch (e: any) { addLog(`re-connect (ignored): ${e?.message ?? String(e)}`); }
      await sleep(1000);

      req('userB.apayNew', { hostNodeId: short(LSP_PEER_PUBKEY) });

      let pool: any;
      try {
        pool = await wB.apayNew(LSP_PEER_PUBKEY);
      } catch (apayErr: any) {
        addLog(`apayNew error: code=${apayErr?.code} name=${apayErr?.name} msg=${apayErr?.message ?? String(apayErr)}`, 'error');
        addLog(`apayNew keys: ${Object.keys(apayErr ?? {}).join(', ')}`, 'error');
        addLog(`apayNew full: ${JSON.stringify(apayErr)}`, 'error');
        throw apayErr;
      }
      setHashPoolInfo(pool);
      res('apayNew', {
        orderId:              short(pool.orderId),
        status:               pool.status,
        unusedHashes:         pool.unusedHashes,
        firstHash:            short(pool.hashes[0]?.paymentHash ?? '', 16),
        acceptedThroughIndex: pool.acceptedThroughIndex,
      });
      addLog(`Hash pool registered ✓  ${pool.hashes.length} hashes issued to LSP`, 'success');

      req('GET /lightning_address/by_pubkey/{pubkey}', { pubkey: short(bPubkey) });
      const lnaddr = await lspB.http.getLightningAddressByPubkey(bPubkey);
      setLnaddrUsername(lnaddr.username);
      setLnaddrDomain(lnaddr.domain);
      res('lightningAddressByPubkey', {
        username: lnaddr.username,
        domain: lnaddr.domain,
      });
      addLog(`Lightning Address for User B: ${lnaddr.username}@${lnaddr.domain}`, 'success');

      // ─────────────────────────────────────────────────────────────────────
      // PHASE 2 — Sender (User A)
      // ─────────────────────────────────────────────────────────────────────

      setPhase('a_init');

      const keysA = await createWallet('regtest' as any);
      const tsA   = Date.now();
      const portA = 42000 + Math.floor(Math.random() * 2000);
      const dirA  = `${documentDirectory ?? ''}apay_a_${tsA}`;
      await FileSystem.makeDirectoryAsync(dirA, { intermediates: true });

      const wA = new UTEXOWallet(
        {
          storageDirPath: dirA.replace('file://', ''),
          daemonListeningPort: portA,
          ldkPeerListeningPort: portA + 1,
          network: 'regtest',
          maxMediaUploadSizeMb: 20,
          // Same as User B — LSP opens 0-conf virtual channels (trusted_no_broadcast).
          enableVirtualChannelsV0: true,
          virtualPeerPubkeys: [LSP_PEER_PUBKEY],
        },
        new PasswordRLNSigner('apaypassA', keysA.mnemonic),
      );
      walletARef.current = wA;
      const lspA = await wA.createLsp(LSP_PEER);
      await wA.init();
      await wA.unlock(REGTEST_UNLOCK);
      res('userA.init', { pubkey: short(String((await wA.getNodeInfo())?.pubkey ?? '')) });

      // ── Fund User A ───────────────────────────────────────────────────────
      setPhase('a_fund');

      const addrA = await wA.getAddress();
      req('sendToAddress userA 1 BTC');
      await sendToAddress(addrA, 1);
      await mine(6);
      await sleep(3000);
      await wA.syncWallet();
      res('userA.funded');

      // ── UTXOs ─────────────────────────────────────────────────────────────
      setPhase('a_utxos');

      req('userA.createUtxos');
      await wA.syncWallet();
      await wA.refreshWallet();
      await wA.createUtxos({ upTo: false, num: 10, feeRate: 7 });
      await mine(1);
      await wA.syncWallet();
      res('userA.createUtxos');

      // ── Connect User A to LSP, wait for channel ───────────────────────────
      setPhase('a_channel');

      req('lspA.connect');
      await lspA.connect();
      res('lspA.connect');

      addLog('Mining 2 blocks to trigger LSP channel open for User A…');
      await mine(2);
      await sleep(6000);

      addLog('Waiting for RGB channel usable on User A…');
      const chanA = await lspA.waitForChannel(ASSET_ID, {
        timeoutMs:      CHANNEL_TIMEOUT_S * 1000,
        pollIntervalMs: 3_000,
        onProgress:  (msg) => addLog(`userA ${msg}`),
        onEachPoll:  () => mine(1),
      });
      setChannelA(chanA);
      addLog('User A RGB channel usable ✓', 'success');

      const [buyerSnapStart, merchantSnapCheckout] = await Promise.all([
        snapshotRgbBalances(wA, ASSET_ID, LSP_PEER_PUBKEY),
        snapshotRgbBalances(wB, ASSET_ID, LSP_PEER_PUBKEY),
      ]);
      logRgbBalanceSnap('userA (buyer)', 'START (pre-checkout)', buyerSnapStart, addLog);
      logRgbBalanceSnap('userB (merchant)', 'START (pre-checkout)', merchantSnapCheckout, addLog);
      addLog(
        `Expected checkout: userA offchainOutbound(local) ≥ ${PAYMENT_ASSET_AMOUNT}; ` +
          `after settle userA local −${PAYMENT_ASSET_AMOUNT}, userB local +${PAYMENT_ASSET_AMOUNT}`,
        'info',
      );

      // ─────────────────────────────────────────────────────────────────────
      // PHASE 3 — LNURL-pay: discover User B's Lightning Address at LSP
      // ─────────────────────────────────────────────────────────────────────
      setPhase('lnurlp');

      const username = lnaddr.username;
      if (!username) {
        throw new Error('Lightning Address username missing — hash pool registration may have failed');
      }

      if (!ASSET_ID) {
        throw new Error('EXPO_PUBLIC_LSP_REGTEST_ASSET_ID is required for async-pay (RGB legs avoid Host sendpayment hash collision)');
      }
      req('GET /.well-known/lnurlp/{username} → callback', { username, amtMsat: PAYMENT_MSAT, assetId: ASSET_ID, assetAmount: PAYMENT_ASSET_AMOUNT });
      const callbackData = await lspA.http.resolveAddress(username, PAYMENT_MSAT, ASSET_ID, PAYMENT_ASSET_AMOUNT);
      if (!callbackData.pr) throw new Error('LNURL callback returned no invoice (pr)');

      setHodlBolt11(callbackData.pr);
      res('HODL BOLT11', { invoice: short(callbackData.pr, 32) });
      addLog('LSP created HODL invoice for User B using registered hash pool ✓', 'success');

      // ── User A pays the HODL BOLT11 ───────────────────────────────────────
      // LSP holds the HTLC — does NOT settle yet (User B is "offline").
      setPhase('send');

      req('userA.payLightningInvoice → HODL', {
        assetId: ASSET_ID,
        assetAmount: PAYMENT_ASSET_AMOUNT,
      });
      const payRes = await wA.payLightningInvoice({
        lnInvoice: callbackData.pr,
        assetId: ASSET_ID,
        assetAmount: PAYMENT_ASSET_AMOUNT,
      });
      const pHash = payRes.txid ?? '';
      const payStatus = String(payRes.status ?? '').toLowerCase();
      setPaymentHash(pHash);
      res('userA.payLightningInvoice', {
        status: payRes.status ?? 'unknown',
        paymentHash: short(pHash),
      });
      if (payStatus === 'failed') {
        throw new Error(
          `userA.payLightningInvoice failed for RGB HODL invoice (hash=${short(pHash)}). ` +
            'Check User A RGB channel balance and that asset_id/asset_amount match the LNURL callback.',
        );
      }
      if (payStatus !== 'pending') {
        addLog(`userA pay status is ${payRes.status} (expected Pending for hodl at LSP)`, 'info');
      }
      addLog('HTLC held at LSP — User B is "offline" (payment not yet settled)', 'success');

      // Give LSP time to process the HTLC
      await sleep(3000);

      // ── LSP outbox settlement (merchant online; no claimHodlInvoice) ─────
      setPhase('settle');
      addLog('User B online — waiting for LSP outbox settlement…');

      try { await wB.connectPeer(lspPeerUri); addLog('User B peer reconnect ok', 'success'); }
      catch (e: any) { addLog(`User B peer reconnect (ignored): ${e?.message ?? String(e)}`); }
      await sleep(2000);

      const normHash = (h: string) => (h || '').toLowerCase().replace(/^0x/, '');
      const settleDeadline = Date.now() + SETTLE_TIMEOUT_S * 1000;
      let settled = false;
      let reconnectEvery = 0;

      while (Date.now() < settleDeadline) {
        if (abortRef.current) throw new Error('Cancelled');
        await sleep(POLL_INTERVAL_MS);
        await mine(1);

        reconnectEvery += POLL_INTERVAL_MS;
        if (reconnectEvery >= 15000) {
          reconnectEvery = 0;
          try { await wB.connectPeer(lspPeerUri); } catch {}
        }

        await wA.syncWallet();
        await wB.syncWallet();

        const buyerStatus = pHash ? await wA.getLightningSendRequest(pHash) : 'Pending';
        addLog(`userA payment status: ${buyerStatus ?? 'Pending'}`);

        const pays = await wB.listPaymentsRaw().catch(() => []);
        const mp = pays.find(p => normHash(p.paymentHash) === normHash(pHash));
        if (mp) {
          addLog(`userB inbound: ${mp.paymentType}/${mp.status}`, 'info');
        }

        if (buyerStatus === 'Settled' && mp && String(mp.status ?? '').toLowerCase() === 'succeeded') {
          settled = true;
          addLog('userA Settled + userB inbound SUCCEEDED — APay complete ✓', 'success');
          break;
        }
        if (buyerStatus === 'Settled') {
          settled = true;
          addLog('userA Settled — LSP claimed buyer HTLC ✓', 'success');
          break;
        }
        if (buyerStatus === 'Failed') {
          throw new Error('userA payment failed during LSP settlement');
        }
      }

      if (!settled) {
        throw new Error(
          'Timeout waiting for LSP settlement — userA should reach Settled. ' +
          'Check utexo-lsp DB and merchant peer connection.',
        );
      }

      try {
        await wB.syncWallet();
        await wA.syncWallet();
        const [buyerSnapEnd, merchantSnapEnd] = await Promise.all([
          snapshotRgbBalances(wA, ASSET_ID, LSP_PEER_PUBKEY),
          snapshotRgbBalances(wB, ASSET_ID, LSP_PEER_PUBKEY),
        ]);
        logRgbBalanceSnap('userA (buyer)', 'END (settled)', buyerSnapEnd, addLog);
        logRgbBalanceSnap('userB (merchant)', 'END (settled)', merchantSnapEnd, addLog);
        logRgbBalanceDelta('userA (buyer)', buyerSnapStart, buyerSnapEnd, addLog);
        logRgbBalanceDelta('userB (merchant)', merchantSnapCheckout, merchantSnapEnd, addLog);
        setFinalBalB(await wB.getAssetBalance(ASSET_ID));
      } catch {}

      setPhase('done');

    } catch (e: any) {
      const msg = e?.message ?? String(e);
      addLog(`Fatal: ${msg}`, 'error');
      addLog(`  code=${e?.code}  name=${e?.name}  keys=${Object.keys(e ?? {}).join(',')}`, 'error');
      setErrorMsg(msg);
      setPhase('error');
    }
  }, [addLog]);

  const reset = useCallback(async () => {
    abortRef.current = true;
    if (walletARef.current) { try { await walletARef.current.destroy(); } catch {} walletARef.current = null; }
    if (walletBRef.current) { try { await walletBRef.current.destroy(); } catch {} walletBRef.current = null; }
    setPhase('idle');
    setLog([]); setErrorMsg('');
    setPubkeyB(''); setLnaddrUsername(''); setLnaddrDomain('');
    setHashPoolInfo(null); setChannelB(null);
    setChannelA(null); setHodlBolt11(''); setPaymentHash('');
    setClaimResult(null); setFinalBalB(null);
  }, []);

  const isRunning  = !['idle', 'done', 'error'].includes(phase);
  const envReady   = !!ASSET_ID;

  const Root = embedded ? View : SafeAreaView;
  const rootProps = embedded
    ? { style: s.embedded }
    : { style: s.safe, edges: ['top', 'left', 'right'] as const };

  return (
    <Root {...rootProps}>
      <ScrollView
        style={embedded ? undefined : s.scroll}
        contentContainerStyle={s.content}
        scrollEnabled={!embedded}
        nestedScrollEnabled={embedded}>

        <View style={s.header}>
          <Text style={s.title}>Async Payment (apay)</Text>
          <Text style={s.subtitle}>Regtest · HODL invoice + hash pool protocol</Text>
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
            <Text style={s.cardTitle}>Full Async Payment Flow</Text>
            <Text style={s.cardDesc}>
              {'Demonstrates the complete async payment (apay) protocol — three parts:\n\n' +
               'Part 1 — Recipient (User B) registers a hash pool:\n' +
               'User B creates an RGB channel with the LSP, then calls\n' +
               'apayNew(lspNodePubkey). Internally the RLN node\n' +
               'sends hashes to the Host RLN via P2P onion messages. The LSP\n' +
               'stores the pool and creates a Lightning Address for User B.\n\n' +
               'Part 2 — Sender (User A) pays via LNURL-pay:\n' +
               'User A discovers User B\'s Lightning Address at the LSP, gets\n' +
               'a HODL BOLT11 invoice, and pays it. The LSP holds the HTLC —\n' +
               'the payment is NOT yet settled. User B is "offline".\n\n' +
               'Part 3 — LSP settlement (no manual claim):\n' +
               'User B stays peer-connected; LSP outbox pays merchant\n' +
               'and claims userA HTLC when merchant auto-claims.\n' +
               'receives the preimage, settles the inbound HTLC from User A,\n' +
               'and the payment completes end-to-end.'}
            </Text>

            {!envReady && (
              <View style={s.warnCard}>
                <Text style={s.warnTxt}>
                  {'Run the setup script first:\n\n  ./scripts/start-lsp-regtest.sh\n\nThen rebuild the app.'}
                </Text>
              </View>
            )}

            <View style={s.paramCard}>
              <Text style={s.paramTitle}>Config</Text>
              <Text style={s.paramLine}>LSP API     {LSP_URL}</Text>
              <Text style={s.paramLine}>LSP daemon  {LSP_DAEMON_URL}</Text>
              <Text style={s.paramLine}>Asset ID    {ASSET_ID ? short(ASSET_ID, 28) : '(not set)'}</Text>
              <Text style={s.paramLine}>LSP pubkey  {LSP_PEER_PUBKEY ? short(LSP_PEER_PUBKEY, 28) : '(not set)'}</Text>
              <Text style={s.paramLine}>Payment     {PAYMENT_MSAT / 1000} sat + {PAYMENT_ASSET_AMOUNT} RGB unit</Text>
            </View>

            <TouchableOpacity
              style={[s.startBtn, !envReady && { opacity: 0.4 }]}
              onPress={run}
              disabled={!envReady}
              activeOpacity={0.8}>
              <Text style={s.startBtnTxt}>▶  Run Async Payment Flow</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Spinner */}
        {isRunning && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>{(() => {
              switch (phase) {
                case 'b_init':    return 'Creating User B (recipient) node…';
                case 'b_fund':    return 'Funding User B (sendToAddress + mine 6)…';
                case 'b_utxos':   return 'Creating UTXOs for User B…';
                case 'b_channel': return 'Waiting for LSP → User B RGB channel…';
                case 'register':  return 'Registering hash pool with LSP (apayNew)…';
                case 'a_init':    return 'Creating User A (sender) node…';
                case 'a_fund':    return 'Funding User A…';
                case 'a_utxos':   return 'Creating UTXOs for User A…';
                case 'a_channel': return 'Waiting for LSP → User A RGB channel…';
                case 'lnurlp':    return 'Discovering User B Lightning Address via LNURL-pay…';
                case 'send':      return 'User A paying HODL invoice (LSP holds HTLC)…';
                case 'settle':    return 'Waiting for LSP settlement (userA Settled)…';
                default: return 'Working…';
              }
            })()}</Text>
            {phase === 'register' && (
              <Text style={[s.spinnerTxt, { fontSize: 11, marginTop: 6, fontFamily: AppColors.mono }]}>
                {'Recipient RLN → Host RLN (P2P) → utexo-lsp /internal/async_order/new'}
              </Text>
            )}
          </View>
        )}

        {/* Hash pool card */}
        {hashPoolInfo && (
          <InfoCard title="Hash Pool (apayNew)" accent={AppColors.primary} rows={[
            ['Order ID',   short(hashPoolInfo.orderId, 28)],
            ['Status',     hashPoolInfo.status],
            ['Hashes',     `${hashPoolInfo.hashes.length} issued`],
            ['Unused',     String(hashPoolInfo.unusedHashes)],
            ['Accepted→',  String(hashPoolInfo.acceptedThroughIndex)],
            ['LN Address', lnaddrUsername && lnaddrDomain
              ? `${lnaddrUsername}@${lnaddrDomain}`
              : lnaddrUsername
                ? `${lnaddrUsername}@…`
                : '(pending)'],
          ]} />
        )}

        {/* Channels */}
        {channelB && (
          <InfoCard title="RGB Channel (LSP → User B)" accent={AppColors.success} rows={[
            ['Asset',    short(ASSET_ID, 28)],
            ['Capacity', `${channelB.capacitySat ?? channelB.capacity_sat ?? '?'} sat`],
            ['Status',   'Usable ✓'],
          ]} />
        )}
        {channelA && (
          <InfoCard title="RGB Channel (LSP → User A)" accent={AppColors.success} rows={[
            ['Asset',    short(ASSET_ID, 28)],
            ['Capacity', `${channelA.capacitySat ?? channelA.capacity_sat ?? '?'} sat`],
            ['Status',   'Usable ✓'],
          ]} />
        )}

        {/* HODL invoice */}
        {hodlBolt11 && (
          <InfoCard title="HODL BOLT11 (LSP holding HTLC)" accent={AppColors.warning} rows={[
            ['Invoice',     short(hodlBolt11, 32)],
            ['Amount',      `${PAYMENT_MSAT / 1000} sat`],
            ['Pmt Hash',    short(paymentHash, 28)],
            ['Status',      'HTLC held — User B offline'],
          ]} />
        )}

        {/* Claim result */}
        {claimResult && (
          <InfoCard title="Claim Result" accent={AppColors.success} rows={[
            ['Changed',  String(claimResult.changed)],
            ['Status',   'Preimage revealed to LSP ✓'],
          ]} />
        )}

        {/* Final balance */}
        {finalBalB && (
          <InfoCard title="User B Final Balance" accent={AppColors.success} rows={[
            ['Offchain In',  String(finalBalB.offchainInbound ?? 0)],
            ['Offchain Out', String(finalBalB.offchainOutbound ?? 0)],
            ['Settled',      String(finalBalB.settled ?? 0)],
          ]} />
        )}

        {/* Done */}
        {phase === 'done' && (
          <View style={[s.card, { borderColor: AppColors.successBorder }]}>
            <Text style={[s.cardTitle, { color: AppColors.success }]}>
              ✓ Async Payment Complete
            </Text>
            <Text style={s.cardDesc}>
              {'1. User B registered hash pool → LSP created Lightning Address\n' +
               '2. User A paid via LNURL-pay → LSP held HTLC\n' +
               '3. LSP outbox settled — userA Settled\n' +
               '4. LSP settled inbound HTLC from User A\n\n' +
               'Full async payment lifecycle demonstrated end-to-end.'}
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
    </Root>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  embedded:       { backgroundColor: AppColors.bgBase },
  safe:           { flex: 1, backgroundColor: AppColors.bgBase },
  scroll:         { flex: 1 },
  content:        { padding: 16, paddingBottom: 60 },
  header:         { marginBottom: 20 },
  title:          { fontSize: 22, fontWeight: '700', color: AppColors.textPrimary, letterSpacing: -0.3 },
  subtitle:       { fontSize: 13, color: AppColors.textSecondary, marginTop: 2 },
  badge:          { flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: AppColors.bgCard, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', borderWidth: 1, borderColor: AppColors.border },
  dot:            { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  badgeTxt:       { fontSize: 11, color: AppColors.textSecondary, fontFamily: AppColors.mono },
  card:           { backgroundColor: AppColors.bgCard, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: AppColors.border, marginBottom: 16 },
  cardTitle:      { fontSize: 15, fontWeight: '700', color: AppColors.textPrimary, marginBottom: 8 },
  cardDesc:       { fontSize: 13, color: AppColors.textSecondary, lineHeight: 22 },
  warnCard:       { backgroundColor: AppColors.errorBg, borderRadius: 8, padding: 12, marginVertical: 12, borderWidth: 1, borderColor: AppColors.errorBorder },
  warnTxt:        { fontSize: 12, color: '#FCA5A5', fontFamily: AppColors.mono, lineHeight: 20 },
  paramCard:      { backgroundColor: AppColors.bgCardElevated, borderRadius: 8, padding: 12, marginVertical: 12 },
  paramTitle:     { fontSize: 11, color: AppColors.textTertiary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 },
  paramLine:      { fontSize: 12, color: AppColors.textSecondary, fontFamily: AppColors.mono, marginBottom: 2 },
  startBtn:       { backgroundColor: AppColors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  startBtnTxt:    { fontSize: 15, fontWeight: '700', color: AppColors.black },
  spinnerCard:    { backgroundColor: AppColors.bgCard, borderRadius: 12, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: AppColors.border, marginBottom: 16 },
  spinnerTxt:     { fontSize: 14, color: AppColors.textSecondary, marginTop: 14, textAlign: 'center' },
  resetBtn:       { borderWidth: 1, borderColor: AppColors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 16 },
  resetBtnTxt:    { fontSize: 14, fontWeight: '600', color: AppColors.primary },
  cancelBtn:      { borderWidth: 1, borderColor: AppColors.error, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginBottom: 16 },
  cancelBtnTxt:   { fontSize: 13, color: AppColors.error },
});

const pb = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', marginBottom: 12, backgroundColor: AppColors.bgCard, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: AppColors.border },
  step:    { alignItems: 'center', flex: 0 },
  dot:     { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  dotText: { fontSize: 7, fontWeight: '700' },
  label:   { fontSize: 6, fontWeight: '600', letterSpacing: 0.3 },
  line:    { flex: 1, height: 2, marginBottom: 8, marginHorizontal: 1 },
});

const ic = StyleSheet.create({
  card:  { backgroundColor: AppColors.bgCard, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: AppColors.border, marginBottom: 10 },
  title: { fontSize: 11, color: AppColors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  row:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderTopColor: AppColors.border },
  key:   { fontSize: 12, color: AppColors.textTertiary, flex: 1 },
  val:   { fontSize: 12, color: AppColors.textAccent, fontFamily: AppColors.mono, flex: 2, textAlign: 'right' },
});

const lp = StyleSheet.create({
  box:    { backgroundColor: AppColors.bgCard, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: AppColors.border, marginTop: 8 },
  header: { fontSize: 11, color: AppColors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  empty:  { fontSize: 12, color: AppColors.textTertiary, fontStyle: 'italic' },
  line:   { fontSize: 11, color: AppColors.textSecondary, fontFamily: AppColors.mono, lineHeight: 18 },
});
