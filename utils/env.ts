import { Platform } from 'react-native';

export function readEnv(name: string): string | null {
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
                      : name === 'RLN_VSS_URL'
                        ? process.env.EXPO_PUBLIC_RLN_VSS_URL
                      : null) ?? null;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

export function buildUtexoConfig() {
  const network = (process.env.EXPO_PUBLIC_UTEXO_NETWORK?.trim() || 'utexo') as any;
  const rpcUsername = process.env.EXPO_PUBLIC_UTEXO_BITCOIND_RPC_USERNAME?.trim() ?? '';
  const rpcPassword = process.env.EXPO_PUBLIC_UTEXO_BITCOIND_RPC_PASSWORD?.trim() ?? '';
  const rpcHost = process.env.EXPO_PUBLIC_UTEXO_BITCOIND_RPC_HOST?.trim() ?? '';
  const rpcPort = Number(process.env.EXPO_PUBLIC_UTEXO_BITCOIND_RPC_PORT?.trim() ?? '38332');
  const indexerUrl = process.env.EXPO_PUBLIC_UTEXO_INDEXER_URL?.trim() ?? 'https://esplora-api.utexo.com';
  const proxyEndpoint = process.env.EXPO_PUBLIC_UTEXO_PROXY_ENDPOINT?.trim() ?? 'rpcs://rgb-proxy-utexo.utexo.com/json-rpc';

  return {
    network,
    unlockParams: {
      bitcoindRpcUsername: rpcUsername,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl,
      proxyEndpoint,
      announceAddresses: [] as string[],
      announceAlias: null as string | null,
    },
  };
}

export function buildRegtestConfig() {
  const rpcHost = readEnv('RLN_BITCOIND_RPC_HOST') ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
  const rpcPort = Number(readEnv('RLN_BITCOIND_RPC_PORT') ?? '18443');
  const rpcUsername = readEnv('RLN_BITCOIND_RPC_USERNAME') ?? 'user';
  const rpcPassword = readEnv('RLN_BITCOIND_RPC_PASSWORD') ?? 'password';
  const indexerUrl = readEnv('RLN_INDEXER_URL') ?? `${rpcHost}:50001`;
  const proxyEndpoint = readEnv('RLN_PROXY_ENDPOINT') ?? `rpc://${rpcHost}:3000/json-rpc`;

  return {
    network: 'regtest' as const,
    unlockParams: {
      bitcoindRpcUsername: rpcUsername,
      bitcoindRpcPassword: rpcPassword,
      bitcoindRpcHost: rpcHost,
      bitcoindRpcPort: rpcPort,
      indexerUrl,
      proxyEndpoint,
      announceAddresses: [] as string[],
      announceAlias: null as string | null,
    },
  };
}
