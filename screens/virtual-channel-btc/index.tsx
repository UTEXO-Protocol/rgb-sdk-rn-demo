/**
 * Virtual Channel BTC Payment — pure-BTC variant of the virtual-channel flow.
 *
 * Two embedded SDK nodes open a virtual BTC-only channel peer-to-peer
 * (no LSP, no RGB asset, no consignment/proxy involvement), then make a
 * bidirectional plain-BOLT11 payment to prove msat flow both ways.
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
  CHANNEL_CAPACITY_SAT,
  PAYMENT_MSAT_AB, PAYMENT_MSAT_BA, VIRTUAL_OPEN_MODE,
  short, msatStr, type Phase,
} from './config';
import { useVirtualChannelBtcFlow } from './useVirtualChannelBtcFlow';

// ── Phase progress ────────────────────────────────────────────────────────────

const PHASES_SETUP: Phase[] = ['init', 'init_b', 'fund', 'connect', 'open_channel', 'wait_channel'];
const PHASES_PAY:   Phase[] = ['pay_ab', 'settle_ab', 'pay_ba', 'settle_ba', 'done'];
const ALL_PHASES   = [...PHASES_SETUP, ...PHASES_PAY];

const PHASE_LABELS: Partial<Record<Phase, string>> = {
  init:         'A Init',
  init_b:       'B Init',
  fund:         'Fund',
  connect:      'Connect',
  open_channel: 'Open',
  wait_channel: 'Wait',
  pay_ab:       'A→B',
  settle_ab:    'Settle',
  pay_ba:       'B→A',
  settle_ba:    'Settle',
  done:         'Done',
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

export default function VirtualChannelBtcScreen({ embedded = false }: { embedded?: boolean }) {
  const flow = useVirtualChannelBtcFlow();
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
          <Text style={s.title}>Virtual Channel · BTC Payment</Text>
          <Text style={s.subtitle}>Regtest · BTC-only virtual channel, no RGB asset</Text>
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
            <Text style={s.cardTitle}>virtual_channel_btc_payment</Text>
            <Text style={s.cardDesc}>
              {'Two embedded SDK nodes open a virtual BTC-only channel directly — no LSP, no RGB asset.\n\n' +
               'What this flow proves:\n' +
               '1. Node A opens a virtual Lightning channel to Node B with ' + CHANNEL_CAPACITY_SAT.toLocaleString() + ' sat capacity (assetId: null)\n' +
               '2. A→B payment: Node B invoices ' + PAYMENT_MSAT_AB / 1000 + ' sat (plain BOLT11), Node A pays\n' +
               '3. B→A reverse: Node A invoices ' + PAYMENT_MSAT_BA / 1000 + ' sat, Node B pays back\n\n' +
               'BTC-only virtual channels are the simplest case: with no asset there is no RGB ' +
               'consignment, so the channel open never touches the RGB proxy — the only machinery ' +
               'is the LDK virtual-channel negotiation (trusted_no_broadcast: no on-chain funding ' +
               'transaction is broadcast).\n\n' +
               'RLN enforces a global 3,000,000 msat invoice minimum, so the reverse payment is sized ' +
               'at exactly that; A→B sends 5,000 sat so Node B clears its 1% channel reserve ' +
               '(1,000 sat) with room to pay back.\n\n' +
               'Node B is created with virtualPeerPubkeys=[nodeA] so it explicitly allows ' +
               'Node A to open a virtual channel.'}
            </Text>
            <View style={s.paramCard}>
              <Text style={s.paramTitle}>Parameters</Text>
              <Text style={s.paramLine}>Channel cap   {CHANNEL_CAPACITY_SAT.toLocaleString()} sat</Text>
              <Text style={s.paramLine}>Asset         none — pure BTC channel</Text>
              <Text style={s.paramLine}>A→B payment   {PAYMENT_MSAT_AB / 1000} sat</Text>
              <Text style={s.paramLine}>B→A payment   {PAYMENT_MSAT_BA / 1000} sat (RLN invoice minimum)</Text>
              <Text style={s.paramLine}>Open mode     {VIRTUAL_OPEN_MODE}</Text>
            </View>
            <TouchableOpacity style={s.startBtn} onPress={flow.run} activeOpacity={0.8}>
              <Text style={s.startBtnTxt}>▶  Run Virtual BTC Channel Flow</Text>
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
        {flow.phase === 'connect' && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>Node A connecting to Node B …</Text>
          </View>
        )}
        {flow.phase === 'open_channel' && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>Opening virtual BTC channel (A → B) …</Text>
          </View>
        )}
        {flow.phase === 'wait_channel' && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>Waiting for virtual channel to become usable …</Text>
            <Text style={[s.spinnerTxt, { fontSize: 11, marginTop: 4 }]}>mining blocks every 2 s</Text>
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

        {/* ── Info cards ── */}
        {(flow.pubkeyA || flow.addrA) && (
          <InfoCard title="Node A (initiator)" accent={AppColors.primary} rows={[
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
        {flow.chanA && (
          <InfoCard title="Virtual BTC Channel (A → B)" accent={AppColors.primary} rows={[
            ['Capacity', `${flow.chanA.capacitySat ?? CHANNEL_CAPACITY_SAT} sat`],
            ['Asset',    'none (BTC only)'],
            ['Mode',     flow.chanA.virtualOpenMode ?? 'default'],
            ['Status',   'Usable ✓'],
          ]} />
        )}
        {flow.chanB && (
          <InfoCard title="Virtual Channel (Node B view)" accent={AppColors.running} rows={[
            ['Capacity', `${flow.chanB.capacitySat ?? CHANNEL_CAPACITY_SAT} sat`],
            ['Asset',    'none (BTC only)'],
            ['Status',   'Visible ✓'],
          ]} />
        )}
        {flow.invoiceAB && (
          <InfoCard title="A→B Invoice (Node B)" rows={[
            ['BOLT11', short(flow.invoiceAB, 32)],
            ['Amount', `${PAYMENT_MSAT_AB / 1000} sat`],
            ['Status', flow.statusAB || 'Pending'],
          ]} />
        )}
        {flow.invoiceBA && (
          <InfoCard title="B→A Invoice (Node A, reverse)" rows={[
            ['BOLT11', short(flow.invoiceBA, 32)],
            ['Amount', `${PAYMENT_MSAT_BA / 1000} sat`],
            ['Status', flow.statusBA || 'Pending'],
          ]} />
        )}

        {/* ── Done ── */}
        {flow.phase === 'done' && (
          <View style={[s.card, { borderColor: AppColors.successBorder }]}>
            <Text style={[s.cardTitle, { color: AppColors.success }]}>✓ Virtual BTC Channel Flow Complete</Text>
            <Text style={s.cardDesc}>
              {'Bidirectional virtual BTC channel payments succeeded.\n\n' +
               `A→B: ${PAYMENT_MSAT_AB / 1000} sat sent — status: ${flow.statusAB}\n` +
               `B→A: ${PAYMENT_MSAT_BA / 1000} sat returned — status: ${flow.statusBA}\n\n` +
               `nodeA final outbound: ${flow.outboundA != null ? msatStr(flow.outboundA) : 'n/a'}\n` +
               `nodeB final outbound: ${flow.outboundB != null ? msatStr(flow.outboundB) : 'n/a'}`}
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
