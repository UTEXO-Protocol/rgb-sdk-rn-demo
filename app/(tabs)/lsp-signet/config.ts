import { buildUtexoConfig } from '@/utils/env';

export const LSP_URL      = process.env.EXPO_PUBLIC_LSP_URL?.trim()             || 'https://lsp-signet.utexo.com';
export const FAUCET_URL   = process.env.EXPO_PUBLIC_FAUCET_URL?.trim()          || '';
export const FAUCET_TOKEN = process.env.EXPO_PUBLIC_FAUCET_BEARER_TOKEN?.trim() || '';

export const UNLOCK = buildUtexoConfig().unlockParams;

export const PAYMENT_MSAT         = 3_000_000;
export const PAYMENT_ASSET_AMOUNT = 100;
export const ASSET_TOTAL_SUPPLY   = 1_000;
export const FAUCET_AMOUNT_SAT    = 16_900;

// Signet: no mining — blocks arrive naturally every ~100s
export const POLL_MS            = 20_000;
export const CHANNEL_TIMEOUT_MS = 30 * 60 * 1000;   // 30 min — 6 confirmations
export const FUND_TIMEOUT_MS    = 15 * 60 * 1000;
export const SETTLE_TIMEOUT_MS  = 30 * 60 * 1000;

export type Phase =
  | 'idle' | 'init' | 'fund' | 'utxos' | 'asset'
  | 'channel' | 'b_channel'
  | 'lsp_flow' | 'rgb_send' | 'settle'
  | 'p2_pay' | 'p2_settle'
  | 'done' | 'error';

export interface LogEntry { time: string; msg: string; type: 'info' | 'success' | 'error' }

export const sleep  = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const satStr = (n: number) => n === 0 ? '0 sat' : `${(n / 1e8).toFixed(8)} BTC`;
export const short  = (s: string, n = 24) => (s || '').slice(0, n) + ((s || '').length > n ? '…' : '');
