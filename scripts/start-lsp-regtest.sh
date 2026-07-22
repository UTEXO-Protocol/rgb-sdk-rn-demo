#!/usr/bin/env bash
# start-lsp-regtest.sh
#
# Sets up the full LSP regtest environment matching the utexo-lsp e2e test fixture:
#   LSP daemon  (port 3001, peer 9735) — docker RLN
#   Faucet daemon (port 3004, peer 9738) — docker RLN
#   utexo-lsp   (port 8080) — Go service
#   local-node-bridge (port 5000) — bitcoin-cli helper for mine/send
#
# Run once before starting the demo app.
# Outputs .env.lsp.local with LSP_ASSET_ID, LSP_PEER_PUBKEY, etc.
#
# Usage:
#   ./scripts/start-lsp-regtest.sh
#   ./scripts/start-lsp-regtest.sh stop     # kill daemons

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RGBLN_REPO="${RGBLN_REPO:?Set RGBLN_REPO to your rgb-lightning-node path, e.g.: export RGBLN_REPO=~/rgb/rgb-lightning-node}"
UTEXO_LSP_REPO="${UTEXO_LSP_REPO:?Set UTEXO_LSP_REPO to your utexo-lsp path, e.g.: export UTEXO_LSP_REPO=~/rgb/utexo-lsp}"
RLN_BIN="$RGBLN_REPO/target/release/rgb-lightning-node"

LSP_DIR="$RGBLN_REPO/data_lsp"
FAUCET_DIR="$RGBLN_REPO/data_faucet"

LSP_PORT=3005
LSP_PEER_PORT=9737
FAUCET_PORT=3008
FAUCET_PEER_PORT=9740
UTEXO_PORT=8080
BRIDGE_PORT=5000

PASSWORD="password123"
BTC_USER="user"
BTC_PASS="password"
BTC_HOST="127.0.0.1"
BTC_PORT=18443
INDEXER_URL="127.0.0.1:50001"
PROXY_ENDPOINT="rpc://127.0.0.1:3000/json-rpc"

UNLOCK_BODY="{\"password\":\"$PASSWORD\",\"bitcoind_rpc_username\":\"$BTC_USER\",\"bitcoind_rpc_password\":\"$BTC_PASS\",\"bitcoind_rpc_host\":\"$BTC_HOST\",\"bitcoind_rpc_port\":$BTC_PORT,\"indexer_url\":\"$INDEXER_URL\",\"proxy_endpoint\":\"$PROXY_ENDPOINT\",\"announce_addresses\":[]}"

ENV_OUT="$DEMO_DIR/.env.lsp.local"

# ── helpers ───────────────────────────────────────────────────────────────────

log() { echo "[lsp-setup] $*"; }
die() { echo "[lsp-setup] ERROR: $*" >&2; exit 1; }

rln_post() {
  local port=$1; local path=$2; local body=${3:-'{}'};
  curl -sf -X POST "http://127.0.0.1:$port$path" \
    -H 'Content-Type: application/json' \
    -d "$body" || die "POST $path failed on port $port"
}

rln_get() {
  local port=$1; local path=$2;
  curl -sf "http://127.0.0.1:$port$path" || die "GET $path failed on port $port"
}

wait_for_port() {
  local port=$1; local label=$2; local deadline=$((SECONDS + 30))
  log "Waiting for $label on :$port …"
  # 200 = ready, 403 = locked (not yet init'd) — both mean the daemon is listening
  while true; do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$port/nodeinfo" 2>/dev/null || echo "000")
    if [ "$code" = "200" ] || [ "$code" = "403" ]; then
      break
    fi
    [ $SECONDS -lt $deadline ] || die "$label did not start within 30s"
    sleep 1
  done
  log "$label ready"
}

