# APAY (Async Payment) Flow

> Source: `utexo-lsp/internal/lspapi/api.go` + `rgb-lightning-node/src/routes.rs`  
> Three nodes: **Sender**, **LSP** (Host RLN + utexo-lsp Go service), **Recipient**

---

## Overview

Async payment lets a **Recipient be offline** when a Sender initiates the payment. The LSP holds the HTLC and delivers it once the Recipient is reachable. The delivery is fully driven by the LSP — the Recipient app does **not** manually claim anything.

The real APAY flow (LSP-driven):

  1. LSP provisions a Lightning Address on connect; Recipient registers N payment hashes (attested) against it
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

### Phase 1 — Recipient registers attested hash pool with LSP

```
Recipient RLN  ──P2P apay/new_with_address──►  LSP Host RLN  ──POST /internal/async_order/new──►  utexo-lsp
```

The Recipient starts by connecting to the LSP (`lsp.connect()`). The LSP runs a cron that assigns every connected peer a Lightning Address keyed by their pubkey, so the address already exists before registration — the Recipient fetches it with `GET /lightning_address/by_pubkey/{pubkey}`.

With the `username` and `domain` resolved, the Recipient's RLN calls `/apay/new_with_address`. It pulls N `(hash_index, payment_hash)` pairs from its local hash pool, builds a Merkle root over them, and signs `username`+`domain` (`address_sig`); this signature proves the pool belongs to that address. The batch and signature travel to the LSP Host RLN over an onion P2P message, which forwards them to utexo-lsp at `/internal/async_order/new` (authenticated with `APAY_BEARER_TOKEN`). utexo-lsp verifies the signature and stores the pool against the Recipient's address.

SDK call: `wallet.apayNewWithAddress(lspPubkey, username, domain)`. In the demo this is wrapped by `lsp.enableLightningAddress()`, which does the lookup and registration in one step. When the pool runs low, top it up with `lsp.refillHashPool()`.

> Register one batch only. The node's batch size already matches the LSP's pool cap, so a single batch fills it. Issuing an `apayNew` bootstrap first overflows the pool, and the LSP rejects the second batch with `invalid_hash_batch`.

---

### Phase 2 — Sender discovers Recipient's Lightning Address and pays

```
Sender  ──GET /.well-known/lnurlp/{username}──►  utexo-lsp  ──callback──►  HODL BOLT11
Sender  ──lsp.payAddress(address)──►  Sender RLN  ──HTLC──►  LSP RLN  (HELD)
LSP RLN  ──POST /internal/async_order/claimable──►  utexo-lsp
```

1. Sender fetches the LNURL pay endpoint for Recipient's username.
2. Sender calls the callback with `amount_msat` (and optionally `asset_id` + `asset_amount` for RGB).
3. utexo-lsp reserves a hash slot from Recipient's pool and calls the LSP RLN `/lninvoice` with `is_hodl=true` and the reserved `payment_hash` → gets a HODL BOLT11.
4. Sender pays via `lsp.payAddress({ address, amtMsat, asset })` (LNURL resolve + HODL pay).
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

Reference implementation: [`screens/apay/useApayFlow.ts`](../screens/apay/useApayFlow.ts)  
Screens: **Async Payment** (`screens/async-pay.tsx`), **APay Cart** (`screens/apay-regular-channels.tsx`).

| Role | App responsibility |
|------|-------------------|
| **Recipient** | `lsp.connect()` → `lsp.waitForChannel()` → `lsp.enableLightningAddress()`. Call `lsp.connect()` when online so the LSP outbox can reach the node in Phase 3. Settlement is automatic — no `claimHodlInvoice`. |
| **Sender** | `lsp.connect()` → `lsp.waitForChannel()` → `lsp.waitForOutboundLiquidity()` → `lsp.payAddress()`. Poll `getLightningSendRequest(paymentHash)` until `Settled`. |

**Success checks:** Sender `Settled`; Recipient inbound `INBOUND_HODL` → `Succeeded`; Recipient `offchainOutbound` increased (not `offchainInbound`).

---

## Regtest setup

Run `./scripts/start-lsp-local.sh` (or `start-lsp-regtest.sh`) before the demo. Required env: `EXPO_PUBLIC_LSP_REGTEST_ASSET_ID`, LSP HTTP on `:8080`, Host RLN on `:3005`.

Channel config must give the **Sender RGB** to pay (`DEFAULT_CHANNEL_PUSH_ASSET_AMOUNT=1`, `DEFAULT_CHANNEL_ASSET_AMOUNT=2` in the start script). Without push, the Sender channel has 0 local RGB and `payAddress` fails immediately with `Failed`.

See also [LSP_REGTEST_SETUP.md](./LSP_REGTEST_SETUP.md) and SDK [async-payments.md](https://github.com/UTEXO-Protocol/rgb-sdk-rn/blob/main/docs/async-payments.md).
