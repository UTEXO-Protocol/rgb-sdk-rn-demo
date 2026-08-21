import { Platform } from 'react-native';

export const host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

/**
 * Rewrite a URL minted on this device so a daemon on the dev machine can use it.
 *
 * `10.0.2.2` is the emulator's alias for the host loopback and means nothing
 * outside the emulator. An RGB invoice created by an on-device node carries it
 * in `transport_endpoints`; hand that straight to the faucet — a process on the
 * dev machine — and rgb-lib finds no reachable endpoint and rejects the send
 * with `InvalidTransportEndpoints`. No-op on iOS, where both sides say
 * `127.0.0.1` already.
 *
 * Only for values crossing device → daemon. Anything the device itself dials
 * must keep `host`.
 */
export const toDaemonUrl = (url: string) => url.split('10.0.2.2').join('127.0.0.1');

/**
 * Proxy host — `127.0.0.1` on both platforms, unlike everything else.
 *
 * A node's proxy endpoint is not only dialled by that node: when it funds an
 * RGB channel, the endpoint travels to the counterparty, which fetches the
 * consignment from it. Put `10.0.2.2` here and the LSP — a process on the dev
 * machine — goes looking for the consignment at an address that means nothing
 * outside the emulator, finds nothing, and closes the channel with
 * `Failed to find RGB consignment`.
 *
 * `127.0.0.1:3000` is the one form correct on both sides: `adb reverse
 * tcp:3000 tcp:3000` (set by start-lsp-regtest.sh) makes it reach the proxy
 * from the device, and it is the proxy's own address on the dev machine.
 *
 * Only port 3000 gets this treatment. bitcoind (18443) and electrs (50001)
 * have no reverse forward and are dialled by the device alone, so they keep
 * `host`.
 */
export const PROXY_HOST = '127.0.0.1';

export const LSP_URL        = `http://${host}:8080`;
export const LSP_DAEMON_URL = `http://${host}:3005`;
/** Faucet RLN daemon — issuer of the bridge asset and the on-chain source that
 * funds buyers (`TWO_ASSETS=1 ./scripts/start-lsp-regtest.sh`). Port is fixed
 * by the script (`FAUCET_PORT=3008`), already in the adb reverse forward list. */
export const FAUCET_DAEMON_URL = `http://${host}:3008`;

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
  proxyEndpoint: `rpc://${PROXY_HOST}:3000/json-rpc`,
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

/**
 * Two-asset checkout (`TWO_ASSETS=1 ./scripts/start-lsp-regtest.sh`, see
 * `docs/apay-linked-asset-mvp.md`). Two contract IDs, not one:
 * - `payoutAssetId` — LNUSDT: the only asset the LSP serves, and what the
 *   merchant's channel and delivery are denominated in. Same id as
 *   `IFA_ASSET_ID` — under `TWO_ASSETS=1` the served asset *is* the payout asset.
 * - `bridgeAssetId` — BUSDT: the buyer receives it on-chain from the Faucet and
 *   funds its own channel with it, and it is the only asset the buyer can spend.
 *
 * The two are unrelated RGB contracts, both issued on the Faucet. What makes
 * them interchangeable is utexo-lsp's `CONVERTIBLE_PAIRS` — no RGB Asset Link is
 * involved anywhere (see §10 of `docs/apay-linked-asset-options.uk.md`).
 *
 * The conversion happens on the LSP's books, between the two legs of one APay
 * payment (option A of `docs/apay-linked-asset-options.uk.md`): the buyer's leg
 * is an ordinary BUSDT payment, the merchant's an ordinary LNUSDT payment, and
 * one payment hash makes them atomic. No node-level swap is involved.
 *
 * On-chain only: no virtual channels anywhere in this flow (the LSP process
 * itself is started without `--enable-virtual-channels-v0` under
 * `TWO_ASSETS=1`), so both legs are real, confirmed channels.
 */
export const BRIDGE_ASSET_ID = process.env.EXPO_PUBLIC_LSP_REGTEST_BRIDGE_ASSET_ID ?? '';
export const BRIDGE_TICKER   = process.env.EXPO_PUBLIC_LSP_REGTEST_BRIDGE_TICKER ?? 'BUSDT';

