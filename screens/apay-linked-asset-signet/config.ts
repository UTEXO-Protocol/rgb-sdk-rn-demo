/**
 * APay Bridge-Asset checkout · Signet (UTEXO) config.
 *
 * The signet twin of `screens/apay/config.ts`'s `BRIDGE_ASSET`, pointed at a
 * utexo-lsp deployed from `utexo-lsp/.env.signet` — the production equivalent of
 * `TWO_ASSETS=1 ./scripts/start-lsp-regtest.sh`. Two unrelated IFA contracts,
 * converted 1:1 by the LSP because `CONVERTIBLE_PAIRS` says so:
 *
 *   LNUSDT  SUPPORTED_ASSET_IDS   — provisioned to every peer, what the
 *                                   merchant's channel and payout are in
 *   USDT    CONVERTIBLE_ASSET_IDS — canonical, what users already hold
 *                                   on-chain; accepted and paid out over a
 *                                   channel the peer funded itself, never
 *                                   provisioned
 *
 * The asset amounts are deliberately the *same numbers* the regtest script
 * uses, because that script was sized off `.env.signet` in the first place
 * (`CHANNEL_ASSET_AMOUNT`, `CHANNEL_CAPACITY_SAT`, `CHANNEL_PUSH_MSAT`). What
 * genuinely differs here is time, not money:
 *
 *   - no mining: every confirmation is waited out, at ~30 s per signet block
 *   - `CHANNEL_PROVISION_GRACE=60s` (30 s on regtest), so an LSP-provisioned
 *     peer sits idle for a full minute before the cron touches it
 *   - `CRON_EVERY=10s` (5 s on regtest)
 *   - `HTTP_TIMEOUT=30s`: the LSP's own /sendrgb and /openchannel sync against a
 *     remote indexer first
 *
 * Every timeout below is derived from those four numbers rather than guessed —
 * see each constant.
 */
import { buildUtexoConfig } from '@/utils/env';

/**
 * utexo-lsp service. The two-asset deployment is a *different configuration* of
 * the same service, not a different endpoint, so this defaults to the usual
 * signet host and is overridable for a side-by-side deployment.
 */
export const LSP_URL = process.env.EXPO_PUBLIC_SIGNET_BRIDGE_LSP_URL?.trim()
  || 'https://lsp-signet.utexo.com';

/**
 * Faucet RLN node REST — the same one `screens/apay-signet` uses.
 *
 * It plays two parts here, and both are preconditions the app cannot create:
 * it funds BTC (`/sendbtc`), and it is the on-chain source of the BRIDGE asset
 * for the buyer and for the merchant's top-up (`/sendrgb`). So the signet
 * faucet node must actually hold USDT — the flow checks this up front rather
 * than discovering it 20 minutes in.
 */
export const FAUCET_NODE_URL = process.env.EXPO_PUBLIC_FAUCET_NODE_URL?.trim() || '';

/**
 * The two contract ids, defaulted to the ones in `utexo-lsp/.env.signet`.
 *
 * `bridge` is the same contract `screens/apay-signet/config.ts` already calls
 * `ASSET_ID` — on signet the canonical USDT *is* the convertible asset.
 */
export const PAYOUT_ASSET_ID = process.env.EXPO_PUBLIC_SIGNET_BRIDGE_PAYOUT_ASSET_ID?.trim()
  || 'rgb:vDU5IB7L-ZJFyqM3-5KrG84e-L0Q4kzi-eg3y0nH-JzoBylw';
export const PAYOUT_TICKER = process.env.EXPO_PUBLIC_SIGNET_BRIDGE_PAYOUT_TICKER?.trim() || 'LNUSDT';

export const BRIDGE_ASSET_ID = process.env.EXPO_PUBLIC_SIGNET_BRIDGE_ASSET_ID?.trim()
  || 'rgb:f~9F4X0C-TiLOTvy-pALF29V-2xJ2p0m-hP3_vpW-Alj4G5Y';
export const BRIDGE_TICKER = process.env.EXPO_PUBLIC_SIGNET_BRIDGE_TICKER?.trim() || 'USDT';

/** Both contracts must agree — `ensureConvertiblePair` rejects a mismatch. */
export const ASSET_PRECISION = Number(process.env.EXPO_PUBLIC_SIGNET_BRIDGE_PRECISION ?? '6');

export const UNLOCK = buildUtexoConfig().unlockParams;

/**
 * Amounts, in base units (10^-6 here). Identical to the regtest `BRIDGE_ASSET`
 * — see `screens/apay/config.ts` for why each is the size it is. The short
 * version: `paymentMsat` is a flat 3 000 sat floor whatever the asset amount
 * (`HTLC_MIN_MSAT`, no virtual channels in this mode), so a 5-unit checkout
 * keeps the sat cost at ~5% and a 75 000 sat LSP channel covers 20 of them.
 */
export interface BridgeSignetAmounts {
  paymentMsat: number;
  paymentAssetAmount: number;
  /** Bridge asset the Faucet hands the buyer before it funds its own channel. */
  aFundUnits: number;
  aChannelCapacitySat: number;
  /**
   * Sats on the LSP's side of the buyer's channel at open. Not decoration: the
   * RGB amount rides an HTLC, so with 0 here the LSP holds only what the
   * checkout pushed (3 000 sat) less the 1% reserve, and the refund leg dies as
   * a bare `NoRoute` with the asset balance untouched.
   */
  aChannelPushMsat: number;
  refundAssetAmount: number;
  refundMsat: number;
  topupAssetAmount: number;
  topupMsat: number;
  recipientAssetAmount: number;
  recipientMsat: number;
  relayAssetAmount: number;
  relayMsat: number;
}

