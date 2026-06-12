#!/usr/bin/env bash
# claimbug.sh — Desktop APay repro (merchant + buyer RLN + Host LSP + utexo-lsp)
#
# Follows HackMD "Async Payments" §3 Flow Overview:
#   https://hackmd.io/@xalkan/async-payments
#
#   1. Recipient POST /apay/new  →  hash pool on Host/LSP
#   2. Payer LNURL discovery + callback  →  reserve hash slot, return BOLT11
#      (utexo-lsp: Host inbound HODL via /lninvoice — invoice A in §7 diagram;
#       /apay/outboundinvoice at callback is §3.4 outbox, not checkout)
#   3. Payer pays  →  Host PaymentClaimable  →  LSP status claimable
#   4–8. LSP outbox: outbound_requested → … → inbound_claimed
#
# No manual claim_hodl_invoice on merchant — settlement is LSP-driven (see
# screens/apay-regular-channels.tsx).
#
# Prerequisites:
#   ./scripts/start-lsp-local.sh
#   cargo build --release  (in rgb-lightning-node)
#
# Usage:
#   ./scripts/claimbug.sh              # full run (wipes claimbug node dirs)
#   ./scripts/claimbug.sh --keep-data  # reuse existing merchant/buyer dirs
#   ./scripts/claimbug.sh stop         # kill claimbug nodes only
#   ./scripts/claimbug.sh diagnose     # re-print diagnostics from last run
#
# See docs/apay-flow.md for the APay protocol flow.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RGBLN_REPO="${RGBLN_REPO:-/Users/yuriibandrivskyi/Desktop/utexo/rgb-lightning-node}"
UTEXO_LSP_REPO="${UTEXO_LSP_REPO:-/Users/yuriibandrivskyi/Desktop/utexo/utexo-lsp}"
RLN_BIN="$RGBLN_REPO/target/release/rgb-lightning-node"

MERCHANT_DIR="$RGBLN_REPO/data_claimbug_merchant"
BUYER_DIR="$RGBLN_REPO/data_claimbug_buyer"
HOST_DIR="$RGBLN_REPO/data_lsp"
LOG_DIR="$RGBLN_REPO/logs"
RUN_STATE="$LOG_DIR/claimbug-last.json"

MERCHANT_PORT=3010
MERCHANT_PEER=9745
BUYER_PORT=3011
BUYER_PEER=9746

LSP_PORT=3005
LSP_PEER_PORT=9737
UTEXO_PORT=8080

PASSWORD="password123"
BTC_USER="user"
BTC_PASS="password"
BTC_HOST="127.0.0.1"
BTC_PORT=18443
INDEXER_URL="127.0.0.1:50001"
PROXY_ENDPOINT="rpc://127.0.0.1:3000/json-rpc"

UNLOCK_BODY="{\"password\":\"$PASSWORD\",\"bitcoind_rpc_username\":\"$BTC_USER\",\"bitcoind_rpc_password\":\"$BTC_PASS\",\"bitcoind_rpc_host\":\"$BTC_HOST\",\"bitcoind_rpc_port\":$BTC_PORT,\"indexer_url\":\"$INDEXER_URL\",\"proxy_endpoint\":\"$PROXY_ENDPOINT\",\"announce_addresses\":[]}"

PAYMENT_MSAT=3000000
PAYMENT_ASSET_AMOUNT=1
CHANNEL_TIMEOUT_S=180
SETTLE_TIMEOUT_S=180
POLL_INTERVAL_S=3
KEEPALIVE_S=15

KEEP_DATA=false
KEEP_NODES=false

# ── helpers ───────────────────────────────────────────────────────────────────

log() { echo "[claimbug] $*"; }
step() { log "§3.$1 — $2"; }
die() { echo "[claimbug] ERROR: $*" >&2; exit 1; }

rln_post() {
  local port=$1 path=$2 body=${3:-'{}'}
  curl -sf -X POST "http://127.0.0.1:$port$path" \
    -H 'Content-Type: application/json' \
    -d "$body" || die "POST $path failed on port $port"
}

rln_get() {
  local port=$1 path=$2
  curl -sf "http://127.0.0.1:$port$path" || die "GET $path failed on port $port"
}

node_http_code() {
  local port=$1
  curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$port/nodeinfo" 2>/dev/null || echo "000"
}

