import { Platform } from 'react-native';

export const host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

export const LSP_URL        = `http://${host}:8080`;
export const LSP_DAEMON_URL = `http://${host}:3005`;

export const ASSET_ID    = process.env.EXPO_PUBLIC_LSP_REGTEST_ASSET_ID ?? '';
export const LSP_LDK_PORT = Number(process.env.EXPO_PUBLIC_LSP_REGTEST_LDK_PORT ?? '9737');

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
export const CHANNEL_TIMEOUT_S    = 180;
export const SETTLE_TIMEOUT_S     = 120;
export const POLL_INTERVAL_MS     = 3_000;
export const MERCHANT_KEEPALIVE_MS = 15_000;

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
