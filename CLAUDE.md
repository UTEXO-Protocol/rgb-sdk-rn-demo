# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

End-to-end integration demo for `@utexo/rgb-sdk-rn`. An Expo + Expo Router app that runs four live RGB Lightning flows (plus VSS flows) against a local regtest stack — two or three on-device RLN nodes execute real transactions inside the app process.

The SDK is consumed via a **local file reference** (`file:../rgb-sdk-rn`), not from npm. Metro is configured to watch that sibling directory so changes to the SDK are picked up without republishing.

## Commands

```bash
# Install (nested strategy required to avoid duplicate react/react-native instances)
npm install --install-strategy=nested

# Generate native iOS/Android folders (must run after fresh install or dependency changes)
npm run prebuild

# iOS
cd ios && LANG=en_US.UTF-8 pod install && cd ..
npm run ios:release          # always Release — see note below
npm run ios:open             # open Xcode workspace

# Android
npm run android:release      # always Release — see note below

# Clean builds
npm run clean                # removes android/build, ios/build, metro cache
npm run ios:pod-install      # re-runs pod install

# Lint
npm run lint
```

> **Always use Release builds.** The RGB Lightning Node runs as a native daemon. In Debug mode, Metro serves JS over the network and the native daemon can't reliably bind its listening ports. Debug builds will appear to start but flows will silently fail or hang.

## Environment Setup

Two env file templates exist:

- **`.env`** — regtest defaults (Bitcoin Core on `127.0.0.1`, Electrum on `50001`, RGB Proxy on `3000`, Bitcoin node helper on `5000`)
- **`.env.utexo`** — UTEXO public network credentials template; copy to `.env.utexo.local` and fill in values

Create `.env.local` to override regtest values. Android emulator needs `10.0.2.2` instead of `127.0.0.1` for all services. All `EXPO_PUBLIC_*` variables are read by `readEnv()` in `utils/wallet-flow.ts`.

Key variables:
```
EXPO_PUBLIC_RLN_BITCOIND_RPC_HOST / PORT / USERNAME / PASSWORD
EXPO_PUBLIC_RLN_INDEXER_URL         (e.g. 127.0.0.1:50001)
EXPO_PUBLIC_RLN_PROXY_ENDPOINT      (e.g. rpc://127.0.0.1:3000/json-rpc)
EXPO_PUBLIC_RLN_VSS_URL             (optional, e.g. http://127.0.0.1:8081/vss)
BITCOIN_NODE_ENDPOINT               (e.g. http://127.0.0.1:5000/execute)
```

## Required Infrastructure

All flows require four services running locally before hitting **Run**:

| Service | Default | Purpose |
|---------|---------|---------|
| Bitcoin Core (regtest) | `127.0.0.1:18443` | Block production, wallet funding |
| Electrum indexer | `127.0.0.1:50001` | UTXO/tx indexing |
| RGB Proxy | `127.0.0.1:3000` | RGB invoice transport |
| Bitcoin node helper | `127.0.0.1:5000` | HTTP API wrapping `bitcoin-cli` for `mine` and `sendtoaddress` |

The Bitcoin node helper is a tiny HTTP server (minimal Python/Flask example in `README.md`). The demo's `mine()` and `sendToAddress()` in `utils/wallet-flow.ts` are the only pieces that call it — the SDK itself never touches Bitcoin Core directly.

## Architecture

### Metro configuration (`metro.config.js`)

Watches `../rgb-sdk-rn` as an additional folder so Metro picks up SDK changes without reinstalling. `nodeModulesPaths` puts the demo's `node_modules` first to avoid duplicate React instances from the local SDK package.

### Flow runner (`utils/wallet-flow.ts`)

Contains all six flow functions and the shared infrastructure helpers:

- `runRlnUtexoWalletChannelPaymentFlow` — Flow 1: BTC channel, payment, node restart
- `runRLNUtexoPaymentFlow` — Flow 2: RGB asset channel, 4 payments, cooperative close, on-chain sends
- `runRlnUtexoWalletAssetChannelExtSignerFlow` — Flow 3: mixed signers (password + native external), reverse channel
- `runRLNUtexoExternalPaymentFlow` — Flow 4: same as Flow 2 but nodeB uses `NativeExternalRLNSigner`
- `runRlnUtexoVssFlow` / `runRlnVssFlow` — VSS backup/restore flows

**Flow guard:** `beginExclusiveFlow` / `endExclusiveFlow` prevent concurrent flows by tracking `activeDemoFlow`. Flows must run sequentially — running two simultaneously corrupts node state.

**Step tracking:** Every flow uses `createFlowResults()` which returns `addStep(name, status, data?, error?)`. Steps are upserted by name so the UI can update in-place.

### Port allocation

Each flow picks a random base port and allocates ports as:
```
nodeA: base, base+1
nodeB: base+100, base+101
nodeC: base+200, base+201
```
Ranges per flow: Flow 1 / Flow 3 use 20000–30000; Flow 2 uses 21000–26000; Flow 4 uses 22000–27000.

### Node storage

Each node gets a directory created via `expo-file-system` before `UTEXOWallet` is constructed:
```
<documentDirectory>/rln_wallet_chan_a_<timestamp>/
<documentDirectory>/rln_wallet_chan_b_<timestamp>/
```
Fresh directories are created per flow run (timestamp suffix). Old directories accumulate on disk.

### App screens (`app/(tabs)/`)

- `flows.tsx` — primary screen; buttons to run each flow, live step log, SDK utility tests
- `utexo.tsx` — UTEXO network tab
- `lsp-regtest.tsx` — full LSP e2e flow (lightning_receive Part 1 + User A pays User B Part 2)
- `lsp.tsx` — LSP flow against UTEXO public network
- `index.tsx` — home

### Key plugin

`plugins/withExcludeX86SimulatorArch.js` — Expo config plugin that strips x86_64 slice from simulator builds so the arm64-only `RGBLightningNode.xcframework` links correctly on Apple Silicon Macs.

## LSP Flow (`app/(tabs)/lsp-regtest.tsx`)

Implements `test_flow0_full_e2e` from `utexo-lsp/tests/e2e/tests/test_flow0_full_e2e.py`.

**What it demonstrates:**
- Part 1: User A receives RGB inbound liquidity via the LSP (`lightning_receive` protocol) — an external sender (faucet in regtest) sends RGB on-chain to the LSP, LSP delivers it to User A over a Lightning channel.
- Part 2: User A pays User B — proves outbound liquidity works. LSP opens a channel to User B, User B creates an invoice, User A pays via the LSP as a routing node.

**Infrastructure required:** Run `./scripts/start-lsp-regtest.sh` before launching the flow. This script:
1. Wipes and restarts `data_lsp` + `data_faucet` RLN nodes fresh
2. Issues **two** RGB assets on the Faucet node — NIA `UTST` (precision 0) and IFA `UTIF` (precision 6)
3. Seeds the LSP with `SEED_ROUNDS` (6) allocations of the **active** asset (`ASSET=utst|ifa`), `SEED_UNITS` base units apiece
4. Starts `utexo-lsp` (Go service) with `SUPPORTED_ASSET_IDS` set to the active asset only — see the one-session-per-peer note below
5. Writes both asset IDs (+ ticker, precision) and the LSP pubkey to `.env.lsp.local`, `.env.local` and `e2e-fixtures.json`

**Key services and ports:**

| Service | Port | Binary/command |
|---------|------|---------------|
| LSP RLN node | 3005 (REST), 9737 (LDK peer) | `rgb-lightning-node data_lsp` |
| Faucet RLN node | 3008 (REST), 9740 (LDK peer) | `rgb-lightning-node data_faucet` |
| utexo-lsp (Go) | 8080 | `go run .` in `utexo-lsp/` |
| RGB Proxy | 3000 | Docker (part of regtest stack) |
| Bitcoin node helper | 5000 | `local-node-bridge.js` |

