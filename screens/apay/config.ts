import { Platform } from 'react-native';

export const host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

export const LSP_URL        = `http://${host}:8080`;
export const LSP_DAEMON_URL = `http://${host}:3005`;

export const ASSET_ID    = process.env.EXPO_PUBLIC_LSP_REGTEST_ASSET_ID ?? '';
export const LSP_LDK_PORT = Number(process.env.EXPO_PUBLIC_LSP_REGTEST_LDK_PORT ?? '9737');

/** Second demo asset — IFA, precision 6. Issued by start-lsp-regtest.sh. */
export const IFA_ASSET_ID  = process.env.EXPO_PUBLIC_LSP_REGTEST_IFA_ASSET_ID ?? '';
export const IFA_TICKER    = process.env.EXPO_PUBLIC_LSP_REGTEST_IFA_TICKER ?? 'UTIF';
export const IFA_PRECISION = Number(process.env.EXPO_PUBLIC_LSP_REGTEST_IFA_PRECISION ?? '6');

/**
 * Which asset the running LSP actually serves (`ASSET=` in start-lsp-regtest.sh).
 *
 * Only one at a time: rgb-lightning-node allows a single virtual channel
 * session per peer pair (`virtual_channel_add_intent`, src/ldk.rs), so an LSP
 * advertising two assets opens a channel for whichever it reaches first and
 * every flow for the other asset waits forever. Flows check this up front
 * instead of polling until the channel timeout.
 */
export const ACTIVE_ASSET_KEY = process.env.EXPO_PUBLIC_LSP_REGTEST_ACTIVE_ASSET ?? 'utst';

export const REGTEST_UNLOCK = {
  bitcoindRpcUsername: 'user',
  bitcoindRpcPassword: 'password',
  bitcoindRpcHost: host,
  bitcoindRpcPort: 18443,
  indexerUrl: `${host}:50001`,
  proxyEndpoint: `rpc://${host}:3000/json-rpc`,
  announceAddresses: [] as string[],
  announceAlias: null as string | null,
};

export const CART_ITEM            = '1× RGB Token (UTST)';
export const PAYMENT_MSAT         = 3_000_000;
export const PAYMENT_ASSET_AMOUNT = 1;

/**
 * An asset as the APay flow needs to see it. Amounts are always in *base units*
 * (10^-precision) — the only unit the RGB and LSP APIs accept; `precision` is
 * for display only.
 */
export interface ApayAsset {
  key: string;
  assetId: string;
  /** Env var that carries `assetId` — named in the "run the setup script" error. */
  envVarName: string;
  ticker: string;
  precision: number;
  /** Sats carried by the checkout HTLC, in msat. */
  paymentMsat: number;
  /** Checkout price, in base units. */
  paymentAssetAmount: number;
  cartItem: string;
}

/** NIA, precision 0 — the original cart / async-pay asset. */
export const UTST_ASSET: ApayAsset = {
  key: 'utst',
  assetId: ASSET_ID,
  envVarName: 'EXPO_PUBLIC_LSP_REGTEST_ASSET_ID',
  ticker: 'UTST',
  precision: 0,
  paymentMsat: PAYMENT_MSAT,
  paymentAssetAmount: PAYMENT_ASSET_AMOUNT,
  cartItem: CART_ITEM,
};

/**
 * IFA, precision 6 — fractional checkout.
 *
 * 500_000 base units = 0.5 UTIF, half of the 1_000_000 units
 * (DEFAULT_CHANNEL_ASSET_AMOUNT) the LSP puts on its side of each channel.
 *
 * paymentMsat is 1 sat: rgb-lightning-node negotiates VIRTUAL_HTLC_MIN_MSAT
 * (1_000) on trusted_no_broadcast channels instead of the 3_000_000 floor a
 * broadcastable commitment needs, and start-lsp-regtest.sh lowers the LSP's
 * MIN_AMT_MSAT / minSendable to match.
 */
export const IFA_ASSET: ApayAsset = {
  key: 'ifa',
  assetId: IFA_ASSET_ID,
  envVarName: 'EXPO_PUBLIC_LSP_REGTEST_IFA_ASSET_ID',
  ticker: IFA_TICKER,
  precision: IFA_PRECISION,
  paymentMsat: 1_000,
  paymentAssetAmount: 500_000,
  cartItem: `1× Inflatable RGB Token (${IFA_TICKER})`,
};

/** Base units → display string, e.g. 500000 @ precision 6 → "0.5". */
export function formatAssetAmount(baseUnits: number, precision: number): string {
  if (precision <= 0) return String(baseUnits);
  const scale = 10 ** precision;
  const whole = Math.floor(baseUnits / scale);
  const frac = String(baseUnits % scale).padStart(precision, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

export const CHANNEL_TIMEOUT_S    = 180;
export const SETTLE_TIMEOUT_S     = 120;
export const POLL_INTERVAL_MS     = 3_000;
export const MERCHANT_KEEPALIVE_MS = 15_000;
/** Auto-refill the merchant's APay hash pool once it drops below this many unused hashes. */
export const APAY_HASH_REFILL_THRESHOLD = 3;

export type ApayFlowVariant = 'cart' | 'async';

export type Phase =
  | 'idle'
  | 'b_init' | 'b_fund' | 'b_utxos' | 'b_channel' | 'register'
  | 'a_init' | 'a_fund' | 'a_utxos' | 'a_channel' | 'a_topup'
  | 'lnurlp' | 'send' | 'settle'
  | 'done' | 'error';

export interface LogEntry { time: string; msg: string; type: 'info' | 'success' | 'error' }

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const short = (s: string, n = 24) => (s || '').slice(0, n) + ((s || '').length > n ? '…' : '');
export const normHash = (h: string) => (h || '').toLowerCase().replace(/^0x/, '');

export const PHASE_LABELS: Record<Phase, string> = {
  idle: 'Idle',
  b_init: 'B Init', b_fund: 'B Fund', b_utxos: 'B UTXOs', b_channel: 'B Chan', register: 'Register',
  a_init: 'A Init', a_fund: 'A Fund', a_utxos: 'A UTXOs', a_channel: 'A Chan', a_topup: 'A Top-up',
  lnurlp: 'Checkout', send: 'Pay', settle: 'Settle',
  done: 'Done', error: 'Error',
};

export const PHASES_P1: Phase[] = ['b_init', 'b_fund', 'b_utxos', 'b_channel', 'register'];
export const PHASES_P2: Phase[] = ['a_init', 'a_fund', 'a_utxos', 'a_channel', 'a_topup', 'send', 'settle', 'done'];
