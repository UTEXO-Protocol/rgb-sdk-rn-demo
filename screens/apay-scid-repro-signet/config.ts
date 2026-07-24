/**
 * APay · SCID-alias JIT reproduction — Signet (UTEXO).
 *
 * Same reproduction as screens/apay-scid-repro (regtest), but against the live
 * signet stack — the SAME production LSP the issue was reported on:
 *   - wallet.network = 'utexo'
 *   - createLsp() (no args) auto-discovers the LSP pubkey from GET /get_info and
 *     enables virtual channels (enableVirtualChannelsV0 + virtualPeerPubkeys=[LSP])
 *     — exactly the config in issue #49
 *   - no manual mining — fund / UTXO / settlement reached by polling for signet
 *     confirmations
 *   - OUR faucet RLN node (EXPO_PUBLIC_FAUCET_NODE_URL) funds BTC and pays the
 *     RGB invoice
 *
 * This is where #49 actually reproduces: if the signet LSP opens a PLAIN JIT
 * channel to the virtual-mode receiver, the receiver force-closes it with
 * `unsupported_scid_alias` and the RGB is stranded at the LSP.
 */
export {
  LSP_URL,
  FAUCET_NODE_URL,
  ASSET_ID,
  UNLOCK,
  PAYMENT_MSAT,
  PAYMENT_ASSET_AMOUNT,
  FAUCET_BTC_SAT,
  UTXO_NUM,
  FEE_RATE,
  POLL_MS,
  CHANNEL_TIMEOUT_MS,
  FUND_TIMEOUT_MS,
  SETTLE_TIMEOUT_MS,
} from '../apay-signet/config';

export { sleep, short } from '../apay/config';

export {
  PHASE_LABELS,
  PHASES,
  type ChannelSample,
  type LogEntry,
  type Phase,
  type ReproVerdict,
} from '../apay-scid-repro/config';

/** RGB amount the faucet pays into the invoice. */
export const FAUCET_PAY_AMOUNT = 1;
/** How long to watch delivery before concluding the RGB is stranded (signet is slow). */
export const DELIVER_WATCH_MS = 10 * 60 * 1000;
