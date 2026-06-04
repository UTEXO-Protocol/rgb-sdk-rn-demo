import { Platform } from 'react-native';

// iOS simulator shares Mac's network — 127.0.0.1 is Mac localhost.
// Android emulator reaches Mac via 10.0.2.2.
export const host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

// URLs always computed from host — never from env vars (127.0.0.1 breaks on Android emulator).
export const LSP_URL           = `http://${host}:8080`;
export const LSP_DAEMON_URL    = `http://${host}:3005`;
export const FAUCET_DAEMON_URL = `http://${host}:3008`;

// Non-URL values from env (written by start-lsp-regtest.sh).
export const ASSET_ID          = process.env.EXPO_PUBLIC_LSP_REGTEST_ASSET_ID ?? '';
export const LSP_LDK_PORT      = Number(process.env.EXPO_PUBLIC_LSP_REGTEST_LDK_PORT ?? '9737');
export const LSP_PEER_PUBKEY_DEFAULT = process.env.EXPO_PUBLIC_LSP_REGTEST_PEER_PUBKEY ?? '';

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

// Matches e2e config values from config.py
export const PAYMENT_MSAT         = 3_000_000;
export const PAYMENT_ASSET_AMOUNT = 1;
export const FAUCET_PAY_AMOUNT    = 1;
export const CHANNEL_TIMEOUT_S    = 120;
export const PAYMENT_TIMEOUT_S    = 60;
export const POLL_INTERVAL_S      = 2;

export type Phase =
  | 'idle' | 'preflight' | 'init' | 'fund' | 'utxos'
  | 'channel' | 'b_init' | 'b_channel'
  | 'lsp_flow' | 'rgb_send' | 'settle'
  | 'p2_pay' | 'p2_settle'
  | 'done' | 'error';

export interface LogEntry { time: string; msg: string; type: 'info' | 'success' | 'error' }

export const sleep  = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const satStr = (n: number) => n === 0 ? '0 sat' : `${(n / 1e8).toFixed(8)} BTC`;
export const short  = (s: string, n = 24) => (s || '').slice(0, n) + ((s || '').length > n ? '…' : '');
