import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AppColors } from '@/constants/theme';
import { type LogEntry, type Phase } from './config';

// ── Phase progress bar ────────────────────────────────────────────────────────

export const PHASES_P1: Phase[] = ['init', 'fund', 'utxos', 'asset', 'channel', 'b_channel', 'lsp_flow', 'rgb_send', 'settle'];
export const PHASES_P2: Phase[] = ['p2_pay', 'p2_settle', 'done'];
export const ALL_PHASES = [...PHASES_P1, ...PHASES_P2];

const PHASE_LABELS: Record<string, string> = {
  init: 'Init', fund: 'Fund', utxos: 'UTXOs', asset: 'Asset',
  channel: 'A Chan', b_channel: 'B Chan',
  lsp_flow: 'LSP', rgb_send: 'Send', settle: 'Settle',
  p2_pay: 'Pay', p2_settle: 'Settle', done: 'Done',
};

export function PhaseRow({ phases, phase }: { phases: Phase[]; phase: Phase }) {
  const idx = ALL_PHASES.indexOf(phase);
  return (
    <View style={pb.row}>
      {phases.map((s, i) => {
        const globalIdx = ALL_PHASES.indexOf(s);
        const done   = idx > globalIdx;
        const active = phase === s;
        const err    = phase === 'error' && active;
        const color  = err ? AppColors.error : done ? AppColors.success : active ? AppColors.primary : AppColors.textTertiary;
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

// ── Info card ─────────────────────────────────────────────────────────────────

export function InfoCard({ title, rows, accent }: { title: string; rows: [string, string][]; accent?: string }) {
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

// ── Log pane ──────────────────────────────────────────────────────────────────

export function LogPane({ entries }: { entries: LogEntry[] }) {
  return (
    <View style={lp.box}>
      <Text style={lp.header}>Console</Text>
      {entries.length === 0
        ? <Text style={lp.empty}>No output yet</Text>
        : entries.map((e, i) => (
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

// ── Styles ────────────────────────────────────────────────────────────────────

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
  entry:  { fontSize: 11, color: AppColors.textSecondary, fontFamily: AppColors.mono, lineHeight: 18 },
});
