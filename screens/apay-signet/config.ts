/**
 * APay · Signet (UTEXO) config.
 *
 * Same APay flow as the regtest variant, but against the live signet stack:
 *   - wallet.network = 'utexo', wallet.lspBaseUrl = utexo-lsp service URL
 *   - virtual channels (`virtual_channel_mode: trusted_no_broadcast` per the
 *     LSP's /get_info) — createLsp() discovers this and enables them
 *   - no manual mining — fund/UTXO/settlement are reached by waiting for
 *     signet confirmations (poll loops)
 *   - the faucet RLN node funds BTC and plays the external RGB sender
 */
import { buildUtexoConfig } from '@/utils/env';

// utexo-lsp service (wallet.lspBaseUrl) — peer pubkey/host discovered via GET /get_info.
export const LSP_URL = 'https://lsp-signet.utexo.com';

// Faucet RLN node REST — set EXPO_PUBLIC_FAUCET_NODE_URL in .env.local
export const FAUCET_NODE_URL = process.env.EXPO_PUBLIC_FAUCET_NODE_URL?.trim() || '';

/**
 * The asset the signet LSP serves (`supported_assets` in GET /get_info):
 * IFA `USDT`, precision 6. It is the only one advertised — a virtual channel
 * for any other asset never opens, so the flow checks this up front.
 *
 * Deliberately not read from EXPO_PUBLIC_SIGNET_ASSET_ID: that variable is the
 * lsp-signet screen's (older, precision-0) asset.
 */
export const ASSET_ID = process.env.EXPO_PUBLIC_SIGNET_APAY_ASSET_ID?.trim()
  || 'rgb:f~9F4X0C-TiLOTvy-pALF29V-2xJ2p0m-hP3_vpW-Alj4G5Y';
export const ASSET_TICKER    = process.env.EXPO_PUBLIC_SIGNET_APAY_ASSET_TICKER?.trim() || 'USDT';
export const ASSET_PRECISION = Number(process.env.EXPO_PUBLIC_SIGNET_APAY_ASSET_PRECISION ?? '6');

export const UNLOCK = buildUtexoConfig().unlockParams;

/**
 * Checkout price. **Both values are base units** — 10^-precision for the asset,
 * msat for the sats leg.
 *
 * 500_000 base units = 0.5 USDT, well inside the 100_000_000 (100 USDT) the LSP
 * puts on its side of each channel (`min/max_channel_asset_amount`).
 *
 * 1 sat rides the HTLC: virtual channels negotiate VIRTUAL_HTLC_MIN_MSAT
 * (1_000) instead of the 3_000_000 floor a broadcastable commitment needs, and
 * the signet LSP reports `min_payment_size_msat` /
 * `lightning_address_min_sendable_msat` = 1_000 to match. Anything above
 * `lightning_address_max_sendable_msat` (3_000_000) is rejected at LNURL
 * discovery, before the payment is even attempted.
 */
export const PAYMENT_MSAT         = 1_000;
export const PAYMENT_ASSET_AMOUNT = 500_000;

// BTC the faucet sends to each app wallet, plus the colorable UTXO count.
// createUtxos uses the node default of 32_000 sat/UTXO (needed so the colorable
// UTXOs are large enough to back LSP channel opens), so the faucet must fund
// enough to cover UTXO_NUM × 32_000 + fees + vanilla headroom.
//   colorable = 5 × 32_000 = 160_000 sat  →  fund ≥ 250_000 sat
export const FAUCET_BTC_SAT = 250_000;
export const UTXO_NUM       = 5;
export const FEE_RATE       = 2;

// Signet: no mining — blocks arrive naturally, settlement just takes longer.
export const POLL_MS             = 15_000;
export const CHANNEL_TIMEOUT_MS  = 30 * 60 * 1000; // 30 min (channel needs 6 confs)
export const FUND_TIMEOUT_MS     = 15 * 60 * 1000;
export const SETTLE_TIMEOUT_MS   = 30 * 60 * 1000;
export const MERCHANT_KEEPALIVE_MS = 15_000;
/** Auto-refill the merchant's APay hash pool once it drops below this many unused hashes. */
export const APAY_HASH_REFILL_THRESHOLD = 3;
