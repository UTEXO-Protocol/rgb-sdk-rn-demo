import { buildUtexoConfig } from '@/utils/env';

export const UNLOCK = buildUtexoConfig().unlockParams;

// Minimum RGB channel capacity in RLN is 30 010 sat (HTLC_MIN_MSAT/1000*10+10).
// send_begin creates a real PSBT output of capacity_sat — keep it just above minimum
// so it fits within the signet faucet budget.
export const CHANNEL_CAPACITY_SAT  = 31_000;
export const CHANNEL_ASSET_AMOUNT  = 200;
export const PAYMENT_MSAT          = 3_000_000;  // 3 000 sat, exactly HTLC_MIN_MSAT
export const PAYMENT_ASSET_AMOUNT  = 1;
export const VIRTUAL_OPEN_MODE     = 'trusted_no_broadcast';

// rgb-lib send_begin uses manually_selected_only — only colored UTXOs are inputs for the channel PSBT.
// Need: capacity_sat (31 000) + fees (~2 000) = ~33 000 sat in colored BTC.
// 5 UTXOs × 7 000 sat = 35 000 sat covers that.  60 000 sat faucet funds createUtxos + leftover.
export const FAUCET_AMOUNT_SAT = 60_000;

// Signet: no manual mining — blocks arrive every ~100 s
export const POLL_MS              = 20_000;
export const FUND_TIMEOUT_MS      = 15 * 60 * 1000;   // 15 min to see funded balance
export const UTXO_TIMEOUT_MS      = 15 * 60 * 1000;   // 15 min for createUtxos to confirm
export const ISSUE_TIMEOUT_MS     = 30 * 60 * 1000;   // 30 min for issuance to settle
export const CHANNEL_TIMEOUT_MS   = 30 * 60 * 1000;   // 30 min for virtual channel ready
export const PAYMENT_TIMEOUT_MS   =  5 * 60 * 1000;   //  5 min for payment settlement

export type Phase =
  | 'idle'
  | 'init'          // create + init + unlock Node A
  | 'init_b'        // create + init + unlock Node B
  | 'fund'          // faucet → both nodes, poll for settled balance
  | 'utxos'         // createUtxos (both), poll for spendable
  | 'issue'         // Node A issues RGB asset, poll settled
  | 'connect'       // Node A connects to Node B as LDK peer
  | 'open_channel'  // Node A opens virtual RGB channel to Node B
  | 'wait_channel'  // poll until both nodes see channel as usable
  | 'pay_ab'        // Node B creates invoice; Node A pays
  | 'settle_ab'     // poll until A→B invoice Succeeded
  | 'pay_ba'        // reverse: Node A invoices; Node B pays
  | 'settle_ba'     // poll until B→A invoice Succeeded
  | 'done'
  | 'error';

export interface LogEntry { time: string; msg: string; type: 'info' | 'success' | 'error' }

export const sleep  = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const satStr = (n: number) => n === 0 ? '0 sat' : `${(n / 1e8).toFixed(8)} BTC`;
export const short  = (s: string, n = 24) => (s || '').slice(0, n) + ((s || '').length > n ? '…' : '');
