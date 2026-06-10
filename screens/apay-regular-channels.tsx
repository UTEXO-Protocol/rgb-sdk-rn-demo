/**
 * APay Cart Checkout — cart scenario on virtual RGB channels (trusted_no_broadcast).
 *
 * Same APay protocol as Async Payment, different UX (shop cart narrative +
 * LSP auto-settlement verify instead of manual claimHodlInvoice).
 *
 * Prerequisites:
 *   ./scripts/start-lsp-local.sh  (virtual LSP + utexo-lsp)
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
  UTEXOWallet,
  type LspPeer,
} from '@utexo/rgb-sdk-rn';

// ── Config ────────────────────────────────────────────────────────────────────

const _host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

const LSP_URL        = `http://${_host}:8080`;
const LSP_DAEMON_URL = `http://${_host}:3005`;

const ASSET_ID     = process.env.EXPO_PUBLIC_LSP_REGTEST_ASSET_ID ?? '';
const LSP_LDK_PORT = Number(process.env.EXPO_PUBLIC_LSP_REGTEST_LDK_PORT ?? '9737');
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

const CART_ITEM            = '1× RGB Token (UTST)';
const PAYMENT_MSAT         = 3_000_000;
const PAYMENT_ASSET_AMOUNT = 1;
const CHANNEL_TIMEOUT_S       = 180;
const SETTLE_TIMEOUT_S        = 120;
const POLL_INTERVAL_MS          = 3_000;
const MERCHANT_KEEPALIVE_MS     = 15_000;

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
const normHash = (h: string) => (h || '').toLowerCase().replace(/^0x/, '');

function chanField<T>(c: Record<string, unknown>, camel: string, snake: string): T | undefined {
  return (c[camel] ?? c[snake]) as T | undefined;
}

/** Settlement-time snapshot — merchant inbound HTLC / claim state vs buyer outbound. */
async function logSettlementDiagnostics(
  wA: UTEXOWallet,
  wB: UTEXOWallet,
  paymentHash: string,
  lspPubkey: string,
  addLog: (msg: string, type?: LogEntry['type']) => void,
): Promise<void> {
  try {
    const [buyerPays, merchantPays, buyerChans, merchantChans, peers] = await Promise.all([
      wA.listPaymentsRaw().catch(() => []),
      wB.listPaymentsRaw().catch(() => []),
      wA.listChannels().catch(() => []),
      wB.listChannels().catch(() => []),
      wB.listPeers().catch(() => []),
    ]);

    const n = normHash(paymentHash);
    const bp = buyerPays.find(p => normHash(p.paymentHash) === n);
    const mp = merchantPays.find(p => normHash(p.paymentHash) === n);

    addLog(
      `diag buyer outbound: ${bp
        ? `${bp.status}/${bp.paymentType ?? '?'} msat=${bp.amtMsat ?? '?'} rgb=${bp.assetAmount ?? '?'}`
        : 'not in listPayments'}`,
    );
    addLog(
      `diag merchant inbound (hash): ${mp
        ? `${mp.status}/${mp.paymentType ?? '?'} preimage=${mp.preimage ? 'yes' : 'no'}`
        : 'not in listPayments'}`,
    );

    const inbound = merchantPays.filter(p =>
      String(p.paymentType ?? '').toLowerCase().includes('inbound'),
    );
    if (inbound.length) {
      const brief = inbound
        .slice(0, 4)
        .map(p => `${short(p.paymentHash, 8)}=${p.status}/${p.paymentType ?? '?'}`)
        .join(' ');
      addLog(`diag merchant inbound (${inbound.length}): ${brief}`);
    } else {
      addLog('diag merchant inbound: none in listPayments');
    }

    const pickLspChan = (chans: typeof buyerChans) =>
      chans.find(c => {
        const peer = String(chanField<string>(c as any, 'peerPubkey', 'peer_pubkey') ?? '');
        const asset = String(chanField<string>(c as any, 'assetId', 'asset_id') ?? '');
        return peer === lspPubkey && asset === ASSET_ID;
      });

    const mChan = pickLspChan(merchantChans);
    const aChan = pickLspChan(buyerChans);
    if (mChan) {
      addLog(
        `diag merchant→LSP chan: localRgb=${chanField<number>(mChan as any, 'assetLocalAmount', 'asset_local_amount') ?? '?'} ` +
        `remoteRgb=${chanField<number>(mChan as any, 'assetRemoteAmount', 'asset_remote_amount') ?? '?'} ` +
        `usable=${chanField<boolean>(mChan as any, 'isUsable', 'is_usable') ?? '?'}`,
      );
    } else {
      addLog('diag merchant→LSP RGB channel: not found');
    }
    if (aChan) {
      addLog(
        `diag buyer→LSP chan: localRgb=${chanField<number>(aChan as any, 'assetLocalAmount', 'asset_local_amount') ?? '?'} ` +
        `remoteRgb=${chanField<number>(aChan as any, 'assetRemoteAmount', 'asset_remote_amount') ?? '?'}`,
      );
    }

    addLog(`diag merchant peers connected: ${peers.length}`);
  } catch (e: any) {
    addLog(`diag error: ${e?.message ?? String(e)}`);
  }
}

