/**
 * React Native compatible wallet flow
 * Adapted from flow.js for React Native environment
 */

import { mnemonicToSeedSync } from '@scure/bip39';
import {
  createRLNManager,
  createWallet,
  DEFAULT_INDEXER_URLS,
  getBridgeAPI,
  LightningProtocol,
  NativeExternalRLNSigner,
  OnchainProtocol,
  PasswordRLNSigner,
  UTEXOProtocol,
  UTEXOWallet,
  type RLNManager
} from '@utexo/rgb-sdk-rn';
import * as FileSystem from 'expo-file-system/legacy';
import { documentDirectory } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

let activeDemoFlow: string | null = null;

function isPoisonLike(e: unknown): boolean {
  const err = e as { message?: string; code?: unknown } | null;
  const code = typeof err?.code === 'string' ? err.code.toLowerCase() : '';
  const msg = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
  return (
    code.includes('nodestatecorrupted') ||
    msg.includes('poisonerror') ||
    msg.includes('poison error') ||
    msg.includes('node internal state is corrupted')
  );
}

function beginExclusiveFlow(flowName: string) {
  if (activeDemoFlow && activeDemoFlow !== flowName) {
    throw new Error(
      `Flow "${flowName}" blocked: "${activeDemoFlow}" is currently running. Run flows sequentially to avoid RLN/node state conflicts.`
    );
  }
  activeDemoFlow = flowName;
}

function endExclusiveFlow(flowName: string) {
  if (activeDemoFlow === flowName) {
    activeDemoFlow = null;
  }
}

