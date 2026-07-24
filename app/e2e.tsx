/**
 * E2E flow-runner screen (MIGRATION-PLAN-v3 §6.0m, §7a.5 "flow runner" option).
 *
 * Not part of the demo's tabs — it is reached by deep link from the host runner:
 *
 *   adb shell "am start -a android.intent.action.VIEW \
 *     -d 'myapp://e2e?auto=1&fx=<uri-encoded e2e-fixtures.json>' com.anonymous.myapp"
 *
 * The fixtures arrive as a parameter rather than through `EXPO_PUBLIC_*` env
 * vars because those are inlined into the bundle at build time: a
 * re-provisioned stack would otherwise need a rebuild before the suite could
 * see the new asset id and pubkeys.
 *
 * The on-screen list renders exactly the markers the host scrapes from logcat,
 * so a run watched on the emulator and a run judged by CI cannot disagree.
 */
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { Marker } from '@/e2e/marker';
import { runE2E, SCENARIO_IDS, type RunSummary } from '@/e2e/run';

function decodeFixtures(raw: string | string[] | undefined): unknown {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    // expo-router already percent-decodes query params; try raw first and fall
    // back for a double-encoded value (some adb/shell paths encode twice).
    return JSON.parse(raw);
  } catch {
    return JSON.parse(decodeURIComponent(raw));
  }
}

export default function E2EScreen() {
  const params = useLocalSearchParams<{
    auto?: string;
    fx?: string;
    only?: string;
    sink?: string;
    /** Run id — lets the host re-issue the deep link without double-running. */
    rid?: string;
  }>();
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const start = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setRunning(true);
    setError(null);
    setMarkers([]);
    setSummary(null);
    try {
      const fixtures = decodeFixtures(params.fx);
      const only =
        typeof params.only === 'string' && params.only.length > 0
          ? params.only.split(',').map((s) => s.trim().toUpperCase())
          : undefined;
      const result = await runE2E({
        fixtures,
        only,
        sink: typeof params.sink === 'string' ? params.sink : null,
        onMarker: (m) => setMarkers((prev) => [...prev, m]),
      });
      setSummary(result);
    } catch (e) {
      setError(e instanceof Error ? (e.stack ?? e.message) : String(e));
    } finally {
      setRunning(false);
      startedRef.current = false;
    }
  }, [params.fx, params.only, params.sink]);

  // Once per run id. The host may re-issue the deep link (the app can still be
  // loading its bundle when the first one lands), and `rid` is what keeps that
  // retry from starting a second wallet on top of the first.
  useEffect(() => {
    if (params.auto === '1') void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.auto, params.rid]);

  const rows = markers.filter((m) => m.t !== 'run');

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>SDK e2e runner</Text>
          <Text style={styles.subtitle}>
            scenarios {SCENARIO_IDS.join(' · ')} — same markers the host runner sees
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.button, running && styles.buttonDisabled]}
          disabled={running}
          onPress={() => void start()}
        >
          {running ? (
            <ActivityIndicator color={AppColors.textPrimary} size="small" />
          ) : (
            <Text style={styles.buttonText}>Run</Text>
          )}
        </TouchableOpacity>
      </View>

      {summary ? (
        <View style={[styles.banner, summary.ok ? styles.bannerOk : styles.bannerFail]}>
          <Text style={styles.bannerText}>
            {summary.ok ? 'PASS' : 'FAIL'} — {summary.passed} passed, {summary.failed} failed,{' '}
            {Math.round(summary.ms / 1000)}s
          </Text>
        </View>
      ) : null}

      {error ? (
        <View style={[styles.banner, styles.bannerFail]}>
          <Text style={styles.bannerText}>{error}</Text>
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {rows.map((m, i) => (
          <MarkerRow key={i} marker={m} />
        ))}
        {rows.length === 0 && !running ? (
          <Text style={styles.empty}>
            Idle. Launch with `?auto=1&fx=…` from scripts/run-e2e-android.mjs, or tap Run
            after passing fixtures.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function MarkerRow({ marker }: { marker: Marker }) {
  if (marker.t === 'log') {
    return <Text style={styles.logLine}>{marker.message}</Text>;
  }
  if (marker.t === 'done') {
    return (
      <Text style={[styles.rowTitle, marker.ok ? styles.ok : styles.fail]}>
        done — {marker.passed} passed / {marker.failed} failed
      </Text>
    );
  }
  if (marker.t === 'run') {
    return <Text style={styles.logLine}>run started — {marker.scenarios.join(', ')}</Text>;
  }
  const ok = marker.ok;
  const label =
    marker.t === 'scenario'
      ? `${marker.scenario} — scenario`
      : `${marker.scenario} · ${marker.step}`;
  return (
    <View style={styles.row}>
      <Text style={[styles.rowMark, ok ? styles.ok : styles.fail]}>{ok ? '✓' : '✗'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>
          {label} <Text style={styles.rowMs}>{marker.ms}ms</Text>
        </Text>
        {!ok && 'error' in marker && marker.error ? (
          <Text style={styles.rowError}>{marker.error}</Text>
        ) : null}
        {ok && marker.t === 'step' && marker.value !== undefined ? (
          <Text style={styles.rowValue} numberOfLines={6}>
            {JSON.stringify(marker.value)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const MONO = 'monospace';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AppColors.bgBase },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
  },
  title: { fontSize: 18, fontWeight: '700', color: AppColors.textPrimary },
  subtitle: { fontSize: 11, color: AppColors.textTertiary, fontFamily: MONO, marginTop: 2 },
  button: {
    minWidth: 72,
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: AppColors.primaryDark,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: AppColors.textPrimary, fontWeight: '700' },
  banner: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  bannerOk: { backgroundColor: AppColors.successBg, borderBottomColor: AppColors.successBorder },
  bannerFail: { backgroundColor: AppColors.errorBg, borderBottomColor: AppColors.errorBorder },
  bannerText: { color: AppColors.textPrimary, fontFamily: MONO, fontSize: 12 },
  list: { flex: 1 },
  listContent: { padding: 12, gap: 6 },
  empty: { color: AppColors.textTertiary, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 8 },
  rowMark: { width: 14, fontFamily: MONO, fontSize: 12 },
  rowTitle: { color: AppColors.textPrimary, fontSize: 12, fontFamily: MONO },
  rowMs: { color: AppColors.textTertiary },
  rowValue: { color: AppColors.textSecondary, fontSize: 11, fontFamily: MONO },
  rowError: { color: AppColors.error, fontSize: 11, fontFamily: MONO },
  logLine: { color: AppColors.textTertiary, fontSize: 11, fontFamily: MONO },
  ok: { color: AppColors.success },
  fail: { color: AppColors.error },
});