export const AMOUNTS: BridgeSignetAmounts = {
  paymentMsat: 3_000_000,
  paymentAssetAmount: 5_000_000,
  aFundUnits: 20_000_000,
  aChannelCapacitySat: Number(process.env.EXPO_PUBLIC_SIGNET_BRIDGE_CHANNEL_SAT ?? '50000'),
  aChannelPushMsat: 10_000_000,
  refundAssetAmount: 2_000_000,
  refundMsat: 3_000_000,
  topupAssetAmount: 1_000_000,
  topupMsat: 3_000_000,
  recipientAssetAmount: 1_000_000,
  recipientMsat: 3_000_000,
  relayAssetAmount: 1_000_000,
  relayMsat: 3_000_000,
};

export const CART_ITEM = `1× Bridge Asset checkout (${BRIDGE_TICKER} → ${PAYOUT_TICKER})`;

// ── BTC funding ──────────────────────────────────────────────────────────────
//
// `createUtxos` uses the node default of 32 000 sat per colorable UTXO. Each of
// the three nodes needs UTXO_NUM of them, and the buyer additionally needs
// UTXO_TOPUP_NUM more (its blind receive burns one) plus the channel it funds
// itself:
//
//   buyer = (6 + 3) × 32 000 + 50 000 channel + fees ≈ 340 000 sat
//
// 500 000 leaves headroom for signet fee spikes on all three roles.
export const FAUCET_BTC_SAT   = Number(process.env.EXPO_PUBLIC_SIGNET_BRIDGE_FUND_SAT ?? '500000');
export const UTXO_NUM         = 6;
/** Top-up after the blind receive: it consumes one uncolored UTXO. */
export const UTXO_TOPUP_NUM   = 3;
export const FEE_RATE         = 2;

// ── Timing ───────────────────────────────────────────────────────────────────

/** One poll per ~half a signet block. */
export const POLL_MS = 15_000;

/**
 * `CHANNEL_PROVISION_GRACE` on the signet LSP. Purely informational here — the
 * flow logs it so the first minute of silence on an LSP-provisioned channel
 * reads as expected rather than as a stall.
 *
 * It also sets a client-side rule the flow obeys: the *buyer* must not touch
 * the LSP before it funds its own channel, because any earlier connect (LNURL
 * discovery, a keepalive) puts its pubkey in /listpeers and starts this clock.
 */
export const CHANNEL_PROVISION_GRACE_MS = 60_000;

/** utexo-lsp `CRON_EVERY` — what drives provisioning, delivery and the outbox. */
export const CRON_EVERY_MS = 10_000;

/**
 * Channel readiness, both directions.
 *
 *   grace 60s + CRON_EVERY 10s + initiate→pending ~5s
 *     + MIN_CHANNEL_CONFIRMATIONS × blocktime  =  60 + 10 + 5 + 3×30  =  165s
 *
 * (`MIN_CHANNEL_CONFIRMATIONS = 3`, rgb-lightning-node `src/core_types.rs`; the
 * config loader rejects 0.) Only the served side pays the grace — the buyer's
 * own channel shows up in `/listchannels` on `funding_created` and ends it early.
 *
 * 30 min is ~11× that, on purpose. The 165 s assumes a 30 s block every 30 s,
 * and signet block times are an average, not a schedule: three confirmations
 * can take several minutes when the interval stretches. Every step also syncs
 * against a remote indexer first. A channel absent after 30 min is broken
 * rather than slow — the same budget `screens/lsp-signet` and
 * `screens/apay-signet` use.
 */
export const CHANNEL_TIMEOUT_MS = 30 * 60 * 1000;

/** BTC funding / createUtxos: one confirmation, plus faucet + indexer latency. */
export const FUND_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * A Lightning leg (checkout, refund, recipient, relay). No blocks involved —
 * what is being waited on is the LSP outbox, which ticks every CRON_EVERY and
 * retries a failed delivery on DELIVERY_RETRY_BASE_DELAY (15 s) backing off to
 * 60 s. 15 min allows ~15 retries; anything beyond that is a liquidity problem
 * the logs will name, not a slow signet.
 */
export const SETTLE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * An on-chain RGB leg (buyer's bridge-asset receive, merchant's top-up).
 *
 * Much longer than a Lightning one and not by a constant factor: the RGB
 * handshake is send → recipient acknowledges → sender broadcasts →
 * confirmation, and each hop waits on the *counterparty's* own refresh cycle
 * before the next can start. Four sequential ~30 s blocks is the floor, and the
 * proxy round trips between them are not free.
 */
export const ONCHAIN_SETTLE_TIMEOUT_MS = 45 * 60 * 1000;

export const MERCHANT_KEEPALIVE_MS = 15_000;

/** RGB invoice validity for the buyer's blind receive — outlives the wait above. */
export const RGB_INVOICE_DURATION_S = 2 * 60 * 60;
