/**
 * Virtual Channel Asset Payment — on-device mirror of
 * test_virtual_channel_asset_payment_succeeds.py.
 *
 * Two embedded SDK nodes open a virtual RGB channel peer-to-peer (no LSP).
 * Node A issues the VTST asset, opens the channel to Node B, then makes
 * a bidirectional payment to prove the channel works in both directions.
 */
import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors } from '@/constants/theme';
import { InfoCard, LogPane } from '@/screens/lsp-regtest/components';
import {
  CHANNEL_ASSET_AMOUNT, CHANNEL_CAPACITY_SAT,
  PAYMENT_ASSET_AMOUNT, PAYMENT_MSAT, VIRTUAL_OPEN_MODE,
  short, satStr, type Phase,
} from './config';
import { useVirtualChannelFlow } from './useVirtualChannelFlow';

// ── Phase progress ────────────────────────────────────────────────────────────

const PHASES_SETUP: Phase[] = ['init', 'init_b', 'fund', 'issue', 'connect', 'open_channel', 'wait_channel', 'open_btc_channel'];
const PHASES_PAY:   Phase[] = ['pay_ab', 'settle_ab', 'pay_ba', 'settle_ba', 'close_channel', 'reopen_attempt', 'client_regular_open', 'done'];
const ALL_PHASES   = [...PHASES_SETUP, ...PHASES_PAY];

const PHASE_LABELS: Partial<Record<Phase, string>> = {
  init:            'A Init',
  init_b:          'B Init',
  fund:            'Fund',
  issue:           'Issue',
  connect:         'Connect',
  open_channel:    'Open',
  wait_channel:    'Wait',
  open_btc_channel:'2nd (BTC)',
  pay_ab:          'A→B',
  settle_ab:       'Settle',
  pay_ba:          'B→A',
  settle_ba:       'Settle',
  close_channel:   'Close',
  reopen_attempt:  'Reopen',
  client_regular_open: 'C→B Regular',
  done:            'Done',
};