/** Keep merchant→LSP P2P warm so APay outbox can deliver async_order.request_invoice + payout. */
function startMerchantPeerKeepalive(
  wallet: UTEXOWallet,
  peerUri: string,
  isAborted: () => boolean,
): () => void {
  let active = true;
  (async () => {
    while (active && !isAborted()) {
      await sleep(MERCHANT_KEEPALIVE_MS);
      if (!active || isAborted()) break;
      try { await wallet.connectPeer(peerUri); } catch { /* already connected */ }
    }
  })();
  return () => { active = false; };
}

const PHASE_LABELS: Record<Phase, string> = {
  idle: 'Idle',
  b_init: 'Shop Init', b_fund: 'Shop Fund', b_utxos: 'Shop UTXOs', b_channel: 'Shop Chan', register: 'Register',
  a_init: 'Buyer Init', a_fund: 'Buyer Fund', a_utxos: 'Buyer UTXOs', a_channel: 'Buyer Chan',
  lnurlp: 'Checkout', send: 'Pay', settle: 'Settle',
  done: 'Done', error: 'Error',
};

const PHASES_P1: Phase[] = ['b_init', 'b_fund', 'b_utxos', 'b_channel', 'register'];
const PHASES_P2: Phase[] = ['a_init', 'a_fund', 'a_utxos', 'a_channel', 'lnurlp', 'send', 'settle', 'done'];

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

