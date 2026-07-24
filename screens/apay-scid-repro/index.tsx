/**
 * APay · SCID-alias JIT reproduction (regtest).
 * Reproduces UTEXO-Protocol/rgb-sdk-rn#49 — see ./useScidReproFlow.ts and
 * docs/issue-49-scid-alias-repro.md.
 *
 * Rendered in the LSP tab, directly below the "APay Cart Checkout" flow.
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

import { InfoCard, LogPane, apayStyles as s } from '../apay/ui';
import {
  ASSET_ID,
  DELIVER_WATCH_S,
  LSP_URL,
  PAYMENT_ASSET_AMOUNT,
  PAYMENT_MSAT,
  PHASE_LABELS,
  short,
  type Phase,
} from './config';
import { useScidReproFlow } from './useScidReproFlow';

function phaseMessage(phase: Phase): string {
  switch (phase) {
    case 'preflight':   return 'Preflight — checking LSP + faucet…';
    case 'init':        return 'Creating receiver node (virtual channels ON, like the issue)…';
    case 'fund':        return 'Funding receiver…';
    case 'utxos':       return 'Creating receiver UTXOs…';
    case 'connect':     return 'Connecting to LSP…';
    case 'receive':     return 'Receiver requests inbound RGB (lightning_receive) → LSP opens JIT channel…';
    case 'faucet_send': return 'Our faucet node pays the RGB invoice (sends to the LSP)…';
    case 'lsp_settle':  return 'Waiting for RGB to settle at the LSP…';
    case 'deliver':     return `Watching if the LSP can deliver over a JIT channel (${DELIVER_WATCH_S}s)…`;
    case 'report':      return 'Building reproduction report…';
    default:            return 'Working…';
  }
}

const VERDICT_UI: Record<string, { label: string; color: string }> = {
  reproduced:       { label: '🔴 #49 REPRODUCED — RGB stranded at LSP; JIT channel force-closed (scid_alias)', color: AppColors.error },
  'not-reproduced': { label: '🟢 Not reproduced — the LSP delivered the RGB to the receiver', color: AppColors.success },
  inconclusive:     { label: '⚪️ Inconclusive — the RGB never reached the LSP (infra, not #49)', color: AppColors.warning },
  pending:          { label: '…', color: AppColors.textTertiary },
};

export default function ScidReproScreen({ embedded = false }: { embedded?: boolean }) {
  const flow = useScidReproFlow();

  const Root = embedded ? View : SafeAreaView;
  const rootProps = embedded
    ? { style: s.embedded }
    : { style: s.safe, edges: ['top', 'left', 'right'] as const };

  const v = VERDICT_UI[flow.verdict] ?? VERDICT_UI.pending;

  return (
    <Root {...rootProps}>
      <ScrollView
        style={embedded ? undefined : s.scroll}
        contentContainerStyle={s.content}
        scrollEnabled={!embedded}
        nestedScrollEnabled={embedded}>

        <View style={s.header}>
          <Text style={s.title}>APay · SCID-alias JIT Repro</Text>
          <Text style={s.subtitle}>Regtest · reproduces rgb-sdk-rn#49 (unsupported_scid_alias)</Text>
          <View style={s.badge}>
            <View style={[s.dot, { backgroundColor: flow.envReady ? AppColors.success : AppColors.error }]} />
            <Text style={s.badgeTxt}>{flow.envReady ? 'LSP configured' : 'Run ./scripts/start-lsp-regtest.sh first'}</Text>
          </View>
        </View>

        {flow.phase === 'idle' && (
          <View style={s.card}>
            <Text style={s.cardTitle}>What this reproduces</Text>
            <Text style={s.cardDesc}>
              {'Issue #49: to deliver received RGB, the LSP opens a JIT channel\n' +
               'requesting scid_alias (channel_type [0,16]). A receiver whose RLN\n' +
               'node has negotiate_scid_privacy=false force-closes it with\n' +
               'unsupported_scid_alias — so the RGB is never delivered.\n\n' +
               '⚠️ Same config as the issue\n' +
               '   The receiver wallet enables virtual channels\n' +
               '   (enableVirtualChannelsV0 + virtualPeerPubkeys=[LSP]),\n' +
               '   exactly like the report. Whitelisting the LSP as a virtual\n' +
               '   peer is NOT enough — it does not flip negotiate_scid_privacy,\n' +
               '   so the scid_alias channel is still rejected.\n\n' +
               '🔁 Drives the JIT open\n' +
               '   The receiver calls lsp.receiveAsset() (lightning_receive).\n' +
               '   OUR faucet RLN node pays the RGB invoice on-chain to the LSP.\n\n' +
               '💧 Stranding = the symptom\n' +
               '   The RGB settles AT THE LSP, but the JIT channel is force-closed,\n' +
               '   so it never reaches the receiver — the invoice stays Pending and\n' +
               '   offchainInbound stays 0. Asset stranded at the LSP.\n\n' +
               'A markdown report is generated (rendered below + written to the\n' +
               'device docs dir).'}
            </Text>

            <View style={s.paramCard}>
              <Text style={s.paramTitle}>Config</Text>
              <Text style={s.paramLine}>LSP API     {LSP_URL}</Text>
              <Text style={s.paramLine}>Asset ID    {ASSET_ID ? short(ASSET_ID, 28) : '(not set)'}</Text>
              <Text style={s.paramLine}>Channels    enableVirtualChannelsV0: true</Text>
              <Text style={s.paramLine}>Receive     {PAYMENT_MSAT / 1000} sat + {PAYMENT_ASSET_AMOUNT} RGB</Text>
            </View>

            {!flow.envReady && (
              <View style={s.warnCard}>
                <Text style={s.warnTxt}>{'Run:\n\n  ./scripts/start-lsp-regtest.sh'}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[s.startBtn, !flow.envReady && { opacity: 0.4 }]}
              onPress={flow.run}
              disabled={!flow.envReady}
              activeOpacity={0.8}>
              <Text style={s.startBtnTxt}>▶  Run SCID-alias Repro</Text>
            </TouchableOpacity>
          </View>
        )}

        {flow.isRunning && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>{phaseMessage(flow.phase)}</Text>
            <Text style={[s.spinnerTxt, { fontSize: 11, marginTop: 4 }]}>{PHASE_LABELS[flow.phase]}</Text>
          </View>
        )}

        {flow.verdict !== 'pending' && (
          <View style={[s.card, { borderColor: v.color + '80', backgroundColor: v.color + '10' }]}>
            <Text style={[s.cardTitle, { color: v.color }]}>{v.label}</Text>
            {flow.pubkey ? <Text style={s.paramLine}>receiver {short(flow.pubkey, 32)}</Text> : null}
          </View>
        )}

        {(flow.rgbAtLsp !== null || flow.delivered !== null) && (
          <InfoCard title="RGB delivery" accent={flow.verdict === 'reproduced' ? AppColors.error : AppColors.success} rows={[
            ['RGB reached LSP',      flow.rgbAtLsp == null ? '—' : flow.rgbAtLsp ? 'yes (settled at LSP)' : 'no'],
            ['Delivered to receiver', flow.delivered == null ? '—' : flow.delivered ? 'yes' : 'NO — stranded at LSP'],
          ]} />
        )}

        {flow.samples.length > 0 && (
          <InfoCard title="Channel lifecycle (LSP → receiver)" accent={AppColors.primary} rows={[
            ['Samples',  String(flow.samples.length)],
            ['Distinct channelIds', String(new Set(flow.samples.map(x => x.channelId)).size)],
            ['Ever usable', flow.samples.some(x => x.isUsable) ? 'yes' : 'no'],
            ['Last status', flow.samples[flow.samples.length - 1]?.status ?? '—'],
          ]} />
        )}

        {flow.reportMd ? (
          <View style={[s.card, { marginTop: 4 }]}>
            <Text style={s.cardTitle}>Reproduction report (markdown)</Text>
            {flow.reportPath ? <Text style={[s.paramLine, { marginBottom: 8 }]}>{flow.reportPath}</Text> : null}
            <Text selectable style={rep.mono}>{flow.reportMd}</Text>
          </View>
        ) : null}

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
        {flow.isRunning && (
          <TouchableOpacity style={s.cancelBtn} onPress={flow.reset} activeOpacity={0.8}>
            <Text style={s.cancelBtnTxt}>✕  Cancel</Text>
          </TouchableOpacity>
        )}

        {flow.log.length > 0 && <LogPane entries={flow.log} />}
      </ScrollView>
    </Root>
  );
}

const rep = StyleSheet.create({
  mono: { fontSize: 10, color: AppColors.textSecondary, fontFamily: AppColors.mono, lineHeight: 15 },
});
