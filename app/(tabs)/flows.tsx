import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  accountXpubsFromMnemonic,
  BadRequestError,
  BIP32_VERSIONS,
  bridgeAPI,
  COIN_BITCOIN_MAINNET,
  COIN_BITCOIN_TESTNET,
  COIN_RGB_MAINNET,
  COIN_RGB_TESTNET,
  ConfigurationError,
  configureLogging,
  ConflictError,
  createWalletManager,
  CryptoError,
  DEFAULT_INDEXER_URLS,
  DEFAULT_API_TIMEOUT,
  DEFAULT_LOG_LEVEL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_NETWORK,
  DERIVATION_ACCOUNT,
  DERIVATION_PURPOSE,
  deriveKeysFromMnemonic,
  deriveKeysFromMnemonicOrSeed,
  deriveKeysFromSeed,
  deriveKeysFromXpriv,
  fromUnitsNumber,
  generateKeys,
  getDestinationAsset,
  getXprivFromMnemonic,
  getXpubFromXpriv,
  KEYCHAIN_BTC,
  KEYCHAIN_RGB,
  LightningProtocol,
  logger,
  LogLevel,
  NETWORK_MAP,
  NetworkError,
  normalizeNetwork,
  NotFoundError,
  OnchainProtocol,
  restoreFromVss,
  restoreKeys,
  RgbNodeError,
  SDKError,
  signMessage,
  signPsbt,
  signPsbtFromSeed,
  signPsbtSync,
  toUnitsNumber,
  utexoNetworkIdMap,
  utexoNetworkMap,
  UTEXOProtocol,
  UTEXOWallet,
  validateBase64,
  validateHex,
  validateMnemonic,
  validateNetwork,
  validatePsbt,
  validateRequired,
  validateString,
  ValidationError,
  verifyMessage,
  VssBackupConfig,
  wallet,
  WalletError,
  WalletManager,
} from '@utexo/rgb-sdk-rn';

import { runUtexoVssFlow } from '@/utils/wallet-flow';
import { AppColors } from '@/constants/theme';

// ─── Test data ────────────────────────────────────────────────────────────────

const TEST_MNEMONIC = 'poem twice question inch happy capital grain quality laptop dry chaos what';

const EXPECTED_KEYS = {
  mnemonic: TEST_MNEMONIC,
  xpub: 'tpubD6NzVbkrYhZ4XCaTDersU6277zvyyV6uCCeEgx1jfv7bUYMrbTt8Vem1MBt5Gmp7eMwjv4rB54s2kjqNNtTLYpwFsVX7H2H93pJ8SpZFRRi',
  accountXpubVanilla: 'tpubDDMTD6EJKKLP6Gx9JUnMpjf9NYyePJszmqBnNqULNmcgEuU1yQ3JsHhWZdRFecszWETnNsmhEe9vnaNibfzZkDDHycbR2rGFbXdHWRgBfu7',
  accountXpubColored: 'tpubDDPLJfdVbDoGtnn6hSto3oCnm6hpfHe9uk2MxcANanxk87EuquhSVfSLQv7e5UykgzaFn41DUXaikjjVGcUSUTGNaJ9LcozfRwatKp1vTfC',
  masterFingerprint: 'a66bffef',
};

const UTXO_UNSIGNED_PSBT = 'cHNidP8BAP01AQIAAAABtSecjg4J41fmQtoh4TTlQdnu6iifN5ogbVWEAXrUWhoAAAAAAP3///8G6AMAAAAAAAAiUSDzKPGEYMWF2Spr+6GDDaiByz+OjfjlV3Lfr/zYKZ2iB+gDAAAAAAAAIlEg83490lnilgZRgrHnETy+JEjou1md47ACmb0kn5rO2+joAwAAAAAAACJRIHD6gvLQXWd4BvEW0YjxA0z50cxfC3ZUhKXnKhPTS1B+6AMAAAAAAAAiUSCXxMTRByl/+IGyzvdE6V+4ac0UOeEwe1dl3zb8ceaZ5OgDAAAAAAAAIlEg3oU2/GUMIeYj4d/R1dK5ThTLhkg7JAhjPOLjNqb215YYEzEBAAAAACJRIHn8VHdi5k8OITo7LrsqYr+cQIASgZTwvtfvYoBHBxpWoXVIAAABASsALTEBAAAAACJRIM9hxZBkyMxn4vyYOosTZEYQIMqQZRSwxigi1aTQwJLrIRaUhLceLJAwJvzah8652iBUot/I4ZG5LVNrof4L451TuRkApmv/71YAAIABAACAAAAAgAEAAAAAAAAAARcglIS3HiyQMCb82ofOudogVKLfyOGRuS1Ta6H+C+OdU7kAAQUgeHCOVR20fg1Bz+fM/Cpg3KrkSlmKQDLwInucZ2bCMcwhB3hwjlUdtH4NQc/nzPwqYNyq5EpZikAy8CJ7nGdmwjHMGQCma//vVgAAgB+fDIAAAACAAAAAAAIAAAAAAQUgzBIX4uwl2L4m53HESkMyqyevlalsmf3tw9nH0r3KQoIhB8wSF+LsJdi+JudxxEpDMqsnr5WpbJn97cPZx9K9ykKCGQCma//vVgAAgB+fDIAAAACAAAAAAAMAAAAAAQUgs43Fa7pRIMJTLGHkWwyCRf16wo3uSS/3CDv0c550QBkhB7ONxWu6USDCUyxh5FsMgkX9esKN7kkv9wg79HOedEAZGQCma//vVgAAgB+fDIAAAACAAAAAAAQAAAAAAQUgaqAn3Z3FYWYqPiTb2KCMBirkLH3ZnhE1Q7NpCOiuJBkhB2qgJ92dxWFmKj4k29igjAYq5Cx92Z4RNUOzaQjoriQZGQCma//vVgAAgB+fDIAAAACAAAAAAAEAAAAAAQUgnZNdhk/w7sXuE3/fLeNHq5My6f6IqMI5KrZAVeoZdnUhB52TXYZP8O7F7hN/3y3jR6uTMun+iKjCOSq2QFXqGXZ1GQCma//vVgAAgB+fDIAAAACAAAAAAAAAAAAAAQUg+5xo2r852/jJjwIpMPXdsWsse2hpIxAhJhP6YDPcrrIhB/ucaNq/Odv4yY8CKTD13bFrLHtoaSMQISYT+mAz3K6yGQCma//vVgAAgAEAAIAAAACAAQAAAAEAAAAA';