wait_for_port() {
  local port=$1 label=$2 deadline=$((SECONDS + 45))
  log "Waiting for $label on :$port …"
  while true; do
    local code
    code=$(node_http_code "$port")
    if [ "$code" = "200" ] || [ "$code" = "403" ]; then
      log "$label listening (HTTP $code)"
      return 0
    fi
    [ $SECONDS -lt $deadline ] || die "$label did not start within 45s (last HTTP $code)"
    sleep 1
  done
}

wait_unlocked() {
  local port=$1 label=$2 deadline=$((SECONDS + 90))
  while true; do
    if [ "$(node_http_code "$port")" = "200" ]; then
      log "$label unlocked"
      return 0
    fi
    [ $SECONDS -lt $deadline ] || die "$label did not unlock within 90s"
    sleep 2
  done
}

btc_mine() {
  local n=$1
  cd "$RGBLN_REPO"
  docker compose exec -u blits bitcoind bitcoin-cli -regtest -rpcwallet=miner -generate "$n" >/dev/null
  log "Mined $n block(s)"
}

btc_send() {
  local addr=$1 amt=$2
  cd "$RGBLN_REPO"
  docker compose exec -u blits bitcoind bitcoin-cli -regtest sendtoaddress "$addr" "$amt" | tr -d '"'
}

load_env() {
  local f
  for f in "$DEMO_DIR/.env.lsp.local" "$DEMO_DIR/.env.local"; do
    if [ -f "$f" ]; then
      # shellcheck disable=SC1090
      set -a; source "$f"; set +a
    fi
  done
  ASSET_ID="${EXPO_PUBLIC_LSP_REGTEST_ASSET_ID:-}"
  LSP_PUBKEY="${EXPO_PUBLIC_LSP_REGTEST_PEER_PUBKEY:-}"
  [ -n "$ASSET_ID" ] || die "EXPO_PUBLIC_LSP_REGTEST_ASSET_ID not set — run ./scripts/start-lsp-local.sh first"
}

check_lsp_stack() {
  node_http_code "$LSP_PORT" | grep -qE '200|403' || die "Host RLN not listening on :$LSP_PORT — run ./scripts/start-lsp-local.sh"
  curl -sf "http://127.0.0.1:$UTEXO_PORT/health" >/dev/null || die "utexo-lsp not healthy on :$UTEXO_PORT"
  if ! nc -z 127.0.0.1 "$LSP_PEER_PORT" 2>/dev/null; then
    die "Host LDK peer port :$LSP_PEER_PORT not reachable — restart ./scripts/start-lsp-local.sh"
  fi
  if [ -z "$LSP_PUBKEY" ]; then
    LSP_PUBKEY=$(rln_get "$LSP_PORT" "/nodeinfo" | jq -r '.pubkey')
  fi
  [ -n "$LSP_PUBKEY" ] || die "Could not resolve Host pubkey"
  log "Host pubkey: $LSP_PUBKEY"
  log "Asset ID:    $ASSET_ID"
}

stop_claimbug_nodes() {
  pkill -f "rgb-lightning-node.*data_claimbug_merchant" 2>/dev/null || true
  pkill -f "rgb-lightning-node.*data_claimbug_buyer"    2>/dev/null || true
}

start_rln_node() {
  local dir=$1 port=$2 peer_port=$3 logfile=$4 lsp_pk=$5
  mkdir -p "$dir" "$LOG_DIR"
  "$RLN_BIN" "$dir" \
    --daemon-listening-port "$port" \
    --ldk-peer-listening-port "$peer_port" \
    --network regtest \
    --disable-authentication \
    --enable-virtual-channels-v0 \
    --virtual-peer-pubkeys "$lsp_pk" \
    >"$logfile" 2>&1 &
}

init_unlock_node() {
  local port=$1 label=$2
  local code
  code=$(node_http_code "$port")
  if [ "$code" = "403" ]; then
    log "Initializing $label …"
    rln_post "$port" "/init" "{\"password\":\"$PASSWORD\"}" >/dev/null
  fi
  if [ "$(node_http_code "$port")" = "403" ]; then
    log "Unlocking $label …"
    rln_post "$port" "/unlock" "$UNLOCK_BODY" >/dev/null
  fi
  wait_unlocked "$port" "$label"
}

