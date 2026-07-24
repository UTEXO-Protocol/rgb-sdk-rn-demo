# rgb-sdk-rn e2e suite

Behaviour-against-a-real-node tests for the **rn** track (MIGRATION-PLAN-v3
§7a, step 6b.3). The unit suite and `check:contract` verify *shape*; this suite
verifies *values* coming back from a live regtest stack, field by field — and
it is the only place `rlnInflate` is ever executed rather than merely compiled.

## Running

```bash
# 1. Bring up the regtest stack (docker + 2 RLN daemons + utexo-lsp + bridge).
#    Writes e2e-fixtures.json — the suite's input.
export RGBLN_REPO=…/rgb-lightning-node UTEXO_LSP_REPO=…/utexo-lsp
./scripts/start-lsp-regtest.sh

# 2. Emulator with the demo installed (once per code change).
emulator -avd Medium_Phone_API_36.1 &
yarn android

# 3. Run the suite.
yarn test:e2e                 # all scenarios
yarn test:e2e --only A,D      # subset
yarn test:e2e --verbose       # echo raw ReactNativeJS logs too
```

Exit code: `0` pass, `1` a scenario failed, `2` setup/timeout problem.

## How it works

The SDK cannot run headless in Node here — the wallet talks to a TurboModule,
so native calls only happen on a device (§7a.4). So the suite runs *inside* the
demo app and the host only judges it:

| Piece | Role |
|---|---|
| `app/e2e.tsx` | flow-runner screen, outside the tabs, opened by deep link |
| `e2e/run.ts` | orchestrator — one wallet, scenarios A–E in order, then teardown |
| `e2e/harness.ts` | boot, fixtures, `waitFor`, `step()` |
| `e2e/scenarios/*` | the scenarios themselves, assertions only |
| `e2e/marker.ts` | one JSON marker per step, POSTed to the host sink |
| `scripts/run-e2e-android.mjs` | serves the sink, launches the deep link, sets the exit code |

**Markers travel over HTTP, not `adb logcat`.** §6.0m planned to scrape
`[[E2E]]` lines out of logcat; that was tried and does not work — under the New
Architecture `console.log` is delivered to the Metro dev server, and only RN's
own startup line reaches the `ReactNativeJS` tag. The runner therefore serves a
one-route sink on `:8099` (`--port` to change) which the app POSTs to at
`10.0.2.2:8099`. Nothing depends on the `console.log`, which is still emitted
for whoever is watching Metro.

Assertions come from `@utexo/rgb-sdk-core/conformance` (`expectFields`,
`expectEach`, `expectNoWireKeys`, the canonical status vocabularies) — the same
helpers the web suite uses, so the two tracks cannot drift in what counts as a
valid response.

## Scenarios

| # | Covers |
|---|---|
| A | node/network info, `capabilities` vs. the live carriers, `runConformanceChecks` against the **live** wallet (closes the §6.0f gap for rn) |
| B | address → fund via bridge → balance increase → `createUtxos` → `listUnspents` with parsed outpoints |
| C | `issueAssetNia` → `listAssets` → balance → `blindReceive` → `decodeRGBInvoice` → `listTransfers` |
| D | **`issueAssetIfa` → `inflate` → balance rises by exactly the inflation amount** — the proof step 1b was missing |
| E | `connectPeer`(Faucet) → `openChannel` → ready → `createLightningInvoice` → Faucet pays → `Succeeded` |

Scenario F (carriers) is web-only by construction: rn has none of the three.

## Constraints worth knowing

- **Fixtures travel in the deep link**, not in `EXPO_PUBLIC_*`. Env vars are
  inlined into the bundle at build time, so a re-provisioned stack would
  otherwise need a rebuild before the suite could see the new asset id.
- **URLs are rewritten to `10.0.2.2`** in-app (`hostUrl`/`hostAddr`), matching
  what `utils/bitcoin-node.ts` already does. No `adb reverse` is needed for the
  peer ports (9737/9740) or the Faucet REST port (3008).
- **The rn stack and the web stack cannot run at the same time** — both claim
  :3000, :18443, :50001 (§6.0l). Stop one before starting the other.
- **Core must be rebuilt** for changes to the field helpers to reach the app:
  metro resolves `dist/`, not `src/` (`cd ../rgb-sdk-core && npm run build`).
- One wallet is shared across A–E: B's colorable UTXOs and C's asset are inputs
  to the later scenarios. `dispose()` is asserted once, in teardown.
- Local gate, not CI: `start-lsp-regtest.sh` hard-requires local repo paths
  (§7a.6).