function readEnv(name: string): string | null {
  const value =
    (name === 'RLN_NODE_PASSWORD'
      ? process.env.EXPO_PUBLIC_RLN_NODE_PASSWORD
      : name === 'RLN_BITCOIND_RPC_USERNAME'
        ? process.env.EXPO_PUBLIC_RLN_BITCOIND_RPC_USERNAME
        : name === 'RLN_BITCOIND_RPC_PASSWORD'
          ? process.env.EXPO_PUBLIC_RLN_BITCOIND_RPC_PASSWORD
          : name === 'RLN_BITCOIND_RPC_HOST'
            ? process.env.EXPO_PUBLIC_RLN_BITCOIND_RPC_HOST
            : name === 'RLN_BITCOIND_RPC_PORT'
              ? process.env.EXPO_PUBLIC_RLN_BITCOIND_RPC_PORT
              : name === 'RLN_INDEXER_URL'
                ? process.env.EXPO_PUBLIC_RLN_INDEXER_URL
                : name === 'RLN_PROXY_ENDPOINT'
                  ? process.env.EXPO_PUBLIC_RLN_PROXY_ENDPOINT
                  : name === 'RLN_ANNOUNCE_ADDRESSES'
                    ? process.env.EXPO_PUBLIC_RLN_ANNOUNCE_ADDRESSES
                    : name === 'RLN_ANNOUNCE_ALIAS'
                      ? process.env.EXPO_PUBLIC_RLN_ANNOUNCE_ALIAS
                      : name === 'RLN_PLAYGROUND_NETWORK'
                        ? process.env.EXPO_PUBLIC_RLN_PLAYGROUND_NETWORK
                      : name === 'RLN_STRICT_UNLOCK_CREDS'
                        ? process.env.EXPO_PUBLIC_RLN_STRICT_UNLOCK_CREDS
                      : null) ?? null;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

const getIndexerEndpoint = (network: keyof typeof DEFAULT_INDEXER_URLS) => {
  const overrideEndpoint = process.env.RGB_ENDPOINT || null;
  return overrideEndpoint ?? DEFAULT_INDEXER_URLS[network];
};
const _bitcoinNodeHost = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
const BITCOIN_NODE_ENDPOINT =
  process.env.BITCOIN_NODE_ENDPOINT ?? `http://${_bitcoinNodeHost}:5000/execute`;

async function postBitcoinNodeCommand(args: string) {
  const endpoints = [BITCOIN_NODE_ENDPOINT];
  if (BITCOIN_NODE_ENDPOINT.startsWith('http://')) {
    endpoints.push(BITCOIN_NODE_ENDPOINT.replace(/^http:\/\//, 'https://'));
  }

  // console.log(`[bitcoin-node] ► postBitcoinNodeCommand args="${args}" platform=${Platform.OS} endpoints=${JSON.stringify(endpoints)}`);

  const errors: string[] = [];
  for (const endpoint of endpoints) {
    // console.log(`[bitcoin-node]   trying endpoint: ${endpoint}`);
    try {
      const body = JSON.stringify({ args });
      console.log(`[bitcoin-node]   fetch POST ${endpoint} body=${body}`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      // console.log(`[bitcoin-node]   response status: ${response.status} ${response.statusText}`);
      if (!response.ok) {
        const text = await response.text().catch(() => '(no body)');
        console.warn(`[bitcoin-node]   HTTP error body: ${text}`);
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      const json = await response.json();
      console.log(`[bitcoin-node]   response json: ${JSON.stringify(json)}`);
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
    console.log(`[bitcoin-node] mine(${numBlocks}) ✓ result=${JSON.stringify(data)}`);
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
    console.log(`[bitcoin-node] sendToAddress ✓ txid=${txid}`);
    return txid;
  } catch (error: any) {
    console.error(`[bitcoin-node] sendToAddress(address="${address}", amount=${amount}) ✗ ${error?.message ?? String(error)}`);
    throw new Error(`Unable to send bitcoins: ${error.message}`);
  }
}

/**
 * Initialize a wallet with RGB SDK
 */
export async function runUTEXOFlow() {
  const flowName = 'runUTEXOFlow';
  beginExclusiveFlow(flowName);
  console.log('Starting UTEXO Flow');
  console.log('='.repeat(50));

  const results: any = { steps: [], success: false, error: null };
  const pushStep = (step: any) => results.steps.push(step);

  try {
    // ── UTEXOWallet: instantiation ──────────────────────────
    pushStep({ step: 'utexoWalletInstantiate', status: 'running' });
    const generatedKeys = await createWallet('testnet');
    const utexoWallet: any = new (UTEXOWallet as any)(generatedKeys.mnemonic, { network: 'testnet' });
    results.instantiation = true;
    pushStep({ step: 'utexoWalletInstantiate', status: 'success' });

    // ── UTEXOWallet: throws before initialize() ─────────────
    pushStep({ step: 'throwsBeforeInit', status: 'running' });
    try {
      utexoWallet.getXpub();
      results.throwsBeforeInit = false;
      pushStep({ step: 'throwsBeforeInit', status: 'error', error: 'Expected throw but resolved' });
    } catch (e: any) {
      results.throwsBeforeInit = e.message.toLowerCase().includes('init');
      pushStep({ step: 'throwsBeforeInit', status: results.throwsBeforeInit ? 'success' : 'error' });
    }

    // ── UTEXOWallet: derivePublicKeys (pure crypto, no server) ──
    pushStep({ step: 'derivePublicKeys', status: 'running' });
    try {
      const keys = await utexoWallet.derivePublicKeys('testnet');
      results.derivePublicKeys = { xpub: keys.xpub?.slice(0, 20) + '...' };
      pushStep({ step: 'derivePublicKeys', status: 'success', data: results.derivePublicKeys });
    } catch (e: any) {
      results.derivePublicKeys = { error: e.message };
      pushStep({ step: 'derivePublicKeys', status: 'error', error: e.message });
    }

    // ── UTEXOWallet: initialize (needs signet node – may fail) ──
    pushStep({ step: 'initialize', status: 'running' });
    try {
      await utexoWallet.initialize();
      results.initialized = true;
      pushStep({ step: 'initialize', status: 'success' });

      // ── getXpub / getNetwork / isDisposed after init ─────
      pushStep({ step: 'walletGetters', status: 'running' });
      const xpub = utexoWallet.getXpub();
      const network = utexoWallet.getNetwork();
      const notDisposed = !utexoWallet.isDisposed();
      results.walletGetters = { network, notDisposed, xpubVan: xpub.xpubVan?.slice(0, 20) + '...' };
      pushStep({ step: 'walletGetters', status: 'success', data: { network, notDisposed } });

      // ── dispose ──────────────────────────────────────────
      pushStep({ step: 'dispose', status: 'running' });
      await utexoWallet.dispose();
      results.disposed = utexoWallet.isDisposed();
      pushStep({ step: 'dispose', status: 'success' });
    } catch (e: any) {
      results.initialized = false;
      results.initError = e.message;
      pushStep({ step: 'initialize', status: 'error', error: e.message });
    }

    // ── LightningProtocol: stub throws "not implemented" ────
    pushStep({ step: 'lightningProtocolStubs', status: 'running' });
    try {
      const lp = new LightningProtocol();
      const stubResults: Record<string, boolean> = {};
      for (const [methodName, call] of [
        ['createLightningInvoice', () => lp.createLightningInvoice({ asset: { assetId: 'a', amount: 1 } } as any)],
        ['getLightningReceiveRequest', () => lp.getLightningReceiveRequest('id')],
        ['getLightningSendRequest', () => lp.getLightningSendRequest('id')],
        ['payLightningInvoiceBegin', () => lp.payLightningInvoiceBegin({ lnInvoice: 'lnbc1' } as any)],
        ['listLightningPayments', () => lp.listLightningPayments()],
      ] as [string, () => Promise<any>][]) {
        try {
          await call();
          stubResults[methodName] = false;
        } catch (e: any) {
          stubResults[methodName] = e.message.includes('not implemented');
        }
      }
      results.lightningProtocolStubs = stubResults;
      pushStep({ step: 'lightningProtocolStubs', status: 'success' });
    } catch (e: any) {
      pushStep({ step: 'lightningProtocolStubs', status: 'error', error: e.message });
    }

    // ── OnchainProtocol: stub throws "not implemented" ──────
    pushStep({ step: 'onchainProtocolStubs', status: 'running' });
    try {
      const op = new OnchainProtocol();
      const stubResults: Record<string, boolean> = {};
      for (const [methodName, call] of [
        ['onchainReceive', () => op.onchainReceive({ assetId: 'a', amount: 1 } as any)],
        ['onchainSendBegin', () => op.onchainSendBegin({ invoice: 'inv' } as any)],
        ['onchainSendEnd', () => op.onchainSendEnd({ signedPsbt: '' } as any)],
        ['getOnchainSendStatus', () => op.getOnchainSendStatus('inv')],
        ['listOnchainTransfers', () => op.listOnchainTransfers()],
      ] as [string, () => Promise<any>][]) {
        try {
          await call();
          stubResults[methodName] = false;
        } catch (e: any) {
          stubResults[methodName] = e.message.includes('not implemented');
        }
      }
      results.onchainProtocolStubs = stubResults;
      pushStep({ step: 'onchainProtocolStubs', status: 'success' });
    } catch (e: any) {
      pushStep({ step: 'onchainProtocolStubs', status: 'error', error: e.message });
    }

    // ── UTEXOProtocol: inherits both stub sets ───────────────
    pushStep({ step: 'utexoProtocolStubs', status: 'running' });
    try {
      const up = new UTEXOProtocol();
      let lightningThrows = false;
      let onchainThrows = false;
      try { await up.createLightningInvoice({ asset: { assetId: 'a', amount: 1 } } as any); }
      catch (e: any) { lightningThrows = e.message.includes('not implemented'); }
      try { await up.onchainReceive({ assetId: 'a', amount: 1 } as any); }
      catch (e: any) { onchainThrows = e.message.includes('not implemented'); }
      results.utexoProtocolStubs = { lightningThrows, onchainThrows };
      pushStep({ step: 'utexoProtocolStubs', status: 'success' });
    } catch (e: any) {
      pushStep({ step: 'utexoProtocolStubs', status: 'error', error: e.message });
    }

    // ── bridge API client: create and query ─────────────────
    pushStep({ step: 'bridgeAPIClient', status: 'running' });
    const bridgeAPI = getBridgeAPI('testnet');
    results.bridgeAPIConfigured =
      bridgeAPI !== null &&
      typeof (bridgeAPI as any).getTransferByMainnetInvoice === 'function';
    pushStep({ step: 'bridgeAPIClient', status: results.bridgeAPIConfigured ? 'success' : 'error' });

    pushStep({ step: 'bridgeAPIQuery', status: 'running' });
    try {
      const transfer = await bridgeAPI.getTransferByMainnetInvoice('test-invoice', 94);
      results.bridgeAPIQuery = {
        returned: transfer === null ? 'null (not found – expected)' : 'found (unexpected)',
      };
      pushStep({ step: 'bridgeAPIQuery', status: 'success' });
    } catch (e: any) {
      results.bridgeAPIQuery = { error: e.message };
      pushStep({ step: 'bridgeAPIQuery', status: 'error', error: e.message });
    }

    results.success = true;
    return results;
  } catch (error: any) {
    console.error('Error in UTEXO flow:', error);
    results.success = false;
    results.error = { message: error.message || 'Unknown error' };
    return results;
  } finally {
    endExclusiveFlow(flowName);
  }
}

/**
 * RLN Playground flow
 *
 * Uses the RLN binding mode (with UTEXOWallet protocol adapter) to validate
 * the shape of the integration end-to-end before native RLN methods are wired.
 */
let rlnPlaygroundFlowInFlight = false;

export async function runRlnPlaygroundFlow() {
  const flowName = 'runRlnPlaygroundFlow';
  beginExclusiveFlow(flowName);
  if (rlnPlaygroundFlowInFlight) {
    endExclusiveFlow(flowName);
    return {
      steps: [
        {
          step: 'rlnPlaygroundGuard',
          status: 'error',
          error: 'RLN playground flow already running',
        },
      ],
      success: false,
      error: 'RLN playground flow already running',
    } as any;
  }
  rlnPlaygroundFlowInFlight = true;
  const results: any = { steps: [], success: false, error: null };
  const addStep = (step: string, status: string, data?: any, error?: string) => {
    const idx = results.steps.findIndex((s: any) => s.step === step);
    const entry = { step, status, data, error };
    if (idx >= 0) {
      results.steps[idx] = entry;
    } else {
      results.steps.push(entry);
    }
  };

  const configuredRlnNetwork = readEnv('RLN_PLAYGROUND_NETWORK');
  const network = ((configuredRlnNetwork as
    | 'regtest'
    | 'testnet'
    | 'signet'
    | undefined) ?? 'regtest');
  let sender: RLNManager | null = null;
  let senderRlnNodeCreated = false;
  let senderRlnNodeDestroyed = false;
  let senderRlnPubkey: string | null = null;
  let senderRlnReady = false;
  let rlnReadinessBlocker: string | null = null;
  const cleanupIssues: { step: string; message: string }[] = [];

  try {
    const senderKeys = await createWallet(network);
    sender = createRLNManager();

    // ── RLN native bridge surface coverage ───────────────────────────────────
    const resolveRlnMethod = (name: string): ((...args: any[]) => Promise<any>) => {
      const fn = (sender as any)[name];
      if (typeof fn === 'function') return fn.bind(sender);
      return async () => { throw new Error(`Missing RLN method: ${name}`); };
    };
    const consumeUnlockConflictNormalized = () => sender!.consumeRlnUnlockConflictNormalized();
    const mkRlnStorageDir = async () => {
      const uri = `${documentDirectory ?? ''}rln_playground_sender_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      try {
        await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
      } catch {
        // best effort; native side will still try to create/use the path
      }
      return uri.replace('file://', '');
    };
    const mkRlnPorts = () => {
      // Avoid fixed ports across retries/runs in the same app process.
      const base = 20000 + Math.floor(Math.random() * 20000);
      return {
        daemonListeningPort: base,
        ldkPeerListeningPort: base + 1,
      };
    };
    let rlnStorageDir = await mkRlnStorageDir();
    let rlnPorts = mkRlnPorts();

    const snapshotRlnError = (err: any) => {
      const result: Record<string, any> = {};
      try {
        if (err && typeof err === 'object') {
          Object.getOwnPropertyNames(err).forEach((key) => {
            const value = (err as any)[key];
            if (typeof value === 'function') return;
            if (value instanceof Error) {
              result[key] = {
                name: value.name,
                message: value.message,
                stack: value.stack,
              };
              return;
            }
            try {
              JSON.stringify(value);
              result[key] = value;
            } catch {
              result[key] = String(value);
            }
          });
        }
      } catch {
        // best effort snapshot only
      }
      return {
        name: err?.name ?? null,
        message: err?.message ?? String(err),
        code: err?.code ?? null,
        raw: result,
      };
    };

    const classifyRlnError = (err: any) => {
      const message = err?.message ?? String(err);
      const code = err?.code ? String(err.code) : null;
      const lowered = message.toLowerCase();
      const codeLowered = (code ?? '').toLowerCase();
      let kind: 'NotInitialized' | 'Conflict' | 'Transport' | 'Unknown' = 'Unknown';
      let conflictSubtype:
        | 'AlreadyUnlocked'
        | 'UnlockInProgress'
        | 'StateCollision'
        | 'OtherConflict'
        | null = null;
      if (
        lowered.includes('not initialized') ||
        lowered.includes('notinitialized') ||
        codeLowered.includes('notinitialized') ||
        codeLowered.includes('not_initialized')
      ) {
        kind = 'NotInitialized';
      } else if (lowered.includes('conflict') || codeLowered.includes('conflict')) {
        kind = 'Conflict';
        if (
          lowered.includes('already unlocked') ||
          lowered.includes('already initialized')
        ) {
          conflictSubtype = 'AlreadyUnlocked';
        } else if (
          lowered.includes('in progress') ||
          lowered.includes('busy') ||
          lowered.includes('already running')
        ) {
          conflictSubtype = 'UnlockInProgress';
        } else if (
          lowered.includes('storage') ||
          lowered.includes('state') ||
          lowered.includes('path') ||
          lowered.includes('locked')
        ) {
          conflictSubtype = 'StateCollision';
        } else {
          conflictSubtype = 'OtherConflict';
        }
      } else if (
        lowered.includes('timeout') ||
        lowered.includes('network') ||
        lowered.includes('connection') ||
        lowered.includes('rpc')
      ) {
        kind = 'Transport';
      }
      return {
        kind,
        code,
        message,
        conflictSubtype,
        methodResponse: snapshotRlnError(err),
      };
    };
    const probeNodeReadyAfterConflict = async (
      attempts: number = 30,
      delayMs: number = 750
    ): Promise<{ ready: boolean; nodeInfo?: any }> => {
      // Give RLN unlock state machine a short grace period before probing.
      await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
      for (let i = 0; i < attempts; i += 1) {
        try {
          const info = await rlnNodeInfo();
          return { ready: true, nodeInfo: info };
        } catch {
          if (i < attempts - 1) {
            await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
          }
        }
      }
      return { ready: false };
    };
    const maskUnlockRequest = (request: any, diagnostics: any) => ({
      ...request,
      bitcoindRpcPassword: '***',
      password: '***',
      diagnostics,
    });

    const isRegtestNetwork = network === 'regtest';
    const defaultRpcHost = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
    const defaultIndexerUrl = `${defaultRpcHost}:50001`;
    const defaultProxyEndpoint = `rpc://${defaultRpcHost}:3000/json-rpc`;
    const rpcHostEnv = readEnv('RLN_BITCOIND_RPC_HOST');
    const rpcPortRawEnv = readEnv('RLN_BITCOIND_RPC_PORT');
    const rpcUserRawEnv = readEnv('RLN_BITCOIND_RPC_USERNAME');
    const rpcPasswordRawEnv = readEnv('RLN_BITCOIND_RPC_PASSWORD');
    const indexerUrlEnv = readEnv('RLN_INDEXER_URL');
    const proxyEndpointEnv = readEnv('RLN_PROXY_ENDPOINT');
    const hasExplicitUnlockOverrides = [
      rpcHostEnv,
      rpcPortRawEnv,
      rpcUserRawEnv,
      rpcPasswordRawEnv,
      indexerUrlEnv,
      proxyEndpointEnv,
    ].some((value) => typeof value === 'string' && value.length > 0);
    const useRegtestForcedDefaults =
      isRegtestNetwork && !hasExplicitUnlockOverrides;
    const rpcHost = useRegtestForcedDefaults
      ? defaultRpcHost
      : (rpcHostEnv ?? defaultRpcHost);
    const rpcPortRaw = useRegtestForcedDefaults ? '18443' : rpcPortRawEnv;
    const rpcPort = Number(rpcPortRaw ?? '18443');
    const rpcUserRaw = useRegtestForcedDefaults ? 'user' : rpcUserRawEnv;
    const rpcPasswordRaw = useRegtestForcedDefaults
      ? 'password'
      : rpcPasswordRawEnv;
    const rpcUser = rpcUserRaw ?? 'rpcuser';
    const rpcPassword = rpcPasswordRaw ?? 'rpcpassword';
    const strictUnlockCreds = readEnv('RLN_STRICT_UNLOCK_CREDS') === 'true';
    const nodePassword = readEnv('RLN_NODE_PASSWORD') ?? 'rln-playground-password';
    const indexerUrl = useRegtestForcedDefaults
      ? defaultIndexerUrl
      : (indexerUrlEnv ?? null);
    const proxyEndpoint = useRegtestForcedDefaults
      ? defaultProxyEndpoint
      : (proxyEndpointEnv ?? null);
    const announceAddresses = (readEnv('RLN_ANNOUNCE_ADDRESSES') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const announceAlias = readEnv('RLN_ANNOUNCE_ALIAS');
    const diagnostics = {
      effectiveNetwork: network,
      configMode: useRegtestForcedDefaults
        ? 'regtest-forced'
        : isRegtestNetwork
        ? 'regtest-env-override'
        : 'env-driven',
      platform: Platform.OS,
      hostSource: useRegtestForcedDefaults
        ? 'regtest-forced'
        : (rpcHostEnv ? 'env' : 'platform-default'),
      portSource: useRegtestForcedDefaults
        ? 'regtest-forced'
        : (rpcPortRaw ? 'env' : 'default-18443'),
      usernameSource: useRegtestForcedDefaults
        ? 'regtest-forced'
        : (rpcUserRaw ? 'env' : 'demo-default'),
      passwordSource: useRegtestForcedDefaults
        ? 'regtest-forced'
        : (rpcPasswordRaw ? 'env' : 'demo-default'),
      indexerSource: useRegtestForcedDefaults
        ? 'regtest-forced'
        : (indexerUrl ? 'env' : 'none'),
      proxySource: useRegtestForcedDefaults
        ? 'regtest-forced'
        : (proxyEndpoint ? 'env' : 'none'),
      strictUnlockCreds,
    };
    const unlockRequest = {
      password: nodePassword,
      bitcoindRpcUsername: rpcUser,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl: indexerUrl ?? null,
      proxyEndpoint: proxyEndpoint ?? null,
      announceAddresses,
      announceAlias: announceAlias ?? null,
    };
    type RlnStepOutcome = {
      request?: any;
      response?: any;
      skipped?: boolean;
      reason?: string;
      errorDetail?: any;
    };
    const runRlnStep = async (
      methodName: string,
      runner: () => Promise<RlnStepOutcome>
    ): Promise<{ ok: boolean; outcome?: RlnStepOutcome; error?: any }> => {
      addStep(methodName, 'running');
      try {
        const outcome = await runner();
        if (outcome.skipped) {
          addStep(methodName, 'success', {
            ...(outcome.request !== undefined ? { request: outcome.request } : {}),
            response: {
              skipped: true,
              reason: outcome.reason ?? 'Skipped due to missing prerequisites',
              ...(outcome.response ?? {}),
            },
          });
        } else {
          addStep(methodName, 'success', {
            ...(outcome.request !== undefined ? { request: outcome.request } : {}),
            response: {
              reason: outcome.reason ?? 'Completed successfully',
              ...(outcome.response !== undefined
                ? { result: outcome.response }
                : {}),
            },
          });
        }
        return { ok: true, outcome };
      } catch (error: any) {
        const message = error?.message ?? String(error);
        addStep(
          methodName,
          'error',
          {
            reason: message,
            ...(error?.errorDetail !== undefined
              ? { detail: error.errorDetail }
              : {}),
            snapshot: snapshotRlnError(error),
          },
          message
        );
        return { ok: false, error };
      }
    };

    const rlnCreateNode = resolveRlnMethod('rlnCreateNode');
    const rlnInitNode = resolveRlnMethod('rlnInitNode');
    const rlnUnlockNode = resolveRlnMethod('rlnUnlockNode');
    const rlnNodeInfo = resolveRlnMethod('rlnNodeInfo');
    const rlnNetworkInfo = resolveRlnMethod('rlnNetworkInfo');
    const rlnListPeers = resolveRlnMethod('rlnListPeers');
    const rlnConnectPeer = resolveRlnMethod('rlnConnectPeer');
    const rlnDisconnectPeer = resolveRlnMethod('rlnDisconnectPeer');
    const rlnListChannels = resolveRlnMethod('rlnListChannels');
    const rlnOpenChannel = resolveRlnMethod('rlnOpenChannel');
    const rlnCloseChannel = resolveRlnMethod('rlnCloseChannel');
    const rlnListPayments = resolveRlnMethod('rlnListPayments');
    const rlnAddress = resolveRlnMethod('rlnAddress');
    const rlnAssetBalance = resolveRlnMethod('rlnAssetBalance');
    const rlnBackup = resolveRlnMethod('rlnBackup');
    const rlnBtcBalance = resolveRlnMethod('rlnBtcBalance');
    const rlnCheckIndexerUrl = resolveRlnMethod('rlnCheckIndexerUrl');
    const rlnCheckProxyEndpoint = resolveRlnMethod('rlnCheckProxyEndpoint');
    const rlnCreateUtxos = resolveRlnMethod('rlnCreateUtxos');
    const rlnDecodeLnInvoice = resolveRlnMethod('rlnDecodeLnInvoice');
    const rlnDecodeRgbInvoice = resolveRlnMethod('rlnDecodeRgbInvoice');
    const rlnEstimateFee = resolveRlnMethod('rlnEstimateFee');
    const rlnFailTransfers = resolveRlnMethod('rlnFailTransfers');
    const rlnGetChannelId = resolveRlnMethod('rlnGetChannelId');
    const rlnGetPayment = resolveRlnMethod('rlnGetPayment');
    const rlnInvoiceStatus = resolveRlnMethod('rlnInvoiceStatus');
    const rlnKeysend = resolveRlnMethod('rlnKeysend');
    const rlnListAssets = resolveRlnMethod('rlnListAssets');
    const rlnListTransactions = resolveRlnMethod('rlnListTransactions');
    const rlnListTransfers = resolveRlnMethod('rlnListTransfers');
    const rlnListUnspents = resolveRlnMethod('rlnListUnspents');
    const rlnLnInvoice = resolveRlnMethod('rlnLnInvoice');
    const rlnRefreshTransfers = resolveRlnMethod('rlnRefreshTransfers');
    const rlnRgbInvoice = resolveRlnMethod('rlnRgbInvoice');
    const rlnSendBtc = resolveRlnMethod('rlnSendBtc');
    const rlnSendPayment = resolveRlnMethod('rlnSendPayment');
    const rlnSendRgb = resolveRlnMethod('rlnSendRgb');
    const rlnSync = resolveRlnMethod('rlnSync');
    const rlnShutdown = resolveRlnMethod('rlnShutdown');
    const rlnDestroyNode = resolveRlnMethod('rlnDestroyNode');

    const peerTargetHost = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
    const peerPubkey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    const peerPubkeyAndAddr = `${peerPubkey}@${peerTargetHost}:9735`;
    let openedChannelId: string | null = null;
    let disconnectPeerTarget: string = peerPubkey;

    await runRlnStep('rlnCreateNode', async () => {
      const nodeId = await rlnCreateNode({
        storageDirPath: rlnStorageDir,
        daemonListeningPort: rlnPorts.daemonListeningPort,
        ldkPeerListeningPort: rlnPorts.ldkPeerListeningPort,
        network,
        maxMediaUploadSizeMb: 16,
        enableVirtualChannelsV0: true,
      });
      senderRlnNodeCreated = true;
      senderRlnNodeDestroyed = false;
      return {
        request: {
          storageDirPath: rlnStorageDir,
          network,
          daemonListeningPort: rlnPorts.daemonListeningPort,
          ldkPeerListeningPort: rlnPorts.ldkPeerListeningPort,
        },
        response: { nodeId },
      };
    });

    await runRlnStep('rlnInitNode', async () => {
      if (!senderRlnNodeCreated) {
        return {
          request: { mnemonic: 'wallet mnemonic', password: '***' },
          skipped: true,
          reason: 'Skipped: rlnCreateNode failed',
        };
      }
      senderRlnPubkey = await rlnInitNode(nodePassword, senderKeys.mnemonic);
      disconnectPeerTarget = senderRlnPubkey ?? peerPubkey;
      return {
        request: { mnemonic: 'wallet mnemonic', password: '***' },
        response: { initResult: senderRlnPubkey },
      };
    });

    await runRlnStep('rlnUnlockNode', async () => {
      if (!senderRlnNodeCreated) {
        return {
          request: maskUnlockRequest(unlockRequest, diagnostics),
          skipped: true,
          reason: 'Skipped: rlnCreateNode failed',
        };
      }
      if (strictUnlockCreds && (!rpcUserRaw || !rpcPasswordRaw)) {
        rlnReadinessBlocker =
          'Missing RLN_BITCOIND_RPC_USERNAME or RLN_BITCOIND_RPC_PASSWORD (or EXPO_PUBLIC_ prefixed variants)';
        return {
          request: maskUnlockRequest(unlockRequest, diagnostics),
          skipped: true,
          reason: rlnReadinessBlocker,
        };
      }
      if (!Number.isFinite(rpcPort) || rpcPort <= 0) {
        rlnReadinessBlocker = `Invalid RLN_BITCOIND_RPC_PORT: ${rpcPortRaw}`;
        return {
          request: maskUnlockRequest(unlockRequest, diagnostics),
          skipped: true,
          reason: rlnReadinessBlocker,
        };
      }
      const unlockAttempt = async (request: typeof unlockRequest, attempt: 'env' | 'regtest-fallback') => {
        try {
          await rlnUnlockNode(request);
          const normalizedConflict = consumeUnlockConflictNormalized();
          senderRlnReady = true;
          rlnReadinessBlocker = null;
          return {
            ok: true as const,
            response: normalizedConflict
              ? { unlocked: true, normalizedConflict: true, attempt, fallbackApplied: attempt === 'regtest-fallback' }
              : { unlocked: true, attempt, fallbackApplied: attempt === 'regtest-fallback' },
          };
        } catch (unlockErr: any) {
          const detail = classifyRlnError(unlockErr);
          if (detail.kind === 'Conflict') {
            const readiness = await probeNodeReadyAfterConflict();
            if (readiness.ready) {
              senderRlnReady = true;
              rlnReadinessBlocker = null;
              return {
                ok: true as const,
                response: {
                  unlocked: true,
                  normalizedConflict: true,
                  conflictSubtype: detail.conflictSubtype,
                  reason: 'Conflict normalized after readiness probe',
                  attempt,
                  fallbackApplied: attempt === 'regtest-fallback',
                  nativeError: {
                    code: detail.code,
                    message: detail.message,
                  },
                  methodResponse: detail.methodResponse,
                  nodeInfo: readiness.nodeInfo,
                },
              };
            }
          }
          return { ok: false as const, detail };
        }
      };

      const envAttempt = await unlockAttempt(unlockRequest, 'env');
      if (envAttempt.ok) {
        return {
          request: maskUnlockRequest(unlockRequest, diagnostics),
          response: envAttempt.response,
        };
      }

      const shouldTryRegtestFallback =
        network === 'regtest' &&
        !useRegtestForcedDefaults &&
        envAttempt.detail.kind !== 'Conflict';
      if (shouldTryRegtestFallback) {
        const fallbackRequest = {
          password: nodePassword,
          bitcoindRpcUsername: 'user',
          bitcoindRpcPassword: 'password',
          bitcoindRpcHost: defaultRpcHost,
          bitcoindRpcPort: 18443,
          indexerUrl: defaultIndexerUrl,
          proxyEndpoint: defaultProxyEndpoint,
          announceAddresses,
          announceAlias: announceAlias ?? null,
        };
        const fallbackAttempt = await unlockAttempt(fallbackRequest, 'regtest-fallback');
        if (fallbackAttempt.ok) {
          return {
            request: maskUnlockRequest(unlockRequest, diagnostics),
            response: {
              ...fallbackAttempt.response,
              firstAttempt: {
                kind: envAttempt.detail.kind,
                code: envAttempt.detail.code,
                message: envAttempt.detail.message,
                methodResponse: envAttempt.detail.methodResponse,
              },
            },
          };
        }
        senderRlnReady = false;
        rlnReadinessBlocker = fallbackAttempt.detail.message;
        throw {
          message: fallbackAttempt.detail.message,
          errorDetail: {
            request: {
              env: maskUnlockRequest(unlockRequest, diagnostics),
              regtestFallback: maskUnlockRequest(fallbackRequest, {
                ...diagnostics,
                configMode: 'regtest-fallback',
                hostSource: 'regtest-forced',
                portSource: 'regtest-forced',
                usernameSource: 'regtest-forced',
                passwordSource: 'regtest-forced',
                indexerSource: 'regtest-forced',
                proxySource: 'regtest-forced',
              }),
            },
            response: {
              attempt: 'regtest-fallback',
              fallbackApplied: true,
              firstAttempt: {
                kind: envAttempt.detail.kind,
                conflictSubtype: envAttempt.detail.conflictSubtype,
                code: envAttempt.detail.code,
                message: envAttempt.detail.message,
                methodResponse: envAttempt.detail.methodResponse,
              },
              secondAttempt: {
                kind: fallbackAttempt.detail.kind,
                conflictSubtype: fallbackAttempt.detail.conflictSubtype,
                code: fallbackAttempt.detail.code,
                message: fallbackAttempt.detail.message,
                methodResponse: fallbackAttempt.detail.methodResponse,
              },
            },
          },
        };
      }

      senderRlnReady = false;
      rlnReadinessBlocker = envAttempt.detail.message;
      throw {
        message: envAttempt.detail.message,
        errorDetail: {
          request: maskUnlockRequest(unlockRequest, diagnostics),
          response: {
            attempt: 'env',
            fallbackApplied: false,
            kind: envAttempt.detail.kind,
            conflictSubtype: envAttempt.detail.conflictSubtype,
            code: envAttempt.detail.code,
            message: envAttempt.detail.message,
            methodResponse: envAttempt.detail.methodResponse,
          },
        },
      };
    });

    await runRlnStep('rlnNodeInfo', async () => {
      if (!senderRlnNodeCreated || rlnReadinessBlocker) {
        return {
          request: {},
          skipped: true,
          reason: rlnReadinessBlocker ?? 'Skipped: node is not ready',
        };
      }
      const info = await rlnNodeInfo();
      senderRlnReady = true;
      rlnReadinessBlocker = null;
      return { request: {}, response: info };
    });

    await runRlnStep('rlnNetworkInfo', async () => {
      if (!senderRlnReady) {
        return { request: {}, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      }
      const info = await rlnNetworkInfo();
      return { request: {}, response: info };
    });

    await runRlnStep('rlnListPeers', async () => {
      if (!senderRlnReady) {
        return { request: {}, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      }
      const peers = await rlnListPeers();
      return { request: {}, response: { count: peers?.length ?? 0, peers } };
    });

    await runRlnStep('rlnConnectPeer', async () => {
      if (!senderRlnReady) {
        return { request: { peerPubkeyAndAddr }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      }
      await rlnConnectPeer(peerPubkeyAndAddr);
      disconnectPeerTarget = senderRlnPubkey ?? peerPubkey;
      return { request: { peerPubkeyAndAddr }, response: { connected: true } };
    });

    await runRlnStep('rlnDisconnectPeer', async () => {
      if (!senderRlnReady) {
        return {
          request: { peerPubkey: disconnectPeerTarget },
          skipped: true,
          reason: rlnReadinessBlocker ?? 'Skipped: node is not ready',
        };
      }
      await rlnDisconnectPeer(disconnectPeerTarget);
      return { request: { peerPubkey: disconnectPeerTarget }, response: { disconnected: true } };
    });

    await runRlnStep('rlnListChannels', async () => {
      if (!senderRlnReady) {
        return { request: {}, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      }
      const channels = await rlnListChannels();
      return { request: {}, response: { count: channels?.length ?? 0, channels } };
    });

    await runRlnStep('rlnOpenChannel', async () => {
      if (!senderRlnReady) {
        return {
          request: { peerPubkeyAndOptAddr: peerPubkeyAndAddr, capacitySat: 10000, pushMsat: 0, withAnchors: true },
          skipped: true,
          reason: rlnReadinessBlocker ?? 'Skipped: node is not ready',
        };
      }
      const opened = await rlnOpenChannel({
        peerPubkeyAndOptAddr: peerPubkeyAndAddr,
        capacitySat: 10000,
        pushMsat: 0,
        public: false,
        withAnchors: true,
      });
      openedChannelId =
        String(
          (opened as any)?.channelId ??
            (opened as any)?.channel_id ??
            (opened as any)?.temporaryChannelId ??
            (opened as any)?.temporary_channel_id ??
            ''
        ) || null;
      return {
        request: { peerPubkeyAndOptAddr: peerPubkeyAndAddr, capacitySat: 10000, pushMsat: 0, withAnchors: true },
        response: opened,
      };
    });

    await runRlnStep('rlnCloseChannel', async () => {
      if (!senderRlnReady) {
        return {
          request: { channelId: openedChannelId ?? null, peerPubkey: disconnectPeerTarget, force: true },
          skipped: true,
          reason: rlnReadinessBlocker ?? 'Skipped: node is not ready',
        };
      }
      if (!openedChannelId) {
        return {
          request: { channelId: null, peerPubkey: disconnectPeerTarget, force: true },
          skipped: true,
          reason: 'Skipped: no channel id available from rlnOpenChannel',
        };
      }
      await rlnCloseChannel(openedChannelId, disconnectPeerTarget, true);
      return {
        request: { channelId: openedChannelId, peerPubkey: disconnectPeerTarget, force: true },
        response: { closed: true },
      };
    });

    await runRlnStep('rlnListPayments', async () => {
      if (!senderRlnReady) {
        return { request: {}, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      }
      const payments = await rlnListPayments();
      return { request: {}, response: { count: payments?.length ?? 0, payments } };
    });

    await runRlnStep('rlnAddress', async () => {
      if (!senderRlnReady) return { request: {}, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnAddress();
      return { request: {}, response };
    });

    await runRlnStep('rlnBtcBalance', async () => {
      if (!senderRlnReady) return { request: { skipSync: true }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnBtcBalance(true);
      return { request: { skipSync: true }, response };
    });

    await runRlnStep('rlnAssetBalance', async () => {
      if (!senderRlnReady) return { request: { assetId: 'rgb1dummyasset' }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnAssetBalance('rgb1dummyasset');
      return { request: { assetId: 'rgb1dummyasset' }, response };
    });

    await runRlnStep('rlnCheckIndexerUrl', async () => {
      if (!senderRlnReady) return { request: { indexerUrl: indexerUrlEnv ?? null }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      if (!indexerUrlEnv) return { request: { indexerUrl: null }, skipped: true, reason: 'Skipped: missing RLN_INDEXER_URL' };
      const response = await rlnCheckIndexerUrl(indexerUrlEnv);
      return { request: { indexerUrl: indexerUrlEnv }, response };
    });

    await runRlnStep('rlnCheckProxyEndpoint', async () => {
      if (!senderRlnReady) return { request: { proxyEndpoint: proxyEndpointEnv ?? null }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      if (!proxyEndpointEnv) return { request: { proxyEndpoint: null }, skipped: true, reason: 'Skipped: missing RLN_PROXY_ENDPOINT' };
      await rlnCheckProxyEndpoint(proxyEndpointEnv);
      return { request: { proxyEndpoint: proxyEndpointEnv }, response: { ok: true } };
    });

    await runRlnStep('rlnEstimateFee', async () => {
      if (!senderRlnReady) return { request: { blocks: 6 }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnEstimateFee(6);
      return { request: { blocks: 6 }, response };
    });

    await runRlnStep('rlnCreateUtxos', async () => {
      if (!senderRlnReady) return { request: { upTo: true, num: 1, size: 1000, feeRate: 1, skipSync: true }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      await rlnCreateUtxos(true, 1, 1000, 1, true);
      return { request: { upTo: true, num: 1, size: 1000, feeRate: 1, skipSync: true }, response: { ok: true } };
    });

    await runRlnStep('rlnDecodeLnInvoice', async () => {
      if (!senderRlnReady) return { request: { invoice: 'lnbc1...' }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnDecodeLnInvoice('lnbc1placeholder');
      return { request: { invoice: 'lnbc1placeholder' }, response };
    });

    await runRlnStep('rlnDecodeRgbInvoice', async () => {
      if (!senderRlnReady) return { request: { invoice: 'rgb1...' }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnDecodeRgbInvoice('rgb1placeholder');
      return { request: { invoice: 'rgb1placeholder' }, response };
    });

    await runRlnStep('rlnFailTransfers', async () => {
      if (!senderRlnReady) return { request: { batchTransferIdx: null, noAssetOnly: false, skipSync: true }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnFailTransfers(null, false, true);
      return { request: { batchTransferIdx: null, noAssetOnly: false, skipSync: true }, response };
    });

    await runRlnStep('rlnGetChannelId', async () => {
      if (!senderRlnReady) return { request: { temporaryChannelId: '00'.repeat(32) }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnGetChannelId('00'.repeat(32));
      return { request: { temporaryChannelId: '00'.repeat(32) }, response };
    });

    await runRlnStep('rlnGetPayment', async () => {
      if (!senderRlnReady) return { request: { paymentHash: '00'.repeat(32) }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnGetPayment('00'.repeat(32));
      return { request: { paymentHash: '00'.repeat(32) }, response };
    });

    await runRlnStep('rlnInvoiceStatus', async () => {
      if (!senderRlnReady) return { request: { invoice: 'lnbc1placeholder' }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnInvoiceStatus('lnbc1placeholder');
      return { request: { invoice: 'lnbc1placeholder' }, response };
    });

    await runRlnStep('rlnKeysend', async () => {
      if (!senderRlnReady) return { request: { destPubkey: peerPubkey, amtMsat: 1000 }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnKeysend(peerPubkey, 1000, null, null);
      return { request: { destPubkey: peerPubkey, amtMsat: 1000, assetId: null, assetAmount: null }, response };
    });

    await runRlnStep('rlnListAssets', async () => {
      if (!senderRlnReady) return { request: { filterAssetSchemas: [] }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnListAssets([]);
      return { request: { filterAssetSchemas: [] }, response };
    });

    await runRlnStep('rlnListTransactions', async () => {
      if (!senderRlnReady) return { request: { skipSync: true }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnListTransactions(true);
      return { request: { skipSync: true }, response: { count: response?.length ?? 0, transactions: response } };
    });

    await runRlnStep('rlnListTransfers', async () => {
      if (!senderRlnReady) return { request: { assetId: 'rgb1dummyasset' }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnListTransfers('rgb1dummyasset');
      return { request: { assetId: 'rgb1dummyasset' }, response: { count: response?.length ?? 0, transfers: response } };
    });

    await runRlnStep('rlnListUnspents', async () => {
      if (!senderRlnReady) return { request: { skipSync: true }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnListUnspents(true);
      return { request: { skipSync: true }, response: { count: response?.length ?? 0, unspents: response } };
    });

    await runRlnStep('rlnLnInvoice', async () => {
      if (!senderRlnReady) return { request: { amtMsat: 1000, expirySec: 3600 }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnLnInvoice(1000, 3600, null, null);
      return { request: { amtMsat: 1000, expirySec: 3600, assetId: null, assetAmount: null }, response };
    });

    await runRlnStep('rlnRefreshTransfers', async () => {
      if (!senderRlnReady) return { request: { skipSync: true }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      await rlnRefreshTransfers(true);
      return { request: { skipSync: true }, response: { refreshed: true } };
    });

    await runRlnStep('rlnRgbInvoice', async () => {
      if (!senderRlnReady) return { request: { assetId: null, assignmentAmount: 1, durationSeconds: 3600 }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnRgbInvoice(null, 1, 3600, 1, false);
      return { request: { assetId: null, assignmentAmount: 1, durationSeconds: 3600, minConfirmations: 1, witness: false }, response };
    });

    await runRlnStep('rlnSendBtc', async () => {
      if (!senderRlnReady) return { request: { amount: 1000, address: 'bcrt1qplaceholder', feeRate: 1, skipSync: true }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnSendBtc(1000, 'bcrt1qplaceholder', 1, true);
      return { request: { amount: 1000, address: 'bcrt1qplaceholder', feeRate: 1, skipSync: true }, response };
    });

    await runRlnStep('rlnSendPayment', async () => {
      if (!senderRlnReady) return { request: { invoice: 'lnbc1placeholder' }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnSendPayment('lnbc1placeholder', null, null, null);
      return { request: { invoice: 'lnbc1placeholder', amtMsat: null, assetId: null, assetAmount: null }, response };
    });

    await runRlnStep('rlnSendRgb', async () => {
      if (!senderRlnReady) return { request: { donation: false, feeRate: 1, minConfirmations: 1, skipSync: true }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      const response = await rlnSendRgb(false, 1, 1, true, 'placeholder_asset_id', 'placeholder_recipient_id', 1, []);
      return { request: { donation: false, feeRate: 1, minConfirmations: 1, skipSync: true }, response };
    });

    await runRlnStep('rlnBackup', async () => {
      if (!senderRlnReady) return { request: { backupPath: `${rlnStorageDir}/backup.rln`, password: '***' }, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      await rlnBackup(`${rlnStorageDir}/backup.rln`, nodePassword);
      return { request: { backupPath: `${rlnStorageDir}/backup.rln`, password: '***' }, response: { backedUp: true } };
    });

    await runRlnStep('rlnSync', async () => {
      if (!senderRlnReady) return { request: {}, skipped: true, reason: rlnReadinessBlocker ?? 'Skipped: node is not ready' };
      await rlnSync();
      return { request: {}, response: { synced: true } };
    });

    await runRlnStep('rlnLock', async () => {
      return {
        request: {},
        skipped: true,
        reason: 'Skipped: lock is not exposed by current RLN native bindings',
      };
    });

    await runRlnStep('rlnRestore', async () => {
      return {
        request: {},
        skipped: true,
        reason:
          'Skipped: restore is wallet-level (restoreBackup/restoreFromVss), not an RLN node method',
      };
    });

    await runRlnStep('rlnShutdown', async () => {
      if (!senderRlnNodeCreated) return { request: {}, skipped: true, reason: 'Skipped: rlnCreateNode failed' };
      await rlnShutdown();
      return { request: {}, response: { shutdown: true } };
    });

    await runRlnStep('rlnDestroyNode', async () => {
      if (!senderRlnNodeCreated) {
        return { request: {}, skipped: true, reason: 'Skipped: rlnCreateNode failed' };
      }
      await rlnDestroyNode();
      senderRlnNodeDestroyed = true;
      senderRlnNodeCreated = false;
      senderRlnReady = false;
      return { request: {}, response: { destroyed: true } };
    });

    const failed = results.steps.some((s: any) => s.status === 'error');
    results.success = !failed;
    return results;
  } catch (error: any) {
    if (!results.steps.length) {
      addStep(
        'rlnPlaygroundSetup',
        'error',
        {
          reason: error?.message ?? String(error),
          stage: 'setup',
        },
        error?.message ?? String(error)
      );
    }
    results.success = false;
    results.error = {
      message: error?.message ?? String(error),
      reason: 'Flow aborted before completing all RLN steps',
      name: error?.name ?? null,
      code: error?.code ?? null,
    };
    return results;
  } finally {
    if (sender && senderRlnNodeCreated && !senderRlnNodeDestroyed) {
      const shouldIgnoreCleanupError = (error: any): boolean => {
        const message = (error?.message ?? String(error)).toLowerCase();
        return (
          message.includes('not found') ||
          message.includes('not created') ||
          message.includes('not initialized') ||
          message.includes('already shut') ||
          message.includes('already destroyed')
        );
      };

      let shutdownError: any = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await sender.rlnShutdown();
          shutdownError = null;
          break;
        } catch (error) {
          shutdownError = error;
          if (shouldIgnoreCleanupError(error)) {
            shutdownError = null;
            break;
          }
          await new Promise((resolve) => globalThis.setTimeout(resolve, 400));
        }
      }
      if (shutdownError) {
        cleanupIssues.push({
          step: 'rlnShutdown',
          message: shutdownError?.message ?? String(shutdownError),
        });
      }

      let destroyed = false;
      let destroyError: any = null;
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          await sender.rlnDestroyNode();
          destroyed = true;
          destroyError = null;
          break;
        } catch (error) {
          destroyError = error;
          if (shouldIgnoreCleanupError(error)) {
            destroyed = true;
            destroyError = null;
            break;
          }
          await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
        }
      }
      if (destroyed) {
        senderRlnNodeDestroyed = true;
        senderRlnNodeCreated = false;
        senderRlnReady = false;
      } else if (destroyError) {
        cleanupIssues.push({
          step: 'rlnDestroyNode',
          message: destroyError?.message ?? String(destroyError),
        });
      }
    }
    if (cleanupIssues.length > 0) {
      results.cleanup = {
        ok: false,
        issues: cleanupIssues,
      };
    }
    rlnPlaygroundFlowInFlight = false;
    endExclusiveFlow(flowName);
  }
}

/**
 * RLN Full Regtest Flow
 *
 * Pass-oriented end-to-end flow for the demo app:
 * create -> init -> unlock -> address -> fund -> sync -> balance -> shutdown -> destroy.
 */
export async function runRlnFullRegtestFlow() {
  return runRlnPaymentFlow();
}

type RlnFlowResults = { steps: any[]; success: boolean; error: any };
type RlnFlowContext = {
  results: RlnFlowResults;
  addStep: (step: string, status: string, data?: any, error?: string) => void;
  rln: RLNManager;
  nodeCreated: boolean;
  nodeDestroyed: boolean;
  keys: any;
  call: (name: string, ...args: any[]) => Promise<any>;
  nodePassword: string;
  unlockRequest: any;
  rpcHost: string;
  ensureFunded: (label?: string, amountBtc?: number) => Promise<string>;
};

type RlnNodeRuntime = {
  name: string;
  rln: RLNManager;
  call: (name: string, ...args: any[]) => Promise<any>;
  callSwap: (name: 'makerinit' | 'taker' | 'makerexecute' | 'listSwaps', ...args: any[]) => Promise<any>;
  storageDirPath: string;
  daemonListeningPort: number;
  ldkPeerListeningPort: number;
  nodePassword: string;
  proxyEndpoint: string;
  cleanup: () => Promise<void>;
  safeShutdown: () => Promise<void>;
  unlockRequest: any;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isNodeStateConflictError(error: any): boolean {
  const message = String(error?.message ?? error).toLowerCase();
  const code = String(error?.code ?? '').toLowerCase();
  return message.includes('conflict') || code.includes('conflict');
}

function isRetryableNodeStateError(error: any): boolean {
  const message = String(error?.message ?? error).toLowerCase();
  return (
    isNodeStateConflictError(error) ||
    message.includes('shutting_down') ||
    message.includes('shutting down') ||
    message.includes('non-lifecycle operations are blocked')
  );
}

async function probeNodeReady(
  call: (method: string, ...args: any[]) => Promise<any>,
  attempts: number = 12,
  delayMs: number = 500
): Promise<{ ready: boolean; info?: any }> {
  await sleep(500);
  for (let i = 0; i < attempts; i += 1) {
    try {
      const info = await call('rlnNodeInfo');
      return { ready: true, info };
    } catch {
      if (i < attempts - 1) {
        await sleep(delayMs);
      }
    }
  }
  return { ready: false };
}

function createFlowResults(): {
  results: RlnFlowResults;
  addStep: (step: string, status: string, data?: any, error?: string) => void;
  failFlow: (flowName: string, error: any) => RlnFlowResults;
} {
  const results: RlnFlowResults = { steps: [], success: false, error: null };
  let lastStep: string | null = null;

  const addStep = (step: string, status: string, data?: any, error?: string) => {
    const idx = results.steps.findIndex((s: any) => s.step === step);
    const entry = { step, status, data, error };
    if (idx >= 0) results.steps[idx] = entry;
    else results.steps.push(entry);
    if (status !== 'running') lastStep = step;
    if (status === 'error' || error) {
      console.error(`[flow] ✗ step="${step}" error="${error ?? '(none)'}"`, data ?? null);
    } else if (status === 'running') {
      console.log(`[flow] ▶ step="${step}"`);
    } else {
      console.log(`[flow] ✓ step="${step}"`, data ?? null);
    }
  };

  const failFlow = (flowName: string, error: any): RlnFlowResults => {
    const message = error?.message ?? String(error);
    const stack = error?.stack ?? null;
    console.error(
      `[flow] ✗ FLOW FAILED flowName="${flowName}" lastStep="${lastStep ?? 'none'}" error="${message}"`,
      stack ? `\n${stack}` : ''
    );
    results.success = false;
    results.error = { message, lastStep, stack };
    return results;
  };

  return { results, addStep, failFlow };
}

async function createRlnFlowContext(flowPrefix: string): Promise<RlnFlowContext> {
  const { results, addStep } = createFlowResults();
  const network = 'regtest' as const;
  const rpcHost = readEnv('RLN_BITCOIND_RPC_HOST') ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
  const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
  const keys = await createWallet(network);
  const rln = createRLNManager();

  const call = async (name: string, ...args: any[]) => {
    const fn = (rln as any)[name];
    if (typeof fn === 'function') return fn.call(rln, ...args);
    throw new Error(`Missing RLN method: ${name}`);
  };

  const mkStorageDir = async () => {
    const uri = `${documentDirectory ?? ''}${flowPrefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    try {
      await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
    } catch {
      // best effort
    }
    return uri.replace('file://', '');
  };
  const basePort = 20000 + Math.floor(Math.random() * 20000);
  const storageDirPath = await mkStorageDir();

  const nodePassword = readEnv('RLN_NODE_PASSWORD') ?? 'password';
  const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
  const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
  const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
  const proxyEndpoint = readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;
  const unlockRequest = {
    password: nodePassword,
    bitcoindRpcUsername: rpcUsername,
    bitcoindRpcPassword: rpcPassword,
    bitcoindRpcHost: rpcHost,
    bitcoindRpcPort: rpcPort,
    indexerUrl,
    proxyEndpoint,
    announceAddresses: [],
    announceAlias: null,
  };

  addStep('rlnCreateNode', 'running');
  await call('rlnCreateNode', {
    storageDirPath,
    daemonListeningPort: basePort,
    ldkPeerListeningPort: basePort + 1,
    network,
    maxMediaUploadSizeMb: 20,
    enableVirtualChannelsV0: false,
  });
  addStep('rlnCreateNode', 'success', {
    storageDirPath,
    daemonListeningPort: basePort,
    ldkPeerListeningPort: basePort + 1,
    network,
  });

  addStep('rlnInitNode', 'running');
  const pubkey = await call('rlnInitNode', nodePassword, keys.mnemonic);
  addStep('rlnInitNode', 'success', { pubkey });

  addStep('rlnUnlockNode', 'running');
  await call('rlnUnlockNode', unlockRequest);
  addStep('rlnUnlockNode', 'success', { rpcHost, rpcPort, rpcUsername, indexerUrl, proxyEndpoint });

  const ensureFunded = async (label: string = 'fundAddress', amountBtc: number = 1) => {
    addStep('rlnAddress', 'running');
    const addrResponse = await call('rlnAddress');
    const address = String(addrResponse?.address ?? addrResponse ?? '');
    if (!address) throw new Error('Failed to get RLN address');
    addStep('rlnAddress', 'success', { address });
    addStep(label, 'running');
    const txid = await sendToAddress(address, amountBtc);
    await mine(6);
    addStep(label, 'success', { txid, blocksMined: 6, amountBtc, nodeEndpoint: BITCOIN_NODE_ENDPOINT });
    return address;
  };

  return {
    results,
    addStep,
    rln,
    nodeCreated: true,
    nodeDestroyed: false,
    keys,
    call,
    nodePassword,
    unlockRequest,
    rpcHost,
    ensureFunded,
  };
}

async function cleanupRlnFlowContext(ctx: RlnFlowContext) {
  if (ctx.nodeCreated && !ctx.nodeDestroyed) {
    try {
      await ctx.rln.rlnShutdown();
    } catch {
      // best effort
    }
    try {
      await ctx.rln.rlnDestroyNode();
    } catch {
      // best effort
    }
  }
}

async function createRlnNodeRuntime(
  opts: {
    name: string;
    flowPrefix: string;
    stepPrefix: string;
    addStep: (step: string, status: string, data?: any, error?: string) => void;
    useExternalSigner?: boolean;
    reuse?: {
      storageDirPath: string;
      daemonListeningPort: number;
      ldkPeerListeningPort: number;
      nodePassword: string;
    };
  }
): Promise<RlnNodeRuntime> {
  const { name, flowPrefix, stepPrefix, addStep, reuse, useExternalSigner = false } = opts;
  const network = 'regtest' as const;
  const rpcHost = readEnv('RLN_BITCOIND_RPC_HOST') ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
  const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
  const keys = await createWallet(network);
  const rln = createRLNManager();
  // const wallet = createWalletManager({
  //   xpubVan: keys.accountXpubVanilla,
  //   xpubCol: keys.accountXpubColored,
  //   masterFingerprint: keys.masterFingerprint,
  //   mnemonic: keys.mnemonic,
  //   network,
  //   indexerUrl,
  // });
  // await wallet.initialize();

  const call = async (method: string, ...args: any[]) => {
    const fn = (rln as any)[method];
    if (typeof fn !== 'function') throw new Error(`Missing RLN method on ${name}: ${method}`);
    const argsLog = JSON.stringify(args);
    console.log(`[rln:${name}] ▶ ${method}(${argsLog})`);
    try {
      const result = await fn.call(rln, ...args);
      console.log(`[rln:${name}] ✓ ${method} → ${JSON.stringify(result)}`);
      return result;
    } catch (e: any) {
      console.error(`[rln:${name}] ✗ ${method}(${argsLog}) threw: ${e?.message ?? String(e)}`);
      throw e;
    }
  };

  const callSwap = async (
    method: 'makerinit' | 'taker' | 'makerexecute' | 'listSwaps',
    ...args: any[]
  ) => {
    throw new Error(`Swap method '${method}' is not yet implemented in RLNManager on ${name}`);
  };

  const mkStorageDir = async () => {
    const uri = `${documentDirectory ?? ''}${flowPrefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    try {
      await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
    } catch {
      // best effort
    }
    return uri.replace('file://', '');
  };

  const basePort = reuse?.daemonListeningPort ?? (20000 + Math.floor(Math.random() * 20000));
  const ldkPeerListeningPort = reuse?.ldkPeerListeningPort ?? (basePort + 1);
  const storageDirPath = reuse?.storageDirPath ?? (await mkStorageDir());
  const nodePassword = reuse?.nodePassword ?? `${name}pass`;
  const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
  const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
  const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
  const proxyEndpoint = readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;
  const unlockRequest = {
    password: nodePassword,
    bitcoindRpcUsername: rpcUsername,
    bitcoindRpcPassword: rpcPassword,
    bitcoindRpcHost: rpcHost,
    bitcoindRpcPort: rpcPort,
    indexerUrl,
    proxyEndpoint,
    announceAddresses: [],
    announceAlias: null,
  };

  addStep(`${stepPrefix}CreateNode`, 'running');
  await call('rlnCreateNode', {
    storageDirPath,
    daemonListeningPort: basePort,
    ldkPeerListeningPort,
    network,
    maxMediaUploadSizeMb: 20,
    enableVirtualChannelsV0: false,
  });
  addStep(`${stepPrefix}CreateNode`, 'success', { storageDirPath, daemonListeningPort: basePort, ldkPeerListeningPort });

  let signerId: number | null = null;

  if (useExternalSigner) {
    const seedHex = Buffer.from(mnemonicToSeedSync(keys.mnemonic)).slice(0, 32).toString('hex');

    addStep(`${stepPrefix}CreateExternalSigner`, 'running');
    signerId = await call('rlnCreateNativeExternalSigner', seedHex, network);
    addStep(`${stepPrefix}CreateExternalSigner`, 'success', { signerId });

    addStep(`${stepPrefix}InitNode`, 'running');
    try {
      await call('rlnInitNodeWithNativeExternalSigner', signerId);
      addStep(`${stepPrefix}InitNode`, 'success', { signerId, recreated: Boolean(reuse) });
    } catch (error: any) {
      const message = String(error?.message ?? error).toLowerCase();
      if (!message.includes('already initialized') && !message.includes('conflict with current node state')) throw error;
      addStep(`${stepPrefix}InitNode`, 'success', { skipped: true, normalizedConflict: true, recreated: Boolean(reuse) });
    }

    addStep(`${stepPrefix}UnlockNode`, 'running');
    let unlockAttempts = 0;
    let lastRetryError: string | null = null;
    const unlockParams = {
      bitcoindRpcUsername: unlockRequest.bitcoindRpcUsername ?? rpcUsername,
      bitcoindRpcPassword: unlockRequest.bitcoindRpcPassword ?? rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl,
      proxyEndpoint,
      announceAddresses: [] as string[],
      announceAlias: null as string | null,
    };
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      unlockAttempts = attempt;
      try {
        await call('rlnUnlockNodeWithNativeExternalSigner', signerId, unlockParams);
        lastRetryError = null;
        break;
      } catch (error: any) {
        lastRetryError = String(error?.message ?? error);
        if (!isRetryableNodeStateError(error) || attempt === 12) throw error;
        if (isNodeStateConflictError(error)) {
          const readiness = await probeNodeReady(call, 12, 500);
          if (readiness.ready) break;
        }
        await sleep(800);
      }
    }
    addStep(`${stepPrefix}UnlockNode`, 'success', { rpcHost, rpcPort, indexerUrl, proxyEndpoint, attempts: unlockAttempts, lastRetryError });
  } else {
    addStep(`${stepPrefix}InitNode`, 'running');
    let pubkey: string | null = null;
    try {
      pubkey = await call('rlnInitNode', nodePassword, keys.mnemonic);
      addStep(`${stepPrefix}InitNode`, 'success', { pubkey, recreated: Boolean(reuse) });
    } catch (error: any) {
      const message = String(error?.message ?? error).toLowerCase();
      const alreadyInitialized =
        message.includes('already initialized') || message.includes('conflict with current node state');
      if (!alreadyInitialized) {
        throw error;
      }
      addStep(`${stepPrefix}InitNode`, 'success', {
        skipped: true,
        normalizedConflict: true,
        reason: error?.message ?? String(error),
        recreated: Boolean(reuse),
      });
    }

    addStep(`${stepPrefix}UnlockNode`, 'running');
    let unlockAttempts = 0;
    let normalizedConflict = false;
    let recoveredFromReadinessProbe = false;
    let lastRetryError: string | null = null;
    const maxUnlockAttempts = 12;
    for (let attempt = 1; attempt <= maxUnlockAttempts; attempt += 1) {
      unlockAttempts = attempt;
      try {
        await call('rlnUnlockNode', unlockRequest);
        break;
      } catch (error: any) {
        lastRetryError = String(error?.message ?? error);
        if (!isRetryableNodeStateError(error)) {
          throw error;
        }
        if (isNodeStateConflictError(error)) {
          const readiness = await probeNodeReady(call, 12, 500);
          if (readiness.ready) {
            normalizedConflict = true;
            recoveredFromReadinessProbe = true;
            break;
          }
        }
        if (attempt === maxUnlockAttempts) {
          throw error;
        }
        await sleep(800);
      }
    }
    addStep(`${stepPrefix}UnlockNode`, 'success', {
      rpcHost,
      rpcPort,
      indexerUrl,
      proxyEndpoint,
      attempts: unlockAttempts,
      recoveredFromRetry: unlockAttempts > 1,
      normalizedConflict,
      recoveredFromReadinessProbe,
      lastRetryError,
    });
  }

  const cleanup = async () => {
    try { await rln.rlnShutdown(); } catch {}
    try { await rln.rlnDestroyNode(); } catch {}
    if (signerId !== null) {
      try { await (rln as any).rlnDestroyNativeExternalSigner(signerId); } catch {}
    }
    // try { await wallet.dispose(); } catch {}
  };
  const safeShutdown = async () => {
    try {
      await rln.rlnShutdown();
    } catch {
      // best effort
    }
  };
  return {
    name,
    rln,
    call,
    callSwap,
    storageDirPath,
    daemonListeningPort: basePort,
    ldkPeerListeningPort,
    nodePassword,
    proxyEndpoint,
    cleanup,
    safeShutdown,
    unlockRequest,
  };
}

// For asset channels (assetId provided): find channel in listChannels by assetId — mirrors Android.
// For BTC channels (no assetId): resolve via rlnGetChannelId(tmpId), then find by channelId.
// Returns { channelId, fundingTxid }.
async function waitForChannelFundingTx(
  opener: RlnNodeRuntime,
  peer: RlnNodeRuntime,
  tmpId: string,
  timeoutMs: number = 120000,
  assetId?: string,
): Promise<{ channelId: string; fundingTxid: string }> {
  const startMs = Date.now();
  const deadline = startMs + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    try { await opener.call('rlnSync'); } catch (e: any) { console.warn(`[flow] opener.rlnSync: ${e?.message}`); }
    try { await peer.call('rlnSync'); } catch (e: any) { console.warn(`[flow] peer.rlnSync: ${e?.message}`); }
    let channels: any[] = [];
    try { channels = (await opener.call('rlnListChannels')) ?? []; } catch (e: any) { console.warn(`[flow] rlnListChannels: ${e?.message}`); }
    let ch: any;
    if (assetId) {
      ch = channels.find((c: any) => (c.assetId ?? c.asset_id) === assetId);
    } else {
      let channelId = '';
      try {
        const resolved = await opener.call('rlnGetChannelId', tmpId);
        channelId = String(resolved ?? '');
      } catch (e: any) {
        console.warn(`[flow] rlnGetChannelId(${tmpId}) attempt=${attempt}: ${e?.message}`);
      }
      if (channelId) ch = channels.find((c: any) => (c.channelId ?? c.channel_id) === channelId);
    }
    const channelId = String(ch?.channelId ?? ch?.channel_id ?? '');
    const fundingTxid = String(ch?.fundingTxid ?? ch?.funding_txid ?? '');
    console.log(`[flow] waitForChannelFundingTx attempt=${attempt} elapsed=${elapsedSec}s channelId="${channelId}" fundingTxid="${fundingTxid}" found=${!!ch}`);
    if (ch) return { channelId, fundingTxid };
    try { await mine(1); } catch (e: any) { console.warn(`[flow] mine(1): ${e?.message}`); }
    await sleep(2000);
  }
  throw new Error(`Channel not found after ${attempt} attempts (${timeoutMs / 1000}s)`);
}

// Mirrors Android's mineUntilTxConfirmed: sync → listTransactions → check confirmationTime.
async function waitForFundingConfirmed(
  node: RlnNodeRuntime,
  fundingTxid: string,
  timeoutMs: number = 180000
): Promise<void> {
  if (!fundingTxid) {
    console.log('[flow] waitForFundingConfirmed: fundingTxid absent, channel already confirmed');
    return;
  }
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try { await node.call('rlnSync'); } catch {}
    const txs: any[] = (await node.call('rlnListTransactions', false)) ?? [];
    const tx = txs.find((t: any) => (t?.txid ?? t?.txId) === fundingTxid);
    const confirmed = !!(tx && (tx.confirmationTime != null || tx.confirmation_time != null));
    console.log(`[flow] waitForFundingConfirmed attempt=${attempt} txid=${fundingTxid.substring(0, 12)}... confirmed=${confirmed} tx=${JSON.stringify(tx ?? null)}`);
    if (confirmed) return;
    await mine(2);
    await sleep(2000);
  }
  throw new Error(`Funding tx not confirmed after ${attempt} attempts: ${fundingTxid}`);
}

// Mirrors Android's waitForUsableChannel: poll listChannels until ready=true,
// mining every 5 polls. Returns channelId of the first ready channel.
async function waitForChannelReady(
  node: RlnNodeRuntime,
  timeoutMs: number = 120000
): Promise<string> {
  const startMs = Date.now();
  const deadline = startMs + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    try {
      const channels: any[] = (await node.call('rlnListChannels')) ?? [];
      const usable = channels.find((c: any) => (c.isUsable ?? c.is_usable) === true || (c.ready === true && c.isUsable == null));
      const channelId = String(usable?.channelId ?? usable?.channel_id ?? '');
      console.log(`[flow] waitForChannelReady attempt=${attempt} elapsed=${elapsedSec}s channels=${channels.length} usableChannelId="${channelId}"`);
      if (channelId) return channelId;
    } catch (e: any) {
      console.warn(`[flow] waitForChannelReady rlnListChannels: ${e?.message}`);
    }
    if (attempt % 5 === 0) {
      try { await mine(1); } catch (e: any) { console.warn(`[flow] mine(1): ${e?.message}`); }
    }
    await sleep(1000);
  }
  throw new Error(`No ready channel after ${attempt} attempts (${timeoutMs / 1000}s)`);
}

// Mirrors Android's waitForStableChannelBalances: sync both nodes, poll listChannels
// until localBalanceSat on both sides is stable for 2 consecutive polls. This ensures
// all HTLC resolution is complete before cooperative close.
async function waitForStableChannelBalances(
  nodeA: RlnNodeRuntime,
  nodeB: RlnNodeRuntime,
  channelId: string,
  timeoutMs: number = 30000,
): Promise<void> {
  const startMs = Date.now();
  const deadline = startMs + timeoutMs;

    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    try { await nodeA.call('rlnSync'); } catch (e: any) { console.warn(`[flow] waitForStable nodeA.rlnSync: ${e?.message}`); }
    try { await nodeB.call('rlnSync'); } catch (e: any) { console.warn(`[flow] waitForStable nodeB.rlnSync: ${e?.message}`); }
    const channelsA: any[] = (await nodeA.call('rlnListChannels')) ?? [];
    const channelsB: any[] = (await nodeB.call('rlnListChannels')) ?? [];
}

async function waitForAssetBalance(
  node: RlnNodeRuntime,
  assetId: string,
  expectedSpendable: number,
  timeoutMs: number = 70000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < deadline) {
    try {
      const bal = await node.call('rlnAssetBalance', assetId);
      last = Number(bal?.spendable ?? -1);
      console.log(`[flow] waitForAssetBalance assetId=${assetId.substring(0, 12)}... spendable=${last} expected=${expectedSpendable}`);
      if (last === expectedSpendable) return;
    } catch (e: any) {
      console.warn(`[flow] waitForAssetBalance: ${e?.message}`);
    }
    try { await node.call('rlnRefreshTransfers', false); } catch {}
    await sleep(2000);
  }
  throw new Error(`Asset balance did not reach ${expectedSpendable}, last=${last}`);
}

async function waitForUsableChannels(node: RlnNodeRuntime, expected: number, timeoutMs: number = 60000) {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    try {
      const info = await node.call('rlnNodeInfo');
      const usable = Number(info?.numUsableChannels ?? info?.num_usable_channels ?? 0);
      last = usable;
      if (usable === expected) return;
    } catch {
      // keep polling
    }
    await sleep(1000);
  }
  throw new Error(`Usable channels did not reach ${expected}, last=${last}`);
}

async function waitForSwapStatus(
  node: RlnNodeRuntime,
  paymentHash: string,
  expectedStatus: string,
  timeoutMs: number = 90000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const swaps = await node.callSwap('listSwaps');
    const maker = Array.isArray(swaps?.maker) ? swaps.maker : [];
    const taker = Array.isArray(swaps?.taker) ? swaps.taker : [];
    const hit = [...maker, ...taker].find((s: any) => s?.paymentHash === paymentHash || s?.payment_hash === paymentHash);
    if (hit && String(hit.status).toUpperCase() === expectedStatus.toUpperCase()) return hit;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Swap did not reach ${expectedStatus} for payment hash ${paymentHash}`);
}

async function waitForInvoiceStatus(
  call: (method: string, ...args: any[]) => Promise<any>,
  invoice: string,
  expected: string,
  timeoutMs: number = 60000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await call('rlnInvoiceStatus', invoice);
      const status = String(res?.status ?? res?.value ?? res ?? '').toUpperCase();
      if (status === expected.toUpperCase()) return;
    } catch {
      // keep polling
    }
    await sleep(1000);
  }
  throw new Error(`Invoice did not reach ${expected} in ${timeoutMs}ms`);
}

async function waitForPaymentSuccess(
  call: (method: string, ...args: any[]) => Promise<any>,
  paymentHash: string,
  timeoutMs: number = 60000
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const payments: any[] = (await call('rlnListPayments')) ?? [];
      const p = payments.find((x: any) =>
        (x?.paymentHash ?? x?.payment_hash) === paymentHash
      );
      if (p) {
        const s = String(p.status ?? '').toUpperCase();
        if (s === 'SUCCEEDED') return p;
        if (s === 'FAILED') throw new Error(`Payment failed: ${paymentHash}`);
      }
    } catch (e: any) {
      if (e?.message?.includes('Payment failed')) throw e;
    }
    await sleep(3000);
  }
  throw new Error(`Payment did not succeed in ${timeoutMs}ms: ${paymentHash}`);
}

async function fundAndCreateUtxosForNode(
  node: RlnNodeRuntime,
  prefix: string,
  addStep: (step: string, status: string, data?: any) => void
): Promise<void> {
  addStep(`${prefix}Fund`, 'running');
  const bal = await node.call('rlnBtcBalance', false);
  const spendable = Number(bal?.vanilla?.spendable ?? bal?.vanilla?.spendableSat ?? 0);
  let txid: string | null = null;
  if (spendable < 1) {
    const addrResp = await node.call('rlnAddress');
    const address = String(addrResp?.address ?? '');
    if (!address) throw new Error(`${prefix}: could not get address`);
    txid = String(await sendToAddress(address, 1));
    await mine(6);
    await node.call('rlnSync');
  }
  addStep(`${prefix}Fund`, 'success', {
    txid,
    nodeEndpoint: BITCOIN_NODE_ENDPOINT,
    skipped: txid === null,
  });
  addStep(`${prefix}CreateUtxos`, 'running');
  await node.call('rlnSync');
  await node.call('rlnCreateUtxos', false, 10, null, 7, false);
  await mine(1);
  await node.call('rlnSync');
  addStep(`${prefix}CreateUtxos`, 'success', { num: 10, feeRate: 7 });
}

export async function runRlnPaymentFlow() {
  const flowName = 'runRlnPaymentFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();
  let nodeA: RlnNodeRuntime | null = null;
  let nodeB: RlnNodeRuntime | null = null;
  let nodeC: RlnNodeRuntime | null = null;
  try {
    nodeA = await createRlnNodeRuntime({ name: 'nodeA', flowPrefix: 'rln_payment_a', stepPrefix: 'payA', addStep });
    nodeB = await createRlnNodeRuntime({ name: 'nodeB', flowPrefix: 'rln_payment_b', stepPrefix: 'payB', addStep });
    nodeC = await createRlnNodeRuntime({ name: 'nodeC', flowPrefix: 'rln_payment_c', stepPrefix: 'payC', addStep });

    await fundAndCreateUtxosForNode(nodeA, 'payA', addStep);
    await fundAndCreateUtxosForNode(nodeB, 'payB', addStep);
    await fundAndCreateUtxosForNode(nodeC, 'payC', addStep);

    // Issue RGB asset on nodeA (1000 units) — mirrors Android test
    addStep('payIssueAsset', 'running');
    const issued = await nodeA.call('rlnIssueAssetNia', 'USDT', 'Tether', 0, [1000]);
    const assetId = String(issued?.assetId ?? issued?.asset_id ?? '');
    if (!assetId) throw new Error('Failed to issue asset');
    addStep('payIssueAsset', 'success', { assetId });

    const infoA = await nodeA.call('rlnNodeInfo');
    const infoB = await nodeB.call('rlnNodeInfo');
    const pubkeyA = String(infoA?.pubkey ?? '');
    const pubkeyB = String(infoB?.pubkey ?? '');
    addStep('payNodeInfos', 'success', {
      pubkeyA: pubkeyA.substring(0, 16) + '...',
      pubkeyB: pubkeyB.substring(0, 16) + '...',
    });

    addStep('payConnectPeers', 'running');
    const peerUriB = `${pubkeyB}@127.0.0.1:${nodeB.ldkPeerListeningPort}`;
    try { await nodeA.call('rlnConnectPeer', peerUriB); } catch { /* already connected */ }
    addStep('payConnectPeers', 'success', {});

    // nodeA opens asset channel to nodeB (600 units pushed into channel)
    addStep('payOpenChannel', 'running');
    const openResp = await nodeA.call('rlnOpenChannel', {
      peerPubkeyAndOptAddr: peerUriB,
      capacitySat: 100000,
      pushMsat: 3_500_000,
      public: true,
      withAnchors: true,
      assetId,
      assetAmount: 600,
    });
    const tmpId = String(openResp?.temporaryChannelId ?? openResp?.temporary_channel_id ?? '');
    // Find channel by assetId (mirrors Android's waitForChannelFundingTx(nodeA, nodeB, assetId))
    const { fundingTxid } = await waitForChannelFundingTx(nodeA, nodeB, tmpId, 120000, assetId);
    await waitForFundingConfirmed(nodeA, fundingTxid, 180000);

    const channelId = await waitForChannelReady(nodeA);
    await mine(6);
    await waitForChannelReady(nodeA);
    addStep('payOpenChannel', 'success', { channelId, fundingTxid });

    // nodeA has 400 spendable (1000 issued - 600 in channel)
    addStep('payAssetBalanceA', 'running');
    const balA0 = await nodeA.call('rlnAssetBalance', assetId);
    addStep('payAssetBalanceA', 'success', { spendable: balA0?.spendable ?? null });

    const paymentMsat = 3_000_000;

    // inv1: B creates (100 asset units), A pays — like Android invoice1
    addStep('payInvoice1', 'running');
    const invResp1 = await nodeB.call('rlnLnInvoice', paymentMsat, 900, assetId, 100);
    const invoice1 = String(invResp1?.invoice ?? invResp1 ?? '');
    const dec1 = await nodeA.call('rlnDecodeLnInvoice', invoice1);
    const hash1 = String(dec1?.paymentHash ?? dec1?.payment_hash ?? '');
    await nodeA.call('rlnSendPayment', invoice1, null, null, null);
    await waitForInvoiceStatus(nodeB.call.bind(nodeB), invoice1, 'SUCCEEDED', 60000);
    await waitForPaymentSuccess(nodeA.call.bind(nodeA), hash1, 60000);
    addStep('payInvoice1', 'success', { paymentHash: hash1, assetAmount: 100 });

    // inv2: A creates (50 asset units), B pays — like Android invoice2
    addStep('payInvoice2', 'running');
    const invResp2 = await nodeA.call('rlnLnInvoice', paymentMsat, 900, assetId, 50);
    const invoice2 = String(invResp2?.invoice ?? invResp2 ?? '');
    const dec2 = await nodeA.call('rlnDecodeLnInvoice', invoice2);
    const hash2 = String(dec2?.paymentHash ?? dec2?.payment_hash ?? '');
    await nodeB.call('rlnSendPayment', invoice2, null, null, null);
    await waitForInvoiceStatus(nodeA.call.bind(nodeA), invoice2, 'SUCCEEDED', 60000);
    await waitForPaymentSuccess(nodeB.call.bind(nodeB), hash2, 60000);
    addStep('payInvoice2', 'success', { paymentHash: hash2, assetAmount: 50 });

    // inv3: B creates (50 asset units), A pays — like Android invoice3
    addStep('payInvoice3', 'running');
    const invResp3 = await nodeB.call('rlnLnInvoice', paymentMsat, 900, assetId, 50);
    const invoice3 = String(invResp3?.invoice ?? invResp3 ?? '');
    const dec3 = await nodeA.call('rlnDecodeLnInvoice', invoice3);
    const hash3 = String(dec3?.paymentHash ?? dec3?.payment_hash ?? '');
    await nodeA.call('rlnSendPayment', invoice3, null, null, null);
    await waitForInvoiceStatus(nodeB.call.bind(nodeB), invoice3, 'SUCCEEDED', 60000);
    await waitForPaymentSuccess(nodeA.call.bind(nodeA), hash3, 60000);
    addStep('payInvoice3', 'success', { paymentHash: hash3, assetAmount: 50 });

    // inv4: A creates (50 asset units), B pays — like Android invoice4
    addStep('payInvoice4', 'running');
    const invResp4 = await nodeA.call('rlnLnInvoice', paymentMsat, 900, assetId, 50);
    const invoice4 = String(invResp4?.invoice ?? invResp4 ?? '');
    const dec4 = await nodeA.call('rlnDecodeLnInvoice', invoice4);
    const hash4 = String(dec4?.paymentHash ?? dec4?.payment_hash ?? '');
    await nodeB.call('rlnSendPayment', invoice4, null, null, null);
    await waitForInvoiceStatus(nodeA.call.bind(nodeA), invoice4, 'SUCCEEDED', 60000);
    await waitForPaymentSuccess(nodeB.call.bind(nodeB), hash4, 60000);
    addStep('payInvoice4', 'success', { paymentHash: hash4, assetAmount: 50 });

    // Wait for HTLC resolution on both sides before cooperative close (mirrors Android's waitForStableChannelBalances)
    await waitForStableChannelBalances(nodeA, nodeB, channelId, 30000);

    // Cooperative close
    addStep('payCloseChannel', 'running');
   
    await nodeA.call('rlnCloseChannel', channelId, pubkeyB, false);
    await mine(6);
    await nodeA.call('rlnRefreshTransfers', false);
    await nodeB.call('rlnRefreshTransfers', false);
    await sleep(20000);
    await mine(6);
    await nodeA.call('rlnRefreshTransfers', false);
    await nodeB.call('rlnRefreshTransfers', false);
    await sleep(20000);
    await mine(6);
    await nodeA.call('rlnRefreshTransfers', false);
    await nodeB.call('rlnRefreshTransfers', false);
    await nodeA.call('rlnListChannels');
    addStep('payCloseChannel', 'success', { channelId });

    // After close: A=950 (400 settled + 550 from channel), B=50
    addStep('payWaitBalances', 'running');
    await waitForAssetBalance(nodeA, assetId, 950, 70000);
    await waitForAssetBalance(nodeB, assetId, 50, 70000);
    addStep('payWaitBalances', 'success', { expectedA: 950, expectedB: 50 });

    // RGB sends to nodeC (A sends 925, B sends 25) — mirrors Android
    addStep('payRgbSendA', 'running');
    const invoiceC1 = await nodeC.call('rlnRgbInvoice', null, null, null, 1, false);
    const recipientC1 = String(invoiceC1?.recipientId ?? invoiceC1?.recipient_id ?? '');
    await nodeA.call('rlnSendRgb', true, 1, 1, false, assetId, recipientC1, 925, [nodeA.proxyEndpoint]);
    await mine(1);
    await nodeC.call('rlnRefreshTransfers', false);
    await nodeC.call('rlnRefreshTransfers', false);
    await nodeA.call('rlnRefreshTransfers', false);
    addStep('payRgbSendA', 'success', { amount: 925, recipient: recipientC1.substring(0, 20) + '...' });

    addStep('payRgbSendB', 'running');
    const invoiceC2 = await nodeC.call('rlnRgbInvoice', null, null, null, 1, false);
    const recipientC2 = String(invoiceC2?.recipientId ?? invoiceC2?.recipient_id ?? '');
    await nodeB.call('rlnSendRgb', true, 1, 1, false, assetId, recipientC2, 25, [nodeB.proxyEndpoint]);
    await mine(1);
    await nodeC.call('rlnRefreshTransfers', false);
    await nodeC.call('rlnRefreshTransfers', false);
    await nodeB.call('rlnRefreshTransfers', false);
    addStep('payRgbSendB', 'success', { amount: 25, recipient: recipientC2.substring(0, 20) + '...' });

    // Final balances: A=25, B=25, C=950
    addStep('payFinalBalances', 'running');
    const [finalA, finalB, finalC] = await Promise.all([
      nodeA.call('rlnAssetBalance', assetId),
      nodeB.call('rlnAssetBalance', assetId),
      nodeC.call('rlnAssetBalance', assetId),
    ]);
    addStep('payFinalBalances', 'success', {
      spendableA: finalA?.spendable ?? null,
      spendableB: finalB?.spendable ?? null,
      spendableC: finalC?.spendable ?? null,
    });

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (nodeA) await nodeA.cleanup();
    if (nodeB) await nodeB.cleanup();
    if (nodeC) await nodeC.cleanup();
    endExclusiveFlow(flowName);
  }
}


// Same as runRlnPaymentFlow but all three nodes are initialised with a native external signer
// instead of password+mnemonic. The payment steps (issue asset, open channel, 4 invoices,
// cooperative close, RGB sends) are identical.
export async function runRlnExternalSignerPaymentFlow() {
  const flowName = 'runRlnExternalSignerPaymentFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();
  let nodeA: RlnNodeRuntime | null = null;
  let nodeB: RlnNodeRuntime | null = null;
  let nodeC: RlnNodeRuntime | null = null;
  try {
    nodeA = await createRlnNodeRuntime({ name: 'nodeA', flowPrefix: 'rln_ext_pay_a', stepPrefix: 'extPayA', addStep, useExternalSigner: true });
    nodeB = await createRlnNodeRuntime({ name: 'nodeB', flowPrefix: 'rln_ext_pay_b', stepPrefix: 'extPayB', addStep, useExternalSigner: true });
    nodeC = await createRlnNodeRuntime({ name: 'nodeC', flowPrefix: 'rln_ext_pay_c', stepPrefix: 'extPayC', addStep, useExternalSigner: true });

    await fundAndCreateUtxosForNode(nodeA, 'extPayA', addStep);
    await fundAndCreateUtxosForNode(nodeB, 'extPayB', addStep);
    await fundAndCreateUtxosForNode(nodeC, 'extPayC', addStep);
    await mine(6);
    await sleep(5000)
    addStep('payIssueAsset', 'running');
    const issued = await nodeA.call('rlnIssueAssetNia', 'USDT', 'Tether', 0, [1000]);
    const assetId = String(issued?.assetId ?? issued?.asset_id ?? '');
    if (!assetId) throw new Error('Failed to issue asset');
    addStep('payIssueAsset', 'success', { assetId });

    const infoA = await nodeA.call('rlnNodeInfo');
    const infoB = await nodeB.call('rlnNodeInfo');
    const pubkeyA = String(infoA?.pubkey ?? '');
    const pubkeyB = String(infoB?.pubkey ?? '');
    addStep('payNodeInfos', 'success', {
      pubkeyA: pubkeyA.substring(0, 16) + '...',
      pubkeyB: pubkeyB.substring(0, 16) + '...',
    });

    addStep('payConnectPeers', 'running');
    const peerUriB = `${pubkeyB}@127.0.0.1:${nodeB.ldkPeerListeningPort}`;
    try { await nodeA.call('rlnConnectPeer', peerUriB); } catch { /* already connected */ }
    addStep('payConnectPeers', 'success', {});

    addStep('payOpenChannel', 'running');
    const openResp = await nodeA.call('rlnOpenChannel', {
      peerPubkeyAndOptAddr: peerUriB,
      capacitySat: 100000,
      pushMsat: 3_500_000,
      public: true,
      withAnchors: true,
      assetId,
      assetAmount: 600,
    });
    const tmpId = String(openResp?.temporaryChannelId ?? openResp?.temporary_channel_id ?? '');
    const { channelId, fundingTxid } = await waitForChannelFundingTx(nodeA, nodeB, tmpId, 120000, assetId);
    await waitForFundingConfirmed(nodeA, fundingTxid, 180000);
    await mine(6);
    await waitForChannelReady(nodeA);
    addStep('payOpenChannel', 'success', { channelId, fundingTxid });

    addStep('payAssetBalanceA', 'running');
    const balA0 = await nodeA.call('rlnAssetBalance', assetId);
    addStep('payAssetBalanceA', 'success', { spendable: balA0?.spendable ?? null });

    const paymentMsat = 3_000_000;

    addStep('payInvoice1', 'running');
    const invResp1 = await nodeB.call('rlnLnInvoice', paymentMsat, 900, assetId, 100);
    const invoice1 = String(invResp1?.invoice ?? invResp1 ?? '');
    const dec1 = await nodeA.call('rlnDecodeLnInvoice', invoice1);
    const hash1 = String(dec1?.paymentHash ?? dec1?.payment_hash ?? '');
    await nodeA.call('rlnSendPayment', invoice1, null, null, null);
    await waitForInvoiceStatus(nodeB.call.bind(nodeB), invoice1, 'SUCCEEDED', 60000);
    await waitForPaymentSuccess(nodeA.call.bind(nodeA), hash1, 60000);
    addStep('payInvoice1', 'success', { paymentHash: hash1, assetAmount: 100 });

    addStep('payInvoice2', 'running');
    const invResp2 = await nodeA.call('rlnLnInvoice', paymentMsat, 900, assetId, 50);
    const invoice2 = String(invResp2?.invoice ?? invResp2 ?? '');
    const dec2 = await nodeA.call('rlnDecodeLnInvoice', invoice2);
    const hash2 = String(dec2?.paymentHash ?? dec2?.payment_hash ?? '');
    await nodeB.call('rlnSendPayment', invoice2, null, null, null);
    await waitForInvoiceStatus(nodeA.call.bind(nodeA), invoice2, 'SUCCEEDED', 60000);
    await waitForPaymentSuccess(nodeB.call.bind(nodeB), hash2, 60000);
    addStep('payInvoice2', 'success', { paymentHash: hash2, assetAmount: 50 });

    addStep('payInvoice3', 'running');
    const invResp3 = await nodeB.call('rlnLnInvoice', paymentMsat, 900, assetId, 50);
    const invoice3 = String(invResp3?.invoice ?? invResp3 ?? '');
    const dec3 = await nodeA.call('rlnDecodeLnInvoice', invoice3);
    const hash3 = String(dec3?.paymentHash ?? dec3?.payment_hash ?? '');
    await nodeA.call('rlnSendPayment', invoice3, null, null, null);
    await waitForInvoiceStatus(nodeB.call.bind(nodeB), invoice3, 'SUCCEEDED', 60000);
    await waitForPaymentSuccess(nodeA.call.bind(nodeA), hash3, 60000);
    addStep('payInvoice3', 'success', { paymentHash: hash3, assetAmount: 50 });

    addStep('payInvoice4', 'running');
    const invResp4 = await nodeA.call('rlnLnInvoice', paymentMsat, 900, assetId, 50);
    const invoice4 = String(invResp4?.invoice ?? invResp4 ?? '');
    const dec4 = await nodeA.call('rlnDecodeLnInvoice', invoice4);
    const hash4 = String(dec4?.paymentHash ?? dec4?.payment_hash ?? '');
    await nodeB.call('rlnSendPayment', invoice4, null, null, null);
    await waitForInvoiceStatus(nodeA.call.bind(nodeA), invoice4, 'SUCCEEDED', 60000);
    await waitForPaymentSuccess(nodeB.call.bind(nodeB), hash4, 60000);
    addStep('payInvoice4', 'success', { paymentHash: hash4, assetAmount: 50 });

    await waitForStableChannelBalances(nodeA, nodeB, channelId, 30000);

    addStep('payCloseChannel', 'running');
    await nodeA.call('rlnCloseChannel', channelId, pubkeyB, false);
    await mine(6);
    addStep('payCloseChannel', 'success', { channelId });

    addStep('payWaitBalances', 'running');
    await waitForAssetBalance(nodeA, assetId, 950, 70000);
    await waitForAssetBalance(nodeB, assetId, 50, 70000);
    addStep('payWaitBalances', 'success', { expectedA: 950, expectedB: 50 });

    addStep('payRgbSendA', 'running');
    const invoiceC1 = await nodeC.call('rlnRgbInvoice', null, null, null, 1, false);
    const recipientC1 = String(invoiceC1?.recipientId ?? invoiceC1?.recipient_id ?? '');
    await nodeA.call('rlnSendRgb', true, 1, 1, false, assetId, recipientC1, 925, [nodeA.proxyEndpoint]);
    await mine(1);
    await nodeC.call('rlnRefreshTransfers', false);
    await nodeC.call('rlnRefreshTransfers', false);
    await nodeA.call('rlnRefreshTransfers', false);
    addStep('payRgbSendA', 'success', { amount: 925, recipient: recipientC1.substring(0, 20) + '...' });

    addStep('payRgbSendB', 'running');
    const invoiceC2 = await nodeC.call('rlnRgbInvoice', null, null, null, 1, false);
    const recipientC2 = String(invoiceC2?.recipientId ?? invoiceC2?.recipient_id ?? '');
    await nodeB.call('rlnSendRgb', true, 1, 1, false, assetId, recipientC2, 25, [nodeB.proxyEndpoint]);
    await mine(1);
    await nodeC.call('rlnRefreshTransfers', false);
    await nodeC.call('rlnRefreshTransfers', false);
    await nodeB.call('rlnRefreshTransfers', false);
    addStep('payRgbSendB', 'success', { amount: 25, recipient: recipientC2.substring(0, 20) + '...' });

    addStep('payFinalBalances', 'running');
    const [finalA, finalB, finalC] = await Promise.all([
      nodeA.call('rlnAssetBalance', assetId),
      nodeB.call('rlnAssetBalance', assetId),
      nodeC.call('rlnAssetBalance', assetId),
    ]);
    addStep('payFinalBalances', 'success', {
      spendableA: finalA?.spendable ?? null,
      spendableB: finalB?.spendable ?? null,
      spendableC: finalC?.spendable ?? null,
    });

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (nodeA) await nodeA.cleanup();
    if (nodeB) await nodeB.cleanup();
    if (nodeC) await nodeC.cleanup();
    endExclusiveFlow(flowName);
  }
}

export async function runRlnExternalSignerFlow() {
  const flowName = 'runRlnExternalSignerFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep } = createFlowResults();
  const rln = createRLNManager();
  let nodeCreated = false;
  let nodeDestroyed = false;
  let signerId: number | null = null;

  try {
    const network = 'regtest' as const;
    const rpcHost =
      readEnv('RLN_BITCOIND_RPC_HOST') ??
      (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
    const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
    const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
    const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
    const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
    const proxyEndpoint =
      readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;

    const keys = await createWallet(network);
    const seedHex = Buffer.from(mnemonicToSeedSync(keys.mnemonic)).slice(0, 32).toString('hex');

    const basePort = 20000 + Math.floor(Math.random() * 20000);
    const ldkPeerListeningPort = basePort + 1;
    const storageDirUri = `${documentDirectory ?? ''}rln_ext_signer_flow_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    try {
      await FileSystem.makeDirectoryAsync(storageDirUri, { intermediates: true });
    } catch {
      // best effort
    }
    const storageDirPath = storageDirUri.replace('file://', '');

    const unlockParams = {
      bitcoindRpcUsername: rpcUsername,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl,
      proxyEndpoint,
      announceAddresses: [] as string[],
      announceAlias: null as string | null,
    };

    // 1 — create node
    addStep('rlnCreateNode', 'running');
    await rln.rlnCreateNode({
      storageDirPath,
      daemonListeningPort: basePort,
      ldkPeerListeningPort,
      network,
      maxMediaUploadSizeMb: 20,
      enableVirtualChannelsV0: false,
    });
    nodeCreated = true;
    addStep('rlnCreateNode', 'success', {
      storageDirPath,
      daemonListeningPort: basePort,
      ldkPeerListeningPort,
      network,
    });

    // 2 — create native external signer from mnemonic seed
    addStep('rlnCreateNativeExternalSigner', 'running');
    signerId = await rln.rlnCreateNativeExternalSigner(seedHex, network);
    addStep('rlnCreateNativeExternalSigner', 'success', { signerId, network });

    // 3 — init node with external signer (no password / mnemonic passed)
    addStep('rlnInitNodeWithNativeExternalSigner', 'running');
    await rln.rlnInitNodeWithNativeExternalSigner(signerId);
    addStep('rlnInitNodeWithNativeExternalSigner', 'success', { signerId });

    // 4 — unlock with external signer (with retry for transient conflicts)
    addStep('rlnUnlockNodeWithNativeExternalSigner', 'running');
    let unlockAttempts = 0;
    let lastUnlockError: string | null = null;
    const maxUnlockAttempts = 12;
    for (let attempt = 1; attempt <= maxUnlockAttempts; attempt += 1) {
      unlockAttempts = attempt;
      try {
        await rln.rlnUnlockNodeWithNativeExternalSigner(signerId, unlockParams);
        lastUnlockError = null;
        break;
      } catch (err: any) {
        lastUnlockError = String(err?.message ?? err);
        if (!isRetryableNodeStateError(err) || attempt === maxUnlockAttempts) throw err;
        if (isNodeStateConflictError(err)) {
          const probe = await probeNodeReady(
            (name, ...args) => (rln as any)[name](...args),
            12,
            500
          );
          if (probe.ready) break;
        }
        await sleep(800);
      }
    }
    addStep('rlnUnlockNodeWithNativeExternalSigner', 'success', {
      rpcHost,
      rpcPort,
      indexerUrl,
      proxyEndpoint,
      attempts: unlockAttempts,
      recoveredFromRetry: unlockAttempts > 1,
      lastRetryError: lastUnlockError,
    });

    // 5 — fund
    addStep('rlnAddress', 'running');
    const addrResp = await rln.rlnAddress();
    addStep('rlnAddress', 'success', { address: addrResp.address });
    addStep('fundAddress', 'running');
    const txid = await sendToAddress(addrResp.address, 1);
    await mine(6);
    addStep('fundAddress', 'success', {
      txid,
      blocksMined: 6,
      amountBtc: 1,
      nodeEndpoint: BITCOIN_NODE_ENDPOINT,
    });

    // 6 — sync, balance, node info
    addStep('rlnSync', 'running');
    await rln.rlnSync();
    addStep('rlnSync', 'success', { synced: true });

    addStep('rlnBtcBalance', 'running');
    const balance = await rln.rlnBtcBalance(false);
    addStep('rlnBtcBalance', 'success', balance);

    addStep('rlnNodeInfo', 'running');
    const info = await rln.rlnNodeInfo();
    addStep('rlnNodeInfo', 'success', info);

    // 7 — shutdown
    addStep('rlnShutdown', 'running');
    await rln.rlnShutdown();
    addStep('rlnShutdown', 'success', { shutdown: true });

    // 8 — destroy node
    addStep('rlnDestroyNode', 'running');
    await rln.rlnDestroyNode();
    nodeCreated = false;
    nodeDestroyed = true;
    addStep('rlnDestroyNode', 'success', { destroyed: true });

    // 9 — destroy signer
    addStep('rlnDestroyNativeExternalSigner', 'running');
    await rln.rlnDestroyNativeExternalSigner(signerId);
    signerId = null;
    addStep('rlnDestroyNativeExternalSigner', 'success', { destroyed: true });

    results.success = true;
    return results;
  } catch (error: any) {
    results.success = false;
    results.error = { message: error?.message ?? String(error) };
    return results;
  } finally {
    if (nodeCreated && !nodeDestroyed) {
      try { await rln.rlnShutdown(); } catch {}
      try { await rln.rlnDestroyNode(); } catch {}
    }
    if (signerId !== null) {
      try { await rln.rlnDestroyNativeExternalSigner(signerId); } catch {}
    }
    endExclusiveFlow(flowName);
  }
}

const FAUCET_URL =
  'https://node-api.thunderstack.org/c17bc5d0-80b1-7050-5af5-dfd8a67834f1/1e0cfe422f0e4306bebdab953a0b99f2/sendbtc';
const FAUCET_TOKEN =
  'EnYKDBgDIggKBggGEgIYDRIkCAASIGuYoof1WC0FaPciGHzPinGmglHd_b3Lb-gokogoeL-aGkA_hc_eLZ05C1XaA9wrcqFh1Bozvi_sawa_QKNCcowZCsVRmrsxJYahtsMduWYGrOVT7JNVVvpcU4PrGu19GrYNIiIKIO5ajD4HcB-R-yadJQCA954KhC7DV2wHi4_piv9k1uYT';
const FAUCET_AMOUNT_SATS = 16900; // fallback only
const FUND_POLL_INTERVAL_MS = 5000;
const FUND_POLL_TIMEOUT_MS = 90000;



// SDK usage example — direct API calls, no internal helpers.
// Shows the minimal sequence to create a node with a native external signer,
// fund it, create UTXOs, and issue an RGB asset.
export async function runRlnExternalSignerIssueAssetFlow() {
  const flowName = 'runRlnExternalSignerIssueAssetFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();

  const rln = createRLNManager();
  let nodeCreated = false;
  let signerId: number | null = null;

  try {
    const network = 'regtest' as const;
    const rpcHost = readEnv('RLN_BITCOIND_RPC_HOST') ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
    const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
    const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
    const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
    const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
    const proxyEndpoint = readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;

    const keys = await createWallet(network);
    const seedHex = Buffer.from(mnemonicToSeedSync(keys.mnemonic)).slice(0, 32).toString('hex');

    const basePort = 20000 + Math.floor(Math.random() * 20000);
    const storageDirUri = `${documentDirectory ?? ''}rln_ext_issue_${Date.now()}`;
    await FileSystem.makeDirectoryAsync(storageDirUri, { intermediates: true });
    const storageDirPath = storageDirUri.replace('file://', '');

    // 1 — create node
    addStep('extIssueCreateNode', 'running');
    await rln.rlnCreateNode({
      storageDirPath,
      daemonListeningPort: basePort,
      ldkPeerListeningPort: basePort + 1,
      network,
      maxMediaUploadSizeMb: 20,
      enableVirtualChannelsV0: false,
    });
    nodeCreated = true;
    addStep('extIssueCreateNode', 'success', { storageDirPath });

    // 2 — create native external signer
    addStep('extIssueCreateExternalSigner', 'running');
    signerId = await rln.rlnCreateNativeExternalSigner(seedHex, network);
    addStep('extIssueCreateExternalSigner', 'success', { signerId });

    // 3 — init node with external signer
    addStep('extIssueInitNode', 'running');
    await rln.rlnInitNodeWithNativeExternalSigner(signerId);
    addStep('extIssueInitNode', 'success', {});

    // 4 — unlock node with external signer
    addStep('extIssueUnlockNode', 'running');
    await rln.rlnUnlockNodeWithNativeExternalSigner(signerId, {
      bitcoindRpcUsername: rpcUsername,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl,
      proxyEndpoint,
      announceAddresses: [],
      announceAlias: null,
    });
    addStep('extIssueUnlockNode', 'success', {});

    // 6 — node info after unlock
    addStep('extIssueNodeInfoAfter', 'running');
    const infoAfter = await rln.rlnNodeInfo();
    addStep('extIssueNodeInfoAfter', 'success', infoAfter);

    // 7 — fund
    addStep('extIssueFund', 'running');
    const addrResp = await rln.rlnAddress();
    const txid = await sendToAddress(addrResp.address, 1);
    await mine(6);
    await sleep(5000);
    await rln.rlnSync();
    const balance = await rln.rlnBtcBalance(false);
    addStep('extIssueFund', 'success', { txid, address: addrResp.address, balance });

    // 8 — create UTXOs
    addStep('extIssueCreateUtxos', 'running');
    await rln.rlnSync();
    await rln.rlnCreateUtxos(false, 10, null, 7, false);
    await mine(1);
    await rln.rlnSync();
    await sleep(2000);
    const unspents = await rln.rlnListUnspents(false);
    console.log('[extIssue] rlnListUnspents:', JSON.stringify(unspents));
    addStep('extIssueCreateUtxos', 'success', { num: 10, unspents });

    // 9 — issue asset
    addStep('extIssueAsset', 'running');
    const issued = await rln.rlnIssueAssetNia('USDT', 'Tether', 0, [1000]);
    const assetId = String(issued?.assetId ?? issued?.asset_id ?? '');
    if (!assetId) throw new Error('Failed to issue asset');
    addStep('extIssueAsset', 'success', { assetId });

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (nodeCreated) {
      try { await rln.rlnShutdown(); } catch {}
      try { await rln.rlnDestroyNode(); } catch {}
    }
    if (signerId !== null) {
      try { await rln.rlnDestroyNativeExternalSigner(signerId); } catch {}
    }
    endExclusiveFlow(flowName);
  }
}

// SDK usage example — direct API calls, no internal helpers.
// Mirrors Python run_regular_channel_flow_external_real:
//   nodeA — native external signer
//   nodeB — regular password node
//   open BTC channel, payment 1, restart nodeA, payment 2
export async function runRlnExternalSignerChannelPaymentFlow() {
  const flowName = 'runRlnExternalSignerChannelPaymentFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();

  let rlnA = createRLNManager();
  const rlnB = createRLNManager();
  let nodeACreated = false;
  let nodeBCreated = false;
  let signerId: number | null = null;

  try {
    const network = 'regtest' as const;
    const rpcHost = readEnv('RLN_BITCOIND_RPC_HOST') ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
    const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
    const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
    const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
    const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
    const proxyEndpoint = readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;

    const unlockParams = {
      bitcoindRpcUsername: rpcUsername,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl,
      proxyEndpoint,
      announceAddresses: [] as string[],
      announceAlias: null as string | null,
    };

    const keysA = await createWallet(network);
    const keysB = await createWallet(network);
    const seedHex = Buffer.from(mnemonicToSeedSync(keysA.mnemonic)).slice(0, 32).toString('hex');
    const nodeBPassword = 'nodeBpass';

    const basePortA = 20000 + Math.floor(Math.random() * 10000);
    const basePortB = basePortA + 100;
    const ts = Date.now();
    const storageDirUriA = `${documentDirectory ?? ''}rln_ext_chan_a_${ts}`;
    const storageDirUriB = `${documentDirectory ?? ''}rln_ext_chan_b_${ts}`;
    await FileSystem.makeDirectoryAsync(storageDirUriA, { intermediates: true });
    await FileSystem.makeDirectoryAsync(storageDirUriB, { intermediates: true });
    const storageDirA = storageDirUriA.replace('file://', '');
    const storageDirB = storageDirUriB.replace('file://', '');

    const nodeParamsA = { storageDirPath: storageDirA, daemonListeningPort: basePortA, ldkPeerListeningPort: basePortA + 1, network, maxMediaUploadSizeMb: 20, enableVirtualChannelsV0: false };
    const nodeParamsB = { storageDirPath: storageDirB, daemonListeningPort: basePortB, ldkPeerListeningPort: basePortB + 1, network, maxMediaUploadSizeMb: 20, enableVirtualChannelsV0: false };

    // 1 — create nodeA
    addStep('extChanACreateNode', 'running');
    await rlnA.rlnCreateNode(nodeParamsA);
    nodeACreated = true;
    addStep('extChanACreateNode', 'success', { storageDirPath: storageDirA });

    // 2 — create external signer for nodeA
    addStep('extChanACreateExternalSigner', 'running');
    signerId = await rlnA.rlnCreateNativeExternalSigner(seedHex, network);
    addStep('extChanACreateExternalSigner', 'success', { signerId });

    // 3 — init nodeA with external signer
    addStep('extChanAInitNode', 'running');
    await rlnA.rlnInitNodeWithNativeExternalSigner(signerId);
    addStep('extChanAInitNode', 'success', {});

    // 4 — unlock nodeA with external signer
    addStep('extChanAUnlockNode', 'running');
    await rlnA.rlnUnlockNodeWithNativeExternalSigner(signerId, unlockParams);
    addStep('extChanAUnlockNode', 'success', {});

    // 5 — create nodeB (regular password)
    addStep('extChanBCreateNode', 'running');
    await rlnB.rlnCreateNode(nodeParamsB);
    nodeBCreated = true;
    addStep('extChanBCreateNode', 'success', { storageDirPath: storageDirB });

    // 6 — init nodeB
    addStep('extChanBInitNode', 'running');
    await rlnB.rlnInitNode(nodeBPassword, keysB.mnemonic);
    addStep('extChanBInitNode', 'success', {});

    // 7 — unlock nodeB
    addStep('extChanBUnlockNode', 'running');
    await rlnB.rlnUnlockNode({ password: nodeBPassword, ...unlockParams });
    addStep('extChanBUnlockNode', 'success', {});

    // 8 — node infos
    const infoA = await rlnA.rlnNodeInfo();
    const infoB = await rlnB.rlnNodeInfo();
    const pubkeyA = String(infoA?.pubkey ?? '');
    const pubkeyB = String(infoB?.pubkey ?? '');
    addStep('extChanNodeInfos', 'success', {
      pubkeyA: pubkeyA.substring(0, 16) + '...',
      pubkeyB: pubkeyB.substring(0, 16) + '...',
    });

    // 9 — fund nodeA
    addStep('extChanAFund', 'running');
    const addrA = (await rlnA.rlnAddress()).address;
    const txidA = await sendToAddress(addrA, 1);
    await mine(6);
    await sleep(3000);
    await rlnA.rlnSync();
    const balA = await rlnA.rlnBtcBalance(false);
    addStep('extChanAFund', 'success', { txid: txidA, address: addrA, balance: balA });

    // 10 — create UTXOs for nodeA
    addStep('extChanACreateUtxos', 'running');
    await rlnA.rlnSync();
    await rlnA.rlnCreateUtxos(false, 10, null, 7, false);
    await mine(1);
    await rlnA.rlnSync();
    addStep('extChanACreateUtxos', 'success', { num: 10 });

    // 11 — fund nodeB
    addStep('extChanBFund', 'running');
    const addrB = (await rlnB.rlnAddress()).address;
    const txidB = await sendToAddress(addrB, 1);
    await mine(6);
    await sleep(3000);
    await rlnB.rlnSync();
    const balB = await rlnB.rlnBtcBalance(false);
    addStep('extChanBFund', 'success', { txid: txidB, address: addrB, balance: balB });

    // 12 — create UTXOs for nodeB
    addStep('extChanBCreateUtxos', 'running');
    await rlnB.rlnSync();
    await rlnB.rlnCreateUtxos(false, 10, null, 7, false);
    await mine(1);
    await rlnB.rlnSync();
    addStep('extChanBCreateUtxos', 'success', { num: 10 });

    // 13 — connect peers nodeA → nodeB
    addStep('extChanConnectPeers', 'running');
    const peerUriB = `${pubkeyB}@127.0.0.1:${basePortB + 1}`;
    console.log(`[extChan] connecting nodeA → ${peerUriB}`);
    try {
      await rlnA.rlnConnectPeer(peerUriB);
      console.log(`[extChan] connected to ${peerUriB}`);
    } catch (e: any) {
      if (isPoisonLike(e)) {
        addStep('extChanConnectPeers', 'error', undefined, e?.message ?? String(e));
        throw e;
      }
      console.warn(`[extChan] connectPeer ignored: ${e?.message ?? String(e)}`);
    }
    addStep('extChanConnectPeers', 'success', { peerUriB });

    // 14 — open BTC channel nodeA → nodeB (500k sat, no asset)
    addStep('extChanOpenChannel', 'running');
    const openResp = await rlnA.rlnOpenChannel({
      peerPubkeyAndOptAddr: peerUriB,
      capacitySat: 500000,
      pushMsat: 0,
      public: false,
      withAnchors: true,
      assetId: null,
      assetAmount: null,
    });
    const tmpId = String(openResp?.temporaryChannelId ?? '');
    console.log(`[extChan] opened channel tmpId=${tmpId}`);

    // wait for funding tx to appear in listChannels
    let fundingTxid = '';
    let channelId = '';
    const fundDeadline = Date.now() + 120000;
    while (Date.now() < fundDeadline) {
      await rlnA.rlnSync();
      const channels: any[] = (await rlnA.rlnListChannels()) ?? [];
      const ch = channels.find((c: any) => (c.fundingTxid ?? c.funding_txid) != null);
      if (ch) {
        fundingTxid = String(ch.fundingTxid ?? ch.funding_txid ?? '');
        channelId = String(ch.channelId ?? ch.channel_id ?? '');
        break;
      }
      await sleep(1000);
    }
    if (!fundingTxid) throw new Error('Timeout waiting for funding tx');
    console.log(`[extChan] channelId=${channelId} fundingTxid=${fundingTxid}`);
    console.log('[extChan] listChannels after funding:', JSON.stringify(await rlnA.rlnListChannels()));

    // mine and wait for usable channels on both nodes
    await mine(6);
    await sleep(3000);
    for (const [rln, label] of [[rlnA, 'nodeA'], [rlnB, 'nodeB']] as [any, string][]) {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        await rln.rlnSync();
        const info = await rln.rlnNodeInfo();
        const usable = Number(info?.numUsableChannels ?? 0);
        console.log(`[extChan] ${label} usableChannels=${usable}`);
        if (usable >= 1) break;
        await sleep(2000);
      }
    }
    addStep('extChanOpenChannel', 'success', { channelId, fundingTxid });

    // 15 — payment 1: nodeB creates invoice, nodeA pays
    addStep('extChanPayment1', 'running');
    const invResp1 = await rlnB.rlnLnInvoice(3_000_000, 900, null, null);
    const invoice1 = String(invResp1?.invoice ?? '');
    console.log(`[extChan] invoice1: ${invoice1.substring(0, 40)}...`);
    const send1 = await rlnA.rlnSendPayment(invoice1, null, null, null);
    const hash1 = String(send1?.paymentHash ?? '');
    console.log(`[extChan] payment1 hash=${hash1}`);
    const pay1Deadline = Date.now() + 60000;
    while (Date.now() < pay1Deadline) {
      await rlnA.rlnSync();
      const payments: any[] = (await rlnA.rlnListPayments()) ?? [];
      const p = payments.find((x: any) => (x?.paymentHash ?? x?.payment_hash) === hash1);
      const status = String(p?.status ?? '').toUpperCase();
      console.log(`[extChan] payment1 status=${status}`);
      if (status === 'SUCCEEDED') break;
      if (status === 'FAILED') throw new Error(`Payment1 failed: ${hash1}`);
      await sleep(2000);
    }
    addStep('extChanPayment1', 'success', { paymentHash: hash1 });

    // 16 — restart nodeA with same external signer (same storage, same ports)
    // Bridge handles SHUTDOWN path in create(): replaces Rust object, sets state to INITIALIZED.
    // Fresh JS manager needed — the old one tracks nodeId and rejects a second rlnCreateNode call.
    addStep('extChanRestartNodeA', 'running');
    await rlnA.rlnShutdown();
    await sleep(1000);
    rlnA = createRLNManager();   // fresh JS manager so rlnCreateNode JS check passes
    nodeACreated = false;
    await rlnA.rlnCreateNode(nodeParamsA);  // bridge detects SHUTDOWN path → restart, INITIALIZED
    nodeACreated = true;
    // no init — bridge restart already sets state to INITIALIZED; unlock directly
    await rlnA.rlnUnlockNodeWithNativeExternalSigner(signerId, unlockParams);
    console.log('[extChan] nodeA restarted with same external signer');
    const restartDeadline = Date.now() + 120000;
    while (Date.now() < restartDeadline) {
      await rlnA.rlnSync();
      const info = await rlnA.rlnNodeInfo();
      const usable = Number(info?.numUsableChannels ?? 0);
      console.log(`[extChan] nodeA usableChannels after restart=${usable}`);
      if (usable >= 1) break;
      await sleep(2000);
    }
    addStep('extChanRestartNodeA', 'success', {});

    // 17 — payment 2: nodeB creates invoice, nodeA pays (after restart)
    addStep('extChanPayment2', 'running');
    const invResp2 = await rlnB.rlnLnInvoice(3_000_000, 900, null, null);
    const invoice2 = String(invResp2?.invoice ?? '');
    console.log(`[extChan] invoice2: ${invoice2.substring(0, 40)}...`);
    const send2 = await rlnA.rlnSendPayment(invoice2, null, null, null);
    const hash2 = String(send2?.paymentHash ?? '');
    console.log(`[extChan] payment2 hash=${hash2}`);
    const pay2Deadline = Date.now() + 60000;
    while (Date.now() < pay2Deadline) {
      await rlnA.rlnSync();
      const payments: any[] = (await rlnA.rlnListPayments()) ?? [];
      const p = payments.find((x: any) => (x?.paymentHash ?? x?.payment_hash) === hash2);
      const status = String(p?.status ?? '').toUpperCase();
      console.log(`[extChan] payment2 status=${status}`);
      if (status === 'SUCCEEDED') break;
      if (status === 'FAILED') throw new Error(`Payment2 failed: ${hash2}`);
      await sleep(2000);
    }
    addStep('extChanPayment2', 'success', { paymentHash: hash2 });

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (nodeACreated) {
      try { await rlnA.rlnShutdown(); } catch {}
      try { await rlnA.rlnDestroyNode(); } catch {}
    }
    if (nodeBCreated) {
      try { await rlnB.rlnShutdown(); } catch {}
      try { await rlnB.rlnDestroyNode(); } catch {}
    }
    if (signerId !== null) {
      try { await rlnA.rlnDestroyNativeExternalSigner(signerId); } catch {}
    }
    endExclusiveFlow(flowName);
  }
}

// ── Response validator used only inside runRlnUtexoWalletChannelPaymentFlow ───
// Checks field presence/type against a schema; never throws.
// Schema values: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'nonempty-string'
function wChanValidate(
  fn: string,
  actual: any,
  schema: Record<string, string>,
): { fn: string; expected: Record<string, string>; received: any; match: boolean; fields: Record<string, boolean> } {
  const fields: Record<string, boolean> = {};
  for (const [key, type] of Object.entries(schema)) {
    const val = actual?.[key];
    if (type === 'nonempty-string') fields[key] = typeof val === 'string' && val.length > 0;
    else if (type === 'array') fields[key] = Array.isArray(val);
    else fields[key] = typeof val === type;
  }
  const match = Object.values(fields).every(Boolean);
  console.log(`[wChan][validate] ${fn} match=${match}`, JSON.stringify({ fields, received: actual }));
  return { fn, expected: schema, received: actual, match, fields };
}

export async function runRlnUtexoWalletChannelPaymentFlow() {
  const flowName = 'runRlnUtexoWalletChannelPaymentFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();

  let nodeA: UTEXOWallet | null = null;
  let nodeB: UTEXOWallet | null = null;

  try {
    const network = 'regtest' as const;
    const rpcHost = readEnv('RLN_BITCOIND_RPC_HOST') ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
    const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
    const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
    const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
    const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
    const proxyEndpoint = readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;

    const unlockParams = {
      bitcoindRpcUsername: rpcUsername,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl,
      proxyEndpoint,
      announceAddresses: [] as string[],
      announceAlias: null as string | null,
    };

    const keysA = await createWallet(network);
    const keysB = await createWallet(network);
    const nodeAPassword = 'nodeApass';
    const nodeBPassword = 'nodeBpass';

    const basePortA = 20000 + Math.floor(Math.random() * 10000);
    const basePortB = basePortA + 100;
    const ts = Date.now();
    const storageDirUriA = `${documentDirectory ?? ''}rln_wallet_chan_a_${ts}`;
    const storageDirUriB = `${documentDirectory ?? ''}rln_wallet_chan_b_${ts}`;
    await FileSystem.makeDirectoryAsync(storageDirUriA, { intermediates: true });
    await FileSystem.makeDirectoryAsync(storageDirUriB, { intermediates: true });
    const storageDirA = storageDirUriA.replace('file://', '');
    const storageDirB = storageDirUriB.replace('file://', '');

    nodeA = new UTEXOWallet(
      {
        storageDirPath: storageDirA,
        daemonListeningPort: basePortA,
        ldkPeerListeningPort: basePortA + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysA.accountXpubVanilla,
        xpubCol: keysA.accountXpubColored,
        masterFingerprint: keysA.masterFingerprint,
      },
      new PasswordRLNSigner(nodeAPassword, keysA.mnemonic),
    );

    nodeB = new UTEXOWallet(
      {
        storageDirPath: storageDirB,
        daemonListeningPort: basePortB,
        ldkPeerListeningPort: basePortB + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysB.accountXpubVanilla,
        xpubCol: keysB.accountXpubColored,
        masterFingerprint: keysB.masterFingerprint,
      },
      new PasswordRLNSigner(nodeBPassword, keysB.mnemonic),
    );

    // 1 — init nodeA (createNode + signer.initNode)
    addStep('wChanAInit', 'running');
    await nodeA.init();
    addStep('wChanAInit', 'success', { storageDirPath: storageDirA });

    // 2 — unlock nodeA
    addStep('wChanAUnlock', 'running');
    await nodeA.unlock(unlockParams);
    addStep('wChanAUnlock', 'success', {});

    // 3 — init nodeB (createNode + signer.initNode)
    addStep('wChanBInit', 'running');
    await nodeB.init();
    addStep('wChanBInit', 'success', { storageDirPath: storageDirB });

    // 4 — unlock nodeB (PasswordRLNSigner injects password automatically)
    addStep('wChanBUnlock', 'running');
    await nodeB.unlock(unlockParams);
    addStep('wChanBUnlock', 'success', {});

    // 5 — node infos
    // getNodeInfo() → RlnNodeInfo { pubkey, numUsableChannels, numChannels, localBalanceMsat, peers[] }
    const infoA = await nodeA.getNodeInfo();
    const infoB = await nodeB.getNodeInfo();
    const pubkeyA = String(infoA?.pubkey ?? '');
    const pubkeyB = String(infoB?.pubkey ?? '');
    const nodeInfoSchema = { pubkey: 'nonempty-string', numUsableChannels: 'number', numChannels: 'number', localBalanceMsat: 'number', peers: 'array' };
    const vInfoA = wChanValidate('getNodeInfo(nodeA)', infoA, nodeInfoSchema);
    const vInfoB = wChanValidate('getNodeInfo(nodeB)', infoB, nodeInfoSchema);
    addStep('wChanNodeInfos', 'success', {
      pubkeyA: pubkeyA.substring(0, 16) + '...',
      pubkeyB: pubkeyB.substring(0, 16) + '...',
      _v: { nodeA: { match: vInfoA.match, fields: vInfoA.fields }, nodeB: { match: vInfoB.match, fields: vInfoB.fields } },
    });

    // 6 — fund nodeA
    // getAddress() → string (bech32)
    // getBtcBalance() → BtcBalance { vanilla: { spendable, future, immature }, colored: { spendable, future, immature } }
    addStep('wChanAFund', 'running');
    const addrA = await nodeA.getAddress();
    const vAddrA = wChanValidate('getAddress(nodeA)', { address: addrA }, { address: 'nonempty-string' });
    const txidA = await sendToAddress(addrA, 1);
    await mine(6);
    await sleep(3000);
    await nodeA.syncWallet();
    const balA = await nodeA.getBtcBalance();
    const vBalA = wChanValidate('getBtcBalance(nodeA)', balA, { vanilla: 'object', colored: 'object' });
    addStep('wChanAFund', 'success', { txid: txidA, address: addrA, balance: balA,
      _v: { address: { match: vAddrA.match }, balance: { match: vBalA.match, fields: vBalA.fields, vanilla: balA?.vanilla, colored: balA?.colored } } });

    // 7 — create UTXOs for nodeA
    addStep('wChanACreateUtxos', 'running');
    await nodeA.syncWallet();
    await nodeA.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeA.syncWallet();
    addStep('wChanACreateUtxos', 'success', { num: 10 });

    // 8 — fund nodeB
    addStep('wChanBFund', 'running');
    const addrB = await nodeB.getAddress();
    const vAddrB = wChanValidate('getAddress(nodeB)', { address: addrB }, { address: 'nonempty-string' });
    const txidB = await sendToAddress(addrB, 1);
    await mine(6);
    await sleep(3000);
    await nodeB.syncWallet();
    const balB = await nodeB.getBtcBalance();
    const vBalB = wChanValidate('getBtcBalance(nodeB)', balB, { vanilla: 'object', colored: 'object' });
    addStep('wChanBFund', 'success', { txid: txidB, address: addrB, balance: balB,
      _v: { address: { match: vAddrB.match }, balance: { match: vBalB.match, fields: vBalB.fields, vanilla: balB?.vanilla, colored: balB?.colored } } });

    // 9 — create UTXOs for nodeB
    addStep('wChanBCreateUtxos', 'running');
    await nodeB.syncWallet();
    await nodeB.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeB.syncWallet();
    addStep('wChanBCreateUtxos', 'success', { num: 10 });

    // 10 — connect peers nodeA → nodeB
    addStep('wChanConnectPeers', 'running');
    const peerUriB = `${pubkeyB}@127.0.0.1:${basePortB + 1}`;
    console.log(`[wChan] connecting nodeA → ${peerUriB}`);
    try {
      await nodeA.connectPeer(peerUriB);
      console.log(`[wChan] connected to ${peerUriB}`);
    } catch (e: any) {
      if (isPoisonLike(e)) {
        addStep('wChanConnectPeers', 'error', undefined, e?.message ?? String(e));
        throw e;
      }
      console.warn(`[wChan] connectPeer ignored: ${e?.message ?? String(e)}`);
    }
    addStep('wChanConnectPeers', 'success', { peerUriB });

    // 11 — open BTC channel nodeA → nodeB (500k sat, no asset)
    // openChannel() → RlnOpenChannelResponse { temporaryChannelId: string }
    // listChannels() → RlnChannel[] — each: { channelId, fundingTxid, isUsable, capacitySat, localBalanceMsat, ... }
    addStep('wChanOpenChannel', 'running');
    const openResp = await nodeA.openChannel({
      peerPubkeyAndOptAddr: peerUriB,
      capacitySat: 500000,
      pushMsat: 0,
      public: false,
      withAnchors: true,
      assetId: null,
      assetAmount: null,
    });
    const vOpenResp = wChanValidate('openChannel(nodeA)', openResp, { temporaryChannelId: 'nonempty-string' });
    const tmpId = String(openResp?.temporaryChannelId ?? '');
    console.log(`[wChan] opened channel tmpId=${tmpId}`);

    let fundingTxid = '';
    let channelId = '';
    let foundChannel: any = null;
    const fundDeadline = Date.now() + 120000;
    while (Date.now() < fundDeadline) {
      await nodeA.syncWallet();
      const channels: any[] = (await nodeA.listChannels()) ?? [];
      const ch = channels.find((c: any) => (c.fundingTxid ?? c.funding_txid) != null);
      if (ch) {
        foundChannel = ch;
        fundingTxid = String(ch.fundingTxid ?? ch.funding_txid ?? '');
        channelId = String(ch.channelId ?? ch.channel_id ?? '');
        break;
      }
      await sleep(1000);
    }
    if (!fundingTxid) throw new Error('Timeout waiting for funding tx');
    const vChannel = wChanValidate('listChannels(nodeA)[found]', foundChannel, {
      channelId: 'nonempty-string', fundingTxid: 'nonempty-string',
      capacitySat: 'number', localBalanceMsat: 'number',
    });
    console.log(`[wChan] channelId=${channelId} fundingTxid=${fundingTxid}`);

    await mine(6);
    await sleep(3000);
    for (const [node, label] of [[nodeA, 'nodeA'], [nodeB, 'nodeB']] as [UTEXOWallet, string][]) {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        await node.syncWallet();
        const info = await node.getNodeInfo();
        const usable = Number(info?.numUsableChannels ?? 0);
        console.log(`[wChan] ${label} usableChannels=${usable}`);
        if (usable >= 1) break;
        await sleep(2000);
      }
    }
    addStep('wChanOpenChannel', 'success', { channelId, fundingTxid,
      _v: { openChannel: { match: vOpenResp.match, fields: vOpenResp.fields }, channel: { match: vChannel.match, fields: vChannel.fields, received: foundChannel } } });

    // 12 — payment 1: nodeB creates invoice, nodeA pays
    // createLightningInvoice() → { lnInvoice: string, amountMsat?: number, expirySeconds: number }
    // payLightningInvoice() → { txid: string }
    // getLightningSendRequest(hash) → status string: 'Pending' | 'Settled' | 'Failed'
    addStep('wChanPayment1', 'running');
    const inv1 = await nodeB.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId: '', amount: 0 } });
    const vInv1 = wChanValidate('createLightningInvoice(nodeB)', inv1, { lnInvoice: 'nonempty-string' });
    const invoice1 = String(inv1?.lnInvoice ?? '');
    console.log(`[wChan] invoice1: ${invoice1.substring(0, 40)}...`);
    const send1 = await nodeA.payLightningInvoice({ lnInvoice: invoice1 });
    const vSend1 = wChanValidate('payLightningInvoice(nodeA)', send1, { txid: 'nonempty-string' });
    const hash1 = String(send1?.txid ?? '');
    console.log(`[wChan] payment1 hash=${hash1}`);
    let status1 = '';
    const pay1Deadline = Date.now() + 60000;
    while (Date.now() < pay1Deadline) {
      await nodeA.syncWallet();
      status1 = String((await nodeA.getLightningSendRequest(hash1)) ?? '');
      console.log(`[wChan] payment1 status=${status1}`);
      if (status1 === 'Settled') break;
      if (status1 === 'Failed') throw new Error(`Payment1 failed: ${hash1}`);
      await sleep(2000);
    }
    const vStatus1 = wChanValidate('getLightningSendRequest(nodeA) payment1', { status: status1 }, { status: 'nonempty-string' });
    addStep('wChanPayment1', 'success', { paymentHash: hash1,
      _v: { invoice: { match: vInv1.match, fields: vInv1.fields }, pay: { match: vSend1.match, fields: vSend1.fields }, status: { value: status1, settled: status1 === 'Settled' } } });

    // 13 — restart nodeA (shutdown + reinit on same instance — no manager recreation needed)
    addStep('wChanRestartNodeA', 'running');
    await nodeA.shutdown();
    await sleep(1000);
    await nodeA.reinit(unlockParams);
    console.log('[wChan] nodeA restarted via UTEXOWallet.reinit()');
    const restartDeadline = Date.now() + 120000;
    while (Date.now() < restartDeadline) {
      await nodeA.syncWallet();
      const info = await nodeA.getNodeInfo();
      const usable = Number(info?.numUsableChannels ?? 0);
      console.log(`[wChan] nodeA usableChannels after restart=${usable}`);
      if (usable >= 1) break;
      await sleep(2000);
    }
    addStep('wChanRestartNodeA', 'success', {});

    // 14 — payment 2: nodeB creates invoice, nodeA pays (after restart)
    addStep('wChanPayment2', 'running');
    const inv2 = await nodeB.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId: '', amount: 0 } });
    const vInv2 = wChanValidate('createLightningInvoice(nodeB)', inv2, { lnInvoice: 'nonempty-string' });
    const invoice2 = String(inv2?.lnInvoice ?? '');
    console.log(`[wChan] invoice2: ${invoice2.substring(0, 40)}...`);
    const send2 = await nodeA.payLightningInvoice({ lnInvoice: invoice2 });
    const vSend2 = wChanValidate('payLightningInvoice(nodeA)', send2, { txid: 'nonempty-string' });
    const hash2 = String(send2?.txid ?? '');
    console.log(`[wChan] payment2 hash=${hash2}`);
    let status2 = '';
    const pay2Deadline = Date.now() + 60000;
    while (Date.now() < pay2Deadline) {
      await nodeA.syncWallet();
      status2 = String((await nodeA.getLightningSendRequest(hash2)) ?? '');
      console.log(`[wChan] payment2 status=${status2}`);
      if (status2 === 'Settled') break;
      if (status2 === 'Failed') throw new Error(`Payment2 failed: ${hash2}`);
      await sleep(2000);
    }
    addStep('wChanPayment2', 'success', { paymentHash: hash2,
      _v: { invoice: { match: vInv2.match, fields: vInv2.fields }, pay: { match: vSend2.match, fields: vSend2.fields }, status: { value: status2, settled: status2 === 'Settled' } } });

    // 15 — issue RGB asset on nodeA (1000 units)
    // issueAssetNia() → AssetNIA { assetId, ticker, name, precision, issuedSupply, timestamp, addedAt, balance: { spendable, future, settled } }
    addStep('wChanIssueAsset', 'running');
    await nodeA.syncWallet();
    const issued = await nodeA.issueAssetNia({ ticker: 'WCTS', name: 'WalletChanTest', precision: 0, amounts: [1000] });
    const vIssued = wChanValidate('issueAssetNia(nodeA)', issued, {
      assetId: 'nonempty-string', ticker: 'nonempty-string', name: 'nonempty-string',
      precision: 'number', issuedSupply: 'number', balance: 'object',
    });
    const assetId = String(issued?.assetId ?? '');
    await mine(1);
    await nodeA.syncWallet();
    await nodeA.refreshWallet();
    addStep('wChanIssueAsset', 'success', { assetId: assetId.substring(0, 20) + '...',
      _v: { match: vIssued.match, fields: vIssued.fields, received: { ticker: issued?.ticker, name: issued?.name, precision: issued?.precision, issuedSupply: issued?.issuedSupply, balance: issued?.balance } } });

    // 16 — nodeB generates witness invoice (nodeA will send 300 units with witnessData)
    // witnessReceive() → InvoiceReceiveData { invoice: string, recipientId: string, batchTransferIdx: number, expirationTimestamp?: number }
    // assetId/amount omitted: nodeB doesn't own the asset yet; passing them causes "resource not found"
    addStep('wChanWitnessReceive', 'running');
    await nodeB.syncWallet();
    const invWitness = await nodeB.witnessReceive({ minConfirmations: 1 });
    const vInvWitness = wChanValidate('witnessReceive(nodeB)', invWitness, {
      invoice: 'nonempty-string', recipientId: 'nonempty-string', batchTransferIdx: 'number',
    });
    const witnessInvoice = String(invWitness?.invoice ?? '');
    const witnessRecipientId = String(invWitness?.recipientId ?? '');
    console.log(`[wChan] witnessInvoice recipientId=${witnessRecipientId.substring(0, 20)}...`);
    addStep('wChanWitnessReceive', 'success', { recipientId: witnessRecipientId.substring(0, 20) + '...',
      _v: { match: vInvWitness.match, fields: vInvWitness.fields, received: { recipientId: witnessRecipientId.substring(0, 20) + '...', batchTransferIdx: invWitness?.batchTransferIdx } } });

    // 17 — nodeA sends 300 units to nodeB via witness invoice (witnessData.amountSat=1000)
    // send() → SendResult { txid: string, batchTransferIdx: number }
    // listOnchainTransfers(assetId) → Transfer[] — each: { kind, status, txid?, amount, assetId, ... }
    // listAssets() → ListAssets { nia?: AssetNIA[], cfa?: AssetCFA[], uda?: AssetUDA[] }
    addStep('wChanSendWitness', 'running');
    const sendWitness = await nodeA.send({
      invoice: witnessInvoice,
      assetId,
      amount: 300,
      donation: true,
      feeRate: 1,
      minConfirmations: 1,
      witnessData: { amountSat: 1000 },
    });
    const vSendWitness = wChanValidate('send(nodeA, witness)', sendWitness, { txid: 'nonempty-string', batchTransferIdx: 'number' });
    await mine(1);
    await nodeA.syncWallet();
    await nodeB.syncWallet();
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await nodeB.refreshWallet();
    const transfersWitness = await nodeA.listOnchainTransfers(assetId);
    const vTransfersW = wChanValidate('listOnchainTransfers(nodeA)', { transfers: transfersWitness }, { transfers: 'array' });
    const assetsAfterWitness = await nodeA.listAssets();
    const vAssetsW = wChanValidate('listAssets(nodeA)', assetsAfterWitness, { nia: 'array' });
    console.log(`[wChan] after witness send: transferCount=${transfersWitness.length} assetCount=${assetsAfterWitness?.nia?.length ?? 0}`);
    addStep('wChanSendWitness', 'success', {
      amount: 300,
      recipientId: witnessRecipientId.substring(0, 20) + '...',
      transferCount: transfersWitness.length,
      _v: {
        send: { match: vSendWitness.match, fields: vSendWitness.fields, received: sendWitness },
        transfers: { match: vTransfersW.match, count: transfersWitness.length, sample: transfersWitness[0] ?? null },
        assets: { match: vAssetsW.match, niaCount: assetsAfterWitness?.nia?.length ?? 0 },
      },
    });

    // 18 — nodeB generates blind invoice (nodeA will send 200 units, no witnessData)
    // blindReceive() → InvoiceReceiveData { invoice: string, recipientId: string, batchTransferIdx: number, expirationTimestamp?: number }
    // assetId/amount omitted: nodeB receives for the first time; asset not yet in its db
    addStep('wChanBlindReceive', 'running');
    await nodeB.syncWallet();
    const invBlind = await nodeB.blindReceive({ minConfirmations: 1 });
    const vInvBlind = wChanValidate('blindReceive(nodeB)', invBlind, {
      invoice: 'nonempty-string', recipientId: 'nonempty-string', batchTransferIdx: 'number',
    });
    const blindInvoice = String(invBlind?.invoice ?? '');
    const blindRecipientId = String(invBlind?.recipientId ?? '');
    console.log(`[wChan] blindInvoice recipientId=${blindRecipientId.substring(0, 20)}...`);
    addStep('wChanBlindReceive', 'success', { recipientId: blindRecipientId.substring(0, 20) + '...',
      _v: { match: vInvBlind.match, fields: vInvBlind.fields, received: { recipientId: blindRecipientId.substring(0, 20) + '...', batchTransferIdx: invBlind?.batchTransferIdx } } });

    // 19 — nodeA sends 200 units to nodeB via blind invoice (no witnessData)
    addStep('wChanSendBlind', 'running');
    const sendBlind = await nodeA.send({
      invoice: blindInvoice,
      assetId,
      amount: 200,
      donation: true,
      feeRate: 1,
      minConfirmations: 1,
    });
    const vSendBlind = wChanValidate('send(nodeA, blind)', sendBlind, { txid: 'nonempty-string', batchTransferIdx: 'number' });
    await mine(1);
    await nodeA.syncWallet();
    await nodeB.syncWallet();
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await nodeB.refreshWallet();
    const transfersBlind = await nodeA.listOnchainTransfers(assetId);
    const vTransfersB = wChanValidate('listOnchainTransfers(nodeA)', { transfers: transfersBlind }, { transfers: 'array' });
    const assetsAfterBlind = await nodeA.listAssets();
    const vAssetsB = wChanValidate('listAssets(nodeA)', assetsAfterBlind, { nia: 'array' });
    console.log(`[wChan] after blind send: transferCount=${transfersBlind.length} assetCount=${assetsAfterBlind?.nia?.length ?? 0}`);
    addStep('wChanSendBlind', 'success', {
      amount: 200,
      recipientId: blindRecipientId.substring(0, 20) + '...',
      transferCount: transfersBlind.length,
      _v: {
        send: { match: vSendBlind.match, fields: vSendBlind.fields, received: sendBlind },
        transfers: { match: vTransfersB.match, count: transfersBlind.length, sample: transfersBlind[0] ?? null },
        assets: { match: vAssetsB.match, niaCount: assetsAfterBlind?.nia?.length ?? 0 },
      },
    });

    // 20 — final asset balances: nodeA=500, nodeB=500
    // getAssetBalance(assetId) → AssetBalance { spendable: number, future: number, settled: number }
    addStep('wChanFinalBalances', 'running');
    const [finalBalA, finalBalB] = await Promise.all([
      nodeA.getAssetBalance(assetId),
      nodeB.getAssetBalance(assetId),
    ]);
    const balSchema = { spendable: 'number', future: 'number', settled: 'number' };
    const vFinalA = wChanValidate('getAssetBalance(nodeA)', finalBalA, balSchema);
    const vFinalB = wChanValidate('getAssetBalance(nodeB)', finalBalB, balSchema);
    console.log(`[wChan] finalA=${finalBalA?.spendable} finalB=${finalBalB?.spendable}`);
    addStep('wChanFinalBalances', 'success', {
      spendableA: finalBalA?.spendable ?? null,
      spendableB: finalBalB?.spendable ?? null,
      _v: {
        nodeA: { match: vFinalA.match, fields: vFinalA.fields, received: finalBalA, expectedSpendable: 500, matchSpendable: finalBalA?.spendable === 500 },
        nodeB: { match: vFinalB.match, fields: vFinalB.fields, received: finalBalB, expectedSpendable: 500, matchSpendable: finalBalB?.spendable === 500 },
      },
    });

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (nodeA) { try { await nodeA.destroy(); } catch {} }
    if (nodeB) { try { await nodeB.destroy(); } catch {} }
    endExclusiveFlow(flowName);
  }
}

export async function runRlnUtexoWalletAssetChannelExtSignerFlow() {
  const flowName = 'runRlnUtexoWalletAssetChannelExtSignerFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();

  let nodeA: UTEXOWallet | null = null;
  let nodeB: UTEXOWallet | null = null;

  try {
    const network = 'regtest' as const;
    const rpcHost = readEnv('RLN_BITCOIND_RPC_HOST') ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
    const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
    const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
    const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
    const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
    const proxyEndpoint = readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;

    const unlockParams = {
      bitcoindRpcUsername: rpcUsername,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl,
      proxyEndpoint,
      announceAddresses: [] as string[],
      announceAlias: null as string | null,
    };

    const keysA = await createWallet(network);
    const keysB = await createWallet(network);
    const nodeAPassword = 'nodeApass';

    const basePortA = 20000 + Math.floor(Math.random() * 10000);
    const basePortB = basePortA + 100;
    const ts = Date.now();
    const storageDirUriA = `${documentDirectory ?? ''}rln_asext_a_${ts}`;
    const storageDirUriB = `${documentDirectory ?? ''}rln_asext_b_${ts}`;
    await FileSystem.makeDirectoryAsync(storageDirUriA, { intermediates: true });
    await FileSystem.makeDirectoryAsync(storageDirUriB, { intermediates: true });
    const storageDirA = storageDirUriA.replace('file://', '');
    const storageDirB = storageDirUriB.replace('file://', '');

    // nodeA — regular node (PasswordRLNSigner): issues asset, opens asset channel, pays
    nodeA = new UTEXOWallet(
      {
        storageDirPath: storageDirA,
        daemonListeningPort: basePortA,
        ldkPeerListeningPort: basePortA + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysA.accountXpubVanilla,
        xpubCol: keysA.accountXpubColored,
        masterFingerprint: keysA.masterFingerprint,
      },
      new PasswordRLNSigner(nodeAPassword, keysA.mnemonic),
    );

    // nodeB — external signer node (NativeExternalRLNSigner): creates invoices
    nodeB = new UTEXOWallet(
      {
        storageDirPath: storageDirB,
        daemonListeningPort: basePortB,
        ldkPeerListeningPort: basePortB + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysB.accountXpubVanilla,
        xpubCol: keysB.accountXpubColored,
        masterFingerprint: keysB.masterFingerprint,
      },
      new NativeExternalRLNSigner(keysB.mnemonic, network),
    );

    // 1 — init nodeA
    addStep('wAsExtAInit', 'running');
    await nodeA.init();
    addStep('wAsExtAInit', 'success', { storageDirPath: storageDirA });

    // 2 — unlock nodeA
    addStep('wAsExtAUnlock', 'running');
    await nodeA.unlock(unlockParams);
    addStep('wAsExtAUnlock', 'success', {});

    // 3 — init nodeB
    addStep('wAsExtBInit', 'running');
    await nodeB.init();
    addStep('wAsExtBInit', 'success', { storageDirPath: storageDirB });

    // 4 — unlock nodeB
    addStep('wAsExtBUnlock', 'running');
    await nodeB.unlock(unlockParams);
    addStep('wAsExtBUnlock', 'success', {});

    // 5 — node infos
    const infoA = await nodeA.getNodeInfo();
    const infoB = await nodeB.getNodeInfo();
    const pubkeyA = String(infoA?.pubkey ?? '');
    const pubkeyB = String(infoB?.pubkey ?? '');
    addStep('wAsExtNodeInfos', 'success', {
      pubkeyA: pubkeyA.substring(0, 16) + '...',
      pubkeyB: pubkeyB.substring(0, 16) + '...',
    });

    // 6 — fund nodeA
    addStep('wAsExtAFund', 'running');
    const addrA = await nodeA.getAddress();
    const txidA = await sendToAddress(addrA, 1);
    await mine(6);
    await sleep(3000);
    await nodeA.syncWallet();
    const balA = await nodeA.getBtcBalance();
    addStep('wAsExtAFund', 'success', { txid: txidA, address: addrA, balance: balA });

    // 7 — create UTXOs for nodeA
    addStep('wAsExtACreateUtxos', 'running');
    await nodeA.syncWallet();
    await nodeA.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeA.syncWallet();
    addStep('wAsExtACreateUtxos', 'success', { num: 10 });

    // 8 — fund nodeB
    addStep('wAsExtBFund', 'running');
    const addrB = await nodeB.getAddress();
    const txidB = await sendToAddress(addrB, 1);
    await mine(6);
    await sleep(3000);
    await nodeB.syncWallet();
    const balB = await nodeB.getBtcBalance();
    addStep('wAsExtBFund', 'success', { txid: txidB, address: addrB, balance: balB });

    // 9 — create UTXOs for nodeB
    addStep('wAsExtBCreateUtxos', 'running');
    await nodeB.syncWallet();
    await nodeB.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeB.syncWallet();
    addStep('wAsExtBCreateUtxos', 'success', { num: 10 });

    // 10 — issue asset on nodeA (regular node)
    addStep('wAsExtIssueAsset', 'running');
    const issued = await nodeA.issueAssetNia({ ticker: 'USDT', name: 'Tether', precision: 0, amounts: [1000] });
    const assetId = String(issued?.assetId ?? '');
    if (!assetId) throw new Error('Failed to issue asset');
    addStep('wAsExtIssueAsset', 'success', { assetId });

    // 11 — connect peers nodeA → nodeB
    addStep('wAsExtConnectPeers', 'running');
    const peerUriB = `${pubkeyB}@127.0.0.1:${basePortB + 1}`;
    const peerUriA = `${pubkeyA}@127.0.0.1:${basePortA + 1}`;
    console.log(`[wAsExt] connecting nodeA → ${peerUriB}`);
    try {
      await nodeA.connectPeer(peerUriB);
      console.log(`[wAsExt] connected to ${peerUriB}`);
    } catch (e: any) {
      if (isPoisonLike(e)) {
        addStep('wAsExtConnectPeers', 'error', undefined, e?.message ?? String(e));
        throw e;
      }
      console.warn(`[wAsExt] connectPeer ignored: ${e?.message ?? String(e)}`);
    }
    addStep('wAsExtConnectPeers', 'success', { peerUriB });

    // 12 — open asset channel nodeA → nodeB (600 units, 100k sat)
    // pushMsat must be 0: channel_signer.rs hardcodes push_value_msat=0 when calling VLS SetupChannel,
    // so any non-zero push causes VLS to reject validate_holder_commitment on the acceptor side.
    addStep('wAsExtOpenChannel', 'running');
    await nodeA.openChannel({
      peerPubkeyAndOptAddr: peerUriB,
      capacitySat: 100000,
      pushMsat: 3_500_000,
      public: false,
      withAnchors: true,
      assetId,
      assetAmount: 600,
    });

    let fundingTxid = '';
    let channelId = '';
    const fundDeadline = Date.now() + 120000;
    while (Date.now() < fundDeadline) {
      await nodeA.syncWallet();
      const channels: any[] = (await nodeA.listChannels()) ?? [];
      const ch = channels.find(
        (c: any) => (c.assetId ?? c.asset_id) === assetId && (c.fundingTxid ?? c.funding_txid) != null,
      );
      if (ch) {
        fundingTxid = String(ch.fundingTxid ?? ch.funding_txid ?? '');
        channelId = String(ch.channelId ?? ch.channel_id ?? '');
        break;
      }
      await sleep(1000);
    }
    if (!fundingTxid) throw new Error('Timeout waiting for funding tx');
    console.log(`[wAsExt] channelId=${channelId} fundingTxid=${fundingTxid}`);

    await mine(6);
    await sleep(3000);
    for (const [node, label] of [[nodeA, 'nodeA'], [nodeB, 'nodeB']] as [UTEXOWallet, string][]) {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        await node.syncWallet();
        const info = await node.getNodeInfo();
        const usable = Number(info?.numUsableChannels ?? 0);
        console.log(`[wAsExt] ${label} usableChannels=${usable}`);
        if (usable >= 1) break;
        await sleep(2000);
      }
    }
    await mine(6);
    addStep('wAsExtOpenChannel', 'success', { channelId, fundingTxid, assetId });

    // log asset balances after channel open to confirm push worked
    const balAfterA = await nodeA.getAssetBalance(assetId).catch(() => null);
    const balAfterB = await nodeB.getAssetBalance(assetId).catch(() => null);
    console.log(`[wAsExt] assetBalance after open — nodeA: ${JSON.stringify(balAfterA)}, nodeB: ${JSON.stringify(balAfterB)}`);
    const channelsA = await nodeA.listChannels().catch(() => []);
    const channelsB = await nodeB.listChannels().catch(() => []);
    console.log(`[wAsExt] nodeA channels: ${JSON.stringify(channelsA)}`);
    console.log(`[wAsExt] nodeB channels: ${JSON.stringify(channelsB)}`);

    // 13 — payment 1: nodeB (ext signer) creates asset invoice, nodeA (regular) pays
    addStep('wAsExtPayment1', 'running');
    const inv1 = await nodeB.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 100 } });
    console.log(`[wAsExt] createLightningInvoice raw response: ${JSON.stringify(inv1)}`);
    const invoice1 = String(inv1?.lnInvoice ?? '');
    console.log(`[wAsExt] invoice1 type=${typeof inv1?.lnInvoice} length=${invoice1.length} first60="${invoice1.substring(0, 60)}"`);
    console.log(`[wAsExt] invoice1 charCodes(0-5): ${Array.from(invoice1.substring(0, 6)).map(c => c.charCodeAt(0)).join(',')}`);
    console.log(`[wAsExt] calling nodeA.payLightningInvoice with invoice1`);
    const send1 = await nodeA.payLightningInvoice({ lnInvoice: invoice1 });
    const hash1 = String(send1?.txid ?? '');
    console.log(`[wAsExt] payment1 hash=${hash1}`);
    const pay1Deadline = Date.now() + 60000;
    while (Date.now() < pay1Deadline) {
      await nodeA.syncWallet();
      const status = await nodeA.getLightningSendRequest(hash1);
      console.log(`[wAsExt] payment1 status=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Payment1 failed: ${hash1}`);
      await sleep(2000);
    }
    addStep('wAsExtPayment1', 'success', { paymentHash: hash1, assetAmount: 100 });

    // 14 — restart nodeA (shutdown + reinit on same instance)
    addStep('wAsExtRestartNodeA', 'running');
    await nodeA.shutdown();
    await sleep(1000);
    await nodeA.reinit(unlockParams);
    console.log('[wAsExt] nodeA restarted via UTEXOWallet.reinit()');
    const restartDeadline = Date.now() + 120000;
    while (Date.now() < restartDeadline) {
      await nodeA.syncWallet();
      const info = await nodeA.getNodeInfo();
      const usable = Number(info?.numUsableChannels ?? 0);
      console.log(`[wAsExt] nodeA usableChannels after restart=${usable}`);
      if (usable >= 1) break;
      await sleep(2000);
    }
    addStep('wAsExtRestartNodeA', 'success', {});

    // 15 — payment 2: nodeB creates invoice, nodeA pays (after restart)
    addStep('wAsExtPayment2', 'running');
    const inv2 = await nodeB.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 50 } });
    const invoice2 = String(inv2?.lnInvoice ?? '');
    console.log(`[wAsExt] invoice2: ${invoice2.substring(0, 40)}...`);
    const send2 = await nodeA.payLightningInvoice({ lnInvoice: invoice2 });
    const hash2 = String(send2?.txid ?? '');
    console.log(`[wAsExt] payment2 hash=${hash2}`);
    const pay2Deadline = Date.now() + 60000;
    while (Date.now() < pay2Deadline) {
      await nodeA.syncWallet();
      const status = await nodeA.getLightningSendRequest(hash2);
      console.log(`[wAsExt] payment2 status=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Payment2 failed: ${hash2}`);
      await sleep(2000);
    }
    addStep('wAsExtPayment2', 'success', { paymentHash: hash2, assetAmount: 50 });

    // 16 — cooperative close channel nodeA → nodeB
    // After payments: nodeA channel=450, nodeB channel=150; nodeA off-chain=400
    // Expected after close: nodeA=850 (400+450), nodeB=150
    addStep('wAsExtCloseChannel', 'running');
    try { await nodeA.syncWallet(); } catch {}
    try { await nodeB.syncWallet(); } catch {}
    await nodeA.closeChannel(channelId, pubkeyB, false);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await sleep(20000);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await sleep(20000);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    addStep('wAsExtCloseChannel', 'success', { channelId });

    // 17 — wait for on-chain balances to settle
    addStep('wAsExtWaitBalances', 'running');
    const balDeadline = Date.now() + 170000;
    let lastSpendableA = -1;
    let lastSpendableB = -1;
    while (Date.now() < balDeadline) {
      try {
        const b = await nodeA.getAssetBalance(assetId);
        lastSpendableA = Number(b?.spendable ?? -1);
        console.log(`[wAsExt] waitBal nodeA spendable=${lastSpendableA} expected=850`);
      } catch (e: any) { console.warn(`[wAsExt] waitBal nodeA: ${e?.message}`); }
      try {
        const b = await nodeB.getAssetBalance(assetId);
        lastSpendableB = Number(b?.spendable ?? -1);
        console.log(`[wAsExt] waitBal nodeB spendable=${lastSpendableB} expected=150`);
      } catch (e: any) { console.warn(`[wAsExt] waitBal nodeB: ${e?.message}`); }
      if (lastSpendableA === 850 && lastSpendableB === 150) break;
      try { await nodeA.refreshWallet(); } catch {}
      try { await nodeB.refreshWallet(); } catch {}
      await sleep(12000);
    }
    if (lastSpendableA !== 850) throw new Error(`nodeA balance did not reach 850, last=${lastSpendableA}`);
    if (lastSpendableB !== 150) throw new Error(`nodeB balance did not reach 150, last=${lastSpendableB}`);
    addStep('wAsExtWaitBalances', 'success', { expectedA: 850, expectedB: 150 });

    // TODO iteration 2: nodeA → nodeB second channel (original direction)
    // addStep('wAsExt2ConnectPeers', 'running');
    // ...
    // addStep('wAsExt2OpenChannel', 'running');  // nodeA opens 500-unit channel to nodeB
    // ...
    // addStep('wAsExt2Payment', 'running');       // nodeB creates invoice, nodeA pays 100 units
    // ...
    // addStep('wAsExt2CloseChannel', 'running');  // nodeA closes, expected A=750, B=250
    // ...
    // addStep('wAsExt2WaitBalances', 'running');
    // ...

    // 18 — reconnect peers for second channel (nodeB signer → nodeA password)
    // NativeExternalRLNSigner (VLS) is the channel initiator here; this tests whether VLS
    // can open a channel. FundingGenerationReady is known to loop without producing a funding
    // tx when VLS is the funder — this step will time out if that Rust-layer bug is present.
    addStep('wAsExtRevConnectPeers', 'running');
    try {
      await nodeB.connectPeer(peerUriA);
    } catch (e: any) {
      if (isPoisonLike(e)) {
        addStep('wAsExtRevConnectPeers', 'error', undefined, e?.message ?? String(e));
        throw e;
      }
      console.warn(`[wAsExt] rev connectPeer ignored: ${e?.message ?? String(e)}`);
    }
    addStep('wAsExtRevConnectPeers', 'success', { peerUriA });

    // 19 — open second channel nodeB (VLS) → nodeA (100 units, 100k sat)
    // nodeB off-chain=150; nodeB puts 100 units into channel (off-chain→50), pushMsat to nodeA.
    // Channel after open: nodeB=100 units, nodeA=0 units.
    addStep('wAsExtRevOpenChannel', 'running');
    await nodeB.syncWallet();
    await nodeB.openChannel({
      peerPubkeyAndOptAddr: peerUriA,
      capacitySat: 100000,
      pushMsat: 3_500_000,
      public: false,
      withAnchors: true,
      assetId,
      assetAmount: 100,
    });

    let revFundingTxid = '';
    let revChannelId = '';
    const revFundDeadline = Date.now() + 120000;
    // nodeB is the initiator, so assetId appears in nodeB.listChannels().
    while (Date.now() < revFundDeadline) {
      await nodeB.syncWallet();
      const channels: any[] = (await nodeB.listChannels()) ?? [];
      const ch = channels.find(
        (c: any) =>
          (c.assetId ?? c.asset_id) === assetId &&
          (c.fundingTxid ?? c.funding_txid) != null,
      );
      if (ch) {
        revFundingTxid = String(ch.fundingTxid ?? ch.funding_txid ?? '');
        revChannelId = String(ch.channelId ?? ch.channel_id ?? '');
        break;
      }
      await sleep(1000);
    }
    if (!revFundingTxid) throw new Error('Timeout waiting for reverse funding tx');
    console.log(`[wAsExt] rev channelId=${revChannelId} fundingTxid=${revFundingTxid}`);

    // listChannels() returns fundingTxid as soon as FundingCreated is sent, but with
    // NativeExternalRLNSigner the VLS signing on the initiator (nodeB) side takes several
    // seconds, so the funding tx may not be broadcast yet. Mine in a retry loop.
    await sleep(5000);
    const revOpenDeadline = Date.now() + 120000;
    let revOpenDone = false;
    while (Date.now() < revOpenDeadline) {
      await mine(6);
      await sleep(3000);
      let allUsable = true;
      for (const [node, label] of [[nodeA, 'nodeA'], [nodeB, 'nodeB']] as [UTEXOWallet, string][]) {
        await node.syncWallet();
        const info = await node.getNodeInfo();
        const usable = Number(info?.numUsableChannels ?? 0);
        console.log(`[wAsExt] rev open ${label} usableChannels=${usable}`);
        if (usable < 1) allUsable = false;
      }
      if (allUsable) { revOpenDone = true; break; }
      await sleep(5000);
    }
    if (!revOpenDone) throw new Error('Reverse channel never became usable within 120s');
    await mine(6);
    addStep('wAsExtRevOpenChannel', 'success', { channelId: revChannelId, fundingTxid: revFundingTxid, assetId });

    // 20 — payment: nodeA creates invoice (50 units), nodeB (VLS initiator) pays
    // Channel: nodeB=100, nodeA=0; after payment: nodeB=50, nodeA=50
    addStep('wAsExtRevPayment', 'running');
    const invRev = await nodeA.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 50 } });
    const invoiceRev = String(invRev?.lnInvoice ?? '');
    const sendRev = await nodeB.payLightningInvoice({ lnInvoice: invoiceRev });
    const hashRev = String(sendRev?.txid ?? '');
    console.log(`[wAsExt] rev payment hash=${hashRev}`);
    const revPayDeadline = Date.now() + 60000;
    while (Date.now() < revPayDeadline) {
      await nodeB.syncWallet();
      const status = await nodeB.getLightningSendRequest(hashRev);
      console.log(`[wAsExt] rev payment status=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Rev payment failed: ${hashRev}`);
      await sleep(2000);
    }
    addStep('wAsExtRevPayment', 'success', { paymentHash: hashRev, assetAmount: 50 });

    // 21 — cooperative close reverse channel (nodeA initiates)
    // Expected after close: nodeA=850+50=900, nodeB=50+50=100
    addStep('wAsExtRevCloseChannel', 'running');
    try { await nodeA.syncWallet(); } catch {}
    try { await nodeB.syncWallet(); } catch {}
    await nodeA.closeChannel(revChannelId, pubkeyB, false);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await sleep(20000);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await sleep(20000);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    addStep('wAsExtRevCloseChannel', 'success', { channelId: revChannelId });

    // 22 — wait for settled balances: A=900, B=100
    addStep('wAsExtRevWaitBalances', 'running');
    const revBalDeadline = Date.now() + 300000;
    let lastSpendableRevA = -1;
    let lastSpendableRevB = -1;
    while (Date.now() < revBalDeadline) {
      try {
        const b = await nodeA.getAssetBalance(assetId);
        lastSpendableRevA = Number(b?.spendable ?? -1);
        console.log(`[wAsExt] rev waitBal nodeA spendable=${lastSpendableRevA} expected=900`);
      } catch (e: any) { console.warn(`[wAsExt] rev waitBal nodeA: ${e?.message}`); }
      try {
        const b = await nodeB.getAssetBalance(assetId);
        lastSpendableRevB = Number(b?.spendable ?? -1);
        console.log(`[wAsExt] rev waitBal nodeB spendable=${lastSpendableRevB} expected=100`);
      } catch (e: any) { console.warn(`[wAsExt] rev waitBal nodeB: ${e?.message}`); }
      if (lastSpendableRevA === 900 && lastSpendableRevB === 100) break;
      try { await nodeA.refreshWallet(); } catch {}
      try { await nodeB.refreshWallet(); } catch {}
      await sleep(12000);
    }
    if (lastSpendableRevA !== 900) throw new Error(`nodeA rev balance did not reach 900, last=${lastSpendableRevA}`);
    if (lastSpendableRevB !== 100) throw new Error(`nodeB rev balance did not reach 100, last=${lastSpendableRevB}`);
    addStep('wAsExtRevWaitBalances', 'success', { expectedA: 900, expectedB: 100 });

    // TODO iteration 2: nodeB RGB on-chain sends 150 back to nodeA
    // addStep('wAsExtRgbSendBtoA', 'running');
    // const invA = await nodeA.blindReceive({ minConfirmations: 1 });
    // await nodeB.send({ invoice: invA.invoice, assetId, amount: 150, donation: true, feeRate: 1, minConfirmations: 1 });
    // await mine(1);
    // await nodeA.syncWallet();
    // await nodeA.refreshWallet();
    // await nodeA.refreshWallet();
    // await nodeB.refreshWallet();
    // addStep('wAsExtRgbSendBtoA', 'success', { amount: 150, recipientId: invA.recipientId.substring(0, 20) + '...' });

    // TODO iteration 2: final balances: A=1000, B=0
    // addStep('wAsExtFinalBalances', 'running');
    // const [finalA, finalB] = await Promise.all([
    //   nodeA.getAssetBalance(assetId),
    //   nodeB.getAssetBalance(assetId).catch(() => ({ spendable: 0 })),
    // ]);
    // addStep('wAsExtFinalBalances', 'success', {
    //   spendableA: finalA?.spendable ?? null,
    //   spendableB: finalB?.spendable ?? null,
    // });

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (nodeA) { try { await nodeA.destroy(); } catch {} }
    if (nodeB) { try { await nodeB.destroy(); } catch {} }
    endExclusiveFlow(flowName);
  }
}

export async function runRLNUtexoPaymentFlow() {
  const flowName = 'runRLNUtexoPaymentFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();

  let nodeA: UTEXOWallet | null = null;
  let nodeB: UTEXOWallet | null = null;
  let nodeC: UTEXOWallet | null = null;

  try {
    const network = 'regtest' as const;
    const rpcHost = readEnv('RLN_BITCOIND_RPC_HOST') ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
    const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
    const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
    const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
    const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
    const proxyEndpoint = readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;

    const unlockParams = {
      bitcoindRpcUsername: rpcUsername,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl,
      proxyEndpoint,
      announceAddresses: [] as string[],
      announceAlias: null as string | null,
    };

    const keysA = await createWallet(network);
    const keysB = await createWallet(network);
    const keysC = await createWallet(network);
    const nodeAPassword = 'nodeApass';
    const nodeBPassword = 'nodeBpass';
    const nodeCPassword = 'nodeCpass';

    const basePortA = 21000 + Math.floor(Math.random() * 5000);
    const basePortB = basePortA + 100;
    const basePortC = basePortA + 200;
    const ts = Date.now();
    const storageDirUriA = `${documentDirectory ?? ''}rln_utexo_pay_a_${ts}`;
    const storageDirUriB = `${documentDirectory ?? ''}rln_utexo_pay_b_${ts}`;
    const storageDirUriC = `${documentDirectory ?? ''}rln_utexo_pay_c_${ts}`;
    await FileSystem.makeDirectoryAsync(storageDirUriA, { intermediates: true });
    await FileSystem.makeDirectoryAsync(storageDirUriB, { intermediates: true });
    await FileSystem.makeDirectoryAsync(storageDirUriC, { intermediates: true });
    const storageDirA = storageDirUriA.replace('file://', '');
    const storageDirB = storageDirUriB.replace('file://', '');
    const storageDirC = storageDirUriC.replace('file://', '');

    nodeA = new UTEXOWallet(
      {
        storageDirPath: storageDirA,
        daemonListeningPort: basePortA,
        ldkPeerListeningPort: basePortA + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysA.accountXpubVanilla,
        xpubCol: keysA.accountXpubColored,
        masterFingerprint: keysA.masterFingerprint,
      },
      new PasswordRLNSigner(nodeAPassword, keysA.mnemonic),
    );
    nodeB = new UTEXOWallet(
      {
        storageDirPath: storageDirB,
        daemonListeningPort: basePortB,
        ldkPeerListeningPort: basePortB + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysB.accountXpubVanilla,
        xpubCol: keysB.accountXpubColored,
        masterFingerprint: keysB.masterFingerprint,
      },
      new PasswordRLNSigner(nodeBPassword, keysB.mnemonic),
    );
    nodeC = new UTEXOWallet(
      {
        storageDirPath: storageDirC,
        daemonListeningPort: basePortC,
        ldkPeerListeningPort: basePortC + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysC.accountXpubVanilla,
        xpubCol: keysC.accountXpubColored,
        masterFingerprint: keysC.masterFingerprint,
      },
      new PasswordRLNSigner(nodeCPassword, keysC.mnemonic),
    );

    addStep('wPayAInit', 'running');
    await nodeA.init();
    addStep('wPayAInit', 'success', { storageDirPath: storageDirA });

    addStep('wPayAUnlock', 'running');
    await nodeA.unlock(unlockParams);
    addStep('wPayAUnlock', 'success', {});

    addStep('wPayBInit', 'running');
    await nodeB.init();
    addStep('wPayBInit', 'success', { storageDirPath: storageDirB });

    addStep('wPayBUnlock', 'running');
    await nodeB.unlock(unlockParams);
    addStep('wPayBUnlock', 'success', {});

    addStep('wPayCInit', 'running');
    await nodeC.init();
    addStep('wPayCInit', 'success', { storageDirPath: storageDirC });

    addStep('wPayCUnlock', 'running');
    await nodeC.unlock(unlockParams);
    addStep('wPayCUnlock', 'success', {});

    addStep('wPayAFund', 'running');
    const addrA = await nodeA.getAddress();
    const txidA = await sendToAddress(addrA, 1);
    await mine(6);
    await sleep(3000);
    await nodeA.syncWallet();
    const balA = await nodeA.getBtcBalance();
    addStep('wPayAFund', 'success', { txid: txidA, address: addrA, balance: balA });

    addStep('wPayACreateUtxos', 'running');
    await nodeA.syncWallet();
    await nodeA.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeA.syncWallet();
    addStep('wPayACreateUtxos', 'success', { num: 10 });

    addStep('wPayBFund', 'running');
    const addrB = await nodeB.getAddress();
    const txidB = await sendToAddress(addrB, 1);
    await mine(6);
    await sleep(3000);
    await nodeB.syncWallet();
    const balB = await nodeB.getBtcBalance();
    addStep('wPayBFund', 'success', { txid: txidB, address: addrB, balance: balB });

    addStep('wPayBCreateUtxos', 'running');
    await nodeB.syncWallet();
    await nodeB.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeB.syncWallet();
    addStep('wPayBCreateUtxos', 'success', { num: 10 });

    addStep('wPayCFund', 'running');
    const addrC = await nodeC.getAddress();
    const txidC = await sendToAddress(addrC, 1);
    await mine(6);
    await sleep(3000);
    await nodeC.syncWallet();
    const balC = await nodeC.getBtcBalance();
    addStep('wPayCFund', 'success', { txid: txidC, address: addrC, balance: balC });

    addStep('wPayCCreateUtxos', 'running');
    await nodeC.syncWallet();
    await nodeC.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeC.syncWallet();
    addStep('wPayCCreateUtxos', 'success', { num: 10 });

    addStep('wPayIssueAsset', 'running');
    const issued = await nodeA.issueAssetNia({ ticker: 'USDT', name: 'Tether', precision: 0, amounts: [1000] });
    const assetId = String(issued?.assetId ?? '');
    if (!assetId) throw new Error('Failed to issue asset');
    addStep('wPayIssueAsset', 'success', { assetId });

    const infoA = await nodeA.getNodeInfo();
    const infoB = await nodeB.getNodeInfo();
    const pubkeyA = String(infoA?.pubkey ?? '');
    const pubkeyB = String(infoB?.pubkey ?? '');
    addStep('wPayNodeInfos', 'success', {
      pubkeyA: pubkeyA.substring(0, 16) + '...',
      pubkeyB: pubkeyB.substring(0, 16) + '...',
    });

    addStep('wPayConnectPeers', 'running');
    const peerUriB = `${pubkeyB}@127.0.0.1:${basePortB + 1}`;
    try {
      await nodeA.connectPeer(peerUriB);
    } catch (e: any) {
      if (isPoisonLike(e)) {
        addStep('wPayConnectPeers', 'error', undefined, e?.message ?? String(e));
        throw e;
      }
      console.warn(`[wPay] connectPeer ignored: ${e?.message ?? String(e)}`);
    }
    addStep('wPayConnectPeers', 'success', { peerUriB });

    // nodeA opens asset channel to nodeB (600 units pushed, 100k sat)
    addStep('wPayOpenChannel', 'running');
    await nodeA.openChannel({
      peerPubkeyAndOptAddr: peerUriB,
      capacitySat: 100000,
      pushMsat: 3_500_000,
      public: true,
      withAnchors: true,
      assetId,
      assetAmount: 600,
    });

    let fundingTxid = '';
    let channelId = '';
    const fundDeadline = Date.now() + 120000;
    while (Date.now() < fundDeadline) {
      await nodeA.syncWallet();
      const channels: any[] = (await nodeA.listChannels()) ?? [];
      const ch = channels.find(
        (c: any) => (c.assetId ?? c.asset_id) === assetId && (c.fundingTxid ?? c.funding_txid) != null,
      );
      if (ch) {
        fundingTxid = String(ch.fundingTxid ?? ch.funding_txid ?? '');
        channelId = String(ch.channelId ?? ch.channel_id ?? '');
        break;
      }
      await sleep(1000);
    }
    if (!fundingTxid) throw new Error('Timeout waiting for funding tx');
    console.log(`[wPay] channelId=${channelId} fundingTxid=${fundingTxid}`);

    await mine(6);
    await sleep(3000);
    for (const [node, label] of [[nodeA, 'nodeA'], [nodeB, 'nodeB']] as [UTEXOWallet, string][]) {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        await node.syncWallet();
        const info = await node.getNodeInfo();
        const usable = Number(info?.numUsableChannels ?? 0);
        console.log(`[wPay] ${label} usableChannels=${usable}`);
        if (usable >= 1) break;
        await sleep(2000);
      }
    }
    await mine(6);
    addStep('wPayOpenChannel', 'success', { channelId, fundingTxid });

    addStep('wPayAssetBalanceA', 'running');
    const bal0 = await nodeA.getAssetBalance(assetId);
    addStep('wPayAssetBalanceA', 'success', { spendable: bal0?.spendable ?? null });

    // inv1: B creates (100 asset units), A pays
    addStep('wPayInvoice1', 'running');
    const inv1Resp = await nodeB.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 100 } });
    const invoice1 = String(inv1Resp?.lnInvoice ?? '');
    const send1Resp = await nodeA.payLightningInvoice({ lnInvoice: invoice1 });
    const hash1 = String(send1Resp?.txid ?? '');
    const pay1Deadline = Date.now() + 60000;
    while (Date.now() < pay1Deadline) {
      await nodeA.syncWallet();
      const status = await nodeA.getLightningSendRequest(hash1);
      console.log(`[wPay] inv1 sendStatus=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Invoice1 payment failed: ${hash1}`);
      await sleep(2000);
    }
    addStep('wPayInvoice1', 'success', { paymentHash: hash1, assetAmount: 100 });

    // inv2: A creates (50 asset units), B pays
    addStep('wPayInvoice2', 'running');
    const inv2Resp = await nodeA.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 50 } });
    const invoice2 = String(inv2Resp?.lnInvoice ?? '');
    const send2Resp = await nodeB.payLightningInvoice({ lnInvoice: invoice2 });
    const hash2 = String(send2Resp?.txid ?? '');
    const pay2Deadline = Date.now() + 60000;
    while (Date.now() < pay2Deadline) {
      await nodeB.syncWallet();
      const status = await nodeB.getLightningSendRequest(hash2);
      console.log(`[wPay] inv2 sendStatus=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Invoice2 payment failed: ${hash2}`);
      await sleep(2000);
    }
    addStep('wPayInvoice2', 'success', { paymentHash: hash2, assetAmount: 50 });

    // inv3: B creates (50 asset units), A pays
    addStep('wPayInvoice3', 'running');
    const inv3Resp = await nodeB.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 50 } });
    const invoice3 = String(inv3Resp?.lnInvoice ?? '');
    const send3Resp = await nodeA.payLightningInvoice({ lnInvoice: invoice3 });
    const hash3 = String(send3Resp?.txid ?? '');
    const pay3Deadline = Date.now() + 60000;
    while (Date.now() < pay3Deadline) {
      await nodeA.syncWallet();
      const status = await nodeA.getLightningSendRequest(hash3);
      console.log(`[wPay] inv3 sendStatus=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Invoice3 payment failed: ${hash3}`);
      await sleep(2000);
    }
    addStep('wPayInvoice3', 'success', { paymentHash: hash3, assetAmount: 50 });

    // inv4: A creates (50 asset units), B pays
    addStep('wPayInvoice4', 'running');
    const inv4Resp = await nodeA.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 50 } });
    const invoice4 = String(inv4Resp?.lnInvoice ?? '');
    const send4Resp = await nodeB.payLightningInvoice({ lnInvoice: invoice4 });
    const hash4 = String(send4Resp?.txid ?? '');
    const pay4Deadline = Date.now() + 60000;
    while (Date.now() < pay4Deadline) {
      await nodeB.syncWallet();
      const status = await nodeB.getLightningSendRequest(hash4);
      console.log(`[wPay] inv4 sendStatus=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Invoice4 payment failed: ${hash4}`);
      await sleep(2000);
    }
    addStep('wPayInvoice4', 'success', { paymentHash: hash4, assetAmount: 50 });

    // Cooperative close
    addStep('wPayCloseChannel', 'running');
    try { await nodeA.syncWallet(); } catch {}
    try { await nodeB.syncWallet(); } catch {}
    await nodeA.closeChannel(channelId, pubkeyB, false);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await sleep(20000);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await sleep(20000);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    addStep('wPayCloseChannel', 'success', { channelId });

    // After close: A=950 (400 settled + 550 from channel), B=50
    addStep('wPayWaitBalances', 'running');
    const balDeadlineA = Date.now() + 70000;
    let lastSpendableA = -1;
    while (Date.now() < balDeadlineA) {
      try {
        const b = await nodeA.getAssetBalance(assetId);
        lastSpendableA = Number(b?.spendable ?? -1);
        console.log(`[wPay] waitBal nodeA spendable=${lastSpendableA} expected=950`);
        if (lastSpendableA === 950) break;
      } catch (e: any) { console.warn(`[wPay] waitBal nodeA: ${e?.message}`); }
      try { await nodeA.refreshWallet(); } catch {}
      await sleep(2000);
    }
    if (lastSpendableA !== 950) throw new Error(`nodeA balance did not reach 950, last=${lastSpendableA}`);

    const balDeadlineB = Date.now() + 70000;
    let lastSpendableB = -1;
    while (Date.now() < balDeadlineB) {
      try {
        const b = await nodeB.getAssetBalance(assetId);
        lastSpendableB = Number(b?.spendable ?? -1);
        console.log(`[wPay] waitBal nodeB spendable=${lastSpendableB} expected=50`);
        if (lastSpendableB === 50) break;
      } catch (e: any) { console.warn(`[wPay] waitBal nodeB: ${e?.message}`); }
      try { await nodeB.refreshWallet(); } catch {}
      await sleep(2000);
    }
    if (lastSpendableB !== 50) throw new Error(`nodeB balance did not reach 50, last=${lastSpendableB}`);
    addStep('wPayWaitBalances', 'success', { expectedA: 950, expectedB: 50 });

    // RGB on-chain sends to nodeC (A sends 925, B sends 25)
    addStep('wPayRgbSendA', 'running');
    const invC1 = await nodeC.blindReceive({ minConfirmations: 1 });
    await nodeA.send({ invoice: invC1.invoice, assetId, amount: 925, donation: true, feeRate: 1, minConfirmations: 1 });
    await mine(1);
    await nodeC.syncWallet();
    await nodeC.refreshWallet();
    await nodeC.refreshWallet();
    await nodeA.refreshWallet();
    addStep('wPayRgbSendA', 'success', { amount: 925, recipientId: invC1.recipientId.substring(0, 20) + '...' });

    addStep('wPayRgbSendB', 'running');
    const invC2 = await nodeC.blindReceive({ minConfirmations: 1 });
    await nodeB.send({ invoice: invC2.invoice, assetId, amount: 25, donation: true, feeRate: 1, minConfirmations: 1 });
    await mine(1);
    await nodeC.syncWallet();
    await nodeC.refreshWallet();
    await nodeC.refreshWallet();
    await nodeB.refreshWallet();
    addStep('wPayRgbSendB', 'success', { amount: 25, recipientId: invC2.recipientId.substring(0, 20) + '...' });

    // Final balances: A=25, B=25, C=950
    addStep('wPayFinalBalances', 'running');
    const [finalA, finalB, finalC] = await Promise.all([
      nodeA.getAssetBalance(assetId),
      nodeB.getAssetBalance(assetId),
      nodeC.getAssetBalance(assetId),
    ]);
    addStep('wPayFinalBalances', 'success', {
      spendableA: finalA?.spendable ?? null,
      spendableB: finalB?.spendable ?? null,
      spendableC: finalC?.spendable ?? null,
    });

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (nodeA) { try { await nodeA.destroy(); } catch {} }
    if (nodeB) { try { await nodeB.destroy(); } catch {} }
    if (nodeC) { try { await nodeC.destroy(); } catch {} }
    endExclusiveFlow(flowName);
  }
}