connect_lsp() {
  local port=$1
  local uri="${LSP_PUBKEY}@127.0.0.1:${LSP_PEER_PORT}"
  local attempt resp code
  for attempt in 1 2 3 4 5; do
    resp=$(curl -s -w "\n%{http_code}" -X POST "http://127.0.0.1:$port/connectpeer" \
      -H 'Content-Type: application/json' \
      -d "{\"peer_pubkey_and_addr\":\"$uri\"}") || true
    code=$(echo "$resp" | tail -1)
    if [ "$code" = "200" ]; then
      return 0
    fi
    log "connectpeer attempt $attempt/5 failed (HTTP $code): $(echo "$resp" | head -1)"
    sleep 3
    rln_post "$port" "/sync" >/dev/null 2>&1 || true
  done
  die "Could not connect port $port to Host at $uri — is ./scripts/start-lsp-local.sh running?"
}

wait_for_rgb_channel() {
  local port=$1 label=$2 deadline=$((SECONDS + CHANNEL_TIMEOUT_S))
  log "Waiting for virtual RGB channel on $label …"
  while [ $SECONDS -lt $deadline ]; do
    btc_mine 1
    sleep 4
    local usable ch
    usable=$(rln_get "$port" "/nodeinfo" | jq '.num_usable_channels // 0')
    ch=$(rln_get "$port" "/listchannels" | jq --arg a "$ASSET_ID" \
      '[.channels[] | select(.is_usable == true and .asset_id == $a)] | length')
    if [ "${ch:-0}" -ge 1 ]; then
      log "$label RGB channel ready (usable_channels=$usable)"
      return 0
    fi
    log "$label … usable_channels=$usable asset_channels=$ch"
  done
  die "$label RGB channel not ready within ${CHANNEL_TIMEOUT_S}s"
}

get_payment_status() {
  local port=$1 hash=$2 ptype=$3
  local resp code body
  resp=$(curl -s -w "\n%{http_code}" -X POST "http://127.0.0.1:$port/getpayment" \
    -H 'Content-Type: application/json' \
    -d "{\"payment_hash\":\"$hash\",\"payment_type\":\"$ptype\"}")
  code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')
  if [ "$code" = "200" ]; then
    echo "$body" | jq -r '.payment.status // "Unknown"'
    return 0
  fi
  echo "NotFound"
}

get_offchain_inbound() {
  local port=$1
  rln_post "$port" "/assetbalance" "{\"asset_id\":\"$ASSET_ID\"}" \
    | jq '.offchain_inbound // 0'
}

inbound_summary() {
  local port=$1
  rln_get "$port" "/listpayments" 2>/dev/null | jq -r '
    [.payments[]? | select(.payment_type | test("Inbound")) |
     "\(.payment_hash[0:12])…=\(.status)/\(.payment_type) preimage=\(if .preimage then "yes" else "no" end)"]
    | if length > 0 then join("; ") else "none" end' 2>/dev/null || echo "n/a"
}

decode_payment_hash() {
  local port=$1 bolt11=$2
  rln_post "$port" "/decodelninvoice" "{\"invoice\":\"$bolt11\"}" \
    | jq -r '.payment_hash // empty' 2>/dev/null || echo ""
}

async_invoice_status() {
  local hash=$1
  local db="$UTEXO_LSP_REPO/utexo_lsp.db"
  [ -f "$db" ] || { echo "n/a"; return 0; }
  sqlite3 "$db" \
    "SELECT status FROM async_rotating_invoices WHERE lower(payment_hash)=lower('$hash') LIMIT 1;" \
    2>/dev/null || echo "n/a"
}

async_invoice_row() {
  local hash=$1
  local db="$UTEXO_LSP_REPO/utexo_lsp.db"
  [ -f "$db" ] || return 0
  sqlite3 -header -column "$db" \
    "SELECT payment_hash, status,
            CASE WHEN payment_preimage IS NULL THEN 'no' ELSE 'yes' END AS has_preimage,
            outbound_paid_at IS NOT NULL AS outbound_paid,
            outbound_invoice IS NOT NULL AS has_outbound_inv
     FROM async_rotating_invoices
     WHERE lower(payment_hash)=lower('$hash');" 2>/dev/null || true
}

async_outbox_summary() {
  local hash=$1
  local db="$UTEXO_LSP_REPO/utexo_lsp.db"
  [ -f "$db" ] || return 0
  sqlite3 -header -column "$db" \
    "SELECT id, action, status, substr(COALESCE(last_error,''),1,60) AS last_error
     FROM async_rotating_invoice_outbox
     WHERE lower(payment_hash)=lower('$hash')
     ORDER BY id;" 2>/dev/null || true
}