wait_for_utexo() {
  local deadline=$((SECONDS + 120))
  log "Waiting for utexo-lsp on :$UTEXO_PORT (may take ~60s on first run for go compile) …"
  while ! curl -sf "http://127.0.0.1:$UTEXO_PORT/health" >/dev/null 2>&1; do
    [ $SECONDS -lt $deadline ] || die "utexo-lsp did not start within 120s"
    sleep 2
  done
  log "utexo-lsp ready"
}

btc_mine() {
  local n=$1
  cd "$RGBLN_REPO"
  docker compose exec -u blits bitcoind bitcoin-cli -regtest -rpcwallet=miner -generate "$n" >/dev/null
  log "Mined $n block(s)"
}

btc_send() {
  local addr=$1; local amt=$2
  cd "$RGBLN_REPO"
  docker compose exec -u blits bitcoind bitcoin-cli -regtest sendtoaddress "$addr" "$amt" | tr -d '"'
}

# ── stop mode ─────────────────────────────────────────────────────────────────

if [ "${1:-}" = "stop" ]; then
  log "Stopping LSP, Faucet, utexo-lsp, bridge …"
  pkill -f "rgb-lightning-node.*data_lsp"    2>/dev/null || true
  pkill -f "rgb-lightning-node.*data_faucet" 2>/dev/null || true
  pkill -f "go run \."                       2>/dev/null || true
  pkill -f "utexo-lsp"                       2>/dev/null || true
  pkill -f "local-node-bridge"               2>/dev/null || true
  # A fixture describing a torn-down stack would send e2e at dead endpoints.
  rm -f "$DEMO_DIR/e2e-fixtures.json"
  log "Done."
  exit 0
fi

# ── preflight ─────────────────────────────────────────────────────────────────

log ""
log "⚠  IMPORTANT: Reset / Cancel any running demo app flow BEFORE continuing."
log "   Active demo nodes stay connected to the LSP. If the cron fires while"
log "   they are connected it creates stuck Initiated Sends → spendable=0."
log ""

[ -f "$RLN_BIN" ] || die "RLN binary not found: $RLN_BIN  (run: cargo build --release in rgb-lightning-node)"
command -v go >/dev/null || die "go not found — install Go"
command -v jq >/dev/null || die "jq not found — brew install jq"

# Check regtest services are running
cd "$RGBLN_REPO"
docker compose ps --services --status running | grep -q bitcoind || die "regtest not running — start with: ./regtest.sh start"
log "Regtest services confirmed running"

# ── local-node-bridge (mine/send helper for demo app) ─────────────────────────

if ! curl -sf "http://127.0.0.1:$BRIDGE_PORT/execute" -d '{"args":"getblockcount"}' >/dev/null 2>&1; then
  log "Starting local-node-bridge on :$BRIDGE_PORT …"
  mkdir -p "$DEMO_DIR/logs"
  RGBLN_REPO="$RGBLN_REPO" node "$DEMO_DIR/scripts/local-node-bridge.js" >"$DEMO_DIR/logs/bridge.log" 2>&1 &
  sleep 2
  curl -sf "http://127.0.0.1:$BRIDGE_PORT/execute" -d '{"args":"getblockcount"}' >/dev/null || die "local-node-bridge failed to start"
  log "local-node-bridge ready"
else
  log "local-node-bridge already running"
fi

# ── start LSP daemon ─────────────────────────────────────────────────────────

pkill -f "rgb-lightning-node.*data_lsp" 2>/dev/null || true
sleep 1
# Always start fresh (mirrors test fixture: new artifact_dir per run)
rm -rf "$LSP_DIR"
mkdir -p "$LSP_DIR" "$RGBLN_REPO/logs" "$DEMO_DIR/logs"
APAY_BEARER_TOKEN="apay-regtest-secret"

