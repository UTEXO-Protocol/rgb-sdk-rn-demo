# APay settlement stall — manual reproduction (nodes + curl only)

Reproduce the **APay / LNURL cart checkout settlement bug** using only:

- `rgb-lightning-node` binaries (4 processes: LSP, Faucet, Merchant, Buyer)
- `utexo-lsp` (Go)
- regtest docker (bitcoind + electrs + RGB proxy)
- `curl`, `jq`, `sqlite3`

No mobile app. No demo repo required.

**Bug:** Merchant receives LSP outbound HTLC but never auto-claims → buyer HODL stays `Pending` forever.

**Fix location:** `rgb-lightning-node/src/ldk.rs` — `PaymentClaimable` handler must use staged invoice preimage when LDK sends `payment_preimage: None`.

**Official spec:** [Async Payments — RGB Lightning Node & Utexo LSP](https://hackmd.io/@xalkan/async-payments) (HackMD). This manual repro follows the **implemented** utexo-lsp + RLN behaviour; see [§ Spec alignment](#spec-alignment-hackmd-vs-this-repro) for one doc typo and demo-app gaps.

---

## Repos & build

```bash
export RGBLN=~/path/to/rgb-lightning-node
export UTEXO_LSP=~/path/to/utexo-lsp

cd "$RGBLN" && cargo build --release
# regtest stack must exist in rgb-lightning-node (docker compose)
cd "$RGBLN" && ./regtest.sh start
```

---

## Port map

| Node | REST | LDK peer | Data directory |
|------|------|----------|----------------|
| LSP Host | `3005` | `9737` | `$RGBLN/data_lsp` |
| Faucet | `3008` | `9740` | `$RGBLN/data_faucet` |
| utexo-lsp | `8080` | — | `$UTEXO_LSP/utexo_lsp.db` |
| Merchant (shop) | `3010` | `9745` | `$RGBLN/data_merchant` |
| Buyer (customer) | `3011` | `9746` | `$RGBLN/data_buyer` |

Shared unlock payload (all RLN nodes):

```bash
export UNLOCK='{"password":"password123","bitcoind_rpc_username":"user","bitcoind_rpc_password":"password","bitcoind_rpc_host":"127.0.0.1","bitcoind_rpc_port":18443,"indexer_url":"127.0.0.1:50001","proxy_endpoint":"rpc://127.0.0.1:3000/json-rpc","announce_addresses":[]}'
export APAY_BEARER=apay-regtest-secret
export PROXY=rpc://127.0.0.1:3000/json-rpc

mine() { docker compose -f "$RGBLN/docker-compose.yml" exec -u blits bitcoind \
  bitcoin-cli -regtest -rpcwallet=miner -generate "$1" >/dev/null; }
```

Payment amounts used below:

| Param | Value |
|-------|-------|
| LNURL `amount` | `3000000` msat |
| `asset_amount` | `1` |

---

## Step 1 — LSP Host RLN

### 1.1 Start process

```bash
rm -rf "$RGBLN/data_lsp"
mkdir -p "$RGBLN/logs"

"$RGBLN/target/release/rgb-lightning-node" "$RGBLN/data_lsp" \
  --daemon-listening-port 3005 \
  --ldk-peer-listening-port 9737 \
  --network regtest \
  --disable-authentication \
  --enable-virtual-channels-v0 \
  --lsp-base-url http://127.0.0.1:8080 \
  --lsp-bearer-token "$APAY_BEARER" \
  >"$RGBLN/logs/rln-lsp.log" 2>&1 &
```

### 1.2 Init + unlock

```bash
curl -s -X POST http://127.0.0.1:3005/init \
  -H 'Content-Type: application/json' \
  -d '{"password":"password123"}'

curl -s -X POST http://127.0.0.1:3005/unlock \
  -H 'Content-Type: application/json' \
  -d "$UNLOCK"

curl -s http://127.0.0.1:3005/nodeinfo | jq '{pubkey, num_peers}'
export LSP_PUBKEY=$(curl -s http://127.0.0.1:3005/nodeinfo | jq -r .pubkey)
export LSP_PEER_URI="${LSP_PUBKEY}@127.0.0.1:9737"
```

### 1.3 Fund + UTXOs

```bash
LSP_ADDR=$(curl -s -X POST http://127.0.0.1:3005/address | jq -r .address)
cd "$RGBLN"
docker compose exec -u blits bitcoind bitcoin-cli -regtest sendtoaddress "$LSP_ADDR" 1
mine 6

curl -s -X POST http://127.0.0.1:3005/createutxos \
  -H 'Content-Type: application/json' \
  -d '{"up_to":false,"num":10,"size":null,"fee_rate":7,"skip_sync":false}'
mine 1
```

---

## Step 2 — Faucet RLN

### 2.1 Start process

```bash
rm -rf "$RGBLN/data_faucet"

"$RGBLN/target/release/rgb-lightning-node" "$RGBLN/data_faucet" \
  --daemon-listening-port 3008 \
  --ldk-peer-listening-port 9740 \
  --network regtest \
  --disable-authentication \
  >"$RGBLN/logs/rln-faucet.log" 2>&1 &
```

### 2.2 Init + unlock + fund + UTXOs

```bash
curl -s -X POST http://127.0.0.1:3008/init \
  -H 'Content-Type: application/json' -d '{"password":"password123"}'
curl -s -X POST http://127.0.0.1:3008/unlock \
  -H 'Content-Type: application/json' -d "$UNLOCK"

FAUCET_ADDR=$(curl -s -X POST http://127.0.0.1:3008/address | jq -r .address)
cd "$RGBLN"
docker compose exec -u blits bitcoind bitcoin-cli -regtest sendtoaddress "$FAUCET_ADDR" 1
mine 6

curl -s -X POST http://127.0.0.1:3008/createutxos \
  -H 'Content-Type: application/json' \
  -d '{"up_to":false,"num":10,"size":null,"fee_rate":7,"skip_sync":false}'
mine 1
```

---

## Step 3 — Issue RGB asset on Faucet

```bash
curl -s -X POST http://127.0.0.1:3008/issueassetnia \
  -H 'Content-Type: application/json' \
  -d '{"ticker":"UTST","name":"APay Test","precision":0,"amounts":[1000]}' | jq .
```

```bash
export ASSET_ID=$(curl -s -X POST http://127.0.0.1:3008/issueassetnia \
  -H 'Content-Type: application/json' \
  -d '{"ticker":"UTST","name":"APay Test","precision":0,"amounts":[1000]}' \
  | jq -r '.asset.asset_id')
echo "ASSET_ID=$ASSET_ID"
mine 1
```

---

## Step 4 — Seed LSP with RGB (6× on-chain sends)

Repeat this block **6 times** (seeds 6 RGB units onto LSP):

```bash
EXPIRY=$(($(date +%s) + 3600))

RECIPIENT_ID=$(curl -s -X POST http://127.0.0.1:3005/rgbinvoice \
  -H 'Content-Type: application/json' \
  -d "{\"assignment\":{\"type\":\"Any\"},\"expiration_timestamp\":$EXPIRY,\"min_confirmations\":1,\"witness\":false}" \
  | jq -r .recipient_id)

curl -s -X POST http://127.0.0.1:3008/sendrgb \
  -H 'Content-Type: application/json' \
  -d "{
    \"donation\": true,
    \"fee_rate\": 7,
    \"min_confirmations\": 1,
    \"skip_sync\": false,
    \"recipient_map\": {
      \"$ASSET_ID\": [{
        \"recipient_id\": \"$RECIPIENT_ID\",
        \"assignment\": {\"type\": \"Fungible\", \"value\": 1},
        \"transport_endpoints\": [\"$PROXY\"]
      }]
    }
  }"

mine 1
sleep 2
curl -s -X POST http://127.0.0.1:3005/refreshtransfers -H 'Content-Type: application/json' -d '{"skip_sync":false}'
curl -s -X POST http://127.0.0.1:3005/refreshtransfers -H 'Content-Type: application/json' -d '{"skip_sync":false}'
```

Verify LSP has RGB:

```bash
curl -s -X POST http://127.0.0.1:3005/assetbalance \
  -H 'Content-Type: application/json' \
  -d "{\"asset_id\":\"$ASSET_ID\"}" | jq '{settled, offchain_inbound, offchain_outbound}'
```

---

## Step 5 — Start utexo-lsp

```bash
rm -f "$UTEXO_LSP/utexo_lsp.db"
cd "$UTEXO_LSP"

env \
  LSP_BASE_URL=http://127.0.0.1:3005 \
  RGB_NODE_BASE_URL=http://127.0.0.1:3005 \
  LIGHTNING_ADDRESS_DOMAIN_URL=http://127.0.0.1:8080 \
  SUPPORTED_ASSET_IDS="$ASSET_ID" \
  CRON_EVERY=5s \
  DEFAULT_CHANNEL_CAPACITY_SAT=200000 \
  DEFAULT_CHANNEL_PUSH_MSAT=5000000 \
  DEFAULT_CHANNEL_ASSET_AMOUNT=2 \
  DEFAULT_CHANNEL_PUSH_ASSET_AMOUNT=1 \
  DEFAULT_VIRTUAL_OPEN_MODE=trusted_no_broadcast \
  MIN_AMT_MSAT=3000000 \
  APAY_BEARER_TOKEN="$APAY_BEARER" \
  APAY_OUTBOUND_MIN_FINAL_CLTV_EXPIRY_DELTA=42 \
  go run . >"$RGBLN/logs/utexo-lsp.log" 2>&1 &

curl -s http://127.0.0.1:8080/health   # expect OK
```

---

## Step 6 — Merchant node (shop)

### 6.1 Start

```bash
rm -rf "$RGBLN/data_merchant"

"$RGBLN/target/release/rgb-lightning-node" "$RGBLN/data_merchant" \
  --daemon-listening-port 3010 \
  --ldk-peer-listening-port 9745 \
  --network regtest \
  --disable-authentication \
  --enable-virtual-channels-v0 \
  --virtual-peer-pubkeys "$LSP_PUBKEY" \
  >"$RGBLN/logs/merchant.log" 2>&1 &
```

### 6.2 Init + unlock + fund + UTXOs

```bash
curl -s -X POST http://127.0.0.1:3010/init \
  -H 'Content-Type: application/json' -d '{"password":"password123"}'
curl -s -X POST http://127.0.0.1:3010/unlock \
  -H 'Content-Type: application/json' -d "$UNLOCK"

export MERCHANT_PUBKEY=$(curl -s http://127.0.0.1:3010/nodeinfo | jq -r .pubkey)

M_ADDR=$(curl -s -X POST http://127.0.0.1:3010/address | jq -r .address)
cd "$RGBLN"
docker compose exec -u blits bitcoind bitcoin-cli -regtest sendtoaddress "$M_ADDR" 1
mine 6

curl -s -X POST http://127.0.0.1:3010/createutxos \
  -H 'Content-Type: application/json' \
  -d '{"up_to":false,"num":10,"size":null,"fee_rate":7,"skip_sync":false}'
mine 1
curl -s -X POST http://127.0.0.1:3010/sync -H 'Content-Type: application/json' -d '{}'
```

### 6.3 Connect to LSP → wait for virtual RGB channel

```bash
curl -s -X POST http://127.0.0.1:3010/connectpeer \
  -H 'Content-Type: application/json' \
  -d "{\"peer_pubkey_and_addr\":\"$LSP_PEER_URI\"}"

mine 2
sleep 8
mine 1

curl -s http://127.0.0.1:3010/nodeinfo | jq .num_usable_channels
curl -s http://127.0.0.1:3010/listchannels | jq \
  '[.channels[] | {peer_pubkey, asset_id, is_usable, virtual_open_mode, asset_local_amount, asset_remote_amount}]'
```

Wait until `num_usable_channels >= 1` and a channel has your `asset_id`.

### 6.4 Register APay hash pool

Merchant **must** be peer-connected to LSP (P2P carries `async_order.new`).

```bash
curl -s -X POST http://127.0.0.1:3010/connectpeer \
  -H 'Content-Type: application/json' \
  -d "{\"peer_pubkey_and_addr\":\"$LSP_PEER_URI\"}"

curl -s -X POST http://127.0.0.1:3010/apay/new \
  -H 'Content-Type: application/json' \
  -d "{\"host_node_id\":\"$LSP_PUBKEY\"}" | jq .
```

**Request:**

```http
POST http://127.0.0.1:3010/apay/new
Content-Type: application/json

{"host_node_id":"<LSP_PUBKEY 66-char hex>"}
```

**Response (example):**

```json
{
  "order_id": "1",
  "unused_hashes": 200,
  "hashes": [{"hash_index": 1, "payment_hash": "..."}],
  "status": "active"
}
```

Behind the scenes LSP Host forwards to utexo-lsp:

```http
POST http://127.0.0.1:8080/internal/async_order/new
Authorization: Bearer apay-regtest-secret

{
  "peer_pubkey": "<MERCHANT_PUBKEY>",
  "protocol_version": 1,
  "hashes": [{"hash_index": 1, "payment_hash": "..."}]
}
```

### 6.5 Get Lightning Address

```bash
curl -s "http://127.0.0.1:8080/lightning_address/by_pubkey/$MERCHANT_PUBKEY" | jq .
```

```bash
export USERNAME=$(curl -s "http://127.0.0.1:8080/lightning_address/by_pubkey/$MERCHANT_PUBKEY" | jq -r .username)
echo "Lightning Address: ${USERNAME}@127.0.0.1:8080"
```

Baseline merchant RGB (note before checkout):

```bash
curl -s -X POST http://127.0.0.1:3010/assetbalance \
  -H 'Content-Type: application/json' \
  -d "{\"asset_id\":\"$ASSET_ID\"}" | jq '{offchain_inbound, offchain_outbound}'
export MERCHANT_BAL_BEFORE=$(curl -s -X POST http://127.0.0.1:3010/assetbalance \
  -H 'Content-Type: application/json' \
  -d "{\"asset_id\":\"$ASSET_ID\"}" | jq .offchain_inbound)
```

---

## Step 7 — Buyer node (customer)

### 7.1 Start + init + fund (same pattern as merchant)

```bash
rm -rf "$RGBLN/data_buyer"

"$RGBLN/target/release/rgb-lightning-node" "$RGBLN/data_buyer" \
  --daemon-listening-port 3011 \
  --ldk-peer-listening-port 9746 \
  --network regtest \
  --disable-authentication \
  --enable-virtual-channels-v0 \
  --virtual-peer-pubkeys "$LSP_PUBKEY" \
  >"$RGBLN/logs/buyer.log" 2>&1 &

curl -s -X POST http://127.0.0.1:3011/init \
  -H 'Content-Type: application/json' -d '{"password":"password123"}'
curl -s -X POST http://127.0.0.1:3011/unlock \
  -H 'Content-Type: application/json' -d "$UNLOCK"

B_ADDR=$(curl -s -X POST http://127.0.0.1:3011/address | jq -r .address)
cd "$RGBLN"
docker compose exec -u blits bitcoind bitcoin-cli -regtest sendtoaddress "$B_ADDR" 1
mine 6

curl -s -X POST http://127.0.0.1:3011/createutxos \
  -H 'Content-Type: application/json' \
  -d '{"up_to":false,"num":10,"size":null,"fee_rate":7,"skip_sync":false}'
mine 1
```

### 7.2 Connect to LSP → wait for channel

```bash
curl -s -X POST http://127.0.0.1:3011/connectpeer \
  -H 'Content-Type: application/json' \
  -d "{\"peer_pubkey_and_addr\":\"$LSP_PEER_URI\"}"

mine 2
sleep 8
mine 1

curl -s http://127.0.0.1:3011/listchannels | jq \
  '[.channels[] | {asset_id, is_usable, asset_local_amount, asset_remote_amount}]'
```

Buyer needs `asset_local_amount >= 1` (RGB on buyer side of channel) or `sendpayment` fails immediately.

---

## Step 8 — Checkout (LNURL → pay HODL)

### 8.1 LNURL discovery

```bash
curl -s "http://127.0.0.1:8080/.well-known/lnurlp/$USERNAME" | jq .
```

**Response fields:** `callback`, `minSendable`, `maxSendable`, `metadata`, `tag`.

```bash
export CALLBACK=$(curl -s "http://127.0.0.1:8080/.well-known/lnurlp/$USERNAME" | jq -r .callback)
```

### 8.2 LNURL callback → HODL BOLT11

```bash
curl -sG "$CALLBACK" \
  --data-urlencode "amount=3000000" \
  --data-urlencode "asset_id=$ASSET_ID" \
  --data-urlencode "asset_amount=1" | jq .
```

**HTTP:**

```http
GET http://127.0.0.1:8080/pay/callback/{username}?amount=3000000&asset_id={ASSET_ID}&asset_amount=1
```

**Response:**

```json
{"pr": "lnbc30n1...", "routes": []}
```

> **Spec note:** At callback time utexo-lsp calls **Host RLN** `LNInvoice` (HODL, reserved `payment_hash`) — **not** `POST /apay/outboundinvoice` to the merchant. The HackMD overview step 2 wording is misleading here; `/apay/outboundinvoice` → merchant P2P happens later in the **outbox** (`request_outbound_invoice`). This curl matches the code in `utexo-lsp/internal/lspapi/lightning_address.go`.

```bash
export HODL_BOLT11=$(curl -sG "$CALLBACK" \
  --data-urlencode "amount=3000000" \
  --data-urlencode "asset_id=$ASSET_ID" \
  --data-urlencode "asset_amount=1" | jq -r .pr)
```

Check utexo-lsp reserved hash:

```bash
sqlite3 "$UTEXO_LSP/utexo_lsp.db" \
  "SELECT payment_hash, status, amount_msat, asset_amount FROM async_rotating_invoices ORDER BY id DESC LIMIT 1;"
```

### 8.3 Re-connect merchant (required for settlement P2P)

```bash
curl -s -X POST http://127.0.0.1:3010/connectpeer \
  -H 'Content-Type: application/json' \
  -d "{\"peer_pubkey_and_addr\":\"$LSP_PEER_URI\"}"
```

### 8.4 Buyer pays HODL invoice

```bash
curl -s -X POST http://127.0.0.1:3011/sendpayment \
  -H 'Content-Type: application/json' \
  -d "{
    \"invoice\": \"$HODL_BOLT11\",
    \"asset_id\": \"$ASSET_ID\",
    \"asset_amount\": 1
  }" | jq .
```

**Request:**

```json
{
  "invoice": "lnbc30n1...",
  "asset_id": "rgb:...",
  "asset_amount": 1
}
```

**Response:**

```json
{
  "payment_hash": "cac9affb632ca71d9e17daa4c1a28f0e9ff5932236cf4406dd03437763e83945",
  "status": "Pending"
}
```

```bash
export PAYMENT_HASH=$(curl -s -X POST http://127.0.0.1:3011/sendpayment \
  -H 'Content-Type: application/json' \
  -d "{\"invoice\":\"$HODL_BOLT11\",\"asset_id\":\"$ASSET_ID\",\"asset_amount\":1}" \
  | jq -r .payment_hash)
echo "PAYMENT_HASH=$PAYMENT_HASH"
```

---

## Step 9 — Wait for settlement (~2 min)

utexo-lsp cron runs every **5s**. Merchant must stay connected.

Loop manually (or watch in another terminal):

```bash
# every 15s:
curl -s -X POST http://127.0.0.1:3010/connectpeer \
  -H 'Content-Type: application/json' \
  -d "{\"peer_pubkey_and_addr\":\"$LSP_PEER_URI\"}"
curl -s -X POST http://127.0.0.1:3010/sync -H 'Content-Type: application/json' -d '{}'
mine 1

# buyer outbound:
curl -s -X POST http://127.0.0.1:3011/getpayment \
  -H 'Content-Type: application/json' \
  -d "{\"payment_hash\":\"$PAYMENT_HASH\",\"payment_type\":\"Outbound\"}" | jq .payment.status

# merchant inbound (same hash — APay pool slot):
curl -s http://127.0.0.1:3010/listpayments | jq \
  '[.payments[] | select(.payment_type | test("Inbound")) | {payment_hash, status, payment_type, has_preimage: (.preimage != null)}]'

# merchant RGB balance:
curl -s -X POST http://127.0.0.1:3010/assetbalance \
  -H 'Content-Type: application/json' \
  -d "{\"asset_id\":\"$ASSET_ID\"}" | jq .offchain_inbound
```

### Expected STUCK state (bug reproduced)

| Check | Value |
|-------|-------|
| Buyer `getpayment` Outbound | `Pending` (never `Succeeded`) |
| Merchant `listpayments` InboundHodl | `Pending`, `has_preimage: true` |
| Merchant `offchain_inbound` | unchanged (e.g. stays `2`) |
| utexo-lsp DB `async_rotating_invoices.status` | `outbound_paid` |
| utexo-lsp DB `payment_preimage` | `NULL` |
| Outbox `claim_inbound_invoice` | never completes |

```bash
sqlite3 "$UTEXO_LSP/utexo_lsp.db" \
  "SELECT payment_hash, status,
          payment_preimage IS NOT NULL AS has_preimage,
          outbound_paid_at IS NOT NULL AS outbound_paid
   FROM async_rotating_invoices WHERE payment_hash='$PAYMENT_HASH';"

sqlite3 "$UTEXO_LSP/utexo_lsp.db" \
  "SELECT action, status FROM async_rotating_invoice_outbox WHERE payment_hash='$PAYMENT_HASH';"
```

### Expected FIXED state (after ldk.rs patch)

| Check | Value |
|-------|-------|
| Buyer outbound | `Succeeded` |
| Merchant inbound | `Succeeded` |
| Merchant `offchain_inbound` | `MERCHANT_BAL_BEFORE + 1` |
| utexo outbox | `claim_inbound_invoice` done |

---

## Step 10 — Logs to attach to bug report

```bash
# Merchant LDK — look for payment_preimage: None
grep -n "PaymentClaimable" "$RGBLN/data_merchant/.ldk/logs/logs.txt"
grep -nE "claimed payment|UpdateFulfillHTLC" "$RGBLN/data_merchant/.ldk/logs/logs.txt"

# Daemon logs
tail -100 "$RGBLN/logs/merchant.log"
tail -100 "$RGBLN/logs/buyer.log"
tail -100 "$RGBLN/logs/rln-lsp.log"
grep -i "async_order\|outbox\|$PAYMENT_HASH" "$RGBLN/logs/utexo-lsp.log" | tail -50
```

**Bug signature in merchant LDK log:**

```
PaymentClaimable { payment_preimage: None, ... }
```

No subsequent `EVENT: claimed payment from payment hash ...`.

---

## What happens automatically (no curl)

After buyer pays LSP HODL, utexo-lsp outbox cron:

1. **`request_outbound_invoice`** — LSP P2P → merchant `async_order.request_outbound_invoice`
2. Merchant creates outbound BOLT11 (same pool `payment_hash`, preimage in app state)
3. **`send_outbound_payment`** — LSP `POST /sendpayment` → merchant
4. **BUG** — merchant `PaymentClaimable` with `preimage: None` → no `claim_funds`
5. **`claim_inbound_invoice`** — never runs → buyer HODL never settled

---

## Root cause

`rgb-lightning-node/src/ldk.rs` (~1943–1949):

```rust
if async_payment_recipient {
    claim_funds(payment_preimage.unwrap());  // None for UserPaymentHash invoices
}
```

APay outbound invoices use user-supplied payment hash. LDK validates via `payment_secret` and omits preimage in the event. Preimage exists in RLN `PaymentInfo` from `async_order.request_invoice`.

**Fix:** `payment_preimage.or(stored_invoice_preimage)` before `claim_funds`.

---

## Cleanup

```bash
pkill -f "rgb-lightning-node.*data_lsp"
pkill -f "rgb-lightning-node.*data_faucet"
pkill -f "rgb-lightning-node.*data_merchant"
pkill -f "rgb-lightning-node.*data_buyer"
pkill -f "utexo-lsp"
```

---

## Spec alignment (HackMD vs this repro)

Reference: https://hackmd.io/@xalkan/async-payments

### Two BOLT11 legs (do not confuse)

| Leg | Who creates invoice | Who pays | When |
|-----|---------------------|----------|------|
| **A — inbound** | Host RLN HODL (`LNInvoice` + pool hash) | Buyer → Host | LNURL callback (Step 8.2) |
| **B — outbound** | Merchant RLN HODL (`async_order.request_invoice`) | Host → Merchant | Outbox `request_outbound_invoice` (after buyer pays) |

Both legs use the **same `payment_hash`** from the merchant's pre-seeded pool. Settlement completes when merchant **auto-claims leg B** (spec §3 step 6), Host gets preimage, outbox runs `claim_inbound_invoice` on leg A.

### HackMD flow vs manual curls — match table

| Spec step | This repro | Match? |
|-----------|------------|--------|
| 1. `POST /apay/new` → P2P `async_order.new` → `/internal/async_order/new` | Step 6.4 | ✓ |
| 2. LNURL discovery + callback | Step 8.1–8.2 | ✓ (see callback note above) |
| 3. Payer pays → Host `PaymentClaimable` → `/internal/async_order/claimable` | Step 8.4 `sendpayment` | ✓ (automatic) |
| 4. Outbox `request_outbound_invoice` → `/apay/outboundinvoice` → merchant P2P | Automatic; merchant must stay on peer (Step 9 keepalive) | ✓ |
| 5. Outbox `send_outbound_payment` → Host pays merchant | Automatic | ✓ |
| 6. **Merchant claims outbound** (preimage revealed) | **BUG** — `PaymentClaimable { payment_preimage: None }` | ✗ RLN |
| 7. Host `/internal/async_order/payment_sent` | Never reached when step 6 stalls | — |
| 8. Outbox `claim_inbound_invoice` → Host `POST /claimhodlinvoice` | Never reached | — |

State machine targets (spec §6): `active` → `claimable` → `outbound_requested` → `outbound_pending` → `outbound_paid` → `outbound_claimed` → `inbound_claimed`. Stuck repro typically stops at **`outbound_paid`** without `payment_preimage` in DB.

### Logic gaps on **our** side (demo repo)

These are **not** the root cause of the curl repro stall (RLN bug is), but they diverge from the spec:

| Item | Spec says | Our code | Gap |
|------|-----------|----------|-----|
| **`screens/async-pay.tsx`** | Merchant stays online; **no manual claim**; LSP outbox settles; merchant **auto-claims outbound** | Polls `InboundHodl` + `Claimable`, calls `claimHodlInvoice` | **Wrong model** — treats merchant as claimant of payer's inbound HODL (leg A). Leg A is on Host only. Merchant never calls `claimHodlInvoice` in APay. |
| **`screens/apay-regular-channels.tsx`** | Same as spec | `apayNew`, LNURL pay, peer keepalive, wait for buyer `Settled` + merchant balance | ✓ **Correct** — matches HackMD + manual repro |
| **Manual repro / `claimbug.sh`** | Same | Desktop RLN + curls | ✓ **Correct** |
| **Recipient online timing** | Offline at pay time OK; **online for outbox** steps 4–6 | Merchant connected before pay + keepalive every 15s | ✓ Required by spec |
| **LNURL RGB params** | `asset_id` + `asset_amount` together or omit | Both sent in callback | ✓ |
| **`docs/apay-flow.md`** | — | Documents LSP-driven flow; notes `async-pay.tsx` is wrong | ✓ |

### What `async-pay.tsx` should do (to match spec)

Same as `apay-regular-channels.tsx` settle phase:

1. After buyer `payLightningInvoice`, **do not** poll for `InboundHodl/Claimable` on merchant.
2. Keep merchant `connectPeer` to Host during outbox (~15s interval).
3. Success = buyer outbound `Succeeded` **and** merchant `offchain_inbound` increased.
4. Optional diagnostics: `listpayments` may show merchant `Pending/InboundHodl` with `preimage=yes` — that is leg B staging, not a manual-claim prompt.

### What is **not** our bug

- Merchant showing `preimage=yes` in REST while LDK log shows `payment_preimage: None` — consistent with UserPaymentHash invoices; preimage is in RLN app state, not in LDK event.
- Same hash on buyer + merchant `getpayment` — expected (one pool slot).
- HackMD step 2 text implying merchant is contacted at LNURL callback — **doc/code mismatch in spec**, not demo error.

---

## Example run (2026-06-09)

```
PAYMENT_HASH=cac9affb632ca71d9e17daa4c1a28f0e9ff5932236cf4406dd03437763e83945
USERNAME=calm-kernel-8721
merchant offchain_inbound before=2, after 120s still 2
merchant inbound: Pending/InboundHodl, preimage=yes
buyer outbound: Pending
```