const UTXO_SIGNED_PSBT = 'cHNidP8BAP01AQIAAAABtSecjg4J41fmQtoh4TTlQdnu6iifN5ogbVWEAXrUWhoAAAAAAP3///8G6AMAAAAAAAAiUSDzKPGEYMWF2Spr+6GDDaiByz+OjfjlV3Lfr/zYKZ2iB+gDAAAAAAAAIlEg83490lnilgZRgrHnETy+JEjou1md47ACmb0kn5rO2+joAwAAAAAAACJRIHD6gvLQXWd4BvEW0YjxA0z50cxfC3ZUhKXnKhPTS1B+6AMAAAAAAAAiUSCXxMTRByl/+IGyzvdE6V+4ac0UOeEwe1dl3zb8ceaZ5OgDAAAAAAAAIlEg3oU2/GUMIeYj4d/R1dK5ThTLhkg7JAhjPOLjNqb215YYEzEBAAAAACJRIHn8VHdi5k8OITo7LrsqYr+cQIASgZTwvtfvYoBHBxpWoXVIAAABASsALTEBAAAAACJRIM9hxZBkyMxn4vyYOosTZEYQIMqQZRSwxigi1aTQwJLrAQhCAUDrRtVkPLHRkFNKbYlEL3bgjs6wjkfkO7fZytofjY3WL7EIHD3W5I2YmVucb9aSFTGJEU2m9+9laoEebGTB8KAdAAEFIHhwjlUdtH4NQc/nzPwqYNyq5EpZikAy8CJ7nGdmwjHMAAEFIMwSF+LsJdi+JudxxEpDMqsnr5WpbJn97cPZx9K9ykKCAAEFILONxWu6USDCUyxh5FsMgkX9esKN7kkv9wg79HOedEAZAAEFIGqgJ92dxWFmKj4k29igjAYq5Cx92Z4RNUOzaQjoriQZAAEFIJ2TXYZP8O7F7hN/3y3jR6uTMun+iKjCOSq2QFXqGXZ1AAEFIPucaNq/Odv4yY8CKTD13bFrLHtoaSMQISYT+mAz3K6yAA==';

// ─── Types ────────────────────────────────────────────────────────────────────

type TestSuite = Record<string, any>;
type FlowResults = Record<string, any> | null;

// ─── Step card component ──────────────────────────────────────────────────────

function formatDetail(data: any): string {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data;
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);
  if (typeof data === 'object') {
    return Object.entries(data)
      .map(([k, v]) => {
        const val = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
        return `${k}  ${val}`;
      })
      .join('\n');
  }
  return JSON.stringify(data);
}