log "Starting LSP RLN daemon (port $LSP_PORT, peer $LSP_PEER_PORT) …"
# --lsp-base-url: host node forwards async_order.new P2P messages to utexo-lsp
# --lsp-bearer-token: must match APAY_BEARER_TOKEN in utexo-lsp (fail-closed if empty)
# --enable-virtual-channels-v0: required for async-pay.tsx — User B nodes are created with
#   enableVirtualChannelsV0:true and reject standard anchor channels with "unsupported_scid_alias".
#   Virtual channels (trusted_no_broadcast) avoid the SCID-alias negotiation entirely.
"$RLN_BIN" "$LSP_DIR" \
  --daemon-listening-port "$LSP_PORT" \
  --ldk-peer-listening-port "$LSP_PEER_PORT" \
  --network regtest \
  --disable-authentication \
  --enable-virtual-channels-v0 \
  --lsp-base-url "http://127.0.0.1:$UTEXO_PORT" \
  --lsp-bearer-token "$APAY_BEARER_TOKEN" \
  >"$DEMO_DIR/logs/rln-lsp.log" 2>&1 &
LSP_PID=$!
wait_for_port "$LSP_PORT" "LSP daemon"

# ── start Faucet daemon ───────────────────────────────────────────────────────

pkill -f "rgb-lightning-node.*data_faucet" 2>/dev/null || true
sleep 1
rm -rf "$FAUCET_DIR"
mkdir -p "$FAUCET_DIR"
log "Starting Faucet RLN daemon (port $FAUCET_PORT, peer $FAUCET_PEER_PORT) …"
"$RLN_BIN" "$FAUCET_DIR" \
  --daemon-listening-port "$FAUCET_PORT" \
  --ldk-peer-listening-port "$FAUCET_PEER_PORT" \
  --network regtest \
  --disable-authentication \
  >"$DEMO_DIR/logs/rln-faucet.log" 2>&1 &
FAUCET_PID=$!
wait_for_port "$FAUCET_PORT" "Faucet daemon"

# ── init + unlock ─────────────────────────────────────────────────────────────

log "Initializing LSP node …"
rln_post "$LSP_PORT" "/init" "{\"password\":\"$PASSWORD\"}" >/dev/null

log "Initializing Faucet node …"
rln_post "$FAUCET_PORT" "/init" "{\"password\":\"$PASSWORD\"}" >/dev/null

log "Unlocking LSP …"
rln_post "$LSP_PORT" "/unlock" "$UNLOCK_BODY" >/dev/null

log "Unlocking Faucet …"
rln_post "$FAUCET_PORT" "/unlock" "$UNLOCK_BODY" >/dev/null

# Wait for nodes to finish unlocking (sync, LDK startup, etc.)
log "Waiting for nodes to finish unlocking …"
for port in "$LSP_PORT" "$FAUCET_PORT"; do
  local_deadline=$((SECONDS + 60))
  while true; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$port/nodeinfo" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then break; fi
    [ $SECONDS -lt $local_deadline ] || die "Node on :$port did not unlock within 60s (last code: $code)"
    sleep 2
  done
  log "Node on :$port unlocked"
done

# ── get pubkeys ───────────────────────────────────────────────────────────────

LSP_PUBKEY=$(rln_get "$LSP_PORT" "/nodeinfo" | jq -r '.pubkey')
FAUCET_PUBKEY=$(rln_get "$FAUCET_PORT" "/nodeinfo" | jq -r '.pubkey')
log "LSP pubkey:    $LSP_PUBKEY"
log "Faucet pubkey: $FAUCET_PUBKEY"

# ── fund both nodes ───────────────────────────────────────────────────────────

log "Getting addresses …"
LSP_ADDR=$(rln_post "$LSP_PORT"    "/address" | jq -r '.address')
FAUCET_ADDR=$(rln_post "$FAUCET_PORT" "/address" | jq -r '.address')
log "LSP address:    $LSP_ADDR"
log "Faucet address: $FAUCET_ADDR"

log "Funding LSP (1 BTC) …";    btc_send "$LSP_ADDR"    1 >/dev/null
log "Funding Faucet (1 BTC) …"; btc_send "$FAUCET_ADDR" 1 >/dev/null
btc_mine 6
sleep 3

# ── create UTXOs ──────────────────────────────────────────────────────────────

