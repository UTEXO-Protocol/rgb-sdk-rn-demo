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
- `index.tsx` — home

### Key plugin

`plugins/withExcludeX86SimulatorArch.js` — Expo config plugin that strips x86_64 slice from simulator builds so the arm64-only `RGBLightningNode.xcframework` links correctly on Apple Silicon Macs.

## What the App Must Provide (vs SDK)

The SDK never touches Bitcoin Core or the filesystem directly. The app owns:
- Creating node storage directories (`FileSystem.makeDirectoryAsync`)
- Funding wallets (`sendToAddress` → Bitcoin node helper)
- Mining confirmation blocks (`mine` → Bitcoin node helper)
- Port assignment per node
- Polling loops for channel readiness (`getNodeInfo().numUsableChannels`) and balance settlement (`getAssetBalance()`)
- Env variable parsing (`readEnv()` wrapper around `process.env.EXPO_PUBLIC_*`)
