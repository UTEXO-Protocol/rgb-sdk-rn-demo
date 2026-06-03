# Bug: `payLightningInvoice` always fails for sender in async payment flow (regtest)

## Scenario

User A (sender) connects to LSP → LSP opens RGB channel → User A tries to pay a HODL invoice
via `payLightningInvoice` → payment fails with `status=FAILED`.

## Root Cause

`utexo-lsp` cron calls `/listconnections` on the RLN node, which doesn't exist →
falls back to `/listpeers`. The peers response has no `asset_decimals` field, so the
synthesized `Connection` has `AssetDecimals = nil`.

In `openChannelPayload` (`api.go:1258`), `push_asset_amount` is only set when
`AssetDecimals != nil`. Since it's nil, the LSP opens channels with `push_asset_amount = 0`
— all RGB stays on the LSP's side.

- **User B (recipient):** fine — needs inbound capacity, LSP holding the RGB is correct.
- **User A (sender):** zero local RGB balance → can't send → payment fails.

## Fix Needed in `utexo-lsp`

When falling back to `listpeers`, `push_asset_amount` should be derived from
`DefaultChannelAssetAmount` (or a dedicated config), not the `asset_decimals` formula
which requires data the peers endpoint doesn't provide.

Also worth checking: the decimal formula gives `1_000_000` for precision-0 assets,
which would exceed the channel's `asset_amount=1` regardless.

## Affected File

`utexo-lsp/internal/lspapi/api.go` — `getConnections()` listpeers fallback (~line 1205)
and `openChannelPayload()` (~line 1258).