UTXO_BODY='{"up_to":false,"num":10,"size":null,"fee_rate":7,"skip_sync":false}'

log "Creating UTXOs on LSP …"
rln_post "$LSP_PORT"    "/createutxos" "$UTXO_BODY" >/dev/null
log "Creating UTXOs on Faucet …"
rln_post "$FAUCET_PORT" "/createutxos" "$UTXO_BODY" >/dev/null
btc_mine 1
sleep 2

# ── issue RGB asset on Faucet ─────────────────────────────────────────────────

log "Issuing RGB asset on Faucet …"
ISSUE_RESP=$(rln_post "$FAUCET_PORT" "/issueassetnia" \
  '{"ticker":"UTST","name":"UTEXO LSP Test","precision":0,"amounts":[1000]}')
ASSET_ID=$(echo "$ISSUE_RESP" | jq -r '.asset.asset_id // .asset_id // empty')
[ -n "$ASSET_ID" ] || die "Failed to parse asset_id from: $ISSUE_RESP"
log "Asset ID: $ASSET_ID"
btc_mine 1
sleep 2

# ── seed LSP from Faucet (mirrors seed_lsp_from_faucet in harness.py) ────────

log "Seeding LSP with 6 RGB units from Faucet …"
for i in 1 2 3 4 5 6; do
  log "  Seed $i/6 …"

  # Get RGB invoice on LSP — no asset_id (receive any asset, mirrors lsp.rgbinvoice_any())
  EXPIRY=$(($(date +%s) + 3600))
  RGB_INVOICE_RESP=$(rln_post "$LSP_PORT" "/rgbinvoice" \
    "{\"assignment\":{\"type\":\"Any\"},\"expiration_timestamp\":$EXPIRY,\"min_confirmations\":1,\"witness\":false}")
  RECIPIENT_ID=$(echo "$RGB_INVOICE_RESP" | jq -r '.recipient_id')
  [ -n "$RECIPIENT_ID" ] || die "No recipient_id in rgbinvoice response: $RGB_INVOICE_RESP"

  # Send 1 unit from Faucet → LSP
  # Note: skip_sync is required by the Rust struct (not in openapi docs)
  # assignment format: {"type":"Fungible","value":N}
  SEND_BODY=$(printf '{
  "donation": true,
  "fee_rate": 7,
  "min_confirmations": 1,
  "skip_sync": false,
  "recipient_map": {
    "%s": [
      {
        "recipient_id": "%s",
        "assignment": {"type": "Fungible", "value": 1},
        "transport_endpoints": ["%s"]
      }
    ]
  }
}' "$ASSET_ID" "$RECIPIENT_ID" "$PROXY_ENDPOINT")
  rln_post "$FAUCET_PORT" "/sendrgb" "$SEND_BODY" >/dev/null
  btc_mine 1
  sleep 2

  # Double refresh (mirrors harness.py)
  rln_post "$LSP_PORT"    "/refreshtransfers" '{"filter":[],"skip_sync":false}' >/dev/null 2>&1 || true
  rln_post "$LSP_PORT"    "/refreshtransfers" '{"filter":[],"skip_sync":false}' >/dev/null 2>&1 || true
  rln_post "$FAUCET_PORT" "/refreshtransfers" '{"filter":[],"skip_sync":false}' >/dev/null 2>&1 || true
  rln_post "$FAUCET_PORT" "/refreshtransfers" '{"filter":[],"skip_sync":false}' >/dev/null 2>&1 || true
done

log "LSP seeded. Checking LSP asset balance …"
LSP_BAL=$(rln_post "$LSP_PORT" "/assetbalance" "{\"asset_id\":\"$ASSET_ID\"}" | jq '.settled // 0')
log "LSP settled balance: $LSP_BAL"

