/**
 * Signet RLN-node REST helpers (NOT the SDK).
 *
 * The faucet node funds the app wallets with BTC and plays the external RGB
 * sender for the buyer top-up.
 */
import { FAUCET_NODE_URL } from './config';

async function nodePost(base: string, path: string, body: object = {}): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// rgb-lib needs a double refresh to advance both legs of a transfer.
async function refreshTransfers(base: string): Promise<void> {
  await nodePost(base, '/refreshtransfers', { filter: [], skip_sync: false });
  await nodePost(base, '/refreshtransfers', { filter: [], skip_sync: false });
}

export const faucet = {
  btcBalance:       ()                       => nodePost(FAUCET_NODE_URL, '/btcbalance',       { skip_sync: false }),
  address:          ()                       => nodePost(FAUCET_NODE_URL, '/address',          {}),
  sendBtc:          (address: string, amount: number, feeRate: number) =>
    nodePost(FAUCET_NODE_URL, '/sendbtc', { address, amount, fee_rate: feeRate, skip_sync: false }),
  assetBalance:     (assetId: string)        => nodePost(FAUCET_NODE_URL, '/assetbalance',     { asset_id: assetId }),
  decodeRgbInvoice: (invoice: string)        => nodePost(FAUCET_NODE_URL, '/decodergbinvoice', { invoice }),
  sendRgb:          (body: object)           => nodePost(FAUCET_NODE_URL, '/sendrgb',           body),
  listTransfers:    (assetId: string)        => nodePost(FAUCET_NODE_URL, '/listtransfers',     { asset_id: assetId }),
  refresh:          ()                       => refreshTransfers(FAUCET_NODE_URL),
};