status_at_or_beyond() {
  local current=$1 target=$2
  local order="reserved active claimable outbound_requested outbound_pending outbound_paid outbound_claimed inbound_claimed"
  local cur_idx tgt_idx idx=0
  for s in $order; do
    idx=$((idx + 1))
    [ "$s" = "$current" ] && cur_idx=$idx
    [ "$s" = "$target" ] && tgt_idx=$idx
  done
  [ -n "${cur_idx:-}" ] && [ -n "${tgt_idx:-}" ] && [ "$cur_idx" -ge "$tgt_idx" ]
}

diagnose_run() {
  local payment_hash=${1:-}
  [ -n "$payment_hash" ] || { [ -f "$RUN_STATE" ] && payment_hash=$(jq -r '.payment_hash // empty' "$RUN_STATE"); }
  [ -n "$payment_hash" ] || die "No payment_hash — run ./scripts/claimbug.sh first"

  log ""
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "  APay claimbug diagnostics  payment_hash=$payment_hash"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  if [ -f "$RUN_STATE" ]; then
    log "Last run state: $RUN_STATE"
    jq . "$RUN_STATE"
  fi

  local buyer_st host_inbound merchant_inbound bal_in async_st
  buyer_st=$(get_payment_status "$BUYER_PORT" "$payment_hash" "Outbound")
  host_inbound=$(inbound_summary "$LSP_PORT")
  merchant_inbound=$(inbound_summary "$MERCHANT_PORT")
  bal_in=$(get_offchain_inbound "$MERCHANT_PORT" 2>/dev/null || echo "?")
  async_st=$(async_invoice_status "$payment_hash")
  local bal_before=0
  if [ -f "$RUN_STATE" ]; then
    bal_before=$(jq -r '.merchant_bal_before // 0' "$RUN_STATE")
  fi

  log ""
  log "── §3.3 payer leg ──"
  log "  buyer outbound:           $buyer_st"
  log "  Host inbound payments:    $host_inbound"
  log "  merchant inbound:         $merchant_inbound"
  log "  merchant offchain_inbound: $bal_in (was $bal_before)"

  log ""
  log "── §3.4–8 LSP async_rotating_invoices (status=$async_st) ──"
  async_invoice_row "$payment_hash"
  log ""
  log "── outbox jobs ──"
  async_outbox_summary "$payment_hash"

  local host_ldk="$HOST_DIR/.ldk/logs/logs.txt"
  local merchant_ldk="$MERCHANT_DIR/.ldk/logs/logs.txt"
  log ""
  log "── Host LDK log ($host_ldk) ──"
  if [ -f "$host_ldk" ]; then
    grep -nE "PaymentClaimable|claimed payment|UpdateFulfillHTLC|sendpayment|async_order" "$host_ldk" | tail -10 \
      || log "  (no matching lines)"
  else
    log "  (Host LDK log not found)"
  fi

  log ""
  log "── Merchant LDK log ($merchant_ldk) ──"
  if [ -f "$merchant_ldk" ]; then
    grep -n "PaymentClaimable" "$merchant_ldk" | tail -5 || log "  (none)"
    grep -n "PaymentClaimable" "$merchant_ldk" | grep -E "payment_preimage: None|payment_preimage: Some" | tail -3 \
      || log "  (no preimage field in PaymentClaimable)"
  else
    log "  (merchant LDK log not found)"
  fi

  log ""
  log "── Host RLN log tail ──"
  if [ -f "$LOG_DIR/rln-lsp.log" ]; then
    grep -nE "PaymentSent|UpdateFulfillHTLC|sendpayment|async_order|claimhodl" "$LOG_DIR/rln-lsp.log" | tail -8 \
      || tail -5 "$LOG_DIR/rln-lsp.log"
  fi

  log ""
  if [ "$async_st" = "inbound_claimed" ] && [ "$buyer_st" = "Succeeded" ]; then
    log "RESULT: §3.8 settlement succeeded (inbound_claimed + buyer Succeeded) ✓"
    return 0
  fi
  if [ "$buyer_st" = "Succeeded" ] && [ "$bal_in" != "?" ] && [ "$bal_in" -gt "$bal_before" ]; then
    log "RESULT: settlement succeeded (buyer Succeeded + merchant balance up) ✓"
    return 0
  fi
  local has_preimage=no
  if [ -f "$UTEXO_LSP_REPO/utexo_lsp.db" ]; then
    has_preimage=$(sqlite3 "$UTEXO_LSP_REPO/utexo_lsp.db" \
      "SELECT CASE WHEN payment_preimage IS NULL THEN 'no' ELSE 'yes' END
       FROM async_rotating_invoices WHERE lower(payment_hash)=lower('$payment_hash') LIMIT 1;" \
      2>/dev/null || echo "no")
  fi
  if [ "$async_st" = "outbound_paid" ] && [ "$has_preimage" = "no" ]; then
    log "RESULT: stuck at §3.5 outbound_paid — no preimage, claim_inbound_invoice not enqueued"
    log "  Check Host→merchant /sendpayment and merchant outbound auto-claim (RLN ldk.rs)."
    return 1
  fi
  if grep -q "payment_preimage: None" "$merchant_ldk" 2>/dev/null; then
    log "RESULT: merchant PaymentClaimable with payment_preimage: None (RLN auto-claim bug)"
    log "  Fix: payment_preimage.or(invoice.preimage) for async_payment_recipient invoices."
    return 1
  fi
  log "RESULT: settlement incomplete (async=$async_st buyer=$buyer_st merchant_offchain_inbound=$bal_in)"
  return 1
}

# ── CLI ───────────────────────────────────────────────────────────────────────

while [ $# -gt 0 ]; do
  case "$1" in
    --keep-data) KEEP_DATA=true ;;
    --keep-nodes) KEEP_NODES=true ;;
    stop)
      stop_claimbug_nodes
      log "Claimbug nodes stopped."
      exit 0
      ;;
    diagnose|logs)
      load_env
      diagnose_run ""
      exit $?
      ;;
    -h|--help)
      sed -n '2,24p' "$0"
      exit 0
      ;;
    *)
      die "Unknown argument: $1 (try --help)"
      ;;
  esac
  shift