export interface BridgeAssetConfig {
  /** What the buyer holds and pays with — the LSP's convertible asset. */
  bridgeAssetId: string;
  bridgeTicker: string;
  /** What the merchant is paid in — the LSP's served asset. */
  payoutAssetId: string;
  payoutTicker: string;
  precision: number;
  /** Sats carried by the checkout HTLC, in msat. Real (broadcastable)
   * channels need >= HTLC_MIN_MSAT (3_000_000) — the 1-sat virtual-channel
   * trick `IFA_ASSET` uses does not apply here. */
  paymentMsat: number;
  /** Checkout price, in base units — the same number on both legs (rate 1:1). */
  paymentAssetAmount: number;
  cartItem: string;
  /** How much bridge asset the app asks Faucet to send the buyer before it
   * funds its own channel — comfortably above `paymentAssetAmount`. */
  aFundUnits: number;
  /**
   * Capacity/push for the buyer's self-opened bridge-asset channel.
   *
   * `aChannelPushMsat` is not decoration: the RGB amount rides an HTLC, so the
   * LSP needs sats on its side of this channel before it can deliver anything
   * in the bridge asset. Opening with 0 leaves it with only what the checkout
   * pushes over (3 000 sat), of which the 1% channel reserve (500 sat on a
   * 50 000 sat channel) is unspendable — 2 500 sat left against a 3 000 sat
   * floor, and the refund fails as `NoRoute` with the asset balance untouched.
   * 10 000 sat covers the refund and the relay leg with margin.
   */
  aChannelCapacitySat: number;
  aChannelPushMsat: number;
  /**
   * Refund leg: the merchant pays the buyer back through APay, quoting the only
   * asset it holds (the payout asset), while the buyer is paid out in the bridge
   * asset — the same conversion as the checkout, in reverse.
   *
   * Smaller than the checkout on purpose. The LSP can only deliver bridge asset
   * it already holds on the buyer's channel, and all it holds there is what the
   * checkout put in; a partial refund is the honest demonstration that both
   * directions work, rather than one that happens to consume the whole balance.
   */
  refundAssetAmount: number;
  refundMsat: number;
  /**
   * Top-up leg: the merchant calls `receiveAsset` naming only the payout asset,
   * the LSP issues an RGB invoice in the bridge asset, and the Faucet — an
   * external node with no channel to anyone — pays it on-chain. The merchant is
   * delivered payout asset over its existing channel.
   *
   * Sized against what the LSP still holds on the merchant's channel after the
   * checkout and the refund (100 000 000 opened − 5 000 000 out + 2 000 000
   * back = 97 000 000), with room to spare.
   */
  topupAssetAmount: number;
  topupMsat: number;
  /**
   * Recipient leg: a third node with no history, served the ordinary way — it
   * connects, the LSP cron opens it a payout-asset channel, it registers a
   * Lightning Address, and the merchant pays it.
   *
   * Deliberately the *unconverted* path: both legs are LNUSDT, so this is the
   * control case that shows the bridge-asset machinery did not disturb plain
   * APay. Sized against what the merchant holds after the checkout, the refund
   * and the top-up (5 000 000 − 2 000 000 + 1 000 000 = 4 000 000).
   */
  recipientAssetAmount: number;
  recipientMsat: number;
  /**
   * `/lightning_send`: the merchant pays the buyer's plain BUSDT invoice holding
   * only LNUSDT. Delivered out of the LSP's own side of the buyer's channel,
   * which is whatever the buyer spent through it and never got refunded — so
   * this has to stay well under (checkout - refund).
   */
  relayAssetAmount: number;
  relayMsat: number;
}

export const BRIDGE_ASSET: BridgeAssetConfig = {
  bridgeAssetId: BRIDGE_ASSET_ID,
  bridgeTicker: BRIDGE_TICKER,
  payoutAssetId: IFA_ASSET_ID,
  payoutTicker: IFA_TICKER,
  precision: IFA_PRECISION,
  paymentMsat: 3_000_000,
  // 5 units, not 0.5: paymentMsat is a flat 3 000 sat floor whatever the asset
  // amount, so a 0.5-unit checkout pays 6x its own value in sats and forces a
  // 640 000 sat channel to keep the asset and the sats in step. At 5 units the
  // sat cost is ~5% and a 75 000 sat channel covers 20 checkouts. See
  // CHANNEL_ASSET_AMOUNT in scripts/start-lsp-regtest.sh.
  paymentAssetAmount: 5_000_000,
  cartItem: `1× Bridge Asset checkout (${BRIDGE_TICKER} → ${IFA_TICKER})`,
  aFundUnits: 20_000_000,
  // Above rgb-lightning-node's RGB-channel floor of htlc_min_msat/1000*10 + 10
  // = 30 010 sat (ChannelsSection::open_rgb_min_sat), with room for anchors.
  // The buyer sends one 3 000 sat checkout out of its own side, so the rest of
  // this is headroom, not need.
  aChannelCapacitySat: 50_000,
  // 10 000 sat: covers the reserve plus several refunds at the 3 000 sat floor.
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
/**
 * On-chain receives need longer than a Lightning leg: the RGB handshake is
 * send → recipient acknowledges → sender broadcasts → confirmation, and every
 * hop waits on a counterparty's own refresh cycle.
 */
export const ONCHAIN_SETTLE_TIMEOUT_S = 300;
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
