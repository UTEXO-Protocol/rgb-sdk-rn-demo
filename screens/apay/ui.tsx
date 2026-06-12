import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppColors } from '@/constants/theme';

import { PHASE_LABELS, PHASES_P1, PHASES_P2, type LogEntry, type Phase } from './config';

export function PhaseRow({ phases, phase }: { phases: Phase[]; phase: Phase }) {
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
                <Text style={[pb.dotText, { color }]}>{done ? '✓' : i + 1}</Text>
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

export function LogPane({ entries }: { entries: LogEntry[] }) {
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

export const apayStyles = StyleSheet.create({
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