done

# ── preflight ─────────────────────────────────────────────────────────────────

[ -f "$RLN_BIN" ] || die "RLN binary not found: $RLN_BIN  (cargo build --release)"
command -v jq >/dev/null || die "jq required — brew install jq"
command -v sqlite3 >/dev/null || die "sqlite3 required"
command -v curl >/dev/null || die "curl required"

load_env
check_lsp_stack

cd "$RGBLN_REPO"
docker compose ps --services --status running 2>/dev/null | grep -q bitcoind \
  || die "regtest not running — start bitcoind in rgb-lightning-node"

log ""
log "⚠  Stop any mobile APay demo before running — extra Host peers can lock UTXOs."
log ""

# ── start merchant + buyer nodes ──────────────────────────────────────────────

stop_claimbug_nodes
sleep 1

if [ "$KEEP_DATA" = false ]; then
  log "Wiping claimbug node dirs …"
  rm -rf "$MERCHANT_DIR" "$BUYER_DIR"
fi

log "Starting merchant RLN (:$MERCHANT_PORT / peer :$MERCHANT_PEER) …"
start_rln_node "$MERCHANT_DIR" "$MERCHANT_PORT" "$MERCHANT_PEER" \
  "$LOG_DIR/claimbug-merchant.log" "$LSP_PUBKEY"
wait_for_port "$MERCHANT_PORT" "merchant"

log "Starting buyer RLN (:$BUYER_PORT / peer :$BUYER_PEER) …"
start_rln_node "$BUYER_DIR" "$BUYER_PORT" "$BUYER_PEER" \
  "$LOG_DIR/claimbug-buyer.log" "$LSP_PUBKEY"
wait_for_port "$BUYER_PORT" "buyer"

init_unlock_node "$MERCHANT_PORT" "merchant"
init_unlock_node "$BUYER_PORT" "buyer"

MERCHANT_PUBKEY=$(rln_get "$MERCHANT_PORT" "/nodeinfo" | jq -r '.pubkey')
BUYER_PUBKEY=$(rln_get "$BUYER_PORT" "/nodeinfo" | jq -r '.pubkey')
log "Merchant pubkey: $MERCHANT_PUBKEY"
log "Buyer pubkey:    $BUYER_PUBKEY"

# ── fund + UTXOs ──────────────────────────────────────────────────────────────

UTXO_BODY='{"up_to":false,"num":10,"size":null,"fee_rate":7,"skip_sync":false}'