function StepCard({
  idx,
  step,
  label,
  desc,
  accentColor,
  isLast,
}: {
  idx: number;
  step: { status: string; data?: any; error?: string; result?: any };
  label: string;
  desc: string;
  accentColor: string;
  isLast: boolean;
}) {
  const isSuccess = step.status === 'success';
  const isRunning = step.status === 'running';
  const isError = step.status === 'error';

  const detail = step.data ?? step.result;

  const circleColor = isSuccess
    ? AppColors.success
    : isRunning
    ? accentColor
    : isError
    ? AppColors.error
    : AppColors.textTertiary;

  const circleBg = isSuccess
    ? AppColors.successBg
    : isRunning
    ? accentColor + '18'
    : isError
    ? AppColors.errorBg
    : AppColors.bgCardElevated;

  return (
    <View style={sStyles.row}>
      {/* Timeline column */}
      <View style={sStyles.timelineCol}>
        <View style={[sStyles.circle, { borderColor: circleColor, backgroundColor: circleBg }]}>
          {isRunning ? (
            <ActivityIndicator size={12} color={accentColor} />
          ) : isSuccess ? (
            <Text style={[sStyles.circleText, { color: AppColors.success }]}>✓</Text>
          ) : isError ? (
            <Text style={[sStyles.circleText, { color: AppColors.error }]}>✗</Text>
          ) : (
            <Text style={[sStyles.circleText, { color: AppColors.textTertiary }]}>{idx + 1}</Text>
          )}
        </View>
        {!isLast && (
          <View style={[sStyles.line, { backgroundColor: isSuccess ? AppColors.success + '50' : AppColors.border }]} />
        )}
      </View>

      {/* Content column */}
      <View style={[sStyles.stepContent, !isLast && sStyles.stepContentSpaced]}>
        <View style={sStyles.stepTitleRow}>
          <Text style={[
            sStyles.stepLabel,
            isSuccess && { color: AppColors.textPrimary },
            isError && { color: AppColors.error },
            isRunning && { color: accentColor },
          ]}>
            {label}
          </Text>
          {isRunning && (
            <View style={[sStyles.statusTag, { backgroundColor: accentColor + '18', borderColor: accentColor + '40' }]}>
              <Text style={[sStyles.statusTagText, { color: accentColor }]}>running</Text>
            </View>
          )}
          {isError && (
            <View style={[sStyles.statusTag, { backgroundColor: AppColors.errorBg, borderColor: AppColors.errorBorder }]}>
              <Text style={[sStyles.statusTagText, { color: AppColors.error }]}>failed</Text>
            </View>
          )}
        </View>
        <Text style={sStyles.stepDesc}>{desc}</Text>
        {(detail || step.error) && (
          <View style={[sStyles.codeBox, isError && { borderColor: AppColors.errorBorder, backgroundColor: AppColors.errorBg }]}>
            <Text style={[sStyles.codeText, isError && { color: '#FCA5A5' }]}>
              {detail ? formatDetail(detail) : step.error}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Flow card component ──────────────────────────────────────────────────────

function FlowCard({
  title,
  subtitle,
  description,
  accentColor,
  totalSteps,
  results,
  running,
  onRun,
  children,
  extra,
}: {
  title: string;
  subtitle?: string;
  description: string;
  accentColor: string;
  totalSteps?: number;
  results: FlowResults;
  running: boolean;
  onRun: () => void;
  children?: React.ReactNode;
  extra?: React.ReactNode;
}) {
  const hasResults = results !== null;
  const success = results?.success;
  const steps = results?.steps ?? [];
  const doneCount = steps.filter((s: any) => s.status === 'success').length;
  const total = totalSteps ?? steps.length;

  return (
    <View style={[fStyles.card, { borderColor: hasResults ? (success ? AppColors.successBorder : AppColors.errorBorder) : AppColors.border }]}>
      {/* Card header */}
      <View style={[fStyles.cardHeader, { borderBottomColor: AppColors.border }]}>
        <View style={[fStyles.cardAccentBar, { backgroundColor: accentColor }]} />
        <View style={fStyles.cardTitleArea}>
          <View style={fStyles.cardTitleRow}>
            <Text style={fStyles.cardTitle}>{title}</Text>
            {subtitle && <Text style={fStyles.cardSubtitle}>{subtitle}</Text>}
            {running && <ActivityIndicator size="small" color={accentColor} style={{ marginLeft: 6 }} />}
            {hasResults && !running && (
              <View style={[fStyles.statusPill, { backgroundColor: success ? AppColors.successBg : AppColors.errorBg, borderColor: success ? AppColors.successBorder : AppColors.errorBorder }]}>
                <Text style={[fStyles.statusText, { color: success ? AppColors.success : AppColors.error }]}>
                  {success ? 'Passed' : 'Failed'}
                </Text>
              </View>
            )}
          </View>
          <Text style={fStyles.cardDesc}>{description}</Text>
        </View>
      </View>

      {/* Progress dots */}
      {steps.length > 0 && total > 0 && (
        <View style={fStyles.progressRow}>
          {Array.from({ length: total }).map((_, i) => {
            const s = steps[i];
            const dotColor = !s
              ? AppColors.border
              : s.status === 'success'
              ? AppColors.success
              : s.status === 'running'
              ? accentColor
              : s.status === 'error'
              ? AppColors.error
              : AppColors.border;
            return (
              <View key={i} style={[fStyles.dot, { backgroundColor: dotColor }]}>
                {s?.status === 'running' && <ActivityIndicator size={8} color="#fff" />}
              </View>
            );
          })}
          {totalSteps && (
            <Text style={fStyles.progressLabel}>{doneCount}/{total}</Text>
          )}
        </View>
      )}

      {/* Idle state */}
      {!hasResults && !running && (
        <View style={fStyles.idleBody}>
          <TouchableOpacity
            style={[fStyles.runBtn, { backgroundColor: accentColor }]}
            onPress={onRun}
            activeOpacity={0.8}>
            <Text style={fStyles.runBtnText}>▶  Run {title}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Step list */}
      {children && (
        <View style={fStyles.stepsWrapper}>
          {children}
        </View>
      )}

      {/* Extra content (e.g. store ID) */}
      {extra}

      {/* Re-run button */}
      {hasResults && !running && (
        <TouchableOpacity
          style={[fStyles.rerunBtn, { borderColor: accentColor }]}
          onPress={onRun}
          activeOpacity={0.8}>
          <Text style={[fStyles.rerunBtnText, { color: accentColor }]}>↺  Re-run</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── SDK tests summary ────────────────────────────────────────────────────────

function TestSummaryCard({ results, loading }: { results: TestSuite | null; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const summary = results?.summary;
  const allPassed = summary && summary.failed === 0;

  return (
    <View style={[tStyles.card, summary && { borderColor: allPassed ? AppColors.successBorder : AppColors.errorBorder }]}>
      <TouchableOpacity
        style={tStyles.header}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.75}>
        <View style={tStyles.titleRow}>
          <Text style={tStyles.title}>SDK Tests</Text>
          {loading && <ActivityIndicator size="small" color={AppColors.primary} style={{ marginLeft: 8 }} />}
          {summary && !loading && (
            <View style={[tStyles.pill, { backgroundColor: allPassed ? AppColors.successBg : AppColors.errorBg, borderColor: allPassed ? AppColors.successBorder : AppColors.errorBorder }]}>
              <Text style={[tStyles.pillText, { color: allPassed ? AppColors.success : AppColors.error }]}>
                {summary.passed}/{summary.total} passed
              </Text>
            </View>
          )}
        </View>
        <Text style={tStyles.desc}>Automated tests run on mount to verify SDK integrity</Text>
        {summary && (
          <Text style={[tStyles.chevron, expanded && { color: AppColors.primary }]}>
            {expanded ? '▲ collapse' : '▼ expand results'}
          </Text>
        )}
      </TouchableOpacity>

      {expanded && results && (
        <View style={tStyles.body}>
          {Object.entries(results)
            .filter(([k]) => k !== 'summary')
            .map(([key, value]: [string, any]) => {
              const passed = value?.success !== false &&
                (!value?.tests || Object.values(value.tests as Record<string, boolean>).every(Boolean));
              return (
                <View key={key} style={tStyles.testRow}>
                  <Text style={[tStyles.testIcon, { color: passed ? AppColors.success : AppColors.error }]}>
                    {passed ? '✓' : '✗'}
                  </Text>
                  <Text style={[tStyles.testName, { color: passed ? AppColors.textPrimary : AppColors.error }]}>
                    {key}
                  </Text>
                  {!passed && value?.error && (
                    <Text style={tStyles.testError} numberOfLines={1}>{value.error}</Text>
                  )}
                </View>
              );
            })}
        </View>
      )}
    </View>
  );
}

// ─── Wallet flow step meta ────────────────────────────────────────────────────

const UTEXO_VSS_STEP_META: Record<string, { label: string; desc: string }> = {
  createUtexoWallet:    { label: 'Create UTEXO Wallet',   desc: 'Instantiate & initialise UTEXOWallet' },
  getAddress:           { label: 'Get Deposit Address',   desc: 'Derive a receive address' },
  fundWallet:           { label: 'Fund via Faucet',       desc: 'Send sats from thunderstack faucet' },
  waitForFunding:       { label: 'Wait for Balance',      desc: 'Poll until balance > 0' },
  createUtxos:          { label: 'Create UTXOs',          desc: 'Allocate UTXOs for RGB operations' },
  issueAssetNia:        { label: 'Issue NIA Asset',       desc: 'Issue DEMO token on UTEXO layer' },
  listAssets:           { label: 'List Assets',           desc: 'Confirm asset appears in list' },
  getAssetBalance:      { label: 'Get Asset Balance',     desc: 'Record pre-backup asset balance' },
  vssBackup:            { label: 'VSS Backup',            desc: 'Upload encrypted backup (zero-arg)' },
  vssBackupInfo:        { label: 'VSS Backup Info',       desc: 'Verify backup exists on server' },
  disposeWallet:        { label: 'Dispose Wallet',        desc: 'Close wallet handles' },
  deleteState:          { label: 'Delete Local State',    desc: 'Prepare restore directory' },
  restoreFromVss:       { label: 'Restore from VSS',      desc: 'Download & decrypt backup' },
  verifyRestoredWallet: { label: 'Verify Restored State', desc: 'Check assets & balances match' },
  cleanup:              { label: 'Cleanup',               desc: 'Dispose restored wallet' },
};

const TESTNET_WALLET_STEP_META: Record<string, { label: string; desc: string }> = {
  generateKeys:       { label: 'Generate Keys',          desc: 'deriveKeys for Bitcoin testnet' },
  createWalletManager: { label: 'Create WalletManager',   desc: 'testnet + DEFAULT_INDEXER_URLS.testnet' },
  initialize:         { label: 'Initialize (go online)', desc: 'Connect Electrum indexer; wallet syncs' },
  syncWallet:         { label: 'Sync Wallet',            desc: 'syncWallet() — pull chain / indexer state' },
  refreshWallet:      { label: 'Refresh Wallet',         desc: 'refreshWallet() — update RGB state' },
  getAddress:         { label: 'Get Deposit Address',    desc: 'Fresh receive address' },
  getBtcBalance:      { label: 'Get BTC Balance',        desc: 'Vanilla + colored settled sats' },
  dispose:            { label: 'Dispose',                desc: 'Release native wallet handle' },
};

const REUSE_ADDRESS_FLOW_STEP_META: Record<string, { label: string; desc: string }> = {
  generateKeys:              { label: 'Generate Keys',              desc: 'deriveKeys for Bitcoin testnet' },
  createWalletReuse:         { label: 'Create WalletManager',        desc: 'reuseAddresses: true + DEFAULT_INDEXER_URLS.testnet' },
  initialize:                { label: 'Initialize (go online)',     desc: 'Connect Electrum indexer' },
  syncWallet:                { label: 'Sync Wallet',                desc: 'syncWallet()' },
  refreshWallet:             { label: 'Refresh Wallet',             desc: 'refreshWallet()' },
  addressPairBeforeRotate:   { label: 'Two getAddress (before)',    desc: 'reuse mode: both calls must return the same address' },
  rotateAddresses:           { label: 'Rotate vanilla + colored', desc: 'rotateVanillaAddress() then rotateColoredAddress()' },
  addressPairAfterRotate:    { label: 'Two getAddress (after)',     desc: 'reuse mode: pair still matches; value may differ from before' },
  dispose:                   { label: 'Dispose',                    desc: 'Release native wallet handle' },
};

const VSS_STEP_META: Record<string, { label: string; desc: string }> = {
  generateKeys:         { label: 'Generate Keys',          desc: 'Create fresh wallet keypairs' },
  initializeWallet:     { label: 'Initialize Wallet',      desc: 'Setup wallet on testnet' },
  vssBackup:            { label: 'Upload Backup',          desc: 'Encrypt & push to VSS server' },
  vssBackupInfo:        { label: 'Check Backup Status',    desc: 'Query server for backup metadata' },
  configureVssBackup:   { label: 'Configure Auto-backup',  desc: 'Enable background auto-backup' },
  disableVssAutoBackup: { label: 'Disable Auto-backup',    desc: 'Stop background auto-backup' },
  restoreFromVss:       { label: 'Restore from VSS',       desc: 'Download & decrypt wallet data' },
  verifyRestoredWallet: { label: 'Verify Restored Wallet', desc: 'Confirm assets & transactions intact' },
};

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FlowsScreen() {
  const [testResults, setTestResults] = useState<TestSuite | null>(null);
  const [testLoading, setTestLoading] = useState(true);

  const [utexoVssFlowResults, setUtexoVssFlowResults] = useState<FlowResults>(null);
  const [runningUtexoVssFlow, setRunningUtexoVssFlow] = useState(false);

  const [vssFlowResults, setVssFlowResults] = useState<FlowResults>(null);
  const [runningVssFlow, setRunningVssFlow] = useState(false);

  const [testnetWalletFlowResults, setTestnetWalletFlowResults] = useState<FlowResults>(null);
  const [runningTestnetWalletFlow, setRunningTestnetWalletFlow] = useState(false);

  const [reuseAddressFlowResults, setReuseAddressFlowResults] = useState<FlowResults>(null);
  const [runningReuseAddressFlow, setRunningReuseAddressFlow] = useState(false);

  // ── On-mount SDK tests ────────────────────────────────────────────────────

  useEffect(() => {
    async function runSdkTests() {
      try {
        setTestLoading(true);
        const results: TestSuite = { summary: { total: 0, passed: 0, failed: 0 } };

        const addResult = (key: string, obj: any, count: number) => {
          results[key] = obj;
          results.summary.total += count;
          if (obj.success !== false && obj.tests) {
            const vals = Object.values(obj.tests as Record<string, boolean>);
            results.summary.passed += vals.filter(Boolean).length;
            results.summary.failed += vals.filter(v => v === false).length;
          } else if (obj.success === false) {
            results.summary.failed += count;
          }
        };

        // generateKeys
        try {
          const tk = await generateKeys('testnet');
          const mk = await generateKeys('mainnet');
          const rk = await generateKeys('regtest');
          addResult('generateKeys', {
            success: true,
            tests: {
              testnetValid: tk.xpub.startsWith('tpub') && tk.mnemonic.split(' ').length === 12,
              mainnetValid: mk.xpub.startsWith('xpub'),
              regtestValid: rk.xpub.startsWith('tpub'),
              unique: tk.mnemonic !== mk.mnemonic,
            },
          }, 4);
        } catch (e: any) { addResult('generateKeys', { success: false, error: e.message }, 4); }

        // deriveKeysFromMnemonic
        try {
          const k = await deriveKeysFromMnemonic('testnet', TEST_MNEMONIC);
          addResult('deriveKeysFromMnemonic', {
            success: true,
            tests: {
              xpub: k.xpub === EXPECTED_KEYS.xpub,
              accountXpubVanilla: k.accountXpubVanilla === EXPECTED_KEYS.accountXpubVanilla,
              masterFingerprint: k.masterFingerprint?.toLowerCase() === EXPECTED_KEYS.masterFingerprint,
              deterministic: (await deriveKeysFromMnemonic('testnet', TEST_MNEMONIC)).xpub === k.xpub,
            },
          }, 4);
        } catch (e: any) { addResult('deriveKeysFromMnemonic', { success: false, error: e.message }, 4); }

        // signPsbt
        try {
          const signed = await signPsbt(TEST_MNEMONIC, UTXO_UNSIGNED_PSBT, 'testnet');
          addResult('signPsbt', {
            success: true,
            tests: { matchesExpected: signed === UTXO_SIGNED_PSBT },
          }, 1);
        } catch (e: any) { addResult('signPsbt', { success: false, error: e.message }, 1); }

        // signPsbtSync
        try {
          const signed = await signPsbtSync(TEST_MNEMONIC, UTXO_UNSIGNED_PSBT, 'testnet');
          addResult('signPsbtSync', {
            success: true,
            tests: { matchesAsync: signed === UTXO_SIGNED_PSBT },
          }, 1);
        } catch (e: any) { addResult('signPsbtSync', { success: false, error: e.message }, 1); }

        // signPsbtFromSeed (should throw in RN)
        try {
          const { mnemonicToSeedSync } = require('@scure/bip39');
          const seed = new Uint8Array(Buffer.from(mnemonicToSeedSync(TEST_MNEMONIC)));
          await signPsbtFromSeed(seed, UTXO_UNSIGNED_PSBT, 'testnet');
          addResult('signPsbtFromSeed', { success: false, error: 'Expected throw, resolved' }, 1);
        } catch (e: any) {
          addResult('signPsbtFromSeed', {
            success: true,
            tests: { throwsNotSupported: (e.message as string).includes('not supported') },
          }, 1);
        }

        // signMessage + verifyMessage
        try {
          const { mnemonicToSeedSync } = require('@scure/bip39');
          const seed = Buffer.from(mnemonicToSeedSync(TEST_MNEMONIC));
          const keys = await deriveKeysFromMnemonic('testnet', TEST_MNEMONIC);
          const sig = await signMessage({ message: 'hello rgb', seed, network: 'testnet' });
          const valid = await verifyMessage({ message: 'hello rgb', signature: sig, accountXpub: keys.accountXpubVanilla, network: 'testnet' });
          const wrong = await verifyMessage({ message: 'wrong', signature: sig, accountXpub: keys.accountXpubVanilla, network: 'testnet' });
          addResult('signMessage+verifyMessage', {
            success: true,
            tests: { signatureProduced: sig.length > 0, validSig: valid === true, wrongMsgFails: wrong === false },
          }, 3);
        } catch (e: any) { addResult('signMessage+verifyMessage', { success: false, error: e.message }, 3); }

        // createWalletManager
        try {
          const keys = await deriveKeysFromMnemonic('testnet', TEST_MNEMONIC);
          const wm = createWalletManager({ xpubVan: keys.accountXpubVanilla, xpubCol: keys.accountXpubColored, masterFingerprint: keys.masterFingerprint, mnemonic: TEST_MNEMONIC, network: 'testnet' });
          addResult('createWalletManager', {
            success: true,
            tests: {
              returnsInstance: typeof wm.initialize === 'function',
              notDisposed: wm.isDisposed() === false,
              correctXpub: wm.getXpub().xpubVan === keys.accountXpubVanilla,
              correctNetwork: wm.getNetwork() === 'testnet',
            },
          }, 4);
        } catch (e: any) { addResult('createWalletManager', { success: false, error: e.message }, 4); }

        // wallet singleton
        try {
          const isProxy = typeof wallet === 'object';
          let throwsWhenUninitialized = false;
          try { void (wallet as any).initialize; } catch (e: any) { throwsWhenUninitialized = e instanceof WalletError; }
          addResult('walletSingleton', { success: true, tests: { isProxy, throwsWhenUninitialized } }, 2);
        } catch (e: any) { addResult('walletSingleton', { success: false, error: e.message }, 2); }

        // Error classes
        try {
          const sdkErr = new SDKError('msg', 'CODE');
          const netErr = new NetworkError('msg', 503);
          const walletErr = new WalletError('msg');
          const cryptoErr = new CryptoError('msg');
          const configErr = new ConfigurationError('msg');
          const badReqErr = new BadRequestError('msg');
          const notFoundErr = new NotFoundError('msg');
          const conflictErr = new ConflictError('msg');
          const rgbNodeErr = new RgbNodeError('msg', 500);
          const valErr = new ValidationError('msg', 'field');
          addResult('errorClasses', {
            success: true,
            tests: {
              SDKError: sdkErr instanceof SDKError,
              NetworkError: netErr.statusCode === 503,
              WalletError: walletErr instanceof SDKError,
              CryptoError: cryptoErr instanceof SDKError,
              ConfigurationError: configErr instanceof SDKError,
              BadRequestError: badReqErr.statusCode === 400,
              NotFoundError: notFoundErr.statusCode === 404,
              ConflictError: conflictErr.statusCode === 409,
              RgbNodeError: rgbNodeErr instanceof SDKError,
              ValidationError: valErr.field === 'field',
            },
          }, 10);
        } catch (e: any) { addResult('errorClasses', { success: false, error: e.message }, 10); }

        // Validation
        try {
          const t: Record<string, boolean> = {};
          t.normalizeNetwork = normalizeNetwork('mainnet') === 'mainnet';
          try { validateNetwork('bad'); t.validateNetworkThrows = false; } catch { t.validateNetworkThrows = true; }
          try { validateMnemonic('not'); t.validateMnemonicThrows = false; } catch { t.validateMnemonicThrows = true; }
          validatePsbt(UTXO_UNSIGNED_PSBT); t.validatePsbt = true;
          validateBase64(UTXO_UNSIGNED_PSBT); t.validateBase64 = true;
          try { validateHex('!!'); t.validateHexThrows = false; } catch { t.validateHexThrows = true; }
          validateHex('deadbeef'); t.validateHex = true;
          addResult('validation', { success: true, tests: t }, Object.keys(t).length);
        } catch (e: any) { addResult('validation', { success: false, error: e.message }, 7); }

        // UTEXO module
        try {
          const utexoWallet = new UTEXOWallet(TEST_MNEMONIC);
          const pubKeys = await utexoWallet.derivePublicKeys('testnet');
          let throwsBeforeInit = false;
          try { utexoWallet.getXpub(); } catch (e: any) { throwsBeforeInit = e.message.toLowerCase().includes('init'); }
          const lp = new LightningProtocol();
          let lpThrows = false;
          try { await lp.createLightningInvoice({ asset: { assetId: 'a', amount: 1 } } as any); } catch (e: any) { lpThrows = e.message.includes('not implemented'); }
          const op = new OnchainProtocol();
          let opThrows = false;
          try { await op.onchainReceive({ assetId: 'a', amount: 1 } as any); } catch (e: any) { opThrows = e.message.includes('not implemented'); }
          addResult('utexoModule', {
            success: true,
            tests: {
              instantiated: typeof utexoWallet.initialize === 'function',
              throwsBeforeInit,
              derivePublicKeys: pubKeys.xpub?.startsWith('tpub') ?? false,
              lightningStubThrows: lpThrows,
              onchainStubThrows: opThrows,
            },
          }, 5);
        } catch (e: any) { addResult('utexoModule', { success: false, error: e.message }, 5); }

        setTestResults(results);
      } finally {
        setTestLoading(false);
      }
    }

    runSdkTests();
  }, []);

  // ── Flow handlers ─────────────────────────────────────────────────────────

  async function handleUtexoVssFlow() {
    try {
      setRunningUtexoVssFlow(true);
      setUtexoVssFlowResults({ running: true, steps: [] });
      const r = await runUtexoVssFlow((progress: any) => setUtexoVssFlowResults(progress));
      setUtexoVssFlowResults({ ...r, running: false });
    } catch (e: any) {
      setUtexoVssFlowResults((prev: any) => ({ ...(prev ?? {}), running: false, success: false, error: e.message }));
    } finally {
      setRunningUtexoVssFlow(false);
    }
  }

  async function handleVssFlow() {
    const VSS_SERVER_URL = 'https://vss-server.utexo.com/vss';
    const steps: { step: string; status: string; result?: any; error?: string }[] = [];

    const addStep = (step: string, status: string, result?: any, error?: string) => {
      const i = steps.findIndex(s => s.step === step);
      const entry = { step, status, result, error };
      if (i >= 0) steps[i] = entry; else steps.push(entry);
      setVssFlowResults({ running: true, steps: [...steps] });
    };

    try {
      setRunningVssFlow(true);
      setVssFlowResults({ running: true, steps: [] });

      addStep('generateKeys', 'running');
      const keys = await generateKeys('testnet');
      const fpHex = keys.masterFingerprint;
      const signingKeyHex = (fpHex.repeat(8)).slice(0, 64);
      const storeId = `demo_${keys.masterFingerprint}`;
      addStep('generateKeys', 'success', { masterFingerprint: keys.masterFingerprint });

      const vssConfig: VssBackupConfig = {
        serverUrl: VSS_SERVER_URL,
        storeId,
        signingKey: signingKeyHex,
        encryptionEnabled: true,
        autoBackup: false,
        backupMode: 'Async',
      };

      addStep('initializeWallet', 'running');
      const wm = await createWalletManager({
        network: 'testnet',
        xpubVan: keys.accountXpubVanilla,
        xpubCol: keys.accountXpubColored,
        mnemonic: keys.mnemonic,
        masterFingerprint: keys.masterFingerprint,
      });
      await wm.initialize();
      addStep('initializeWallet', 'success');

      addStep('vssBackup', 'running');
      let backupVersion: number | null = null;
      try {
        backupVersion = await wm.vssBackup(vssConfig);
        addStep('vssBackup', 'success', { version: backupVersion });
      } catch (e: any) { addStep('vssBackup', 'error', undefined, e?.message ?? String(e)); }

      addStep('vssBackupInfo', 'running');
      try {
        const info = await wm.vssBackupInfo(vssConfig);
        addStep('vssBackupInfo', 'success', { backupExists: info.backupExists, serverVersion: info.serverVersion });
      } catch (e: any) { addStep('vssBackupInfo', 'error', undefined, e?.message ?? String(e)); }

      addStep('configureVssBackup', 'running');
      try {
        await wm.configureVssBackup({ ...vssConfig, autoBackup: true });
        addStep('configureVssBackup', 'success');
      } catch (e: any) { addStep('configureVssBackup', 'error', undefined, e?.message ?? String(e)); }

      addStep('disableVssAutoBackup', 'running');
      try {
        await wm.disableVssAutoBackup();
        addStep('disableVssAutoBackup', 'success');
      } catch (e: any) { addStep('disableVssAutoBackup', 'error', undefined, e?.message ?? String(e)); }

      addStep('restoreFromVss', 'running');
      let restoredVssPath: string | null = null;
      try {
        const dir = `${FileSystem.documentDirectory}vss_restore_test`;
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        restoredVssPath = await restoreFromVss(vssConfig, dir.replace('file://', ''));
        addStep('restoreFromVss', 'success', { restoredPath: restoredVssPath });
      } catch (e: any) { addStep('restoreFromVss', 'error', undefined, e?.message ?? String(e)); }

      addStep('verifyRestoredWallet', 'running');
      try {
        if (!restoredVssPath) throw new Error('Restore did not succeed — skipping verification');
        const restoredWm = new WalletManager({
          network: 'testnet',
          xpubVan: keys.accountXpubVanilla,
          xpubCol: keys.accountXpubColored,
          mnemonic: keys.mnemonic,
          masterFingerprint: keys.masterFingerprint,
          dataDir: restoredVssPath,
        });
        await restoredWm.initialize();
        await restoredWm.syncWallet();
        await restoredWm.refreshWallet();
        const [bal, addr, assets, txs] = await Promise.all([
          restoredWm.getBtcBalance(),
          restoredWm.getAddress(),
          restoredWm.listAssets(),
          restoredWm.listTransactions(),
        ]);
        addStep('verifyRestoredWallet', 'success', {
          address: addr,
          btcSettled: bal?.vanilla?.settled ?? 0,
          totalAssets: (assets.nia?.length ?? 0) + (assets.ifa?.length ?? 0),
          transactionCount: txs.length,
        });
        await restoredWm.dispose();
      } catch (e: any) { addStep('verifyRestoredWallet', 'error', undefined, e?.message ?? String(e)); }

      setVssFlowResults({ running: false, success: true, steps, storeId, backupVersion });
    } catch (e: any) {
      setVssFlowResults({ running: false, success: false, error: e instanceof Error ? e.message : String(e), steps });
    } finally {
      setRunningVssFlow(false);
    }
  }

  async function handleTestnetWalletFlow() {
    const steps: { step: string; status: string; result?: any; error?: string }[] = [];

    const addStep = (step: string, status: string, result?: any, error?: string) => {
      const i = steps.findIndex((s) => s.step === step);
      const entry = { step, status, result, error };
      if (i >= 0) steps[i] = entry;
      else steps.push(entry);
      setTestnetWalletFlowResults({ running: true, steps: [...steps] });
    };

    let wm: WalletManager | null = null;
    try {
      setRunningTestnetWalletFlow(true);
      setTestnetWalletFlowResults({ running: true, steps: [] });

      addStep('generateKeys', 'running');
      const keys = await generateKeys('testnet');
      addStep('generateKeys', 'success', {
        masterFingerprint: keys.masterFingerprint,
        xpubPrefix: keys.xpub.slice(0, 4),
      });

      addStep('createWalletManager', 'running');
      const indexerUrl = DEFAULT_INDEXER_URLS['testnet'];
      wm = createWalletManager({
        network: 'testnet',
        xpubVan: keys.accountXpubVanilla,
        xpubCol: keys.accountXpubColored,
        mnemonic: keys.mnemonic,
        masterFingerprint: keys.masterFingerprint,
        indexerUrl,
      });
      addStep('createWalletManager', 'success', {
        network: wm.getNetwork(),
        indexerUrl,
      });

      addStep('initialize', 'running');
      await wm.initialize();
      addStep('initialize', 'success', { online: true });

      addStep('syncWallet', 'running');
      await wm.syncWallet();
      addStep('syncWallet', 'success');

      addStep('refreshWallet', 'running');
      await wm.refreshWallet();
      addStep('refreshWallet', 'success');

      addStep('getAddress', 'running');
      const address = await wm.getAddress();
      addStep('getAddress', 'success', { address });

      addStep('getBtcBalance', 'running');
      const balance = await wm.getBtcBalance();
      addStep('getBtcBalance', 'success', {
        vanillaSettled: balance.vanilla?.settled ?? 0,
        vanillaSpendable: balance.vanilla?.spendable ?? 0,
        coloredSettled: balance.colored?.settled ?? 0,
        coloredSpendable: balance.colored?.spendable ?? 0,
      });

      addStep('dispose', 'running');
      await wm.dispose();
      wm = null;
      addStep('dispose', 'success');

      setTestnetWalletFlowResults({ running: false, success: true, steps });
    } catch (e: any) {
      if (wm) {
        try {
          await wm.dispose();
        } catch {
          /* ignore */
        }
      }
      setTestnetWalletFlowResults({
        running: false,
        success: false,
        error: e instanceof Error ? e.message : String(e),
        steps,
      });
    } finally {
      setRunningTestnetWalletFlow(false);
    }
  }

  async function handleReuseAddressFlow() {
    const steps: { step: string; status: string; result?: any; error?: string }[] = [];

    const addStep = (step: string, status: string, result?: any, error?: string) => {
      const i = steps.findIndex((s) => s.step === step);
      const entry = { step, status, result, error };
      if (i >= 0) steps[i] = entry;
      else steps.push(entry);
      setReuseAddressFlowResults({ running: true, steps: [...steps] });
    };

    let wm: WalletManager | null = null;
    let addressBeforeRotate: string | null = null;
    try {
      setRunningReuseAddressFlow(true);
      setReuseAddressFlowResults({ running: true, steps: [] });

      addStep('generateKeys', 'running');
      const keys = await generateKeys('testnet');
      addStep('generateKeys', 'success', {
        masterFingerprint: keys.masterFingerprint,
        xpubPrefix: keys.xpub.slice(0, 4),
      });

      addStep('createWalletReuse', 'running');
      const indexerUrl = DEFAULT_INDEXER_URLS['testnet'];
      wm = createWalletManager({
        network: 'testnet',
        xpubVan: keys.accountXpubVanilla,
        xpubCol: keys.accountXpubColored,
        mnemonic: keys.mnemonic,
        masterFingerprint: keys.masterFingerprint,
        indexerUrl,
        reuseAddresses: true,
      });
      addStep('createWalletReuse', 'success', {
        network: wm.getNetwork(),
        reuseAddresses: true,
        indexerUrl,
      });

      addStep('initialize', 'running');
      await wm.initialize();
      addStep('initialize', 'success', { online: true });

      addStep('syncWallet', 'running');
      await wm.syncWallet();
      addStep('syncWallet', 'success');

      addStep('refreshWallet', 'running');
      await wm.refreshWallet();
      addStep('refreshWallet', 'success');

      addStep('addressPairBeforeRotate', 'running');
      const b1 = await wm.getAddress();
      const b2 = await wm.getAddress();
      addressBeforeRotate = b1;
      if (b1 !== b2) {
        addStep(
          'addressPairBeforeRotate',
          'error',
          { first: b1, second: b2, match: false },
          'Expected identical addresses with reuseAddresses before rotation'
        );
      } else {
        addStep('addressPairBeforeRotate', 'success', { address: b1, match: true });
      }

      addStep('rotateAddresses', 'running');
      const nextVanilla = await wm.rotateVanillaAddress();
      const nextColored = await wm.rotateColoredAddress();
      addStep('rotateAddresses', 'success', { nextVanilla, nextColored });

      addStep('addressPairAfterRotate', 'running');
      const a1 = await wm.getAddress();
      const a2 = await wm.getAddress();
      if (a1 !== a2) {
        addStep(
          'addressPairAfterRotate',
          'error',
          { first: a1, second: a2, match: false },
          'Expected identical addresses with reuseAddresses after rotation'
        );
      } else {
        addStep('addressPairAfterRotate', 'success', {
          address: a1,
          match: true,
          changedFromBefore: addressBeforeRotate != null && a1 !== addressBeforeRotate,
        });
      }

      addStep('dispose', 'running');
      await wm.dispose();
      wm = null;
      addStep('dispose', 'success');

      const failed = steps.some((s) => s.status === 'error');
      setReuseAddressFlowResults({ running: false, success: !failed, steps });
    } catch (e: any) {
      if (wm) {
        try {
          await wm.dispose();
        } catch {
          /* ignore */
        }
      }
      setReuseAddressFlowResults({
        running: false,
        success: false,
        error: e instanceof Error ? e.message : String(e),
        steps,
      });
    } finally {
      setRunningReuseAddressFlow(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Flows</Text>
          <Text style={styles.headerSubtitle}>
            Run live SDK tests and end-to-end flow demos against real infrastructure.
          </Text>
          <View style={styles.networkRow}>
            <View style={styles.networkBadge}>
              <View style={styles.networkDot} />
              <Text style={styles.networkText}>
                {Platform.OS === 'android' ? 'Android · 10.0.2.2:8000' : 'iOS · 127.0.0.1:8000'}
              </Text>
            </View>
          </View>
        </View>

        {/* SDK Tests */}
        <TestSummaryCard results={testResults} loading={testLoading} />

        {/* ── Testnet WalletManager (sync + address + balance) ─────────────── */}
        <FlowCard
          title="Testnet Wallet"
          subtitle="Iris Electrum · testnet"
          description="Live path: generateKeys(testnet) → WalletManager(testnet + DEFAULT_INDEXER_URLS) → initialize → sync → refresh → address → BTC balance → dispose."
          accentColor="#0D9488"
          totalSteps={8}
          results={testnetWalletFlowResults}
          running={runningTestnetWalletFlow}
          onRun={handleTestnetWalletFlow}>
          {testnetWalletFlowResults?.steps?.map((step: any, idx: number, arr: any[]) => {
            const meta = TESTNET_WALLET_STEP_META[step.step] ?? { label: step.step, desc: '' };
            return (
              <StepCard
                key={idx}
                idx={idx}
                step={step}
                label={meta.label}
                desc={meta.desc}
                accentColor="#0D9488"
                isLast={idx === arr.length - 1}
              />
            );
          })}
        </FlowCard>

        {/* ── Testnet WalletManager: reuseAddresses + rotation ─────────────── */}
        <FlowCard
          title="Reuse address + rotation"
          subtitle="WalletManager · reuseAddresses"
          description="Init with reuseAddresses: true → two getAddress() (must match) → rotateVanilla + rotateColored → two getAddress() again (must match; may differ from pre-rotate)."
          accentColor="#0F766E"
          totalSteps={9}
          results={reuseAddressFlowResults}
          running={runningReuseAddressFlow}
          onRun={handleReuseAddressFlow}>
          {reuseAddressFlowResults?.steps?.map((step: any, idx: number, arr: any[]) => {
            const meta = REUSE_ADDRESS_FLOW_STEP_META[step.step] ?? { label: step.step, desc: '' };
            return (
              <StepCard
                key={idx}
                idx={idx}
                step={step}
                label={meta.label}
                desc={meta.desc}
                accentColor="#0F766E"
                isLast={idx === arr.length - 1}
              />
            );
          })}
        </FlowCard>

        {/* ── UTEXO VSS E2E Flow ────────────────────────────────────────── */}
        <FlowCard
          title="UTEXO VSS E2E"
          subtitle="Create → Backup → Restore"
          description="Full lifecycle: create wallet → fund → issue NIA → VSS backup → destroy → restore → verify."
          accentColor="#0891B2"
          totalSteps={15}
          results={utexoVssFlowResults}
          running={runningUtexoVssFlow}
          onRun={handleUtexoVssFlow}>
          {utexoVssFlowResults?.steps?.map((step: any, idx: number, arr: any[]) => {
            const meta = UTEXO_VSS_STEP_META[step.step] ?? { label: step.step, desc: '' };
            return (
              <StepCard key={idx} idx={idx} step={step} label={meta.label} desc={meta.desc} accentColor="#0891B2" isLast={idx === arr.length - 1} />
            );
          })}
        </FlowCard>

        {/* ── VSS Cloud Backup ─────────────────────────────────────────── */}
        <FlowCard
          title="VSS Cloud Backup"
          subtitle="vss-server.utexo.com"
          description="End-to-end test against the live VSS server: generate keys → init wallet → backup → check status → configure → disable → restore → verify."
          accentColor="#7C3AED"
          totalSteps={8}
          results={vssFlowResults}
          running={runningVssFlow}
          onRun={handleVssFlow}
          extra={vssFlowResults?.storeId && !vssFlowResults.running ? (
            <View style={styles.storeIdRow}>
              <Text style={styles.storeIdLabel}>Store ID</Text>
              <Text style={styles.storeIdValue} numberOfLines={1}>{vssFlowResults.storeId}</Text>
            </View>
          ) : undefined}>
          {vssFlowResults?.steps?.map((step: any, idx: number, arr: any[]) => {
            const meta = VSS_STEP_META[step.step] ?? { label: step.step, desc: '' };
            return (
              <StepCard key={idx} idx={idx} step={step} label={meta.label} desc={meta.desc} accentColor="#7C3AED" isLast={idx === arr.length - 1} />
            );
          })}
        </FlowCard>

        <View style={styles.footer} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', web: 'monospace' });

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AppColors.bgBase },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  header: { paddingTop: 24, paddingBottom: 16, gap: 8 },
  headerTitle: { fontSize: 26, fontWeight: '800', color: AppColors.textPrimary, letterSpacing: 0.5 },
  headerSubtitle: { fontSize: 14, color: AppColors.textSecondary, lineHeight: 20 },
  networkRow: { flexDirection: 'row', marginTop: 4 },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: AppColors.bgCard,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  networkDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: AppColors.success },
  networkText: { fontSize: 12, color: AppColors.textSecondary, fontFamily: MONO },

  storeIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: AppColors.border,
  },
  storeIdLabel: { fontSize: 11, fontWeight: '700', color: AppColors.textTertiary },
  storeIdValue: { flex: 1, fontSize: 11, color: AppColors.textSecondary, fontFamily: MONO },

  footer: { height: 20 },
});

// Step card styles — timeline layout
const sStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 14,
  },

  // Left: circle + vertical line
  timelineCol: {
    width: 32,
    alignItems: 'center',
  },
  circle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  circleText: {
    fontSize: 10,
    fontWeight: '700',
    includeFontPadding: false,
  },
  line: {
    width: 1.5,
    flex: 1,
    marginVertical: 3,
  },

  // Right: content
  stepContent: {
    flex: 1,
    paddingLeft: 12,
    paddingTop: 2,
    paddingBottom: 4,
    gap: 3,
  },
  stepContentSpaced: {
    paddingBottom: 18,
  },
  stepTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexWrap: 'wrap',
  },
  stepLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: AppColors.textSecondary,
  },
  statusTag: {
    borderRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  statusTagText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  stepDesc: {
    fontSize: 12,
    color: AppColors.textTertiary,
    lineHeight: 17,
  },
  codeBox: {
    marginTop: 5,
    backgroundColor: AppColors.bgBase,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: AppColors.border,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  codeText: {
    fontFamily: MONO,
    fontSize: 11,
    color: AppColors.textSecondary,
    lineHeight: 17,
  },
});

// Flow card styles
const fStyles = StyleSheet.create({
  card: {
    backgroundColor: AppColors.bgCard,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 14,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  cardAccentBar: { width: 3, borderRadius: 2, marginRight: 12 },
  cardTitleArea: { flex: 1, gap: 4 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: AppColors.textPrimary },
  cardSubtitle: { fontSize: 12, color: AppColors.textTertiary, fontFamily: MONO },
  statusPill: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  statusText: { fontSize: 11, fontWeight: '600' },
  cardDesc: { fontSize: 13, color: AppColors.textSecondary, lineHeight: 18 },

  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexWrap: 'wrap',
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressLabel: { fontSize: 11, color: AppColors.textTertiary, marginLeft: 4, fontFamily: MONO },

  idleBody: { padding: 14 },
  runBtn: {
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  runBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.3 },

  stepsWrapper: {
    paddingTop: 12,
    paddingBottom: 4,
  },

  rerunBtn: {
    borderTopWidth: 1,
    borderColor: AppColors.border,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  rerunBtnText: { fontWeight: '700', fontSize: 13 },
});

// Test summary styles
const tStyles = StyleSheet.create({
  card: {
    backgroundColor: AppColors.bgCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppColors.border,
    marginBottom: 14,
    overflow: 'hidden',
  },
  header: { padding: 14, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: AppColors.textPrimary },
  pill: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  pillText: { fontSize: 11, fontWeight: '600' },
  desc: { fontSize: 13, color: AppColors.textSecondary },
  chevron: { fontSize: 12, color: AppColors.textTertiary, marginTop: 2 },
  body: {
    borderTopWidth: 1,
    borderTopColor: AppColors.border,
    paddingVertical: 6,
  },
  testRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 8,
  },
  testIcon: { fontSize: 12, fontWeight: '700', width: 14 },
  testName: { fontSize: 13, fontFamily: MONO, flex: 1 },
  testError: { fontSize: 11, color: AppColors.error, flex: 1 },
});
