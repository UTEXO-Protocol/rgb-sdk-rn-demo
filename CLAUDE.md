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
2. Issues a new RGB asset (UTST) on the Faucet node
3. Seeds the LSP with 3 units from the Faucet
4. Starts `utexo-lsp` (Go service) with `SUPPORTED_ASSET_IDS` set to the new asset
5. Writes the new asset ID + LSP pubkey to `.env.lsp.local` and `.env.local`

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

## LSP-related SDK bugs fixed (in `../rgb-sdk-rn`)

### `UtexoLSPClient` snake_case mismatch (`src/lsp/UtexoLSPClient.ts`)
`utexo-lsp` returns JSON with snake_case keys (`rgb_invoice`, `ln_invoice`, `mapping_id`). The SDK's `request<T>()` does a plain `JSON.parse()` with no key transformation, so camelCase type fields like `rgbInvoice` come back as `undefined`.

Fixed in `lightningReceive()` by introducing `LspLightningReceiveWire` type and explicitly mapping keys:
```ts
const raw = await this.request<LspLightningReceiveWire>('/lightning_receive', ...);
return {
  lnInvoice:  raw.ln_invoice  ?? raw.lnInvoice  ?? '',
  rgbInvoice: raw.rgb_invoice ?? raw.rgbInvoice ?? '',
  mappingId:  String(raw.mapping_id ?? raw.mappingId ?? ''),
};
```

**Still needs fixing:** `getInfo` (`num_channels` vs `numChannels`), `onchainSend` response, `ApayNewResponse` fields — all have the same snake_case mismatch pattern.

## What the App Must Provide (vs SDK)

The SDK never touches Bitcoin Core or the filesystem directly. The app owns:
- Creating node storage directories (`FileSystem.makeDirectoryAsync`)
- Funding wallets (`sendToAddress` → Bitcoin node helper)
- Mining confirmation blocks (`mine` → Bitcoin node helper)
- Port assignment per node
- Polling loops for channel readiness (`getNodeInfo().numUsableChannels`) and balance settlement (`getAssetBalance()`)
- Env variable parsing (`readEnv()` wrapper around `process.env.EXPO_PUBLIC_*`)