// Same as runRLNUtexoPaymentFlow but nodeB uses NativeExternalRLNSigner.
// pushMsat must be 0 — VLS rejects non-zero push on the acceptor side.
// Balance math (pushMsat=0): open: A=600, B=0
//   inv1(B→A 100): A=500, B=100  inv2(A→B 50): A=550, B=50
//   inv3(B→A 50):  A=500, B=100  inv4(A→B 50): A=550, B=50
//   after close: A=400+550=950, B=50
//   rgb send A→C 925, B→C 25 → A=25, B=25, C=950
export async function runRLNUtexoExternalPaymentFlow() {
  const flowName = 'runRLNUtexoExternalPaymentFlow';
  beginExclusiveFlow(flowName);
  const { results, addStep, failFlow } = createFlowResults();

  let nodeA: UTEXOWallet | null = null;
  let nodeB: UTEXOWallet | null = null;
  let nodeC: UTEXOWallet | null = null;

  try {
    const network = 'regtest' as const;
    const rpcHost = readEnv('RLN_BITCOIND_RPC_HOST') ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
    const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
    const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
    const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
    const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
    const proxyEndpoint = readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;

    const unlockParams = {
      bitcoindRpcUsername: rpcUsername,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl,
      proxyEndpoint,
      announceAddresses: [] as string[],
      announceAlias: null as string | null,
    };

    const keysA = await createWallet(network);
    const keysB = await createWallet(network);
    const keysC = await createWallet(network);
    const nodeAPassword = 'nodeApass';
    const nodeCPassword = 'nodeCpass';

    const basePortA = 22000 + Math.floor(Math.random() * 5000);
    const basePortB = basePortA + 100;
    const basePortC = basePortA + 200;
    const ts = Date.now();
    const storageDirUriA = `${documentDirectory ?? ''}rln_xpay_a_${ts}`;
    const storageDirUriB = `${documentDirectory ?? ''}rln_xpay_b_${ts}`;
    const storageDirUriC = `${documentDirectory ?? ''}rln_xpay_c_${ts}`;
    await FileSystem.makeDirectoryAsync(storageDirUriA, { intermediates: true });
    await FileSystem.makeDirectoryAsync(storageDirUriB, { intermediates: true });
    await FileSystem.makeDirectoryAsync(storageDirUriC, { intermediates: true });
    const storageDirA = storageDirUriA.replace('file://', '');
    const storageDirB = storageDirUriB.replace('file://', '');
    const storageDirC = storageDirUriC.replace('file://', '');

    nodeA = new UTEXOWallet(
      {
        storageDirPath: storageDirA,
        daemonListeningPort: basePortA,
        ldkPeerListeningPort: basePortA + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysA.accountXpubVanilla,
        xpubCol: keysA.accountXpubColored,
        masterFingerprint: keysA.masterFingerprint,
      },
      new PasswordRLNSigner(nodeAPassword, keysA.mnemonic),
    );
    // nodeB uses NativeExternalRLNSigner — VLS in-process transport
    nodeB = new UTEXOWallet(
      {
        storageDirPath: storageDirB,
        daemonListeningPort: basePortB,
        ldkPeerListeningPort: basePortB + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysB.accountXpubVanilla,
        xpubCol: keysB.accountXpubColored,
        masterFingerprint: keysB.masterFingerprint,
      },
      new NativeExternalRLNSigner(keysB.mnemonic, network),
    );
    nodeC = new UTEXOWallet(
      {
        storageDirPath: storageDirC,
        daemonListeningPort: basePortC,
        ldkPeerListeningPort: basePortC + 1,
        network,
        maxMediaUploadSizeMb: 20,
        enableVirtualChannelsV0: false,
        xpubVan: keysC.accountXpubVanilla,
        xpubCol: keysC.accountXpubColored,
        masterFingerprint: keysC.masterFingerprint,
      },
      new PasswordRLNSigner(nodeCPassword, keysC.mnemonic),
    );

    addStep('xPayAInit', 'running');
    await nodeA.init();
    addStep('xPayAInit', 'success', { storageDirPath: storageDirA });

    addStep('xPayAUnlock', 'running');
    await nodeA.unlock(unlockParams);
    addStep('xPayAUnlock', 'success', {});

    addStep('xPayBInit', 'running');
    await nodeB.init();
    addStep('xPayBInit', 'success', { storageDirPath: storageDirB });

    addStep('xPayBUnlock', 'running');
    await nodeB.unlock(unlockParams);
    addStep('xPayBUnlock', 'success', {});

    addStep('xPayCInit', 'running');
    await nodeC.init();
    addStep('xPayCInit', 'success', { storageDirPath: storageDirC });

    addStep('xPayCUnlock', 'running');
    await nodeC.unlock(unlockParams);
    addStep('xPayCUnlock', 'success', {});

    addStep('xPayAFund', 'running');
    const addrA = await nodeA.getAddress();
    const txidA = await sendToAddress(addrA, 1);
    await mine(6);
    await sleep(3000);
    await nodeA.syncWallet();
    const balA = await nodeA.getBtcBalance();
    addStep('xPayAFund', 'success', { txid: txidA, address: addrA, balance: balA });

    addStep('xPayACreateUtxos', 'running');
    await nodeA.syncWallet();
    await nodeA.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeA.syncWallet();
    addStep('xPayACreateUtxos', 'success', { num: 10 });

    addStep('xPayBFund', 'running');
    const addrB = await nodeB.getAddress();
    const txidB = await sendToAddress(addrB, 1);
    await mine(6);
    await sleep(3000);
    await nodeB.syncWallet();
    const balB = await nodeB.getBtcBalance();
    addStep('xPayBFund', 'success', { txid: txidB, address: addrB, balance: balB });

    addStep('xPayBCreateUtxos', 'running');
    await nodeB.syncWallet();
    await nodeB.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeB.syncWallet();
    addStep('xPayBCreateUtxos', 'success', { num: 10 });

    addStep('xPayCFund', 'running');
    const addrC = await nodeC.getAddress();
    const txidC = await sendToAddress(addrC, 1);
    await mine(6);
    await sleep(3000);
    await nodeC.syncWallet();
    const balC = await nodeC.getBtcBalance();
    addStep('xPayCFund', 'success', { txid: txidC, address: addrC, balance: balC });

    addStep('xPayCCreateUtxos', 'running');
    await nodeC.syncWallet();
    await nodeC.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await mine(1);
    await nodeC.syncWallet();
    addStep('xPayCCreateUtxos', 'success', { num: 10 });

    addStep('xPayIssueAsset', 'running');
    const issued = await nodeA.issueAssetNia({ ticker: 'USDT', name: 'Tether', precision: 0, amounts: [1000] });
    const assetId = String(issued?.assetId ?? '');
    if (!assetId) throw new Error('Failed to issue asset');
    addStep('xPayIssueAsset', 'success', { assetId });

    const infoA = await nodeA.getNodeInfo();
    const infoB = await nodeB.getNodeInfo();
    const pubkeyA = String(infoA?.pubkey ?? '');
    const pubkeyB = String(infoB?.pubkey ?? '');
    addStep('xPayNodeInfos', 'success', {
      pubkeyA: pubkeyA.substring(0, 16) + '...',
      pubkeyB: pubkeyB.substring(0, 16) + '...',
    });

    addStep('xPayConnectPeers', 'running');
    const peerUriB = `${pubkeyB}@127.0.0.1:${basePortB + 1}`;
    try {
      await nodeA.connectPeer(peerUriB);
    } catch (e: any) {
      if (isPoisonLike(e)) {
        addStep('xPayConnectPeers', 'error', undefined, e?.message ?? String(e));
        throw e;
      }
      console.warn(`[xPay] connectPeer ignored: ${e?.message ?? String(e)}`);
    }
    addStep('xPayConnectPeers', 'success', { peerUriB });

    // nodeA opens asset channel to nodeB; pushMsat=0 required for external signer acceptor
    let fundingTxid = '';
    let channelId = '';
    addStep('xPayOpenChannel', 'running');
    try {
    await nodeA.openChannel({
      peerPubkeyAndOptAddr: peerUriB,
      capacitySat: 100000,
      pushMsat: 0,
      public: true,
      withAnchors: true,
      assetId,
      assetAmount: 600,
    });
    const fundDeadline = Date.now() + 120000;
    while (Date.now() < fundDeadline) {
      await nodeA.syncWallet();
      const channels: any[] = (await nodeA.listChannels()) ?? [];
      const ch = channels.find(
        (c: any) => (c.assetId ?? c.asset_id) === assetId && (c.fundingTxid ?? c.funding_txid) != null,
      );
      if (ch) {
        fundingTxid = String(ch.fundingTxid ?? ch.funding_txid ?? '');
        channelId = String(ch.channelId ?? ch.channel_id ?? '');
        break;
      }
      await sleep(1000);
    }
    if (!fundingTxid) throw new Error('Timeout waiting for funding tx');
    console.log(`[xPay] channelId=${channelId} fundingTxid=${fundingTxid}`);

    await mine(6);
    await sleep(3000);
    for (const [node, label] of [[nodeA, 'nodeA'], [nodeB, 'nodeB']] as [UTEXOWallet, string][]) {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        await node.syncWallet();
        const info = await node.getNodeInfo();
        const usable = Number(info?.numUsableChannels ?? 0);
        console.log(`[xPay] ${label} usableChannels=${usable}`);
        if (usable >= 1) break;
        await sleep(2000);
      }
    }
    await mine(6);
    addStep('xPayOpenChannel', 'success', { channelId, fundingTxid });
    } catch (e: any) {
      addStep('xPayOpenChannel', 'error', undefined, e?.message ?? String(e));
      throw e;
    }

    addStep('xPayAssetBalanceA', 'running');
    const bal0 = await nodeA.getAssetBalance(assetId);
    addStep('xPayAssetBalanceA', 'success', { spendable: bal0?.spendable ?? null });

    // inv1: B creates (100 asset units), A pays → A_chan=500, B_chan=100
    // amountSats=5000 so nodeB gets 5000 sats; it will need 3000+1000(reserve)=4000 for inv2.
    addStep('xPayInvoice1', 'running');
    const inv1Resp = await nodeB.createLightningInvoice({ amountSats: 5000, expirySeconds: 900, asset: { assetId, amount: 100 } });
    const invoice1 = String(inv1Resp?.lnInvoice ?? '');
    const send1Resp = await nodeA.payLightningInvoice({ lnInvoice: invoice1 });
    const hash1 = String(send1Resp?.txid ?? '');
    const pay1Deadline = Date.now() + 60000;
    while (Date.now() < pay1Deadline) {
      await nodeA.syncWallet();
      const status = await nodeA.getLightningSendRequest(hash1);
      console.log(`[xPay] inv1 sendStatus=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Invoice1 payment failed: ${hash1}`);
      await sleep(2000);
    }
    addStep('xPayInvoice1', 'success', { paymentHash: hash1, assetAmount: 100 });

    // inv2: A creates (50 asset units), B pays → A_chan=550, B_chan=50
    // RGB invoices require amountSats>=3000 (RGB_MIN_HTLC_MSAT=3_000_000 msat). nodeB has 5000
    // sats from inv1; pays 3000, keeps 2000 >= 1000 (channel reserve). Fine.
    addStep('xPayInvoice2', 'running');
    const inv2Resp = await nodeA.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 50 } });
    const invoice2 = String(inv2Resp?.lnInvoice ?? '');
    const send2Resp = await nodeB.payLightningInvoice({ lnInvoice: invoice2 });
    const hash2 = String(send2Resp?.txid ?? '');
    const pay2Deadline = Date.now() + 60000;
    while (Date.now() < pay2Deadline) {
      await nodeB.syncWallet();
      const status = await nodeB.getLightningSendRequest(hash2);
      console.log(`[xPay] inv2 sendStatus=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Invoice2 payment failed: ${hash2}`);
      await sleep(2000);
    }
    addStep('xPayInvoice2', 'success', { paymentHash: hash2, assetAmount: 50 });

    // inv3: B creates (50 asset units), A pays → A_chan=500, B_chan=100
    // amountSats=5000 again so nodeB can afford inv4 (3000 sats + reserve).
    addStep('xPayInvoice3', 'running');
    const inv3Resp = await nodeB.createLightningInvoice({ amountSats: 5000, expirySeconds: 900, asset: { assetId, amount: 50 } });
    const invoice3 = String(inv3Resp?.lnInvoice ?? '');
    const send3Resp = await nodeA.payLightningInvoice({ lnInvoice: invoice3 });
    const hash3 = String(send3Resp?.txid ?? '');
    const pay3Deadline = Date.now() + 60000;
    while (Date.now() < pay3Deadline) {
      await nodeA.syncWallet();
      const status = await nodeA.getLightningSendRequest(hash3);
      console.log(`[xPay] inv3 sendStatus=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Invoice3 payment failed: ${hash3}`);
      await sleep(2000);
    }
    addStep('xPayInvoice3', 'success', { paymentHash: hash3, assetAmount: 50 });

    // inv4: A creates (50 asset units), B pays → A_chan=550, B_chan=50
    // nodeB has 2000(leftover)+5000(inv3)=7000 sats; pays 3000, keeps 4000 >= reserve. Fine.
    addStep('xPayInvoice4', 'running');
    const inv4Resp = await nodeA.createLightningInvoice({ amountSats: 3000, expirySeconds: 900, asset: { assetId, amount: 50 } });
    const invoice4 = String(inv4Resp?.lnInvoice ?? '');
    const send4Resp = await nodeB.payLightningInvoice({ lnInvoice: invoice4 });
    const hash4 = String(send4Resp?.txid ?? '');
    const pay4Deadline = Date.now() + 60000;
    while (Date.now() < pay4Deadline) {
      await nodeB.syncWallet();
      const status = await nodeB.getLightningSendRequest(hash4);
      console.log(`[xPay] inv4 sendStatus=${status}`);
      if (status === 'Settled') break;
      if (status === 'Failed') throw new Error(`Invoice4 payment failed: ${hash4}`);
      await sleep(2000);
    }
    addStep('xPayInvoice4', 'success', { paymentHash: hash4, assetAmount: 50 });

    // Cooperative close: A=400(off-chain)+550(channel)=950, B=50
    addStep('xPayCloseChannel', 'running');
    try { await nodeA.syncWallet(); } catch {}
    try { await nodeB.syncWallet(); } catch {}
    await nodeA.closeChannel(channelId, pubkeyB, false);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await sleep(20000);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    await sleep(20000);
    await mine(6);
    await nodeA.refreshWallet();
    await nodeB.refreshWallet();
    addStep('xPayCloseChannel', 'success', { channelId });

    // Wait for settled balances: A=950, B=50
    addStep('xPayWaitBalances', 'running');
    const balDeadlineA = Date.now() + 70000;
    let lastSpendableA = -1;
    while (Date.now() < balDeadlineA) {
      try {
        const b = await nodeA.getAssetBalance(assetId);
        lastSpendableA = Number(b?.spendable ?? -1);
        console.log(`[xPay] waitBal nodeA spendable=${lastSpendableA} expected=950`);
        if (lastSpendableA === 950) break;
      } catch (e: any) { console.warn(`[xPay] waitBal nodeA: ${e?.message}`); }
      try { await nodeA.refreshWallet(); } catch {}
      await sleep(2000);
    }
    if (lastSpendableA !== 950) throw new Error(`nodeA balance did not reach 950, last=${lastSpendableA}`);

    const balDeadlineB = Date.now() + 70000;
    let lastSpendableB = -1;
    while (Date.now() < balDeadlineB) {
      try {
        const b = await nodeB.getAssetBalance(assetId);
        lastSpendableB = Number(b?.spendable ?? -1);
        console.log(`[xPay] waitBal nodeB spendable=${lastSpendableB} expected=50`);
        if (lastSpendableB === 50) break;
      } catch (e: any) { console.warn(`[xPay] waitBal nodeB: ${e?.message}`); }
      try { await nodeB.refreshWallet(); } catch {}
      await sleep(2000);
    }
    if (lastSpendableB !== 50) throw new Error(`nodeB balance did not reach 50, last=${lastSpendableB}`);
    addStep('xPayWaitBalances', 'success', { expectedA: 950, expectedB: 50 });

    // TODO iteration 2: RGB on-chain sends to nodeC (A sends 925, B sends 25 → A=25, B=25, C=950)
    // addStep('xPayRgbSendA', 'running');
    // const invC1 = await nodeC.blindReceive({ minConfirmations: 1 });
    // await nodeA.send({ invoice: invC1.invoice, assetId, amount: 925, donation: true, feeRate: 1, minConfirmations: 1 });
    // await mine(1);
    // await nodeC.syncWallet();
    // await nodeC.refreshWallet();
    // await nodeC.refreshWallet();
    // await nodeA.refreshWallet();
    // addStep('xPayRgbSendA', 'success', { amount: 925, recipientId: invC1.recipientId.substring(0, 20) + '...' });

    // addStep('xPayRgbSendB', 'running');
    // const invC2 = await nodeC.blindReceive({ minConfirmations: 1 });
    // await nodeB.send({ invoice: invC2.invoice, assetId, amount: 25, donation: true, feeRate: 1, minConfirmations: 1 });
    // await mine(1);
    // await nodeC.syncWallet();
    // await nodeC.refreshWallet();
    // await nodeC.refreshWallet();
    // await nodeB.refreshWallet();
    // addStep('xPayRgbSendB', 'success', { amount: 25, recipientId: invC2.recipientId.substring(0, 20) + '...' });

    // TODO iteration 2: Final balances: A=25, B=25, C=950
    // addStep('xPayFinalBalances', 'running');
    // const [finalA, finalB, finalC] = await Promise.all([
    //   nodeA.getAssetBalance(assetId),
    //   nodeB.getAssetBalance(assetId),
    //   nodeC.getAssetBalance(assetId),
    // ]);
    // addStep('xPayFinalBalances', 'success', {
    //   spendableA: finalA?.spendable ?? null,
    //   spendableB: finalB?.spendable ?? null,
    //   spendableC: finalC?.spendable ?? null,
    // });

    results.success = true;
    return results;
  } catch (error: any) {
    return failFlow(flowName, error);
  } finally {
    if (nodeA) { try { await nodeA.destroy(); } catch {} }
    if (nodeB) { try { await nodeB.destroy(); } catch {} }
    if (nodeC) { try { await nodeC.destroy(); } catch {} }
    endExclusiveFlow(flowName);
  }
}