export default function ApayRegularChannelsScreen({ embedded = false }: { embedded?: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog]     = useState<LogEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const [pubkeyB, setPubkeyB] = useState('');
  const [lnaddrUsername, setLnaddrUsername] = useState('');
  const [lnaddrDomain, setLnaddrDomain] = useState('');
  const [hashPoolInfo, setHashPoolInfo] = useState<any>(null);
  const [channelB, setChannelB] = useState<any>(null);
  const [channelA, setChannelA] = useState<any>(null);
  const [hodlBolt11, setHodlBolt11] = useState('');
  const [paymentHash, setPaymentHash] = useState('');
  const [sendStatus, setSendStatus] = useState('');
  const [finalBalB, setFinalBalB] = useState<any>(null);

  const walletARef = useRef<UTEXOWallet | null>(null);
  const walletBRef = useRef<UTEXOWallet | null>(null);
  const abortRef   = useRef(false);

  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
    const time = new Date().toLocaleTimeString('en', { hour12: false });
    setLog(prev => [...prev.slice(-500), { time, msg, type }]);
    console.log(`[apay-reg][${type}] ${msg}`);
  }, []);

  const run = useCallback(async () => {
    abortRef.current = false;
    setLog([]); setErrorMsg('');
    setPubkeyB(''); setLnaddrUsername(''); setLnaddrDomain('');
    setHashPoolInfo(null); setChannelB(null);
    setChannelA(null); setHodlBolt11(''); setPaymentHash('');
    setSendStatus(''); setFinalBalB(null);

    const req = (label: string, p?: Record<string, any>) =>
      addLog(`→ ${label}${p ? '  ' + Object.entries(p).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : ''}`);
    const res = (label: string, d?: Record<string, any>) =>
      addLog(`← ${label}${d ? '  ' + Object.entries(d).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : ''}`, 'success');

    try {
      // ── Merchant (User B) — shop setup ─────────────────────────────────────
      setPhase('b_init');
      addLog(`Platform=${Platform.OS}  host=${_host}`);
      addLog(`LSP_URL=${LSP_URL}`);
      if (!ASSET_ID) throw new Error('EXPO_PUBLIC_LSP_REGTEST_ASSET_ID not set — run ./scripts/start-lsp-local.sh');

      addLog('Fetching LSP pubkey from /nodeinfo…');
      const lspNodeInfo = await fetch(`${LSP_DAEMON_URL}/nodeinfo`).then(r => r.json()) as any;
      LSP_PEER_PUBKEY = lspNodeInfo?.pubkey ?? LSP_PEER_PUBKEY;
      if (!LSP_PEER_PUBKEY) throw new Error('Could not fetch LSP pubkey — is the LSP daemon running?');
      addLog(`LSP pubkey: ${LSP_PEER_PUBKEY}`, 'success');

      const LSP_PEER: LspPeer = {
        baseUrl:    LSP_URL,
        peerPubkey: LSP_PEER_PUBKEY,
        peerHost:   _host,
        peerPort:   LSP_LDK_PORT,
      };

      const keysB = await createWallet('regtest' as any);
      const tsB   = Date.now();
      const portB = 44000 + Math.floor(Math.random() * 2000);
      const dirB  = `${documentDirectory ?? ''}apay_reg_b_${tsB}`;
      await FileSystem.makeDirectoryAsync(dirB, { intermediates: true });

      const wB = new UTEXOWallet(
        {
          storageDirPath: dirB.replace('file://', ''),
          daemonListeningPort: portB,
          ldkPeerListeningPort: portB + 1,
          network: 'regtest',
          maxMediaUploadSizeMb: 20,
          enableVirtualChannelsV0: true,
          virtualPeerPubkeys: [LSP_PEER_PUBKEY],
        },
        new PasswordRLNSigner('apayregB', keysB.mnemonic),
      );
      walletBRef.current = wB;
      const lspB = await wB.createLsp(LSP_PEER);
      await wB.init();
      await wB.unlock(REGTEST_UNLOCK);

      const bPubkey = String((await wB.getNodeInfo())?.pubkey ?? '');
      setPubkeyB(bPubkey);
      res('merchant.init', { pubkey: short(bPubkey) });

      setPhase('b_fund');
      const addrB = await wB.getAddress();
      req('sendToAddress merchant 1 BTC');
      await sendToAddress(addrB, 1);
      await mine(6);
      await sleep(3000);
      await wB.syncWallet();
      res('merchant.funded');

      setPhase('b_utxos');
      req('merchant.createUtxos');
      await wB.syncWallet();
      await wB.refreshWallet();
      await wB.createUtxos({ upTo: false, num: 10, feeRate: 7 });
      await mine(1);
      await wB.syncWallet();
      res('merchant.createUtxos');

      setPhase('b_channel');
      const lspPeerUri = `${LSP_PEER_PUBKEY}@${_host}:${LSP_LDK_PORT}`;
      req('lspB.connect');
      await lspB.connect();
      res('lspB.connect');

      addLog('Mining blocks to trigger virtual RGB channel LSP → merchant…');
      await mine(2);
      await sleep(6000);

      addLog('Waiting for virtual RGB channel usable on merchant…');
      const chanB = await lspB.waitForChannel(ASSET_ID, {
        timeoutMs:      CHANNEL_TIMEOUT_S * 1000,
        pollIntervalMs: POLL_INTERVAL_MS,
        onProgress: (msg) => addLog(`merchant ${msg}`),
        onEachPoll: () => mine(1),
      });
      setChannelB(chanB);
      addLog('Merchant virtual RGB channel usable ✓', 'success');

      addLog('Syncing and waiting for P2P onion path to stabilise (5s)…');
      await wB.syncWallet();
      await mine(2);
      await sleep(5000);
      await wB.syncWallet();

      setPhase('register');
      addLog('Re-connecting to LSP peer before apayNew…');
      try { await wB.connectPeer(lspPeerUri); addLog('merchant re-connect ok', 'success'); }
      catch (e: any) { addLog(`merchant re-connect: ${e?.message ?? String(e)}`); }
      await sleep(1000);

      req('merchant.apayNew', { hostNodeId: short(LSP_PEER_PUBKEY) });
      const pool = await wB.apayNew(LSP_PEER_PUBKEY);
      setHashPoolInfo(pool);
      res('apayNew', {
        orderId:      short(pool.orderId),
        unusedHashes: pool.unusedHashes,
      });
      addLog(`Shop registered ${pool.hashes.length} payment slots with LSP`, 'success');

      req('GET /lightning_address/by_pubkey/{pubkey}');
      const lnaddr = await lspB.http.getLightningAddressByPubkey(bPubkey);
      setLnaddrUsername(lnaddr.username);
      setLnaddrDomain(lnaddr.domain);
      res('lightningAddressByPubkey', { username: lnaddr.username, domain: lnaddr.domain });
      addLog(`Shop Lightning Address: ${lnaddr.username}@${lnaddr.domain}`, 'success');
      addLog(
        'Shop idle (UI) — merchant node stays peer-connected to LSP for APay settlement',
        'info',
      );
      const stopMerchantKeepalive = startMerchantPeerKeepalive(
        wB,
        lspPeerUri,
        () => abortRef.current,
      );

      try {
      // ── Customer (User A) — checkout ─────────────────────────────────────
      setPhase('a_init');

      const keysA = await createWallet('regtest' as any);
      const tsA   = Date.now();
      const portA = 46000 + Math.floor(Math.random() * 2000);
      const dirA  = `${documentDirectory ?? ''}apay_reg_a_${tsA}`;
      await FileSystem.makeDirectoryAsync(dirA, { intermediates: true });

      const wA = new UTEXOWallet(
        {
          storageDirPath: dirA.replace('file://', ''),
          daemonListeningPort: portA,
          ldkPeerListeningPort: portA + 1,
          network: 'regtest',
          maxMediaUploadSizeMb: 20,
          enableVirtualChannelsV0: true,
          virtualPeerPubkeys: [LSP_PEER_PUBKEY],
        },
        new PasswordRLNSigner('apayregA', keysA.mnemonic),
      );
      walletARef.current = wA;
      const lspA = await wA.createLsp(LSP_PEER);
      await wA.init();
      await wA.unlock(REGTEST_UNLOCK);
      res('buyer.init', { pubkey: short(String((await wA.getNodeInfo())?.pubkey ?? '')) });

      setPhase('a_fund');
      const addrA = await wA.getAddress();
      req('sendToAddress buyer 1 BTC');
      await sendToAddress(addrA, 1);
      await mine(6);
      await sleep(3000);
      await wA.syncWallet();
      res('buyer.funded');

      setPhase('a_utxos');
      req('buyer.createUtxos');
      await wA.syncWallet();
      await wA.refreshWallet();
      await wA.createUtxos({ upTo: false, num: 10, feeRate: 7 });
      await mine(1);
      await wA.syncWallet();
      res('buyer.createUtxos');

      setPhase('a_channel');
      req('lspA.connect');
      await lspA.connect();
      res('lspA.connect');

      addLog('Mining blocks to trigger virtual RGB channel LSP → buyer…');
      await mine(2);
      await sleep(6000);

      addLog('Waiting for virtual RGB channel usable on buyer…');
      const chanA = await lspA.waitForChannel(ASSET_ID, {
        timeoutMs:      CHANNEL_TIMEOUT_S * 1000,
        pollIntervalMs: POLL_INTERVAL_MS,
        onProgress: (msg) => addLog(`buyer ${msg}`),
        onEachPoll: () => mine(1),
      });
      setChannelA(chanA);
      addLog('Buyer RGB channel usable ✓', 'success');

      let balBefore = 0;
      try {
        const b0 = await wB.getAssetBalance(ASSET_ID);
        balBefore = Number(b0?.offchainInbound ?? 0);
      } catch {}

      setPhase('lnurlp');
      const username = lnaddr.username;
      if (!username) throw new Error('Lightning Address username missing');

      req('GET /.well-known/lnurlp/{username} → callback', {
        username,
        cart: CART_ITEM,
        amtMsat: PAYMENT_MSAT,
        assetAmount: PAYMENT_ASSET_AMOUNT,
      });
      const callbackData = await lspA.http.resolveAddress(
        username, PAYMENT_MSAT, ASSET_ID, PAYMENT_ASSET_AMOUNT,
      );
      if (!callbackData.pr) throw new Error('LNURL callback returned no invoice (pr)');

      setHodlBolt11(callbackData.pr);
      res('checkout HODL BOLT11', { invoice: short(callbackData.pr, 32) });

      addLog('Merchant peer refresh before buyer checkout payment…');
      try { await wB.connectPeer(lspPeerUri); await wB.syncWallet(); }
      catch (e: any) { addLog(`merchant pre-pay connect: ${e?.message ?? String(e)}`); }

      setPhase('send');
      req('buyer.payLightningInvoice (cart checkout)');
      const payRes = await wA.payLightningInvoice({
        lnInvoice: callbackData.pr,
        assetId: ASSET_ID,
        assetAmount: PAYMENT_ASSET_AMOUNT,
      });
      const pHash = payRes.txid ?? '';
      const payStatus = String(payRes.status ?? '').toLowerCase();
      setPaymentHash(pHash);
      res('buyer.payLightningInvoice', { status: payRes.status, paymentHash: short(pHash) });

      if (payStatus === 'failed') {
        throw new Error(
          'Checkout payment failed — buyer has no RGB on LSP channel (push_asset_amount=0). ' +
          'Restart LSP: ./scripts/start-lsp-local.sh (needs DEFAULT_CHANNEL_PUSH_ASSET_AMOUNT=1).',
        );
      }
      addLog('Cart paid — LSP holds HODL HTLC; waiting for LSP outbox settlement…', 'success');
      await sleep(3000);

      // ── LSP-driven settlement (steps ⑤⑥ — no manual claim) ─────────────
      setPhase('settle');
      addLog('Waiting for LSP outbox (merchant peer kept warm)…');

      try { await wB.connectPeer(lspPeerUri); addLog('merchant peer reconnect ok', 'success'); }
      catch (e: any) { addLog(`merchant reconnect: ${e?.message ?? String(e)}`); }
      await wB.syncWallet();
      await wB.refreshWallet();
      await mine(1);
      await logSettlementDiagnostics(wA, wB, pHash, LSP_PEER_PUBKEY, addLog);

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
          try {
            await wB.connectPeer(lspPeerUri);
            addLog('merchant peer keepalive reconnect');
          } catch {}
        }
        await wA.syncWallet();
        await wB.syncWallet();
        await wB.refreshWallet();

        const status = pHash ? await wA.getLightningSendRequest(pHash) : 'Pending';
        setSendStatus(status ?? 'Pending');
        addLog(`buyer payment status: ${status}`);

        let balAfter = balBefore;
        try {
          const b1 = await wB.getAssetBalance(ASSET_ID);
          balAfter = Number(b1?.offchainInbound ?? 0);
          setFinalBalB(b1);
          addLog(`merchant offchainInbound: ${balAfter} (was ${balBefore})`);
        } catch {}

        diagEvery += POLL_INTERVAL_MS;
        if (diagEvery >= MERCHANT_KEEPALIVE_MS) {
          diagEvery = 0;
          await logSettlementDiagnostics(wA, wB, pHash, LSP_PEER_PUBKEY, addLog);
        }

        if (status === 'Settled' && balAfter > balBefore) {
          settled = true;
          addLog(`merchant received +${balAfter - balBefore} RGB (offchain inbound)`, 'success');
          break;
        }
        if (status === 'Failed') {
          throw new Error('Buyer payment failed during LSP settlement');
        }
      }

      if (!settled) {
        throw new Error(
          'Timeout waiting for LSP settlement — buyer should be Settled and merchant RGB balance up. ' +
          'Check utexo-lsp DB (outbound_paid without claim_inbound_invoice) and rln-lsp.log for PaymentSent.',
        );
      }

      addLog('LSP claimed buyer HTLC with preimage — cart checkout complete ✓', 'success');
      setPhase('done');

      } finally {
        stopMerchantKeepalive();
      }

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
    setPhase('idle');
    setLog([]); setErrorMsg('');
    setPubkeyB(''); setLnaddrUsername(''); setLnaddrDomain('');
    setHashPoolInfo(null); setChannelB(null);
    setChannelA(null); setHodlBolt11(''); setPaymentHash('');
    setSendStatus(''); setFinalBalB(null);
  }, []);

  const isRunning = !['idle', 'done', 'error'].includes(phase);
  const envReady  = !!ASSET_ID;
  const lnAddress = lnaddrUsername && lnaddrDomain
    ? `${lnaddrUsername}@${lnaddrDomain}`
    : lnaddrUsername ? `${lnaddrUsername}@…` : '';

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
          <Text style={s.title}>APay Cart Checkout</Text>
          <Text style={s.subtitle}>Regtest · cart scenario · virtual RGB channels</Text>
          <View style={s.badge}>
            <View style={[s.dot, { backgroundColor: envReady ? AppColors.success : AppColors.error }]} />
            <Text style={s.badgeTxt}>{envReady ? 'LSP configured' : 'Run start-lsp-local.sh first'}</Text>
          </View>
        </View>

        {phase !== 'idle' && (
          <>
            <PhaseRow phases={PHASES_P1} phase={phase} />
            <PhaseRow phases={PHASES_P2} phase={phase} />
          </>
        )}

        {phase === 'idle' && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Cart Checkout Scenario</Text>
            <Text style={s.cardDesc}>
              {'This flow models an RGB shop checkout with async delivery:\n\n' +
               '🛒 Cart — Customer (Alice / User A) buys:\n' +
               `   ${CART_ITEM}\n` +
               `   Total: ${PAYMENT_MSAT / 1000} sat + ${PAYMENT_ASSET_AMOUNT} RGB unit\n\n` +
               '🏪 Merchant (Bob / User B):\n' +
               '   Opens a virtual RGB channel (trusted_no_broadcast) with the LSP.\n' +
               '   Calls apayNew → GET /lightning_address/by_pubkey to get\n' +
               '   shop address (e.g. brisk-river-0421@lsp.local).\n' +
               '   Node keeps P2P to LSP (required for APay outbox).\n\n' +
               '💳 Checkout — Customer:\n' +
               '   GET /.well-known/lnurlp/{username} → callback → HODL BOLT11\n' +
               '   Pays invoice. LSP holds HODL HTLC.\n\n' +
               '📦 Delivery — LSP automatic (steps ⑤⑥):\n' +
               '   LSP outbox requests outbound invoice, pays merchant,\n' +
               '   claims buyer HTLC. No claimHodlInvoice on merchant.\n\n' +
               'Run ./scripts/start-lsp-local.sh before starting (virtual LSP stack).'}
            </Text>

            <View style={s.cartCard}>
              <Text style={s.cartTitle}>Your cart</Text>
              <View style={s.cartRow}>
                <Text style={s.cartItem}>{CART_ITEM}</Text>
                <Text style={s.cartPrice}>{PAYMENT_ASSET_AMOUNT} UTST</Text>
              </View>
              <View style={s.cartDivider} />
              <View style={s.cartRow}>
                <Text style={s.cartTotalLabel}>LN fee (msat)</Text>
                <Text style={s.cartTotalVal}>{PAYMENT_MSAT.toLocaleString()}</Text>
              </View>
            </View>

            {!envReady && (
              <View style={s.warnCard}>
                <Text style={s.warnTxt}>
                  {'Run the local setup script first:\n\n' +
                   '  ./scripts/start-lsp-local.sh'}
                </Text>
              </View>
            )}

            <View style={s.paramCard}>
              <Text style={s.paramTitle}>Config</Text>
              <Text style={s.paramLine}>Channels    virtual trusted_no_broadcast</Text>
              <Text style={s.paramLine}>LSP API     {LSP_URL}</Text>
              <Text style={s.paramLine}>Asset ID    {ASSET_ID ? short(ASSET_ID, 28) : '(not set)'}</Text>
              <Text style={s.paramLine}>Checkout    {PAYMENT_MSAT / 1000} sat + {PAYMENT_ASSET_AMOUNT} RGB</Text>
            </View>

            <TouchableOpacity
              style={[s.startBtn, !envReady && { opacity: 0.4 }]}
              onPress={run}
              disabled={!envReady}
              activeOpacity={0.8}>
              <Text style={s.startBtnTxt}>▶  Run Cart Checkout Flow</Text>
            </TouchableOpacity>
          </View>
        )}

        {isRunning && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>{(() => {
              switch (phase) {
                case 'b_init':    return 'Creating merchant shop node…';
                case 'b_fund':    return 'Funding merchant wallet…';
                case 'b_utxos':   return 'Creating merchant UTXOs…';
                case 'b_channel': return 'Opening virtual RGB channel LSP → merchant…';
                case 'register':  return 'Registering shop Lightning Address (apayNew)…';
                case 'a_init':    return 'Creating buyer node…';
                case 'a_fund':    return 'Funding buyer wallet…';
                case 'a_utxos':   return 'Creating buyer UTXOs…';
                case 'a_channel': return 'Opening virtual RGB channel LSP → buyer…';
                case 'lnurlp':    return 'Checkout — LNURL-pay for cart total…';
                case 'send':      return 'Buyer paying HODL invoice…';
                case 'settle':    return 'Waiting for LSP auto-settlement…';
                default: return 'Working…';
              }
            })()}</Text>
          </View>
        )}

        {hashPoolInfo && (
          <InfoCard title="Shop Registration (apayNew)" accent={AppColors.primary} rows={[
            ['Order ID',   short(hashPoolInfo.orderId, 28)],
            ['Slots',      `${hashPoolInfo.hashes.length} hashes`],
            ['Unused',     String(hashPoolInfo.unusedHashes)],
            ['LN Address', lnAddress || '(pending)'],
          ]} />
        )}

        {channelB && (
          <InfoCard title="Channel · LSP → Merchant" accent={AppColors.success} rows={[
            ['Type',     'Virtual 0-conf'],
            ['Asset',    short(ASSET_ID, 28)],
            ['Capacity', `${channelB.capacitySat ?? channelB.capacity_sat ?? '?'} sat`],
          ]} />
        )}
        {channelA && (
          <InfoCard title="Channel · LSP → Buyer" accent={AppColors.success} rows={[
            ['Type',     'Virtual 0-conf'],
            ['Asset',    short(ASSET_ID, 28)],
            ['Capacity', `${channelA.capacitySat ?? channelA.capacity_sat ?? '?'} sat`],
          ]} />
        )}

        {hodlBolt11 && (
          <InfoCard title="Checkout Invoice (HODL)" accent={AppColors.warning} rows={[
            ['Item',     CART_ITEM],
            ['Invoice',  short(hodlBolt11, 32)],
            ['RGB',      String(PAYMENT_ASSET_AMOUNT)],
            ['Status',   phase === 'send' ? 'Paying…' : sendStatus || 'Held at LSP'],
          ]} />
        )}

        {sendStatus && (
          <InfoCard title="Buyer Payment" accent={AppColors.primary} rows={[
            ['Hash',   short(paymentHash, 28)],
            ['Status', sendStatus],
          ]} />
        )}

        {finalBalB && (
          <InfoCard title="Merchant Balance After Delivery" accent={AppColors.success} rows={[
            ['Offchain In',  String(finalBalB.offchainInbound ?? 0)],
            ['Offchain Out', String(finalBalB.offchainOutbound ?? 0)],
          ]} />
        )}

        {phase === 'done' && (
          <View style={[s.card, { borderColor: AppColors.successBorder }]}>
            <Text style={[s.cardTitle, { color: AppColors.success }]}>
              ✓ Cart Checkout Complete
            </Text>
            <Text style={s.cardDesc}>
              {'1. Merchant registered Lightning Address via by_pubkey\n' +
               '2. Buyer checked out via LNURL-pay (lnurlp + callback)\n' +
               '3. LSP held HODL while merchant peer stayed connected\n' +
               '4. LSP outbox settled — buyer Settled, merchant RGB delivered\n\n' +
               'Virtual channels + LSP auto-settlement — no manual claim.'}
            </Text>
          </View>
        )}

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
  cartCard:       { backgroundColor: AppColors.bgCardElevated, borderRadius: 10, padding: 14, marginVertical: 12, borderWidth: 1, borderColor: AppColors.border },
  cartTitle:      { fontSize: 12, fontWeight: '700', color: AppColors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },
  cartRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  cartItem:       { fontSize: 14, color: AppColors.textPrimary, flex: 1 },
  cartPrice:      { fontSize: 14, fontWeight: '600', color: AppColors.primary, fontFamily: AppColors.mono },
  cartDivider:    { height: 1, backgroundColor: AppColors.border, marginVertical: 8 },
  cartTotalLabel: { fontSize: 13, color: AppColors.textSecondary },
  cartTotalVal:   { fontSize: 13, color: AppColors.textAccent, fontFamily: AppColors.mono },
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
