# LSP Regtest Setup

## Repos you need

Clone these three repos side by side (e.g. all under `~/rgb/`):

```bash
git clone https://github.com/UTEXO-Protocol/rgb-lightning-node.git
git clone https://github.com/UTEXO-Protocol/utexo-lsp.git
git clone https://github.com/UTEXO-Protocol/rgb-sdk-rn-demo.git
```

```
rgb-lightning-node/   ← regtest docker stack + RLN binary
utexo-lsp/            ← Go LSP service
rgb-sdk-rn-demo/      ← this repo, demo app
```

`rgb-lightning-node` is used as-is — no extra files committed there.

---

## Prerequisites

```bash
# macOS
brew install go jq node docker

# Rust (for building the RLN binary)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

---

## Step 1 — Build the RLN binary

```bash
cd rgb-lightning-node
cargo build --release
```

Takes a few minutes on first run.

---

## Step 2 — Start the regtest docker stack

```bash
# from inside rgb-lightning-node
VSS=1 ./regtest.sh start
```

This starts Bitcoin Core, Electrum, RGB Proxy, and a VSS server.

To stop and wipe everything:
```bash
./regtest.sh stop
```

---

## Step 3 — Set environment variables

Export these in your shell (add to `~/.zshrc` / `~/.bashrc` to persist):

```bash
export RGBLN_REPO=/absolute/path/to/rgb-lightning-node
export UTEXO_LSP_REPO=/absolute/path/to/utexo-lsp
```

The setup script and the bitcoin bridge both read `RGBLN_REPO` to locate the docker compose project.

---

## Step 4 — Start the bitcoin-cli bridge

The demo app cannot call `bitcoin-cli` directly. This shim translates HTTP calls from the app into `docker compose exec` commands against the regtest container.

```bash
# from rgb-sdk-rn-demo root
node scripts/local-node-bridge.js
```

Leave this running in a terminal.

---

## Step 5 — Run the LSP setup script

```bash
# from rgb-sdk-rn-demo root
./scripts/start-lsp-regtest.sh
```

This script:
1. Starts a fresh LSP RLN node and a Faucet RLN node (kills any previous ones)
2. Initializes and unlocks both nodes
3. Funds both nodes (1 BTC each) from the regtest miner
4. Issues a new RGB test asset (`UTST`) on the Faucet
5. Seeds the LSP with 3 units of that asset
6. Sets `adb reverse` port forwards if an Android emulator is connected
7. Starts `utexo-lsp` (first run compiles Go deps — allow ~60 s)
8. Writes the live asset ID and LSP pubkey into `.env.local`

Expected final output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  LSP regtest environment ready
  utexo-lsp:   http://127.0.0.1:8080
  LSP daemon:  http://127.0.0.1:3005  (peer :9737)
  Faucet:      http://127.0.0.1:3008  (peer :9740)
  Asset ID:    rgb:...
  LSP pubkey:  02...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Step 6 — Android emulator port forwards (Android only)

If the script did not detect a connected device, set these manually **before starting the app**:

```bash
adb reverse tcp:3000 tcp:3000   # RGB Proxy  ← most critical
adb reverse tcp:3005 tcp:3005   # LSP RLN node
adb reverse tcp:8080 tcp:8080   # utexo-lsp
adb reverse tcp:5000 tcp:5000   # local-node-bridge
adb reverse tcp:8081 tcp:8081   # Metro JS
adb reverse tcp:8082 tcp:8082   # Metro HMR
```

> The proxy forward (`tcp:3000`) must be set **before** `utexo-lsp` starts. The LSP cron fires every 30 s and tries to open RGB channels; if the proxy is unreachable from the emulator each attempt locks a UTXO. After 3 failures all seeded UTXOs are locked → `spendable=0` → `InsufficientAssets`. Re-run the setup script to recover.

---

## Step 7 — Build and run the demo app

```bash
npm install --install-strategy=nested
npm run prebuild

# iOS
cd ios && LANG=en_US.UTF-8 pod install && cd ..
npm run ios:release

# Android
npm run android:release
```

Always use **Release** builds — the native RLN daemon can't reliably bind ports in Debug mode.

In the app: **LSP tab → Regtest**.

---

## Stopping everything

```bash
./scripts/start-lsp-regtest.sh stop        # kills LSP, Faucet, utexo-lsp, bridge
cd rgb-lightning-node && ./regtest.sh stop  # wipes docker stack
```

---

## Troubleshooting

**`InsufficientAssets` or stuck Initiated Sends**
Set all `adb reverse` ports, then re-run `./scripts/start-lsp-regtest.sh`.

**`CounterpartyForceClosed: Failed to find RGB consignment`**
Same cause — `adb reverse tcp:3000 tcp:3000` was missing before utexo-lsp started.

**`RLN binary not found`**
Run `cargo build --release` in `rgb-lightning-node`.

**utexo-lsp takes >60 s to start**
Normal on first run while Go downloads and compiles dependencies.

---

## Logs

All daemon logs are written to `logs/` inside this repo (created automatically):

```
logs/bridge.log       # local-node-bridge
logs/rln-lsp.log      # LSP RLN node
logs/rln-faucet.log   # Faucet RLN node
logs/utexo-lsp.log    # utexo-lsp Go service
```