**Android emulator port forwards (all required):**
```bash
adb reverse tcp:8081 tcp:8081   # Metro JS
adb reverse tcp:8082 tcp:8082   # Metro HMR
adb reverse tcp:3000 tcp:3000   # RGB Proxy ← critical for RGB consignment delivery
adb reverse tcp:3005 tcp:3005   # LSP RLN node
adb reverse tcp:5000 tcp:5000   # Bitcoin node helper
```
These are set automatically by `npm run android` (via `adb wait-for-device &&` prefix).

**Stopping the LSP stack:**
```bash
./scripts/start-lsp-regtest.sh stop
pkill -f "utexo-lsp"  # stop script misses compiled binaries
```

**Common failure: `InsufficientAssets` / stuck Initiated Sends**
The `utexo-lsp` cron fires every 5s and calls `/openchannel` on the LSP node for every connected peer. If the RGB consignment can't be delivered (proxy not reachable from emulator), the channel open creates an Initiated Send that locks a UTXO but never settles. After 3 such failures all 3 seeded UTXOs are locked → `spendable=0` → permanent `InsufficientAssets`.
Fix: ensure `adb reverse tcp:3000 tcp:3000` is set before connecting the app to the LSP, then re-run `start-lsp-regtest.sh`.

**Root cause of `CounterpartyForceClosed: Failed to find RGB consignment`**
This is the underlying error behind the stuck sends — the app node rejects the channel because it can't fetch the RGB consignment from the proxy. Always set the proxy port forward before running the LSP flow.

## APay cart flows — two assets, one LSP

`screens/apay/useApayFlow.ts` is asset-agnostic: pass an `ApayAsset` (`screens/apay/config.ts`) and it drives the whole checkout. Two profiles ship:

| Profile | Asset | Precision | Checkout | Screen |
|---------|-------|-----------|----------|--------|
| `UTST_ASSET` | NIA `UTST` | 0 | 3000 sat + 1 UTST | `screens/apay-regular-channels.tsx` |
| `IFA_ASSET` | IFA `UTIF` | 6 | 1 sat + 500 000 base units (0.5 UTIF) | `screens/apay-ifa.tsx` |

`apay-ifa.tsx` is a thin wrapper around the cart screen with a different asset, storage prefix and port bases (48000/50000) — the flow code is shared, not copied.

**Amounts are always base units.** Every RGB/LSP API (`receiveAsset.amountRgb`, `payAddress.asset.assetAmount`, `sendrgb` assignments) takes 10^-precision units; `precision` only affects display. `formatAssetAmount()` in `screens/apay/config.ts` renders them.

**One asset per stack run — this is a hard constraint, not a preference.** `virtual_channel_add_intent` (rgb-lightning-node `src/ldk.rs`) rejects a second virtual channel to a peer it already has a session with, and the check ignores the asset entirely:

```
openchannel failed for 03eadf98…: virtual channel session already exists for this peer pair
```

So an LSP advertising two assets in `SUPPORTED_ASSET_IDS` opens a channel for whichever the cron reaches first and leaves every flow for the other asset polling until its channel timeout. The script therefore serves exactly one:

```bash
./scripts/start-lsp-regtest.sh             # UTST
ASSET=ifa ./scripts/start-lsp-regtest.sh   # UTIF
```

Both assets are issued on the faucet either way (so the fixtures and `.env.local` stay complete), but only the active one is seeded to the LSP and advertised. `EXPO_PUBLIC_LSP_REGTEST_ACTIVE_ASSET` tells the app which; the flows check it up front and refuse with the command to run rather than burning 180 s in `waitForChannel`.

