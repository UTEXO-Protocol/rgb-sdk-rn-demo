# Bug Report: `utexo-lsp` UTXO auto-maintenance never refills empty colorable slots

**Component:** `utexo-lsp`
**Files:** `internal/lspapi/api.go`, `pkg/node_client/node_endpoints.go`
**Severity:** High — leads to recurring `InsufficientAllocationSlots` / `no available utxos` failures on the LSP node
**Environment:** Signet (RLN wallet runs with `max_allocations_per_utxo = 1`)

---

## Summary

The cron job that is supposed to keep a pool of spendable UTXOs on the LSP node (`maintainUtxos`) never refills the UTXOs that actually matter. It measures the **total** number of unspent outputs instead of the number of **free colorable** UTXOs. As a result, once the node has accumulated enough vanilla + asset-occupied UTXOs to pass the `UTXO_MIN_COUNT` threshold, the cron stops creating new UTXOs — even when there are zero empty colorable slots left to receive assets or open channels.

This makes the failure recurring: every channel open / asset send consumes an empty colorable UTXO, the total UTXO count stays roughly constant, the cron keeps seeing "total ≥ min" and does nothing, and the pool of free slots silently drains to zero.

---

## Impact

- LSP eventually can't create blinded invoices (`lightning_receive`) or open channels.
- Surfaces as `InsufficientAllocationSlots` / `no available utxos` (and downstream `InsufficientAssets`, stuck `Initiated`/`WaitingCounterparty` transfers).
- Requires **manual** `createutxos` intervention every time the free pool drains — the automatic maintenance provides no real protection.

---

## Root cause

### 1. Wrong quantity measured

`maintainUtxos` compares the **total unspent count** against `UTXO_MIN_COUNT`:

```go
// internal/lspapi/api.go  (~line 1063)
if uint32(len(unspents.Unspents)) >= a.cfg.UtxoMinCount {
    return nil
}
```

`len(unspents.Unspents)` includes **all** UTXOs:
- the large vanilla BTC UTXO(s),
- asset-occupied colorable UTXOs,
- empty colorable UTXOs.

Only the last group is usable for new receives/channels. With, say, `UTXO_MIN_COUNT = 5` and a node holding `1 vanilla + 4 asset = 5` UTXOs, the check is `5 >= 5 → return` and **no UTXOs are ever created**, despite **zero** free colorable slots.

### 2. The node client can't even see allocations

The Go client discards the allocation data needed to make the correct decision:

```go
// pkg/node_client/node_endpoints.go  (~line 738)
type UTXO struct {
    Outpoint  string `json:"outpoint"`
    BtcAmount uint64 `json:"btc_amount"`
    Colorable bool   `json:"colorable"`
}

type Unspent struct {
    UTXO UTXO `json:"utxo"`
}
```

`rgb_allocations` is never parsed, so the cron cannot distinguish an empty colorable UTXO from an asset-occupied one even if it wanted to.

### 3. `max_allocations_per_utxo = 1` makes it strict

On Signet the RLN wallet runs with `max_allocations_per_utxo = 1`. In rgb-lib the allocatable filter becomes (`max_allocs = max_allocations_per_utxo - 1 = 0`):

```rust
// rgb-lib  src/wallet/offline.rs  get_available_allocations
.filter(|u| {
    (u.rgb_allocations.len() as u32) + u.pending_blinded <= max_allocs   // <= 0
        && !u.rgb_allocations.iter().any(|a| {
            !a.incoming && (a.status.initiated() || a.status.waiting_counterparty())
        })
})
```

So a UTXO is usable only if `rgb_allocations.len() + pending_blinded == 0`. Creating a blinded invoice reserves one empty UTXO (`pending_blinded += 1`). **Therefore one empty colorable UTXO = capacity for exactly one pending invoice / one allocation.** The LSP needs a *pool* of empty UTXOs, which is precisely what the broken maintenance fails to keep.