fund_and_utxos() {
  local label=$1 port=$2
  log "Funding $label …"
  local addr
  addr=$(rln_post "$port" "/address" | jq -r '.address')
  btc_send "$addr" 1 >/dev/null
}

fund_and_utxos merchant "$MERCHANT_PORT"
fund_and_utxos buyer "$BUYER_PORT"
btc_mine 6
sleep 3

create_utxos() {
  local label=$1 port=$2
  log "Creating UTXOs on $label …"
  rln_post "$port" "/createutxos" "$UTXO_BODY" >/dev/null
  rln_post "$port" "/sync" >/dev/null 2>&1 || true
}

create_utxos merchant "$MERCHANT_PORT"
create_utxos buyer "$BUYER_PORT"
btc_mine 1
sleep 2

rln_post "$MERCHANT_PORT" "/sync" >/dev/null 2>&1 || true
rln_post "$BUYER_PORT" "/sync" >/dev/null 2>&1 || true
sleep 3

# ── merchant channel + §3.1 hash pool ─────────────────────────────────────────

step 1 "Create/refill order — merchant POST /apay/new"

log "Connecting merchant → Host (required before /apay/new and §3.2 outboundinvoice P2P) …"
connect_lsp "$MERCHANT_PORT"
btc_mine 2
sleep 6
wait_for_rgb_channel "$MERCHANT_PORT" "merchant"

connect_lsp "$MERCHANT_PORT"
sleep 1
APAY_RESP=$(rln_post "$MERCHANT_PORT" "/apay/new" "{\"host_node_id\":\"$LSP_PUBKEY\"}")
ORDER_ID=$(echo "$APAY_RESP" | jq -r '.order_id')
UNUSED=$(echo "$APAY_RESP" | jq -r '.unused_hashes // 0')
log "  order_id=$ORDER_ID unused_hashes=$UNUSED"
[ "${UNUSED:-0}" -gt 0 ] || die "Hash pool empty after /apay/new"

LNADDR=$(curl -sf "http://127.0.0.1:$UTEXO_PORT/lightning_address/by_pubkey/$MERCHANT_PUBKEY")
USERNAME=$(echo "$LNADDR" | jq -r '.username')
DOMAIN=$(echo "$LNADDR" | jq -r '.domain')
log "  Lightning Address: ${USERNAME}@${DOMAIN}"

# ── buyer channel ─────────────────────────────────────────────────────────────

log "Connecting buyer → Host …"
connect_lsp "$BUYER_PORT"
btc_mine 2
sleep 6
wait_for_rgb_channel "$BUYER_PORT" "buyer"

# ── §3.2 payer fetches invoice (LNURL) ────────────────────────────────────────

step 2 "Payer LNURL discovery + callback → BOLT11 (Host inbound HODL, invoice A)"

# Merchant must stay connected so Host can reach recipient for §3.4 outboundinvoice.
connect_lsp "$MERCHANT_PORT"
sleep 1

LNDISC=$(curl -sf "http://127.0.0.1:$UTEXO_PORT/.well-known/lnurlp/$USERNAME")
CALLBACK=$(echo "$LNDISC" | jq -r '.callback')
[ -n "$CALLBACK" ] && [ "$CALLBACK" != "null" ] || die "LNURL discovery missing callback"

INVOICE_RESP=$(curl -sf -G "$CALLBACK" \
  --data-urlencode "amount=$PAYMENT_MSAT" \
  --data-urlencode "asset_id=$ASSET_ID" \
  --data-urlencode "asset_amount=$PAYMENT_ASSET_AMOUNT")
INBOUND_BOLT11=$(echo "$INVOICE_RESP" | jq -r '.pr // empty')
[ -n "$INBOUND_BOLT11" ] || die "LNURL callback returned no pr: $INVOICE_RESP"

POOL_HASH=$(decode_payment_hash "$LSP_PORT" "$INBOUND_BOLT11")
[ -n "$POOL_HASH" ] || POOL_HASH=$(decode_payment_hash "$BUYER_PORT" "$INBOUND_BOLT11")
[ -n "$POOL_HASH" ] || die "Could not decode payment_hash from callback invoice"

CALLBACK_STATUS=$(async_invoice_status "$POOL_HASH")
log "  callback payment_hash=$POOL_HASH  LSP invoice status=$CALLBACK_STATUS"
[ "$CALLBACK_STATUS" = "active" ] || die "Expected async invoice status=active after callback, got $CALLBACK_STATUS"