function PhaseRow({ phases, phase }: { phases: Phase[]; phase: Phase }) {
  const idx = ALL_PHASES.indexOf(phase);
  return (
    <View style={pb.row}>
      {phases.map((s, i) => {
        const globalIdx = ALL_PHASES.indexOf(s);
        const done   = idx > globalIdx;
        const active = phase === s;
        const color  = phase === 'error' && active
          ? AppColors.error
          : done ? AppColors.success
          : active ? AppColors.primary
          : AppColors.textTertiary;
        return (
          <React.Fragment key={s}>
            <View style={pb.step}>
              <View style={[pb.dot, { borderColor: color, backgroundColor: active ? color + '20' : 'transparent' }]}>
                {active && phase !== 'error'
                  ? <ActivityIndicator size={8} color={color} />
                  : <Text style={[pb.dotText, { color }]}>{done ? '✓' : phase === 'error' && active ? '✗' : globalIdx + 1}</Text>}
              </View>
              <Text style={[pb.label, { color }]}>{PHASE_LABELS[s] ?? s}</Text>
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

// ── Screen ────────────────────────────────────────────────────────────────────

export default function VirtualChannelScreen({ embedded = false }: { embedded?: boolean }) {
  const flow = useVirtualChannelFlow();
  const isRunning = !['idle', 'done', 'error'].includes(flow.phase);

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
        nestedScrollEnabled={embedded}
      >
        <View style={s.header}>
          <Text style={s.title}>Virtual Channel · Asset Payment</Text>
          <Text style={s.subtitle}>Regtest · mirrors test_virtual_channel_asset_payment.py</Text>
        </View>

        {flow.phase !== 'idle' && (
          <>
            <PhaseRow phases={PHASES_SETUP} phase={flow.phase} />
            <PhaseRow phases={PHASES_PAY}   phase={flow.phase} />
          </>
        )}

        {/* ── Idle ── */}
        {flow.phase === 'idle' && (
          <View style={s.card}>
            <Text style={s.cardTitle}>test_virtual_channel_asset_payment</Text>
            <Text style={s.cardDesc}>
              {'Two embedded SDK nodes open a virtual RGB channel directly — no LSP involved.\n\n' +
               'What this flow proves:\n' +
               '1. Node A issues an RGB asset (VTST, 1 000 units)\n' +
               '2. Node A opens a virtual Lightning channel to Node B carrying ' + CHANNEL_ASSET_AMOUNT + ' VTST of capacity\n' +
               '3. Node A tries a 2nd, BTC-only virtual channel to the same peer — expected to be ' +
               'rejected: virtual_channel_add_intent() caps virtual sessions at one per peer, ' +
               'asset-agnostic (ldk.rs:777-802)\n' +
               '4. A→B payment: Node B invoices ' + PAYMENT_ASSET_AMOUNT + ' VTST, Node A pays\n' +
               '5. B→A reverse: Node A invoices ' + PAYMENT_ASSET_AMOUNT + ' VTST, Node B pays back\n' +
               '6. Node A cooperatively closes the channel, confirmed via listChannels() on both nodes\n' +
               '7. Node A immediately tries to open a NEW virtual channel to the same peer — repro of ' +
               'the virtual-channel session-leak bug (docs/issue-virtual-session-leak.md): the LDK session ' +
               'store never clears on ChannelClosed, so the reopen is expected to fail with ' +
               '"virtual channel session already exists for this peer pair"\n' +
               '8. A fresh Node C (no virtual flags, not in Node B\'s virtualPeerPubkeys) tries a ' +
               'plain REGULAR channel to Node B — expected to be swept into the same ' +
               'untrusted_virtual_peer rejection meant for virtual opens, since Node B\'s acceptor ' +
               'branches on its own enableVirtualChannelsV0 flag before checking what the incoming ' +
               'request actually asked for (docs/issue-virtual-channel-accept-mode.md)\n\n' +
               'Virtual channels differ from standard channels in that the channel open is negotiated off-chain ' +
               '(no on-chain funding transaction). This means no mining is required to open — the two nodes ' +
               'agree on the initial state directly.\n\n' +
               'Node B is created with virtualPeerPubkeys=[nodeA] so it explicitly allows ' +
               'Node A to open a virtual channel. virtualOpenMode="trusted_no_broadcast" ' +
               'tells RLN to skip broadcasting the funding transaction — mirroring the Python test exactly.'}
            </Text>
            <View style={s.paramCard}>
              <Text style={s.paramTitle}>Parameters</Text>
              <Text style={s.paramLine}>Channel cap   {CHANNEL_CAPACITY_SAT.toLocaleString()} sat</Text>
              <Text style={s.paramLine}>Asset amount  {CHANNEL_ASSET_AMOUNT} VTST per channel</Text>
              <Text style={s.paramLine}>Payment       {PAYMENT_MSAT / 1000} sat + {PAYMENT_ASSET_AMOUNT} VTST</Text>
              <Text style={s.paramLine}>Open mode     {VIRTUAL_OPEN_MODE}</Text>
              <Text style={s.paramLine}>Asset ticker  VTST  (issued by Node A at runtime)</Text>
            </View>
            <TouchableOpacity style={s.startBtn} onPress={flow.run} activeOpacity={0.8}>
              <Text style={s.startBtnTxt}>▶  Run Virtual Channel Flow</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Spinners ── */}
        {isRunning && ['init', 'init_b'].includes(flow.phase) && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>
              {flow.phase === 'init' ? 'Creating Node A (enableVirtualChannelsV0) …' : 'Creating Node B (enableVirtualChannelsV0) …'}
            </Text>
          </View>
        )}
        {flow.phase === 'fund' && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>Funding both nodes + creating UTXOs …</Text>
          </View>
        )}
        {flow.phase === 'issue' && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>Node A issuing VTST RGB asset …</Text>
          </View>
        )}
        {flow.phase === 'connect' && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>Node A connecting to Node B …</Text>
          </View>
        )}
        {flow.phase === 'open_channel' && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>Opening virtual RGB channel (A → B) …</Text>
          </View>
        )}
        {flow.phase === 'wait_channel' && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>Waiting for virtual channel to become usable …</Text>
            <Text style={[s.spinnerTxt, { fontSize: 11, marginTop: 4 }]}>mining blocks every 2 s</Text>
          </View>
        )}
        {flow.phase === 'open_btc_channel' && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>Opening a 2nd (BTC-only) virtual channel to the same peer …</Text>
            <Text style={[s.spinnerTxt, { fontSize: 11, marginTop: 4 }]}>expecting one-per-peer rejection</Text>
          </View>
        )}
        {['pay_ab', 'settle_ab'].includes(flow.phase) && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>
              {flow.phase === 'pay_ab'
                ? 'Part 1: Node A sending → Node B …'
                : `Part 1: settling A→B … ${flow.statusAB || 'Pending'}`}
            </Text>
          </View>
        )}
        {['pay_ba', 'settle_ba'].includes(flow.phase) && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>
              {flow.phase === 'pay_ba'
                ? 'Part 2: Node B sending reverse → Node A …'
                : `Part 2: settling B→A … ${flow.statusBA || 'Pending'}`}
            </Text>
          </View>
        )}
        {flow.phase === 'close_channel' && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>
              {flow.closeConfirmed
                ? 'Channel closed ✓ — confirmed via listChannels()'
                : 'Cooperatively closing the channel, then polling listChannels() on both nodes …'}
            </Text>
          </View>
        )}
        {flow.phase === 'reopen_attempt' && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>Attempting to reopen a virtual channel to the same peer …</Text>
            <Text style={[s.spinnerTxt, { fontSize: 11, marginTop: 4 }]}>expecting session-leak rejection</Text>
          </View>
        )}
        {flow.phase === 'client_regular_open' && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>Node C (plain, no virtual flags) opening a REGULAR channel to Node B …</Text>
            <Text style={[s.spinnerTxt, { fontSize: 11, marginTop: 4 }]}>funding + mining, up to 40s</Text>
          </View>
        )}

        {/* ── Info cards ── */}
        {(flow.pubkeyA || flow.addrA) && (
          <InfoCard title="Node A (issuer + initiator)" accent={AppColors.primary} rows={[
            ...(flow.pubkeyA ? [['Pubkey', short(flow.pubkeyA, 28)] as [string, string]] : []),
            ...(flow.addrA   ? [['Address', flow.addrA] as [string, string]] : []),
          ]} />
        )}
        {(flow.pubkeyB || flow.addrB) && (
          <InfoCard title="Node B (recipient)" accent={AppColors.running} rows={[
            ...(flow.pubkeyB ? [['Pubkey', short(flow.pubkeyB, 28)] as [string, string]] : []),
            ...(flow.addrB   ? [['Address', flow.addrB] as [string, string]] : []),
          ]} />
        )}
        {flow.assetId && (
          <InfoCard title="RGB Asset (Node A issued)" accent={AppColors.success} rows={[
            ['Asset ID', short(flow.assetId, 28)],
            ['Ticker',   'VTST'],
            ['Supply',   '1 000'],
          ]} />
        )}
        {flow.chanA && (
          <InfoCard title="Virtual RGB Channel (A → B)" accent={AppColors.primary} rows={[
            ['Capacity', `${flow.chanA.capacitySat ?? CHANNEL_CAPACITY_SAT} sat`],
            ['Asset',    `${flow.chanA.assetLocalAmount ?? CHANNEL_ASSET_AMOUNT} VTST local`],
            ['Mode',     flow.chanA.virtualOpenMode ?? 'default'],
            ['Status',   'Usable ✓'],
          ]} />
        )}
        {flow.chanB && (
          <InfoCard title="Virtual Channel (Node B view)" accent={AppColors.running} rows={[
            ['Capacity', `${flow.chanB.capacitySat ?? CHANNEL_CAPACITY_SAT} sat`],
            ['Asset',    `${flow.chanB.assetRemoteAmount ?? '?'} VTST remote`],
            ['Status',   'Visible ✓'],
          ]} />
        )}
        {flow.invoiceAB && (
          <InfoCard title="A→B Invoice (Node B)" rows={[
            ['BOLT11', short(flow.invoiceAB, 32)],
            ['Amount', `${PAYMENT_MSAT / 1000} sat + ${PAYMENT_ASSET_AMOUNT} VTST`],
            ['Status', flow.statusAB || 'Pending'],
          ]} />
        )}
        {flow.invoiceBA && (
          <InfoCard title="B→A Invoice (Node A, reverse)" rows={[
            ['BOLT11', short(flow.invoiceBA, 32)],
            ['Amount', `${PAYMENT_MSAT / 1000} sat + ${PAYMENT_ASSET_AMOUNT} VTST`],
            ['Status', flow.statusBA || 'Pending'],
          ]} />
        )}

        {/* ── BTC + asset concurrent virtual channel result ── */}
        {flow.btcChannelOutcome !== 'pending' && (
          <View style={[s.card, {
            borderColor: flow.btcChannelOutcome === 'blocked' ? AppColors.border
              : flow.btcChannelOutcome === 'succeeded' ? AppColors.successBorder
              : AppColors.errorBorder,
          }]}>
            <Text style={[s.cardTitle, {
              color: flow.btcChannelOutcome === 'blocked' ? AppColors.textPrimary
                : flow.btcChannelOutcome === 'succeeded' ? AppColors.success
                : AppColors.error,
            }]}>
              {flow.btcChannelOutcome === 'blocked' && 'One virtual channel per peer confirmed (asset-agnostic)'}
              {flow.btcChannelOutcome === 'succeeded' && '✓ BTC + asset virtual channels coexisted'}
              {flow.btcChannelOutcome === 'error' && '✗ 2nd open failed — unexpected error'}
            </Text>
            <Text style={s.cardDesc}>
              {flow.btcChannelOutcome === 'blocked' &&
                `The RGB asset channel occupies the peer's only virtual-channel slot; a BTC-only open ` +
                `to the same peer was rejected:\n\n${flow.btcChannelError}\n\nMatches ` +
                `virtual_channel_add_intent() (ldk.rs:777-802) — the duplicate check is keyed on ` +
                `peer_id only, with no asset dimension.`}
              {flow.btcChannelOutcome === 'succeeded' &&
                `Both a BTC-only channel (tmpChanId ${short(flow.btcChannelId, 16)}) and the RGB asset ` +
                `channel are open to the same peer simultaneously — the one-per-peer limit did not apply.`}
              {flow.btcChannelOutcome === 'error' &&
                `The 2nd open failed with an error that doesn't match the expected one-per-peer ` +
                `signature ("already exists for this peer pair"):\n\n${flow.btcChannelError}`}
            </Text>
          </View>
        )}

        {/* ── Accept-mode asymmetry result ── */}
        {flow.clientOpenOutcome !== 'pending' && (
          <View style={[s.card, {
            borderColor: flow.clientOpenOutcome === 'accepted' ? AppColors.successBorder
              : flow.clientOpenOutcome === 'timeout' ? AppColors.border
              : flow.clientOpenOutcome === 'blocked' ? AppColors.successBorder
              : AppColors.errorBorder,
          }]}>
            <Text style={[s.cardTitle, {
              color: flow.clientOpenOutcome === 'accepted' ? AppColors.success
                : flow.clientOpenOutcome === 'timeout' ? AppColors.textPrimary
                : flow.clientOpenOutcome === 'blocked' ? AppColors.success
                : AppColors.error,
            }]}>
              {flow.clientOpenOutcome === 'accepted' && '✓ Regular open from unlisted peer accepted'}
              {flow.clientOpenOutcome === 'timeout' && '🐛 Likely accept-mode asymmetry — never appeared on Node B'}
              {flow.clientOpenOutcome === 'blocked' && '🐛 Rejected — accept-mode asymmetry reproduced'}
              {flow.clientOpenOutcome === 'error' && '✗ Local send failed — unexpected error'}
            </Text>
            <Text style={s.cardDesc}>
              {flow.clientOpenOutcome === 'accepted' &&
                `Node C (no virtual flags, not in Node B's virtualPeerPubkeys) sent a plain regular ` +
                `openChannel() and it showed up on Node B's listChannels() — Node B's acceptor falls ` +
                `back to a normal accept correctly, even with enableVirtualChannelsV0 on.`}
              {flow.clientOpenOutcome === 'timeout' &&
                `Node C's request never appeared on Node B within the timeout. Node C's own ` +
                `openChannel() call succeeded locally (tmpChanId ${short(flow.clientOpenChanId, 16)}) — ` +
                `that only means Node C sent the OpenChannel message, not that Node B accepted it. ` +
                `Matches docs/issue-virtual-channel-accept-mode.md: Node B's acceptor branches on its ` +
                `own enableVirtualChannelsV0 flag before checking what the incoming request actually ` +
                `asked for, so a plain regular open from a peer outside virtualPeerPubkeys can be swept ` +
                `into the untrusted_virtual_peer rejection meant for virtual opens. Check Node B's own ` +
                `.ldk/logs/logs.txt for the exact reject reason.`}
              {flow.clientOpenOutcome === 'blocked' &&
                `Node C's openChannel() was rejected synchronously with the untrusted_virtual_peer ` +
                `signature:\n\n${flow.clientOpenError}\n\nConfirms docs/issue-virtual-channel-accept-mode.md: ` +
                `Node B's acceptor treats a plain regular open from a peer outside virtualPeerPubkeys as ` +
                `an untrusted virtual peer, even though Node C never requested virtual_open_mode at all.`}
              {flow.clientOpenOutcome === 'error' &&
                `Node C's own openChannel() call failed before it could even reach Node B:\n\n${flow.clientOpenError}`}
            </Text>
          </View>
        )}

        {/* ── Session-leak repro result ── */}
        {flow.reopenOutcome !== 'pending' && (
          <View style={[s.card, {
            borderColor: flow.reopenOutcome === 'blocked' ? AppColors.successBorder
              : flow.reopenOutcome === 'succeeded' ? AppColors.border
              : AppColors.errorBorder,
          }]}>
            <Text style={[s.cardTitle, {
              color: flow.reopenOutcome === 'blocked' ? AppColors.success
                : flow.reopenOutcome === 'succeeded' ? AppColors.textPrimary
                : AppColors.error,
            }]}>
              {flow.reopenOutcome === 'blocked' && '🐛 Session-leak bug reproduced'}
              {flow.reopenOutcome === 'succeeded' && '⚠ Reopen succeeded (bug did not reproduce)'}
              {flow.reopenOutcome === 'error' && '✗ Reopen failed — unexpected error'}
            </Text>
            <Text style={s.cardDesc}>
              {flow.reopenOutcome === 'blocked' &&
                `Cooperative close confirmed on both nodes, then the second openChannel() to the same peer ` +
                `was rejected:\n\n${flow.reopenErrorMsg}\n\nMatches docs/issue-virtual-session-leak.md: ` +
                `virtual_channel_session_store is never reconciled on Event::ChannelClosed, so ` +
                `virtual_channel_add_intent's duplicate check (peer_id only, no status/liveness filter) blocks the reopen.`}
              {flow.reopenOutcome === 'succeeded' &&
                `Close confirmed on both nodes, and the reopen (tmpChanId ${short(flow.reopenChanId, 16)}) succeeded. ` +
                `Either this build already fixes the session-leak bug, or the fix landed since issue-virtual-session-leak.md was written.`}
              {flow.reopenOutcome === 'error' &&
                `Close confirmed on both nodes, but the reopen failed with an error that doesn't match the ` +
                `known session-leak signature ("virtual channel session already exists for this peer pair"):\n\n${flow.reopenErrorMsg}`}
            </Text>
          </View>
        )}

        {/* ── Done ── */}
        {flow.phase === 'done' && (
          <View style={[s.card, { borderColor: AppColors.successBorder }]}>
            <Text style={[s.cardTitle, { color: AppColors.success }]}>✓ Virtual Channel Flow Complete</Text>
            <Text style={s.cardDesc}>
              {'Bidirectional virtual RGB channel payments succeeded.\n\n' +
               `A→B: ${PAYMENT_ASSET_AMOUNT} VTST sent — status: ${flow.statusAB}\n` +
               `B→A: ${PAYMENT_ASSET_AMOUNT} VTST returned — status: ${flow.statusBA}\n\n` +
               `nodeA final offchain: ${flow.balA?.offchainOutbound ?? 'n/a'}\n` +
               `nodeB final offchain: ${flow.balB?.offchainOutbound ?? 'n/a'}`}
            </Text>
          </View>
        )}

        {/* ── Error ── */}
        {flow.phase === 'error' && (
          <View style={[s.card, { borderColor: AppColors.errorBorder, backgroundColor: AppColors.errorBg }]}>
            <Text style={[s.cardTitle, { color: AppColors.error }]}>Flow failed</Text>
            <Text style={[s.cardDesc, { color: '#FCA5A5' }]}>{flow.errorMsg}</Text>
          </View>
        )}

        {(flow.phase === 'done' || flow.phase === 'error') && (
          <TouchableOpacity style={s.resetBtn} onPress={flow.reset} activeOpacity={0.8}>
            <Text style={s.resetBtnTxt}>↺  Reset</Text>
          </TouchableOpacity>
        )}
        {isRunning && (
          <TouchableOpacity style={s.cancelBtn} onPress={flow.reset} activeOpacity={0.8}>
            <Text style={s.cancelBtnTxt}>✕  Cancel</Text>
          </TouchableOpacity>
        )}

        {flow.log.length > 0 && <LogPane entries={flow.log} />}

      </ScrollView>
    </Root>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  embedded:    { backgroundColor: AppColors.bgBase },
  safe:        { flex: 1, backgroundColor: AppColors.bgBase },
  scroll:      { flex: 1 },
  content:     { padding: 16, paddingBottom: 60 },
  header:      { marginBottom: 20 },
  title:       { fontSize: 22, fontWeight: '700', color: AppColors.textPrimary, letterSpacing: -0.3 },
  subtitle:    { fontSize: 13, color: AppColors.textSecondary, marginTop: 2 },
  card:        { backgroundColor: AppColors.bgCard, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: AppColors.border, marginBottom: 16 },
  cardTitle:   { fontSize: 15, fontWeight: '700', color: AppColors.textPrimary, marginBottom: 8 },
  cardDesc:    { fontSize: 13, color: AppColors.textSecondary, lineHeight: 22 },
  paramCard:   { backgroundColor: AppColors.bgCardElevated, borderRadius: 8, padding: 12, marginVertical: 12 },
  paramTitle:  { fontSize: 11, color: AppColors.textTertiary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 },
  paramLine:   { fontSize: 12, color: AppColors.textSecondary, fontFamily: AppColors.mono, marginBottom: 2 },
  startBtn:    { backgroundColor: AppColors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  startBtnTxt: { fontSize: 15, fontWeight: '700', color: AppColors.black },
  spinnerCard: { backgroundColor: AppColors.bgCard, borderRadius: 12, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: AppColors.border, marginBottom: 16 },
  spinnerTxt:  { fontSize: 14, color: AppColors.textSecondary, marginTop: 14, textAlign: 'center' },
  resetBtn:    { borderWidth: 1, borderColor: AppColors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 16 },
  resetBtnTxt: { fontSize: 14, fontWeight: '600', color: AppColors.primary },
  cancelBtn:   { borderWidth: 1, borderColor: AppColors.error, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginBottom: 16 },
  cancelBtnTxt:{ fontSize: 13, color: AppColors.error },
});

const pb = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', marginBottom: 20, backgroundColor: AppColors.bgCard, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: AppColors.border },
  step:    { alignItems: 'center', flex: 0 },
  dot:     { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  dotText: { fontSize: 7, fontWeight: '700' },
  label:   { fontSize: 6, fontWeight: '600', letterSpacing: 0.3 },
  line:    { flex: 1, height: 2, marginBottom: 8, marginHorizontal: 1 },
});