> Note: a UTXO reserved by a pending blinded invoice has empty `rgb_allocations` but `pending_blinded = 1`, so it *looks* free in `listunspents` but is not allocatable.

---

## Steps to reproduce

1. Fund the LSP node and seed a handful of colorable UTXOs.
2. Let the LSP run normally (cron firing every `CRON_EVERY`).
3. Open channels / accept `lightning_receive` invoices until empty colorable slots are consumed (each one becomes asset-occupied or pending).
4. Observe that total UTXO count stays ≥ `UTXO_MIN_COUNT`, so the cron never creates new UTXOs.
5. Next invoice / channel open fails with `no available utxos` / `InsufficientAllocationSlots`.

**Free-slot check used to confirm:**
```bash
curl -s -X POST "<node>/listunspents" -H 'content-type: application/json' \
  -d '{"skip_sync":false,"settled_only":false}' \
  | jq '[.unspents[] | select(.utxo.colorable==true and (.rgb_allocations|length)==0)] | length'
```
This returns `0` while total UTXO count is still ≥ `UTXO_MIN_COUNT`.

---

## Suggested fix

### Part 1 — Parse allocations in the node client (`pkg/node_client/node_endpoints.go`)

Add `rgb_allocations` to the unspent structs so the LSP can tell empty from occupied:

```go
type RgbAllocation struct {
    AssetID string `json:"asset_id"`
    Amount  uint64 `json:"amount"`
    Settled bool   `json:"settled"`
}

type Unspent struct {
    UTXO           UTXO            `json:"utxo"`
    RgbAllocations []RgbAllocation `json:"rgb_allocations"`
}
```

Also ensure `ListUnspentsRequest` sends `settled_only:false` (field already exists) so pending allocations are visible.

### Part 2 — Count free colorable slots, not total UTXOs (`internal/lspapi/api.go`)

Replace the total-count check in `maintainUtxos`:

```go
// before
if uint32(len(unspents.Unspents)) >= a.cfg.UtxoMinCount {
    return nil
}

// after
freeColorable := 0
for _, u := range unspents.Unspents {
    if u.UTXO.Colorable && len(u.RgbAllocations) == 0 {
        freeColorable++
    }
}
if uint32(freeColorable) >= a.cfg.UtxoMinCount {
    return nil
}
// refill back up to target, not just (target - min)
num := uint8(a.cfg.UtxoTargetCount - uint32(freeColorable))
```

This makes the cron self-correcting: when free slots drop below `MIN`, it refills to `TARGET` every cycle.

### Part 3 — Account for `pending_blinded` reservations (recommended)

Because a pending blinded invoice leaves `rgb_allocations` empty but reserves the UTXO, "empty allocations" slightly over-counts. Either:
- cross-reference `/listtransfers` and treat a slot as free only if it is **not** pinned by a `WaitingCounterparty` incoming transfer, **or**
- keep a safety buffer (`UTXO_MIN_COUNT` set a few slots above max concurrent in-flight invoices).

### Part 4 — Avoid duplicate `createutxos` (recommended)

The cron fires every ~`CRON_EVERY` seconds. If a `createutxos` tx is still unconfirmed, the next tick still sees few free slots and fires again, stacking redundant transactions. Add a guard: skip creation while a previous `createutxos` output is still unconfirmed, or rate-limit creation to once per N blocks.

---

## Workaround until fixed

- **Manual:** periodically run `createutxos` on the LSP when the free-slot check above returns low.
- **Config stopgap:** set `UTXO_MIN_COUNT` higher than the node's usual total UTXO count so `total < min` stays true and the cron keeps creating. Wasteful and fragile (still counts the wrong thing), but keeps empty slots flowing.

---

## Acceptance criteria

- With assets and channels in use, the free colorable UTXO count never drops to 0 under normal load while the cron is running.
- No manual `createutxos` needed for steady-state operation.
- No redundant stacked `createutxos` transactions while one is unconfirmed.