# ── set adb reverse ports so Android emulator can reach proxy + LSP ──────────
# Must happen BEFORE utexo-lsp starts; otherwise cron fires, consignment
# delivery fails (proxy unreachable), and Initiated Sends lock all UTXOs.
if command -v adb >/dev/null 2>&1 && adb devices | grep -q "emulator\|device"; then
  log "Setting adb reverse port forwards …"
  adb reverse tcp:3000 tcp:3000 && log "  tcp:3000 (proxy) ok"      || log "  tcp:3000 (proxy) FAILED — set manually"
  adb reverse tcp:3005 tcp:3005 && log "  tcp:3005 (LSP)   ok"      || log "  tcp:3005 (LSP)   FAILED — set manually"
  adb reverse tcp:3008 tcp:3008 && log "  tcp:3008 (faucet) ok"     || log "  tcp:3008 (faucet) FAILED — set manually"
  adb reverse tcp:8080 tcp:8080 && log "  tcp:8080 (utexo-lsp) ok"  || log "  tcp:8080 (utexo-lsp) FAILED — set manually"
  adb reverse tcp:5000 tcp:5000 && log "  tcp:5000 (bridge) ok"     || log "  tcp:5000 (bridge) FAILED — set manually"
  adb reverse tcp:8081 tcp:8081 && log "  tcp:8081 (Metro JS) ok"   || log "  tcp:8081 (Metro JS) FAILED — set manually"
  adb reverse tcp:8082 tcp:8082 && log "  tcp:8082 (Metro HMR) ok"  || log "  tcp:8082 (Metro HMR) FAILED — set manually"
else
  log "adb not found or no device — skipping port forwards"
  log "  Run manually before starting the app:"
  log "    adb reverse tcp:3000 tcp:3000"
  log "    adb reverse tcp:3005 tcp:3005"
  log "    adb reverse tcp:3008 tcp:3008"
  log "    adb reverse tcp:8080 tcp:8080"
  log "    adb reverse tcp:5000 tcp:5000"
  log "    adb reverse tcp:8081 tcp:8081"
  log "    adb reverse tcp:8082 tcp:8082"
fi

# ── start utexo-lsp ───────────────────────────────────────────────────────────

pkill -f "go run \."  2>/dev/null || true
pkill -f "utexo-lsp"  2>/dev/null || true
sleep 2

# Wipe the database so the new instance starts clean (no stale transfers/assets from previous runs)
rm -f "$UTEXO_LSP_REPO/utexo_lsp.db"
log "Wiped utexo_lsp.db"

log "Starting utexo-lsp (port $UTEXO_PORT) with SUPPORTED_ASSET_IDS=$ASSET_ID …"
cd "$UTEXO_LSP_REPO"
env \
  LSP_BASE_URL="http://127.0.0.1:$LSP_PORT" \
  RGB_NODE_BASE_URL="http://127.0.0.1:$LSP_PORT" \
  LIGHTNING_ADDRESS_DOMAIN_URL="http://127.0.0.1:$UTEXO_PORT" \
  SUPPORTED_ASSET_IDS="$ASSET_ID" \
  CRON_EVERY="5s" \
  DEFAULT_CHANNEL_CAPACITY_SAT="200000" \
  DEFAULT_CHANNEL_PUSH_MSAT="5000000" \
  DEFAULT_CHANNEL_ASSET_AMOUNT="2" \
  DEFAULT_VIRTUAL_OPEN_MODE="trusted_no_broadcast" \
  MIN_AMT_MSAT="3000000" \
  EXPIRY_MATCH_TOLERANCE_SEC="30" \
  UTXO_MIN_COUNT="15" \
  UTXO_TARGET_COUNT="25" \
  APAY_BEARER_TOKEN="$APAY_BEARER_TOKEN" \
  APAY_OUTBOUND_MIN_FINAL_CLTV_EXPIRY_DELTA="42" \
  go run . >"$DEMO_DIR/logs/utexo-lsp.log" 2>&1 &
UTEXO_PID=$!
wait_for_utexo

# ── write env file ────────────────────────────────────────────────────────────

