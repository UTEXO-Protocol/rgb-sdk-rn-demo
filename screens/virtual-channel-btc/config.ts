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

// BTC-only virtual channel — no RGB asset involved.
// RLN minimum for vanilla channels is 5,506 sat (vs 30,010 for RGB); 100k gives headroom.
export const CHANNEL_CAPACITY_SAT = 100_000;
// RLN enforces a global invoice/HTLC minimum of 3,000,000 msat (INVOICE_MIN_MSAT),
// so even pure-BTC payments must be ≥ 3,000 sat.
// A→B sends 5,000 sat so B's spendable after the 1% channel reserve (1,000 sat)
// still covers the 3,000 sat reverse payment: 5,000 − 1,000 = 4,000 ≥ 3,000.
export const PAYMENT_MSAT_AB   = 5_000_000;
export const PAYMENT_MSAT_BA   = 3_000_000;
export const CHANNEL_TIMEOUT_S = 120;
export const PAYMENT_TIMEOUT_S = 60;
export const POLL_INTERVAL_S   = 2;
export const VIRTUAL_OPEN_MODE = 'trusted_no_broadcast';

export type Phase =
  | 'idle'
  | 'init'        // create + init + unlock Node A
  | 'init_b'      // create + init + unlock Node B
  | 'fund'        // sendToAddress + mine + createUtxos (both nodes)
  | 'connect'     // Node A connects to Node B as LDK peer
  | 'open_channel'// Node A opens virtual BTC channel to Node B
  | 'wait_channel'// poll until both nodes see channel as usable
  | 'pay_ab'      // Node B creates BTC invoice; Node A pays (A→B)
  | 'settle_ab'   // poll until A→B invoice Succeeded
  | 'pay_ba'      // Node A creates reverse BTC invoice; Node B pays (B→A)
  | 'settle_ba'   // poll until B→A invoice Succeeded
  | 'done'
  | 'error';

export interface LogEntry { time: string; msg: string; type: 'info' | 'success' | 'error' }

export const sleep  = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const satStr = (n: number) => n === 0 ? '0 sat' : `${(n / 1e8).toFixed(8)} BTC`;
export const short  = (s: string, n = 24) => (s || '').slice(0, n) + ((s || '').length > n ? '…' : '');
export const msatStr = (n: number) => `${Math.floor(n / 1000)} sat`;