`DEFAULT_CHANNEL_ASSET_AMOUNT` is a single global in utexo-lsp, so the script sizes it for the precision-6 asset (1 000 000 base units = 1.0 UTIF, and harmlessly 1 000 000 whole UTST) and seeds ~120 channels' worth.

### `MIN_AMT_MSAT` and the 1-sat HTLC

`rgb-lightning-node` has two per-HTLC floors (`src/core_types.rs`):
- `HTLC_MIN_MSAT = 3_000_000` — regular channels. An RGB payment rides the HTLC output, and a dust-trimmed HTLC on a broadcastable commitment cannot settle the asset.
- `VIRTUAL_HTLC_MIN_MSAT = 1_000` — `trusted_no_broadcast` (virtual) channels. Never broadcast, so no dust limit applies.

The virtual floor is applied consistently on every leg: channel open (`our_htlc_minimum_msat`, `routes.rs`/`sdk/mod.rs`), invoice creation (`htlc_min_msat_for_asset`), sends/keysend (`htlc_min_msat_for_peer`) and the APay `request_outbound_invoice` handler (`ldk.rs`). The acceptor keeps LDK's default 1 msat, and utexo-lsp never subtracts a fee — the outbound leg must equal the reserved `amount_msat`. So **1 sat works end to end on virtual channels**, and `start-lsp-regtest.sh` defaults `MIN_AMT_MSAT=1000` whenever `VIRTUAL_OPEN_MODE` is set (falling back to 3 000 000 when it is not).

`LIGHTNING_ADDRESS_MIN_SENDABLE_MSAT` has to track it — the SDK validates `payAddress` against LNURL discovery's `minSendable`, not against `MIN_AMT_MSAT`, so leaving it at the 3 000 000 default would reject a 1-sat checkout client-side. `maxSendable` is set to the per-HTLC ceiling utexo-lsp itself derives (`capacity × PEER_MAX_INBOUND_HTLC_IN_FLIGHT_PERCENT`).

## LSP-related SDK bugs fixed (in `@utexo/rgb-sdk-core`, moved out of `../rgb-sdk-rn`)

### `UtexoLSPClient` snake_case mismatch (`rgb-sdk-core/src/lsp/UtexoLSPClient.ts`)

`utexo-lsp` returns JSON with snake_case keys (`rgb_invoice`, `ln_invoice`, `mapping_id`, `num_channels`, etc.). The SDK's `request<T>()` does a plain `JSON.parse()` with no key transformation, so camelCase type fields come back as `undefined` unless explicitly mapped.

Fixed in `lightningReceive()` by introducing `LspLightningReceiveWire` type and explicitly mapping keys:
```ts
const raw = await this.request<LspLightningReceiveWire>('/lightning_receive', ...);
return {
  lnInvoice:  raw.ln_invoice  ?? raw.lnInvoice  ?? '',
  rgbInvoice: raw.rgb_invoice ?? raw.rgbInvoice ?? '',
  mappingId:  String(raw.mapping_id ?? raw.mappingId ?? ''),
};
```

**Status (verified 2026-08-06):** all previously-flagged endpoints are now fixed — `getInfo()` maps every snake_case field explicitly (`apiVersion`, `supportedAssets`, `minPaymentSizeMsat`, etc.), `onchainSend` response has its own wire type + mapping, and `ApayNewResponse` now goes through the native P2P binding (already camelCase, consistent on both platforms) so the REST variant's mismatch is moot.

## What the App Must Provide (vs SDK)

The SDK never touches Bitcoin Core or the filesystem directly. The app owns:
- Creating node storage directories (`FileSystem.makeDirectoryAsync`)
- Funding wallets (`sendToAddress` → Bitcoin node helper)
- Mining confirmation blocks (`mine` → Bitcoin node helper)
- Port assignment per node
- Polling loops for channel readiness (`getNodeInfo().numUsableChannels`) and balance settlement (`getAssetBalance()`)
- Env variable parsing (`readEnv()` wrapper around `process.env.EXPO_PUBLIC_*`)

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