# URLs are computed at runtime from Platform.OS (mirrors wallet-flow.ts pattern).
# Only write non-URL values to env files.
cat > "$ENV_OUT" <<EOF
EXPO_PUBLIC_LSP_REGTEST_ASSET_ID="$ASSET_ID"
EXPO_PUBLIC_LSP_REGTEST_PEER_PUBKEY="$LSP_PUBKEY"
EXPO_PUBLIC_LSP_REGTEST_LDK_PORT="$LSP_PEER_PORT"
EOF

# Expo auto-loads .env.local — write LSP regtest vars there.
# Single-source env workflow: keep all active vars in .env.local.
ENV_LOCAL="$DEMO_DIR/.env.local"
if [ -f "$ENV_LOCAL" ]; then
  grep -v "^EXPO_PUBLIC_LSP_REGTEST_\|^EXPO_PUBLIC_FAUCET_REGTEST_" "$ENV_LOCAL" > "$ENV_LOCAL.tmp" && mv "$ENV_LOCAL.tmp" "$ENV_LOCAL"
fi

cat >> "$ENV_LOCAL" <<EOF
EXPO_PUBLIC_LSP_REGTEST_ASSET_ID="$ASSET_ID"
EXPO_PUBLIC_LSP_REGTEST_PEER_PUBKEY="$LSP_PUBKEY"
EXPO_PUBLIC_LSP_REGTEST_LDK_PORT="$LSP_PEER_PORT"
EOF
log "LSP regtest vars written to $ENV_LOCAL (single env-file workflow)"

# ── e2e fixtures — machine-readable, additive to the env files above ──────────
# Consumed by the e2e suites; same shape as the web script's fixture
# (rgb-sdk-web-demo/scripts/start-lsp-web.sh). The emulator reaches every URL
# via the adb reverse forwards set earlier, so 127.0.0.1 stays valid on-device.
FIXTURES="$DEMO_DIR/e2e-fixtures.json"
jq -n \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg assetId "$ASSET_ID" \
  --arg lspPubkey "$LSP_PUBKEY" \
  --arg faucetPubkey "$FAUCET_PUBKEY" \
  --arg lspUrl "http://127.0.0.1:$LSP_PORT" \
  --arg faucetUrl "http://127.0.0.1:$FAUCET_PORT" \
  --arg utexoLspUrl "http://127.0.0.1:$UTEXO_PORT" \
  --arg bridgeUrl "http://127.0.0.1:$BRIDGE_PORT" \
  --arg indexerUrl "$INDEXER_URL" \
  --arg proxyEndpoint "$PROXY_ENDPOINT" \
  --argjson lspPeerPort "$LSP_PEER_PORT" \
  --argjson faucetPeerPort "$FAUCET_PEER_PORT" \
  '{
    generatedAt: $generatedAt,
    platform: "rn",
    ASSET_ID: $assetId,
    LSP_PUBKEY: $lspPubkey,
    FAUCET_PUBKEY: $faucetPubkey,
    LSP_URL: $lspUrl,
    FAUCET_URL: $faucetUrl,
    UTEXO_LSP_URL: $utexoLspUrl,
    BRIDGE_URL: $bridgeUrl,
    INDEXER_URL: $indexerUrl,
    PROXY_ENDPOINT: $proxyEndpoint,
    LSP_PEER_PORT: $lspPeerPort,
    FAUCET_PEER_PORT: $faucetPeerPort
  }' \
  > "$FIXTURES"
log "e2e fixtures written to $FIXTURES"

log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  LSP regtest environment ready"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  utexo-lsp:   http://127.0.0.1:$UTEXO_PORT"
log "  LSP daemon:  http://127.0.0.1:$LSP_PORT  (peer :$LSP_PEER_PORT)"
log "  Faucet:      http://127.0.0.1:$FAUCET_PORT  (peer :$FAUCET_PEER_PORT)"
log "  Asset ID:    $ASSET_ID"
log "  LSP pubkey:  $LSP_PUBKEY"
log "  Env file:    $ENV_OUT"
log "  Fixtures:    $FIXTURES"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  Start demo app, select Regtest in LSP tab"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
