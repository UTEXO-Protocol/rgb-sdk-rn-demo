/**
 * APay · SCID-alias JIT reproduction — Signet (UTEXO).
 * Runs the #49 reproduction against the live signet LSP. See
 * ./useScidReproSignetFlow.ts and docs/issue-49-scid-alias-repro.md.
 *
 * Rendered in the LSP tab (UTEXO pane), below the signet APay flow.
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
  DELIVER_WATCH_MS,
  FAUCET_NODE_URL,
  LSP_URL,
  PAYMENT_ASSET_AMOUNT,
  PAYMENT_MSAT,
  PHASE_LABELS,
  short,
  type Phase,
} from './config';
import { useScidReproSignetFlow } from './useScidReproSignetFlow';

function phaseMessage(phase: Phase): string {
  switch (phase) {
    case 'preflight':   return 'Preflight — checking LSP + faucet…';
    case 'init':        return 'Creating receiver node (createLsp → virtual channels)…';
    case 'fund':        return 'Faucet funding receiver with BTC…';
    case 'utxos':       return 'Creating receiver UTXOs…';
    case 'connect':     return 'Connecting to LSP…';
    case 'receive':     return 'Receiver requests inbound RGB (lightning_receive)…';
    case 'faucet_send': return 'Faucet pays the RGB invoice (sends to the LSP)…';
    case 'lsp_settle':  return 'Waiting for the faucet Send to settle…';
    case 'deliver':     return `Watching if the LSP delivers over a JIT channel (${Math.round(DELIVER_WATCH_MS / 60000)} min)…`;
    case 'report':      return 'Building reproduction report…';
    default:            return 'Working…';
  }
}

const VERDICT_UI: Record<string, { label: string; color: string }> = {
  reproduced:       { label: '🔴 #49 REPRODUCED — RGB stranded at LSP; JIT channel force-closed (scid_alias)', color: AppColors.error },
  'not-reproduced': { label: '🟢 Not reproduced — the LSP delivered the RGB to the receiver', color: AppColors.success },
  inconclusive:     { label: '⚪️ Inconclusive — the RGB never reached the LSP', color: AppColors.warning },
  pending:          { label: '…', color: AppColors.textTertiary },
};

export default function ScidReproSignetScreen({ embedded = false }: { embedded?: boolean }) {
  const flow = useScidReproSignetFlow();

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
          <Text style={s.title}>APay · SCID-alias JIT Repro (Signet)</Text>
          <Text style={s.subtitle}>UTEXO signet · reproduces rgb-sdk-rn#49 against the production LSP</Text>
          <View style={s.badge}>
            <View style={[s.dot, { backgroundColor: flow.envReady ? AppColors.success : AppColors.error }]} />
            <Text style={s.badgeTxt}>{flow.envReady ? 'LSP + faucet configured' : 'Set EXPO_PUBLIC_FAUCET_NODE_URL in .env.local'}</Text>
          </View>
        </View>

        {flow.phase === 'idle' && (
          <View style={s.card}>
            <Text style={s.cardTitle}>What this reproduces</Text>
            <Text style={s.cardDesc}>
              {'Same as the regtest repro, but against the LIVE signet LSP —\n' +
               'the same production LSP issue #49 was reported on.\n\n' +
               '⚠️ Config (identical to the issue)\n' +
               '   createLsp() auto-discovers the LSP pubkey and enables\n' +
               '   virtual channels (enableVirtualChannelsV0 +\n' +
               '   virtualPeerPubkeys=[LSP]).\n\n' +
               '🔁 Steps\n' +
               '   1. Faucet funds the receiver with BTC.\n' +
               '   2. Receiver calls lsp.receiveAsset() (lightning_receive).\n' +
               '   3. OUR faucet node pays the RGB invoice → asset goes to LSP.\n' +
               '   4. Watch whether the LSP delivers over a JIT channel.\n\n' +
               '💧 If the LSP opens a PLAIN channel, the virtual-mode receiver\n' +
               '   force-closes it (unsupported_scid_alias) and the RGB is\n' +
               '   stranded at the LSP — that is #49.\n\n' +
               'Signet is slow — allow several minutes. A markdown report is\n' +
               'generated (below + written to the device docs dir).'}
            </Text>

            <View style={s.paramCard}>
              <Text style={s.paramTitle}>Config</Text>
              <Text style={s.paramLine}>LSP API     {LSP_URL}</Text>
              <Text style={s.paramLine}>Faucet      {FAUCET_NODE_URL || '(EXPO_PUBLIC_FAUCET_NODE_URL not set)'}</Text>
              <Text style={s.paramLine}>Asset ID    {ASSET_ID ? short(ASSET_ID, 28) : '(not set)'}</Text>
              <Text style={s.paramLine}>Receive     {PAYMENT_MSAT / 1000} sat + {PAYMENT_ASSET_AMOUNT} RGB</Text>
            </View>

            {!flow.envReady && (
              <View style={s.warnCard}>
                <Text style={s.warnTxt}>{'Set the signet faucet REST URL:\n\n  EXPO_PUBLIC_FAUCET_NODE_URL=https://…'}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[s.startBtn, !flow.envReady && { opacity: 0.4 }]}
              onPress={flow.run}
              disabled={!flow.envReady}
              activeOpacity={0.8}>
              <Text style={s.startBtnTxt}>▶  Run SCID-alias Repro (Signet)</Text>
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
            ['RGB reached LSP',       flow.rgbAtLsp == null ? '—' : flow.rgbAtLsp ? 'yes (faucet Send Settled)' : 'no'],
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
