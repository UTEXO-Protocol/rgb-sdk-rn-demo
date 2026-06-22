/**
 * APay · Signet (UTEXO) config.
 *
 * Same APay flow as the regtest variant, but against the live signet stack:
 *   - wallet.network = 'utexo', wallet.lspBaseUrl = utexo-lsp service URL
 *   - real RGB channels (no virtual channels)
 *   - no manual mining — fund/UTXO/settlement are reached by waiting for
 *     signet confirmations (poll loops)
 *   - the faucet RLN node funds BTC and plays the external RGB sender
 */
import { buildUtexoConfig } from '@/utils/env';

// utexo-lsp service (wallet.lspBaseUrl) — peer pubkey/host discovered via GET /get_info.
export const LSP_URL = 'https://lsp-signet.utexo.com';

// Faucet RLN node REST — set EXPO_PUBLIC_FAUCET_NODE_URL in .env.local
export const FAUCET_NODE_URL = process.env.EXPO_PUBLIC_FAUCET_NODE_URL?.trim() || '';

export const ASSET_ID = 'rgb:2l_MeWlj-YS7qLKQ-RJVhrQk-G6i4jZ4-EJOMAYZ-mpHfoqI';

export const UNLOCK = buildUtexoConfig().unlockParams;

export const PAYMENT_MSAT         = 3_000_000;
export const PAYMENT_ASSET_AMOUNT = 1;

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
