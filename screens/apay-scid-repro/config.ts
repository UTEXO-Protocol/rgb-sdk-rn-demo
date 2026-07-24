/**
 * APay · SCID-alias JIT reproduction (regtest) — config.
 *
 * Straightforward reproduction of UTEXO-Protocol/rgb-sdk-rn#49, mirroring the
 * exact steps from the issue report:
 *   1. receiveAsset  (receiver asks the LSP for inbound RGB)
 *   2. pay the RGB invoice through OUR faucet RLN node (external sender)
 *   3. the LSP delivers by opening a JIT channel to the receiver
 *
 * Wallet config is identical to the issue — virtual channels ON:
 *   enableVirtualChannelsV0: true
 *   virtualPeerPubkeys: [LSP]
 *   lspBaseUrl set, createLsp() before init()
 *
 * Root cause (rgb-lightning-node src/ldk.rs:2573-2628 + src/routes.rs:4118,4299):
 *   With enable_virtual_channels_v0 = true and a trusted peer, the receiver
 *   ACCEPTS an inbound channel only if its channel_type supports scid_privacy;
 *   otherwise it force-closes with `unsupported_scid_alias`. The opener only
 *   sets scid_privacy when it opens with virtual_open_mode="trusted_no_broadcast".
 *   So #49 is an OPEN-MODE MISMATCH: the LSP opened a PLAIN channel to a
 *   receiver configured to accept only virtual channels → force-close → the
 *   RGB is stranded at the LSP.
 *
 * What to expect on THIS stack:
 *   The regtest LSP is started with DEFAULT_VIRTUAL_OPEN_MODE="trusted_no_broadcast"
 *   (scripts/start-lsp-regtest.sh), so it opens VIRTUAL channels — the delivery
 *   succeeds and the flow reports `not-reproduced`. The flow only goes red
 *   (`reproduced`) against an LSP that opens PLAIN channels (e.g. with
 *   DEFAULT_VIRTUAL_OPEN_MODE empty). Either way the report states, with
 *   evidence, exactly what the LSP did.
 *
 * Infra: the same regtest stack as screens/lsp-regtest —
 *   ./scripts/start-lsp-regtest.sh
 */
export {
  host,
  LSP_URL,
  LSP_DAEMON_URL,
  FAUCET_DAEMON_URL,
  ASSET_ID,
  LSP_LDK_PORT,
  LSP_PEER_PUBKEY_DEFAULT,
  REGTEST_UNLOCK,
  PAYMENT_MSAT,
  PAYMENT_ASSET_AMOUNT,
  FAUCET_PAY_AMOUNT,
  sleep,
  short,
} from '../lsp-regtest/config';

/** Wait for the faucet RGB → LSP delivery (faucet Send + LSP ReceiveBlind). */
export const RGB_SETTLE_S = 120;
/** Wait to see whether the LSP ever delivers the RGB to the receiver. */
export const DELIVER_WATCH_S = 120;
/** Poll cadence for every watch loop. */
export const POLL_INTERVAL_MS = 3_000;

export interface LogEntry {
  time: string;
  msg: string;
  type: 'info' | 'success' | 'error';
}

/** One snapshot of a channel to the LSP peer, captured during the watch loops. */
export interface ChannelSample {
  atMs: number;
  channelId: string;
  status: string;        // 'Opening' | 'Opened' | 'Closing' | '?'
  isUsable: boolean;
  ready: boolean;
  capacitySat: number;
}

export type ReproVerdict =
  | 'reproduced'     // RGB settled at LSP but never delivered → JIT channel force-closed
  | 'not-reproduced' // RGB delivered to the receiver → the LSP opened a virtual channel
  | 'inconclusive'   // RGB never even reached the LSP → infra problem, not #49
  | 'pending';

export type Phase =
  | 'idle'
  | 'preflight'
  | 'init'
  | 'fund'
  | 'utxos'
  | 'connect'
  | 'receive'      // receiver requests inbound RGB (lightning_receive)
  | 'faucet_send'  // OUR faucet node pays the RGB invoice (sends to the LSP)
  | 'lsp_settle'   // RGB settles AT THE LSP
  | 'deliver'      // watch whether the LSP can deliver it over a JIT channel
  | 'report'
  | 'done'
  | 'error';

export const PHASES: Phase[] = [
  'init', 'fund', 'utxos', 'connect', 'receive', 'faucet_send', 'lsp_settle', 'deliver', 'report', 'done',
];

export const PHASE_LABELS: Record<Phase, string> = {
  idle: 'Idle',
  preflight: 'Preflight',
  init: 'Init',
  fund: 'Fund',
  utxos: 'UTXOs',
  connect: 'Connect',
  receive: 'Receive',
  faucet_send: 'Faucet',
  lsp_settle: 'LSP settle',
  deliver: 'Deliver',
  report: 'Report',
  done: 'Done',
  error: 'Error',
};
