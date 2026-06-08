import { Platform } from 'react-native';

// iOS simulator uses Mac localhost; Android emulator routes to Mac via 10.0.2.2.
export const host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

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

// Matches test_virtual_channel_asset_payment.py defaults
export const CHANNEL_CAPACITY_SAT     = 100_000;
export const CHANNEL_ASSET_AMOUNT     = 200;
export const PAYMENT_MSAT             = 3_000_000;
export const PAYMENT_ASSET_AMOUNT     = 1;
export const CHANNEL_TIMEOUT_S        = 120;
export const PAYMENT_TIMEOUT_S        = 60;
export const POLL_INTERVAL_S          = 2;
export const VIRTUAL_OPEN_MODE        = 'trusted_no_broadcast';

export type Phase =
  | 'idle'
  | 'init'        // create + init + unlock Node A
  | 'init_b'      // create + init + unlock Node B
  | 'fund'        // sendToAddress + mine + createUtxos (both nodes)
  | 'issue'       // Node A issues RGB asset (NIA)
  | 'connect'     // Node A connects to Node B as LDK peer
  | 'open_channel'// Node A opens virtual RGB channel to Node B
  | 'wait_channel'// poll until both nodes see channel as usable
  | 'pay_ab'      // Node B creates invoice; Node A pays (A→B)
  | 'settle_ab'   // poll until A→B invoice Succeeded
  | 'pay_ba'      // Node A creates reverse invoice; Node B pays (B→A)
  | 'settle_ba'   // poll until B→A invoice Succeeded
  | 'done'
  | 'error';

export interface LogEntry { time: string; msg: string; type: 'info' | 'success' | 'error' }

export const sleep  = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const satStr = (n: number) => n === 0 ? '0 sat' : `${(n / 1e8).toFixed(8)} BTC`;
export const short  = (s: string, n = 24) => (s || '').slice(0, n) + ((s || '').length > n ? '…' : '');