# ── §3.3 payer pays ───────────────────────────────────────────────────────────

step 3 "Payer pays BOLT11 — expect Host PaymentClaimable → LSP claimable"

MERCHANT_BAL_BEFORE=$(get_offchain_inbound "$MERCHANT_PORT")
log "  merchant offchain_inbound before pay: $MERCHANT_BAL_BEFORE"

SEND_BODY=$(jq -n \
  --arg inv "$INBOUND_BOLT11" \
  --arg aid "$ASSET_ID" \
  --argjson aamt "$PAYMENT_ASSET_AMOUNT" \
  '{invoice: $inv, asset_id: $aid, asset_amount: $aamt}')
PAY_RESP=$(rln_post "$BUYER_PORT" "/sendpayment" "$SEND_BODY")
PAYMENT_HASH=$(echo "$PAY_RESP" | jq -r '.payment_hash // empty')
PAY_STATUS=$(echo "$PAY_RESP" | jq -r '.status // empty')
[ -n "$PAYMENT_HASH" ] || die "sendpayment returned no payment_hash: $PAY_RESP"
log "  sendpayment payment_hash=$PAYMENT_HASH initial_status=$PAY_STATUS"

if [ "$PAYMENT_HASH" != "$POOL_HASH" ]; then
  log "  note: sendpayment hash differs from callback decode ($POOL_HASH)"
fi

mkdir -p "$LOG_DIR"
jq -n \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg payment_hash "$PAYMENT_HASH" \
  --arg pool_hash "$POOL_HASH" \
  --arg username "$USERNAME" \
  --arg order_id "$ORDER_ID" \
  --arg merchant_pubkey "$MERCHANT_PUBKEY" \
  --arg buyer_pubkey "$BUYER_PUBKEY" \
  --arg asset_id "$ASSET_ID" \
  --argjson mbb "${MERCHANT_BAL_BEFORE:-0}" \
  '{ts: $ts, payment_hash: $payment_hash, pool_hash: $pool_hash, username: $username,
    order_id: $order_id, merchant_pubkey: $merchant_pubkey, buyer_pubkey: $buyer_pubkey,
    asset_id: $asset_id, merchant_bal_before: $mbb}' \
  >"$RUN_STATE"

# ── §3.4–8 settlement poll ────────────────────────────────────────────────────

step "4-8" "LSP outbox settlement (claimable → inbound_claimed)"

deadline=$((SECONDS + SETTLE_TIMEOUT_S))
keepalive_at=$SECONDS
settled=false
saw_claimable=false

while [ $SECONDS -lt $deadline ]; do
  sleep "$POLL_INTERVAL_S"
  btc_mine 1

  if [ $((SECONDS - keepalive_at)) -ge "$KEEPALIVE_S" ]; then
    keepalive_at=$SECONDS
    connect_lsp "$MERCHANT_PORT" 2>/dev/null || true
    rln_post "$MERCHANT_PORT" "/sync" >/dev/null 2>&1 || true
  fi

  buyer_st=$(get_payment_status "$BUYER_PORT" "$PAYMENT_HASH" "Outbound")
  async_st=$(async_invoice_status "$PAYMENT_HASH")
  bal_after=$(get_offchain_inbound "$MERCHANT_PORT")
  host_in=$(inbound_summary "$LSP_PORT")

  log "  buyer=$buyer_st  LSP=$async_st  merchant_offchain_inbound=$bal_after (was $MERCHANT_BAL_BEFORE)"
  log "  Host inbound: $host_in"

  if status_at_or_beyond "$async_st" "claimable"; then
    saw_claimable=true
  fi

  if [ "$async_st" = "inbound_claimed" ] && [ "$buyer_st" = "Succeeded" ]; then
    settled=true
    break
  fi
  if [ "$buyer_st" = "Succeeded" ] && [ "$bal_after" -gt "$MERCHANT_BAL_BEFORE" ]; then
    settled=true
    break
  fi
  if [ "$buyer_st" = "Failed" ]; then
    die "Buyer payment failed during settlement"
  fi
done

log ""
if [ "$settled" = true ]; then
  log "§3.8 settlement completed ✓"
elif [ "$saw_claimable" = false ]; then
  log "§3.3 never reached claimable — Host may not have parked inbound HTLC"
else
  log "§3.4–8 timed out — running diagnostics …"
fi

diagnose_run "$PAYMENT_HASH"
exit $?
