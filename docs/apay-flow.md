# APAY (Async Payment) Flow

> Source: `utexo-lsp/internal/lspapi/api.go` + `rgb-lightning-node/src/routes.rs`  
> Three nodes: **Sender**, **LSP** (Host RLN + utexo-lsp Go service), **Recipient**

---

## Overview

Async payment lets a **Recipient be offline** when a Sender initiates the payment. The LSP holds the HTLC and delivers it once the Recipient is reachable. The delivery is fully driven by the LSP — the Recipient app does **not** manually claim anything.

The real APAY flow (LSP-driven):

  1. Recipient registers N payment hashes → LSP gets a Lightning Address
  2. Sender pays HODL invoice → HTLC held at LSP
  3. LSP P2P-requests an invoice from Recipient's node (using the registered hash
  index)
  4. LSP pays that outbound invoice → Recipient's node auto-settles using the preimage
  it generated
  5. Preimage propagates back → LSP claims Sender's HTLC

---

## Full Flow

### Phase 0 — Channel setup

Before any payment, both Sender and Recipient need RGB channels with the LSP.

The utexo-lsp cron (`reconcileChannels`) opens a virtual channel to each connected peer using:

- `DEFAULT_CHANNEL_CAPACITY_SAT` — BTC channel capacity
- `DEFAULT_CHANNEL_ASSET_AMOUNT` — total RGB units in the channel (on LSP's side)
- `DEFAULT_CHANNEL_PUSH_ASSET_AMOUNT` — RGB units pushed to the counterparty at open

**Important**: If `DEFAULT_CHANNEL_PUSH_ASSET_AMOUNT` is 0 (or not set), all RGB stays on the LSP's side. The Sender will have 0 RGB and cannot make the outbound payment. `DEFAULT_CHANNEL_ASSET_AMOUNT` must be at least `2 × push` so the LSP retains enough to deliver to the Recipient.

---

### Phase 1 — Recipient registers hash pool with LSP

```
Recipient RLN  ──P2P apay/new──►  LSP Host RLN  ──POST /internal/async_order/new──►  utexo-lsp
```

1. Recipient's RLN calls `/apay/new` with `host_node_id = LSP pubkey`.
2. RLN generates N `(hash_index, payment_hash)` pairs from its local hash pool and sends them to the LSP Host RLN via an onion P2P message.
3. LSP Host RLN forwards the message to utexo-lsp at `/internal/async_order/new` (authenticated with `APAY_BEARER_TOKEN`).
4. utexo-lsp stores the hash pool in its database and creates a Lightning Address for the Recipient (keyed by their pubkey).

SDK call: `wallet.apayNew(lspPubkey)`

---

### Phase 2 — Sender discovers Recipient's Lightning Address and pays

```
Sender  ──GET /.well-known/lnurlp/{username}──►  utexo-lsp  ──callback──►  HODL BOLT11
Sender  ──payLightningInvoice(hodlBolt11)──►  Sender RLN  ──HTLC──►  LSP RLN  (HELD)
LSP RLN  ──POST /internal/async_order/claimable──►  utexo-lsp
```

1. Sender fetches the LNURL pay endpoint for Recipient's username.
2. Sender calls the callback with `amount_msat` (and optionally `asset_id` + `asset_amount` for RGB).
3. utexo-lsp reserves a hash slot from Recipient's pool and calls the LSP RLN `/lninvoice` with `is_hodl=true` and the reserved `payment_hash` → gets a HODL BOLT11.
4. Sender pays the HODL BOLT11 via `payLightningInvoice`.
5. The HTLC reaches the LSP RLN and is **intercepted/held** (not settled).
6. LSP RLN notifies utexo-lsp via `POST /internal/async_order/claimable` (with `payment_hash` + `claim_deadline_height`).
7. utexo-lsp marks the invoice `claimable` and enqueues outbox job `request_outbound_invoice`.

**Sender needs RGB in their channel** to make an RGB payment. If the LSP opened the Sender's channel with `push_asset_amount=1`, the Sender has the required balance.

---

### Phase 3 — LSP requests outbound invoice from Recipient

```
utexo-lsp  ──POST /apay/outboundinvoice {client_node_id, hash_index, payment_hash}──►  LSP Host RLN
LSP Host RLN  ──P2P apay/request_invoice──►  Recipient RLN
Recipient RLN  ──P2P reply──►  LSP Host RLN  ──response──►  utexo-lsp
```

1. utexo-lsp calls `/apay/outboundinvoice` on the LSP RLN, specifying the Recipient's pubkey, the `hash_index`, and the expected `payment_hash`.
2. LSP RLN sends a P2P message to the Recipient's RLN asking it to generate an invoice for that `hash_index`.
3. Recipient's RLN creates a BOLT11 (using the pre-generated preimage for that `hash_index`) and replies via P2P.
4. LSP RLN returns the BOLT11 to utexo-lsp.
5. utexo-lsp stores the outbound invoice and marks status `outbound_pending`, enqueues job `send_outbound_payment`.

**The Recipient must be online (connected peer)** for this P2P exchange to succeed. If offline, the outbox job retries on each cron tick.

---

### Phase 4 — LSP pays Recipient's outbound invoice

```
utexo-lsp  ──POST /sendpayment {invoice}──►  LSP Host RLN
LSP Host RLN  ──HTLC──►  Recipient RLN  (auto-settles using preimage from hash pool)
Recipient RLN  ──payment_preimage──►  LSP Host RLN
LSP Host RLN  ──POST /internal/async_order/payment_sent {payment_hash, payment_preimage}──►  utexo-lsp
```

1. utexo-lsp calls `/sendpayment` on the LSP RLN with Recipient's BOLT11.
2. The HTLC flows LSP → Recipient's channel.
3. Recipient's RLN **auto-settles** by providing the preimage (it knows the preimage because it generated the hash pool).
4. Payment resolves → Recipient's balance increases.
5. LSP RLN receives the preimage and notifies utexo-lsp at `/internal/async_order/payment_sent`.
6. utexo-lsp marks status `outbound_claimed`, enqueues job `claim_inbound_invoice`.

**LSP needs RGB in its channel to Recipient** to make this outbound payment. With `DEFAULT_CHANNEL_ASSET_AMOUNT` ≥ 1 and no push to Recipient, the LSP holds the full RGB on its side and can pay.

---

### Phase 5 — LSP settles Sender's HTLC (claim inbound)

```
utexo-lsp  ──POST /claiminvoice {payment_hash, payment_preimage}──►  LSP Host RLN
LSP Host RLN  ──reveals preimage──►  Sender RLN  (HTLC settled)
```

1. utexo-lsp calls `/claiminvoice` on the LSP RLN with the now-known preimage.
2. LSP RLN settles the HTLC from the Sender.
3. Sender's payment transitions to `Succeeded`.
4. utexo-lsp marks status `inbound_claimed`. Flow complete.

---

## State Machine

```
initial
  └─► claimable            (Sender HTLC received at LSP, /internal/async_order/claimable called)
       └─► outbound_requested  (outbound invoice requested from Recipient RLN)
            └─► outbound_pending   (Recipient replied with BOLT11)
                 └─► outbound_paid     (LSP sent payment to Recipient)
                      └─► outbound_claimed  (/internal/async_order/payment_sent received preimage)
                           └─► inbound_claimed   (Sender HTLC settled via /claiminvoice)
```

Terminal failure: `failed` — claim deadline exceeded or delivery impossible.

---

## What the Demo App Must Do

| Role | App responsibility |
|------|-------------------|
| **Recipient** | Call `apayNew(lspPubkey)` once while connected. Stay online (reconnect periodically) so the LSP can deliver via P2P in Phase 3. No manual claim needed — delivery is automatic. |
| **Sender** | Resolve LNURL address → get HODL BOLT11 → call `payLightningInvoice`. Wait for payment status to become `Succeeded`. |

### What the current demo (`async-pay.tsx`) does wrong

1. **User B polls for `InboundHodl/Claimable` and calls `claimHodlInvoice` manually.** This is wrong. The Recipient does NOT hold a HODL invoice — the LSP pays Recipient's outbound invoice and Recipient auto-settles it. User B's node just needs to remain connected.

2. **User A has 0 RGB.** The LSP opens channels to both users with all RGB on the LSP's side. `payLightningInvoice` fails immediately with `status=FAILED` because User A's channel has no RGB to send. Fix: LSP must push RGB to User A when opening the channel (`push_asset_amount=1`, `asset_amount=2`).

---

## Required Config Changes

### utexo-lsp (`start-lsp-local.sh`)

```bash
DEFAULT_CHANNEL_ASSET_AMOUNT="2"         # total RGB per channel (was 1)
DEFAULT_CHANNEL_PUSH_ASSET_AMOUNT="1"    # push 1 RGB to counterparty at open (new)
```

LSP seeding must provide enough RGB to cover both channels:

- Channel to Sender: 2 units (1 pushed, 1 retained)
- Channel to Recipient: 1 unit (retained for outbound delivery; no push needed since Recipient is the receiver)

But because utexo-lsp uses the same config for all channels, both get push=1 and total=2. LSP needs 4 units minimum → seed at least 5.

### utexo-lsp source changes needed

`DEFAULT_CHANNEL_PUSH_ASSET_AMOUNT` does not exist in the current codebase. The existing `inbound` calculation (from `c.AssetDecimals`) is unreachable because rgb-lightning-node has no `/listconnections` endpoint and the `ListPeers` fallback never sets `AssetDecimals`. A new config field is required:

```go
// config.go
DefaultChannelPushAssetAmount *uint64

// LoadConfig()
DefaultChannelPushAssetAmount: optionalUint64("DEFAULT_CHANNEL_PUSH_ASSET_AMOUNT"),

// api.go — openChannelRequest()
if inbound == 0 && a.cfg.DefaultChannelPushAssetAmount != nil {
    inbound = *a.cfg.DefaultChannelPushAssetAmount
}
```

### async-pay.tsx demo changes needed

1. **Remove `claimHodlInvoice` polling phase.** Replace with: wait for User A's payment to reach `Succeeded`.
2. **Verify User B's RGB balance increased** after User A's payment succeeds.
3. User B just needs to stay connected (keep reconnecting to LSP peer) so Phase 3 P2P exchange can happen.
