import { useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import sdkPkg from '@utexo/rgb-sdk-rn/package.json';

import { AppColors } from '@/constants/theme';

// ─── Data ────────────────────────────────────────────────────────────────────

const SDK_SECTIONS = [
  {
    title: 'Standalone Functions',
    items: [
      { name: 'wallet', desc: 'Singleton proxy to WalletManager' },
      { name: 'generateKeys()', desc: 'Generate fresh keypair for any network' },
      { name: 'createWallet()', desc: 'Convenience: generateKeys on regtest' },
      { name: 'createWalletManager()', desc: 'Instantiate a WalletManager from params' },
      { name: 'deriveKeysFromMnemonic()', desc: 'Derive keys from BIP-39 mnemonic' },
      { name: 'deriveKeysFromSeed()', desc: 'Derive keys from raw seed bytes / hex' },
      { name: 'deriveKeysFromXpriv()', desc: 'Derive keys from extended private key' },
      { name: 'deriveKeysFromMnemonicOrSeed()', desc: 'Auto-detects mnemonic vs seed' },
      { name: 'restoreKeys()', desc: 'Alias for deriveKeysFromMnemonic' },
      { name: 'accountXpubsFromMnemonic()', desc: 'Return vanilla + colored account xpubs' },
      { name: 'getXprivFromMnemonic()', desc: 'Return master xpriv from mnemonic' },
      { name: 'getXpubFromXpriv()', desc: 'Derive xpub from xpriv' },
      { name: 'signPsbt()', desc: 'Sign a PSBT using mnemonic' },
      { name: 'signPsbtSync()', desc: 'Synchronous PSBT signing' },
      { name: 'signPsbtFromSeed()', desc: 'Seed-based PSBT signing (RN: throws)' },
      { name: 'signMessage()', desc: 'Sign an arbitrary message' },
      { name: 'verifyMessage()', desc: 'Verify a message signature' },
      { name: 'restoreFromBackup()', desc: 'Restore wallet from encrypted backup file' },
      { name: 'restoreFromVss()', desc: 'Restore wallet from VSS server' },
      { name: 'toUnitsNumber()', desc: 'Convert decimal amount to base units' },
      { name: 'fromUnitsNumber()', desc: 'Convert base units to decimal amount' },
    ],
  },
  {
    title: 'WalletManager',
    items: [
      { name: 'initialize()', desc: 'Connect to indexer and go online' },
      { name: 'goOnline()', desc: 'Explicitly connect to an indexer URL' },
      { name: 'getXpub()', desc: 'Return vanilla + colored account xpubs' },
      { name: 'getNetwork()', desc: 'Return the configured network' },
      { name: 'isDisposed()', desc: 'Check if wallet is closed' },
      { name: 'dispose()', desc: 'Close wallet and release resources' },
      { name: 'getBtcBalance()', desc: 'Get vanilla + colored BTC balance' },
      { name: 'getAddress()', desc: 'Get a fresh receive address' },
      { name: 'listUnspents()', desc: 'List all UTXOs' },
      { name: 'createUtxosBegin()', desc: 'Build PSBT for UTXO creation' },
      { name: 'createUtxosEnd()', desc: 'Broadcast signed UTXO creation PSBT' },
      { name: 'createUtxos()', desc: 'Full UTXO creation (begin + sign + end)' },
      { name: 'listAssets()', desc: 'List all RGB assets (NIA + IFA)' },
      { name: 'getAssetBalance()', desc: 'Get balance for a specific asset' },
      { name: 'issueAssetNia()', desc: 'Issue a Non-Inflatable Asset' },
      { name: 'issueAssetIfa()', desc: 'Issue an Inflatable Asset' },
      { name: 'inflateBegin()', desc: 'Build PSBT for asset inflation' },
      { name: 'inflateEnd()', desc: 'Broadcast signed inflation PSBT' },
      { name: 'inflate()', desc: 'Full inflate (begin + sign + end)' },
      { name: 'sendBegin()', desc: 'Build PSBT for asset transfer' },
      { name: 'sendEnd()', desc: 'Broadcast signed transfer PSBT' },
      { name: 'send()', desc: 'Full asset send (begin + sign + end)' },
      { name: 'sendBtcBegin()', desc: 'Build PSBT for BTC send' },
      { name: 'sendBtcEnd()', desc: 'Broadcast signed BTC send PSBT' },
      { name: 'sendBtc()', desc: 'Full BTC send (begin + sign + end)' },
      { name: 'blindReceive()', desc: 'Generate a blinded receive invoice' },
      { name: 'witnessReceive()', desc: 'Generate a witness receive invoice' },
      { name: 'decodeRGBInvoice()', desc: 'Decode an RGB invoice string' },
      { name: 'listTransactions()', desc: 'List all on-chain transactions' },
      { name: 'listTransfers()', desc: 'List RGB transfers (optionally by asset)' },
      { name: 'failTransfers()', desc: 'Mark stale transfers as failed' },
      { name: 'refreshWallet()', desc: 'Refresh wallet state from indexer' },
      { name: 'syncWallet()', desc: 'Sync wallet with latest chain state' },
      { name: 'estimateFeeRate()', desc: 'Estimate fee rate for N blocks' },
      { name: 'estimateFee()', desc: 'Estimate fee for a PSBT' },
      { name: 'createBackup()', desc: 'Create an encrypted local backup' },
      { name: 'configureVssBackup()', desc: 'Configure VSS auto-backup' },
      { name: 'vssBackup()', desc: 'Upload encrypted backup to VSS server' },
      { name: 'vssBackupInfo()', desc: 'Query VSS server backup metadata' },
      { name: 'disableVssAutoBackup()', desc: 'Disable background auto-backup' },
      { name: 'signPsbt()', desc: 'Sign a PSBT using the wallet mnemonic' },
      { name: 'signMessage()', desc: 'Sign a message using wallet keys' },
      { name: 'verifyMessage()', desc: 'Verify a message signature' },
    ],
  },
  {
    title: 'UTEXOWallet',
    items: [
      { name: 'new UTEXOWallet()', desc: 'Instantiate from mnemonic/seed + options' },
      { name: 'initialize()', desc: 'Init both UTEXO + layer-1 WalletManager' },
      { name: 'static restoreFromVss()', desc: 'Restore both wallets from VSS backup' },
      { name: 'derivePublicKeys()', desc: 'Derive public keys for a network' },
      { name: 'getPubKeys()', desc: 'Return cached public keys' },
      { name: 'getXpub()', desc: 'Return vanilla + colored xpubs' },
      { name: 'getNetwork()', desc: 'Return the configured network' },
      { name: 'dispose()', desc: 'Close wallet and release resources' },
      { name: 'isDisposed()', desc: 'Check if wallet is closed' },
      { name: 'getBtcBalance()', desc: 'Get BTC balance' },
      { name: 'getAddress()', desc: 'Get receive address' },
      { name: 'listUnspents()', desc: 'List UTXOs' },
      { name: 'createUtxos()', desc: 'Create UTXOs for RGB operations' },
      { name: 'listAssets()', desc: 'List all RGB assets' },
      { name: 'getAssetBalance()', desc: 'Get balance for an asset' },
      { name: 'issueAssetNia()', desc: 'Issue a Non-Inflatable Asset' },
      { name: 'send()', desc: 'Send RGB assets' },
      { name: 'sendBtc()', desc: 'Send BTC' },
      { name: 'onchainReceive()', desc: 'Generate onchain receive request' },
      { name: 'onchainSend()', desc: 'Send assets via onchain' },
      { name: 'getOnchainSendStatus()', desc: 'Query onchain send status' },
      { name: 'listOnchainTransfers()', desc: 'List onchain transfers' },
      { name: 'createLightningInvoice()', desc: 'Create a Lightning receive invoice' },
      { name: 'payLightningInvoice()', desc: 'Pay a Lightning invoice' },
      { name: 'getLightningSendRequest()', desc: 'Query lightning send status' },
      { name: 'getLightningReceiveRequest()', desc: 'Query lightning receive status' },
      { name: 'vssBackup()', desc: 'Upload backup to VSS server' },
      { name: 'vssBackupInfo()', desc: 'Query VSS backup metadata' },
      { name: 'configureVssBackup()', desc: 'Enable VSS auto-backup' },
      { name: 'disableVssAutoBackup()', desc: 'Disable VSS auto-backup' },
      { name: 'signPsbt()', desc: 'Sign a PSBT' },
      { name: 'signMessage()', desc: 'Sign a message' },
      { name: 'verifyMessage()', desc: 'Verify a message signature' },
      { name: 'refreshWallet()', desc: 'Refresh wallet state' },
      { name: 'syncWallet()', desc: 'Sync with chain' },
      { name: 'estimateFeeRate()', desc: 'Estimate fee rate' },
    ],
  },
  {
    title: 'UTEXO / Lightning',
    items: [
      { name: 'UTEXOProtocol', desc: 'Combined Lightning + Onchain protocol class' },
      { name: 'LightningProtocol', desc: 'Lightning Network protocol interface' },
      { name: 'OnchainProtocol', desc: 'Onchain transfer protocol interface' },
      { name: 'bridgeAPI', desc: 'HTTP client for UTEXO bridge API' },
      { name: 'getBridgeAPI()', desc: 'Get configured bridge API instance' },
    ],
  },
  {
    title: 'Error Classes',
    items: [
      { name: 'SDKError', desc: 'Base class for all SDK errors' },
      { name: 'NetworkError', desc: 'HTTP/network failures (carries statusCode)' },
      { name: 'ValidationError', desc: 'Input validation failures (carries field)' },
      { name: 'WalletError', desc: 'Wallet state and operation errors' },
      { name: 'CryptoError', desc: 'Cryptographic operation errors' },
      { name: 'ConfigurationError', desc: 'Invalid SDK configuration' },
      { name: 'BadRequestError', desc: 'HTTP 400 errors' },
      { name: 'NotFoundError', desc: 'HTTP 404 errors' },
      { name: 'ConflictError', desc: 'HTTP 409 errors' },
      { name: 'RgbNodeError', desc: 'RGB node operation errors' },
    ],
  },
  {
    title: 'Logger',
    items: [
      { name: 'logger', desc: 'Global SDK logger instance' },
      { name: 'configureLogging()', desc: 'Set the global log level' },
      { name: 'LogLevel', desc: 'Enum: DEBUG | INFO | WARN | ERROR | NONE' },
    ],
  },
  {
    title: 'Validation',
    items: [
      { name: 'validateNetwork()', desc: 'Throws if network string is invalid' },
      { name: 'normalizeNetwork()', desc: 'Normalize network string variants' },
      { name: 'validateMnemonic()', desc: 'Validate BIP-39 mnemonic phrase' },
      { name: 'validatePsbt()', desc: 'Validate base64-encoded PSBT' },
      { name: 'validateBase64()', desc: 'Validate a base64 string' },
      { name: 'validateHex()', desc: 'Validate a hex-encoded string' },
      { name: 'validateRequired()', desc: 'Throw if value is null/undefined' },
      { name: 'validateString()', desc: 'Throw if value is not a string' },
    ],
  },
  {
    title: 'Constants',
    items: [
      { name: 'COIN_RGB_MAINNET', desc: '827166 — RGB mainnet coin type' },
      { name: 'COIN_RGB_TESTNET', desc: '827167 — RGB testnet coin type' },
      { name: 'COIN_BITCOIN_MAINNET', desc: '0 — Bitcoin mainnet coin type' },
      { name: 'COIN_BITCOIN_TESTNET', desc: '1 — Bitcoin testnet coin type' },
      { name: 'NETWORK_MAP', desc: 'Map of network name → canonical name' },
      { name: 'BIP32_VERSIONS', desc: 'BIP-32 version bytes per network' },
      { name: 'DERIVATION_PURPOSE', desc: '86 — Taproot derivation purpose' },
      { name: 'DERIVATION_ACCOUNT', desc: '0 — Default account index' },
      { name: 'KEYCHAIN_RGB', desc: '0 — RGB keychain index' },
      { name: 'KEYCHAIN_BTC', desc: '0 — BTC keychain index' },
      { name: 'DEFAULT_NETWORK', desc: '"regtest" — default network' },
      { name: 'DEFAULT_API_TIMEOUT', desc: 'Default HTTP timeout in ms' },
      { name: 'DEFAULT_MAX_RETRIES', desc: '3 — default retry count' },
      { name: 'DEFAULT_LOG_LEVEL', desc: 'Default log level value' },
      { name: 'utexoNetworkMap', desc: 'Map of app network → UTEXO network name' },
      { name: 'utexoNetworkIdMap', desc: 'Map of network → network ID metadata' },
      { name: 'getDestinationAsset()', desc: 'Resolve destination asset for a bridge' },
    ],
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function VersionBadge({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.badge}>
      <View style={styles.badgeLabel}>
        <Text style={styles.badgeLabelText}>{label}</Text>
      </View>
      <View style={[styles.badgeValue, accent && styles.badgeValueAccent]}>
        <Text style={styles.badgeValueText} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

function SectionCard({ title, items }: { title: string; items: { name: string; desc: string }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => setOpen(v => !v)}
        activeOpacity={0.75}>
        <View style={styles.sectionHeaderLeft}>
          <View style={styles.sectionAccent} />
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        <View style={styles.sectionHeaderRight}>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{items.length}</Text>
          </View>
          <Text style={[styles.chevron, open && styles.chevronOpen]}>›</Text>
        </View>
      </TouchableOpacity>

      {open && (
        <View style={styles.sectionBody}>
          {items.map((item, idx) => (
            <View key={item.name} style={[styles.methodRow, idx < items.length - 1 && styles.methodRowBorder]}>
              <View style={styles.methodDot} />
              <View style={styles.methodInfo}>
                <Text style={styles.methodName}>{item.name}</Text>
                <Text style={styles.methodDesc}>{item.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DocsScreen() {
  const totalMethods = SDK_SECTIONS.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.logoText}>UTEXO</Text>
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>SDK Reference</Text>
            </View>
          </View>
          <Text style={styles.headerSubtitle}>
            Complete API reference for the RGB SDK React Native package.
          </Text>

          {/* Version badges */}
          <View style={styles.badgeRow}>
            <VersionBadge
              label="package"
              value={`${sdkPkg.name}@${sdkPkg.version}`}
              accent
            />
            {Platform.OS === 'android' && (
              <VersionBadge
                label="rgb-lib"
                value="android@0.3.0-beta.14"
              />
            )}
          </View>

          {/* Stats bar */}
          <View style={styles.statsBar}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{SDK_SECTIONS.length}</Text>
              <Text style={styles.statLabel}>sections</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{totalMethods}</Text>
              <Text style={styles.statLabel}>exports</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>100%</Text>
              <Text style={styles.statLabel}>covered</Text>
            </View>
          </View>
        </View>

        {/* Hint */}
        <Text style={styles.hint}>Tap a section to expand its API</Text>

        {/* Sections */}
        {SDK_SECTIONS.map(section => (
          <SectionCard key={section.title} title={section.title} items={section.items} />
        ))}

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            See the Flows tab to run live SDK tests and end-to-end flow demos.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', web: 'monospace' });

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: AppColors.bgBase,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },

  // Header
  header: {
    paddingTop: 24,
    paddingBottom: 20,
    gap: 12,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoText: {
    fontSize: 26,
    fontWeight: '800',
    color: AppColors.textPrimary,
    letterSpacing: 2,
  },
  headerBadge: {
    backgroundColor: AppColors.primaryBg,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: AppColors.borderAccent,
  },
  headerBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: AppColors.primary,
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: AppColors.textSecondary,
    lineHeight: 20,
  },

  // Version badges
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    borderRadius: 6,
    overflow: 'hidden',
  },
  badgeLabel: {
    backgroundColor: '#374151',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  badgeLabelText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#D1D5DB',
    fontFamily: MONO,
  },
  badgeValue: {
    backgroundColor: '#1E3A5F',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  badgeValueAccent: {
    backgroundColor: AppColors.primaryBg,
  },
  badgeValueText: {
    fontSize: 11,
    fontWeight: '600',
    color: AppColors.primary,
    fontFamily: MONO,
  },

  // Stats bar
  statsBar: {
    flexDirection: 'row',
    backgroundColor: AppColors.bgCard,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: AppColors.border,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: AppColors.textAccent,
  },
  statLabel: {
    fontSize: 11,
    color: AppColors.textTertiary,
    letterSpacing: 0.3,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: AppColors.border,
  },

  // Hint
  hint: {
    fontSize: 12,
    color: AppColors.textTertiary,
    marginBottom: 10,
    letterSpacing: 0.2,
  },

  // Section card
  section: {
    backgroundColor: AppColors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: AppColors.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  sectionAccent: {
    width: 3,
    height: 18,
    borderRadius: 2,
    backgroundColor: AppColors.primary,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: AppColors.textPrimary,
    letterSpacing: 0.1,
  },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countBadge: {
    backgroundColor: AppColors.primaryBg,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  countText: {
    fontSize: 11,
    fontWeight: '700',
    color: AppColors.primary,
  },
  chevron: {
    fontSize: 20,
    color: AppColors.textTertiary,
    transform: [{ rotate: '0deg' }],
    lineHeight: 22,
  },
  chevronOpen: {
    transform: [{ rotate: '90deg' }],
    color: AppColors.primary,
  },

  // Section body
  sectionBody: {
    borderTopWidth: 1,
    borderTopColor: AppColors.borderSubtle,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  methodRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: AppColors.borderSubtle,
  },
  methodDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: AppColors.primary,
    marginTop: 6,
  },
  methodInfo: {
    flex: 1,
    gap: 2,
  },
  methodName: {
    fontSize: 13,
    fontWeight: '600',
    color: AppColors.textPrimary,
    fontFamily: MONO,
  },
  methodDesc: {
    fontSize: 12,
    color: AppColors.textSecondary,
    lineHeight: 17,
  },

  // Footer
  footer: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: AppColors.border,
  },
  footerText: {
    fontSize: 13,
    color: AppColors.textTertiary,
    textAlign: 'center',
    lineHeight: 19,
  },
});
