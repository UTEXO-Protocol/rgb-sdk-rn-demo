import { Platform } from 'react-native';

const _bitcoinNodeHost = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
export const BITCOIN_NODE_ENDPOINT =
  process.env.BITCOIN_NODE_ENDPOINT ?? `http://${_bitcoinNodeHost}:5000/execute`;

async function postBitcoinNodeCommand(args: string) {
  const endpoints = [BITCOIN_NODE_ENDPOINT];
  if (BITCOIN_NODE_ENDPOINT.startsWith('http://')) {
    endpoints.push(BITCOIN_NODE_ENDPOINT.replace(/^http:\/\//, 'https://'));
  }

  const errors: string[] = [];
  for (const endpoint of endpoints) {
    try {
      const body = JSON.stringify({ args });
      // console.log(`[bitcoin-node]   fetch POST ${endpoint} body=${body}`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '(no body)');
        console.warn(`[bitcoin-node]   HTTP error body: ${text}`);
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      const json = await response.json();
      // console.log(`[bitcoin-node]   response json: ${JSON.stringify(json)}`);
      return json;
    } catch (e: any) {
      const msg = `${endpoint}: ${e?.message ?? String(e)}`;
      console.warn(`[bitcoin-node]   ✗ ${msg}`);
      errors.push(msg);
    }
  }

  const finalError = errors.length ? errors.join(' | ') : 'Unknown request error';
  console.error(`[bitcoin-node] ✗ all endpoints failed — args="${args}" errors: ${finalError}`);
  throw new Error(finalError);
}

function unwrapNodeResponse(data: any) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const statusText = typeof data.status === 'string' ? data.status.toLowerCase() : '';
    const errorText = typeof data.error === 'string' ? data.error.trim() : '';
    const outputText = typeof data.output === 'string' ? data.output.trim() : '';
    if (errorText || /^ERR:/i.test(outputText)) {
      console.error(`[bitcoin-node] unwrapNodeResponse error: ${errorText || outputText} raw=${JSON.stringify(data)}`);
      throw new Error(errorText || outputText);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'result')) {
      return data.result;
    }
    if (statusText === 'success' && outputText) {
      return outputText;
    }
  }
  return data;
}

export async function mine(numBlocks: number) {
  console.log(`[bitcoin-node] mine(${numBlocks})`);
  try {
    const raw = await postBitcoinNodeCommand(`mine ${numBlocks}`);
    const data = unwrapNodeResponse(raw);
    // console.log(`[bitcoin-node] mine(${numBlocks}) ✓ result=${JSON.stringify(data)}`);
    return data;
  } catch (error: any) {
    console.error(`[bitcoin-node] mine(${numBlocks}) ✗ ${error?.message ?? String(error)}`);
    throw new Error(`Unable to mine: ${error.message}`);
  }
}

export async function sendToAddress(address: string, amount: number) {
  console.log(`[bitcoin-node] sendToAddress(address="${address}", amount=${amount})`);
  try {
    const raw = await postBitcoinNodeCommand(`sendtoaddress ${address} ${amount}`);
    const txid = unwrapNodeResponse(raw);
    if (typeof txid !== 'string' || txid.trim().length === 0) {
      const msg = `Unexpected sendtoaddress response: ${JSON.stringify(raw)}`;
      console.error(`[bitcoin-node] sendToAddress ✗ ${msg}`);
      throw new Error(msg);
    }
    // console.log(`[bitcoin-node] sendToAddress ✓ txid=${txid}`);
    return txid;
  } catch (error: any) {
    console.error(`[bitcoin-node] sendToAddress(address="${address}", amount=${amount}) ✗ ${error?.message ?? String(error)}`);
    throw new Error(`Unable to send bitcoins: ${error.message}`);
  }
}

export async function sendToAddressUtexo(address: string, amountSat = 16900) {
  const faucetUrl = process.env.EXPO_PUBLIC_FAUCET_URL?.trim() ?? '';
  const faucetToken = process.env.EXPO_PUBLIC_FAUCET_BEARER_TOKEN?.trim() ?? '';
  if (!faucetUrl) throw new Error('EXPO_PUBLIC_FAUCET_URL not set');
  if (!faucetToken) throw new Error('EXPO_PUBLIC_FAUCET_BEARER_TOKEN not set');

  console.log(`[utexo-faucet] sendToAddressUtexo(address="${address}", amountSat=${amountSat})`);
  try {
    const response = await fetch(faucetUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${faucetToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountSat,
        address,
        fee_rate: 5,
        skip_sync: false,
      }),
      signal: (AbortSignal as any).timeout?.(30_000),
    });
    const text = await response.text();
    if (!response.ok) {
      // throw new Error(`HTTP ${response.status}: ${text}`);
    }
    console.log(`[utexo-faucet] sendToAddressUtexo ✓ response=${text}`);
    return text;
  } catch (error: any) {
    console.error(
      `[utexo-faucet] sendToAddressUtexo(address="${address}", amountSat=${amountSat}) ✗ ${error?.message ?? String(error)}`
    );
    throw new Error(`Unable to fund address via UTXEO faucet: ${error.message}`);
  }
}
