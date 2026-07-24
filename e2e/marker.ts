/**
 * Structured markers — the wire format between the in-app flow runner and the
 * host-side runner script (MIGRATION-PLAN-v3 §6.0m).
 *
 * **Transport is HTTP, not logcat.** §6.0m planned to scrape `[[E2E]]` lines
 * out of `adb logcat`; that was verified not to work: under the New
 * Architecture (bridgeless, RN 0.81) `console.log` is delivered to the Metro
 * dev server, and only RN's own startup line reaches `ReactNativeJS` in
 * logcat. Markers are therefore POSTed to a tiny HTTP sink the host runner
 * serves, which is better in every respect anyway: no 4 kB per-line truncation,
 * no tag filtering, and identical behaviour in dev and release builds.
 *
 * The `console.log` is still emitted — it is what a human watching the Metro
 * terminal sees — but nothing depends on it.
 */

export const E2E_MARKER = '[[E2E]]';

/** Clip long payloads: evidence for a human, never the assertion itself. */
const MAX_VALUE_CHARS = 4000;

export type Marker =
  | { t: 'run'; startedAt: string; scenarios: string[] }
  | { t: 'step'; scenario: string; step: string; ok: boolean; ms: number; value?: unknown; error?: string }
  | { t: 'scenario'; scenario: string; ok: boolean; ms: number; error?: string }
  | { t: 'log'; message: string }
  | { t: 'done'; ok: boolean; passed: number; failed: number; ms: number; failures: string[] };

/** JSON-safe: bigints become numbers, cycles and unserializable values a string. */
function encode(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'bigint') return Number(v);
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v as object)) return '[Circular]';
        seen.add(v as object);
      }
      return v;
    });
  } catch {
    return JSON.stringify(String(value));
  }
}

// ── Sink ─────────────────────────────────────────────────────────────────────

let sinkUrl: string | null = null;
/** POSTs are chained, never raced: the host prints markers in arrival order. */
let sinkChain: Promise<void> = Promise.resolve();

/** `http://10.0.2.2:<port>` — passed in by the host runner via the deep link. */
export function setMarkerSink(url: string | null): void {
  sinkUrl = url && url.length > 0 ? url.replace(/\/$/, '') : null;
}

/** Resolves once every queued marker has been delivered (or failed). */
export function flushMarkers(): Promise<void> {
  return sinkChain;
}

function post(body: string): void {
  const url = sinkUrl;
  if (!url) return;
  sinkChain = sinkChain.then(async () => {
    try {
      await fetch(`${url}/marker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch {
      // A dead sink must not fail the run: the screen is still authoritative
      // for a human, and the host's idle timeout will report the silence.
    }
  });
}

export function emit(marker: Marker): void {
  let body = encode(marker);
  if (body.length > MAX_VALUE_CHARS && marker.t === 'step') {
    body = encode({ ...marker, value: `[clipped ${body.length} chars]` });
  }
  console.log(`${E2E_MARKER} ${body}`);
  post(body);
}

/** Free-form progress line, visible in the host output but never a verdict. */
export function emitLog(message: string): void {
  emit({ t: 'log', message });
}
