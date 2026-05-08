import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useRef, useState } from 'react';
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
  BadRequestError,
  ConfigurationError,
  ConflictError,
  createWalletManager,
  CryptoError,
  DEFAULT_INDEXER_URLS,
  deriveKeysFromMnemonic,
  generateKeys,
  LightningProtocol,
  NetworkError,
  normalizeNetwork,
  NotFoundError,
  OnchainProtocol,
  restoreFromVss,
  RgbNodeError,
  SDKError,
  signMessage,
  signPsbt,
  signPsbtFromSeed,
  signPsbtSync,
  UTEXOWallet,
  validateBase64,
  validateHex,
  validateMnemonic,
  validateNetwork,
  validatePsbt,
  ValidationError,
  verifyMessage,
  VssBackupConfig,
  wallet,
  WalletError,
  WalletManager
} from '@utexo/rgb-sdk-rn';

import { AppColors } from '@/constants/theme';
import {
  runRlnExternalSignerChannelPaymentFlow,
  runRlnExternalSignerFlow,
  runRlnExternalSignerIssueAssetFlow,
  runRlnExternalSignerPaymentFlow,
  runRlnPaymentFlow,
  runRlnSwapRoundtripBuyFlow,
  runUtexoVssFlow,
} from '@/utils/wallet-flow';

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
  deferErrorDisplay = false,
}: {
  idx: number;
  step: { status: string; data?: any; error?: string; result?: any };
  label: string;
  desc: string;
  accentColor: string;
  isLast: boolean;
  deferErrorDisplay?: boolean;
}) {
  const isSuccess = step.status === 'success';
  const isRunning = step.status === 'running';
  const isError = step.status === 'error';
  const showErrorState = isError && !deferErrorDisplay;

  const detail = step.data ?? step.result;

  const circleColor = isSuccess
    ? AppColors.success
    : isRunning
    ? accentColor
    : showErrorState
    ? AppColors.error
    : AppColors.textTertiary;

  const circleBg = isSuccess
    ? AppColors.successBg
    : isRunning
    ? accentColor + '18'
    : showErrorState
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
          ) : showErrorState ? (
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
            showErrorState && { color: AppColors.error },
            isRunning && { color: accentColor },
          ]}>
            {label}
          </Text>
          {isRunning && (
            <View style={[sStyles.statusTag, { backgroundColor: accentColor + '18', borderColor: accentColor + '40' }]}>
              <Text style={[sStyles.statusTagText, { color: accentColor }]}>running</Text>
            </View>
          )}
          {showErrorState && (
            <View style={[sStyles.statusTag, { backgroundColor: AppColors.errorBg, borderColor: AppColors.errorBorder }]}>
              <Text style={[sStyles.statusTagText, { color: AppColors.error }]}>failed</Text>
            </View>
          )}
        </View>
        <Text style={sStyles.stepDesc}>{desc}</Text>
        {(detail || step.error) && (
          <View style={[sStyles.codeBox, showErrorState && { borderColor: AppColors.errorBorder, backgroundColor: AppColors.errorBg }]}>
            <Text style={[sStyles.codeText, showErrorState && { color: '#FCA5A5' }]}>
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
  const effectiveRunning = running || results?.running === true;
  const doneCount = steps.filter((s: any) => s.status === 'success').length;
  const total = totalSteps ?? steps.length;
  const borderColor = !hasResults
    ? AppColors.border
    : effectiveRunning
    ? AppColors.border
    : success
    ? AppColors.successBorder
    : AppColors.errorBorder;

  return (
    <View style={[fStyles.card, { borderColor }]}>
      {/* Card header */}
      <View style={[fStyles.cardHeader, { borderBottomColor: AppColors.border }]}>
        <View style={[fStyles.cardAccentBar, { backgroundColor: accentColor }]} />
        <View style={fStyles.cardTitleArea}>
          <View style={fStyles.cardTitleRow}>
            <Text style={fStyles.cardTitle}>{title}</Text>
            {subtitle && <Text style={fStyles.cardSubtitle}>{subtitle}</Text>}
            {effectiveRunning && <ActivityIndicator size="small" color={accentColor} style={{ marginLeft: 6 }} />}
            {hasResults && !effectiveRunning && (
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

      {/* Flow-level error summary */}
      {hasResults && !effectiveRunning && success === false && results?.error && (
        <View style={fStyles.flowErrorBox}>
          <Text style={fStyles.flowErrorTitle}>Failure reason</Text>
          <Text style={fStyles.flowErrorText}>{formatDetail(results.error)}</Text>
        </View>
      )}

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
              ? effectiveRunning
                ? AppColors.border
                : AppColors.error
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
      {!hasResults && !effectiveRunning && (
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
      {hasResults && !effectiveRunning && (
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
  sendIssuedAssetToReceiver: { label: 'Witness Send to Receiver', desc: 'Init receiver, witness invoice, send asset, then timed refreshes' },
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

const RLN_DEMO_STEP_META: Record<string, { label: string; desc: string }> = {
  rlnCreateNode: { label: 'Create Node', desc: 'Create RLN node with local storage and ports' },
  rlnInitNode: { label: 'Init Node', desc: 'Initialize node with wallet mnemonic' },
  rlnUnlockNode: { label: 'Unlock Node', desc: 'Unlock node with bitcoind/indexer/proxy settings' },
  rlnNodeInfo: { label: 'Node Info', desc: 'Read node summary and balances' },
  rlnNetworkInfo: { label: 'Network Info', desc: 'Read chain network and height' },
  rlnListPeers: { label: 'List Peers', desc: 'Fetch currently known peers' },
  rlnConnectPeer: { label: 'Connect Peer', desc: 'Connect to test peer endpoint' },
  rlnDisconnectPeer: { label: 'Disconnect Peer', desc: 'Disconnect selected peer pubkey' },
  rlnListChannels: { label: 'List Channels', desc: 'Fetch currently known channels' },
  rlnOpenChannel: { label: 'Open Channel', desc: 'Try opening a test channel' },
  rlnCloseChannel: { label: 'Close Channel', desc: 'Close opened channel when available' },
  rlnListPayments: { label: 'List Payments', desc: 'Fetch payments history from RLN node' },
  rlnAddress: { label: 'Address', desc: 'Request onchain receive address' },
  fundAddress: { label: 'Fund Address', desc: 'Send BTC to node address and mine confirmation blocks' },
  rlnBtcBalance: { label: 'BTC Balance', desc: 'Read BTC balances from RLN node' },
  rlnAssetBalance: { label: 'Asset Balance', desc: 'Read RGB asset balance for provided assetId' },
  rlnCheckIndexerUrl: { label: 'Check Indexer URL', desc: 'Validate indexer endpoint reachability' },
  rlnCheckProxyEndpoint: { label: 'Check Proxy Endpoint', desc: 'Validate proxy endpoint reachability' },
  rlnEstimateFee: { label: 'Estimate Fee', desc: 'Estimate fee rates for target blocks' },
  rlnCreateUtxos: { label: 'Create UTXOs', desc: 'Request UTXO creation on RLN node wallet' },
  rlnDecodeLnInvoice: { label: 'Decode LN Invoice', desc: 'Decode BOLT11 lightning invoice string' },
  rlnDecodeRgbInvoice: { label: 'Decode RGB Invoice', desc: 'Decode RGB invoice string' },
  rlnFailTransfers: { label: 'Fail Transfers', desc: 'Mark pending transfers as failed' },
  rlnGetChannelId: { label: 'Get Channel ID', desc: 'Resolve channel id from temporary id' },
  rlnGetPayment: { label: 'Get Payment', desc: 'Lookup payment by payment hash' },
  rlnInvoiceStatus: { label: 'Invoice Status', desc: 'Read status for LN invoice' },
  rlnKeysend: { label: 'Keysend', desc: 'Send keysend payment attempt' },
  rlnListAssets: { label: 'List Assets', desc: 'List RGB assets tracked by RLN wallet' },
  rlnListTransactions: { label: 'List Transactions', desc: 'List onchain transactions' },
  rlnListTransfers: { label: 'List Transfers', desc: 'List RGB transfers for assetId' },
  rlnListUnspents: { label: 'List Unspents', desc: 'List spendable unspent outputs' },
  rlnLnInvoice: { label: 'Create LN Invoice', desc: 'Create lightning invoice request' },
  rlnRefreshTransfers: { label: 'Refresh Transfers', desc: 'Refresh transfer statuses from network' },
  rlnRgbInvoice: { label: 'Create RGB Invoice', desc: 'Create RGB receive invoice request' },
  rlnSendBtc: { label: 'Send BTC', desc: 'Send onchain BTC transaction attempt' },
  rlnSendPayment: { label: 'Send Payment', desc: 'Pay lightning invoice attempt' },
  rlnSendRgb: { label: 'Send RGB', desc: 'Send RGB transfer attempt' },
  rlnBackup: { label: 'Backup', desc: 'Trigger RLN wallet backup request' },
  rlnSync: { label: 'Sync', desc: 'Sync RLN node wallet state' },
  rlnLock: { label: 'Lock', desc: 'Not supported in current RLN bindings' },
  rlnRestore: { label: 'Restore', desc: 'Wallet-level restore, not RLN node method' },
  rlnShutdown: { label: 'Shutdown', desc: 'Shutdown RLN node process' },
  rlnDestroyNode: { label: 'Destroy Node', desc: 'Destroy node handle and cleanup resources' },
  rlnCreateNativeExternalSigner: { label: 'Create External Signer', desc: 'Create native external signer from BIP39 seed' },
  rlnInitNodeWithNativeExternalSigner: { label: 'Init With External Signer', desc: 'Initialize node using native external signer instead of password' },
  rlnUnlockNodeWithNativeExternalSigner: { label: 'Unlock With External Signer', desc: 'Unlock node using native external signer with bitcoind/indexer settings' },
  rlnDestroyNativeExternalSigner: { label: 'Destroy External Signer', desc: 'Destroy native external signer handle' },
  rlnSyncBeforeRestart: { label: 'Sync Before Restart', desc: 'Sync node before restart sequence' },
  rlnShutdownForRestart: { label: 'Shutdown For Restart', desc: 'Shutdown node to validate restart lifecycle' },
  rlnUnlockAfterRestart: { label: 'Unlock After Restart', desc: 'Unlock node again after shutdown' },
  rlnNodeInfoAfterRestart: { label: 'Node Info After Restart', desc: 'Validate node information after restart' },
  rlnOpenCloseCycle1: { label: 'Open/Close Cycle 1', desc: 'First open-close channel diagnostic cycle' },
  rlnOpenCloseCycle2: { label: 'Open/Close Cycle 2', desc: 'Second open-close channel diagnostic cycle' },
  // ── Payment flow steps ────────────────────────────────────────────────────
  payACreateNode: { label: 'Pay Node A Create', desc: 'Create RLN node A for payment flow' },
  payAInitNode: { label: 'Pay Node A Init', desc: 'Initialize payment node A' },
  payAUnlockNode: { label: 'Pay Node A Unlock', desc: 'Unlock payment node A' },
  payBCreateNode: { label: 'Pay Node B Create', desc: 'Create RLN node B for payment flow' },
  payBInitNode: { label: 'Pay Node B Init', desc: 'Initialize payment node B' },
  payBUnlockNode: { label: 'Pay Node B Unlock', desc: 'Unlock payment node B' },
  payCCreateNode: { label: 'Pay Node C Create', desc: 'Create RLN node C for payment flow' },
  payCInitNode: { label: 'Pay Node C Init', desc: 'Initialize payment node C' },
  payCUnlockNode: { label: 'Pay Node C Unlock', desc: 'Unlock payment node C' },
  payAFund: { label: 'Pay Node A Fund', desc: 'Fund payment node A with BTC' },
  payACreateUtxos: { label: 'Pay Node A UTXOs', desc: 'Create UTXOs for payment node A' },
  payBFund: { label: 'Pay Node B Fund', desc: 'Fund payment node B with BTC' },
  payBCreateUtxos: { label: 'Pay Node B UTXOs', desc: 'Create UTXOs for payment node B' },
  payCFund: { label: 'Pay Node C Fund', desc: 'Fund payment node C with BTC' },
  payCCreateUtxos: { label: 'Pay Node C UTXOs', desc: 'Create UTXOs for payment node C' },
  payNodeInfos: { label: 'Pay Node Infos', desc: 'Fetch pubkeys for payment nodes A and B' },
  payConnectPeers: { label: 'Pay Connect Peers', desc: 'Connect B→A and C→B peers' },
  payOpenChannel: { label: 'Pay Open Channel', desc: 'B opens channel to A; wait for funding confirmation' },
  payCreateInvoices: { label: 'Pay Create Invoices', desc: 'A creates 4 invoices concurrently' },
  paySendPayment1: { label: 'Pay Send Payment 1', desc: 'B sends first payment to A (10k msat)' },
  payWaitInvoice1: { label: 'Pay Wait Invoice 1', desc: 'Wait for invoice 1 SUCCEEDED on A' },
  payWaitSender1: { label: 'Pay Wait Sender 1', desc: 'Wait for payment 1 success on B' },
  paySendPayment2: { label: 'Pay Send Payment 2', desc: 'B sends second payment to A (20k msat)' },
  payWaitInvoice2: { label: 'Pay Wait Invoice 2', desc: 'Wait for invoice 2 SUCCEEDED on A' },
  payWaitSender2: { label: 'Pay Wait Sender 2', desc: 'Wait for payment 2 success on B' },
  paySendPayment3: { label: 'Pay Send Payment 3', desc: 'B sends third payment to A (30k msat)' },
  payWaitInvoice3: { label: 'Pay Wait Invoice 3', desc: 'Wait for invoice 3 SUCCEEDED on A' },
  payWaitSender3: { label: 'Pay Wait Sender 3', desc: 'Wait for payment 3 success on B' },
  paySendPayment4: { label: 'Pay Send Payment 4', desc: 'B sends fourth payment to A (40k msat)' },
  payWaitInvoice4: { label: 'Pay Wait Invoice 4', desc: 'Wait for invoice 4 SUCCEEDED on A' },
  payWaitSender4: { label: 'Pay Wait Sender 4', desc: 'Wait for payment 4 success on B' },
  payCloseChannel: { label: 'Pay Close Channel', desc: 'Force close channel and mine confirmation blocks' },
  payFinalBalance: { label: 'Pay Final Balance', desc: 'Read final BTC balance on node A' },
  // ── Restart flow steps ────────────────────────────────────────────────────
  restartACreateNode: { label: 'Restart Node A Create', desc: 'Create RLN node A for restart flow' },
  restartAInitNode: { label: 'Restart Node A Init', desc: 'Initialize restart node A' },
  restartAUnlockNode: { label: 'Restart Node A Unlock', desc: 'Unlock restart node A' },
  restartBCreateNode: { label: 'Restart Node B Create', desc: 'Create RLN node B for restart flow' },
  restartBInitNode: { label: 'Restart Node B Init', desc: 'Initialize restart node B' },
  restartBUnlockNode: { label: 'Restart Node B Unlock', desc: 'Unlock restart node B' },
  restartCCreateNode: { label: 'Restart Node C Create', desc: 'Create RLN node C for restart flow' },
  restartCInitNode: { label: 'Restart Node C Init', desc: 'Initialize restart node C' },
  restartCUnlockNode: { label: 'Restart Node C Unlock', desc: 'Unlock restart node C' },
  restartAFund: { label: 'Restart Node A Fund', desc: 'Fund restart node A with BTC' },
  restartACreateUtxos: { label: 'Restart Node A UTXOs', desc: 'Create UTXOs for restart node A' },
  restartBFund: { label: 'Restart Node B Fund', desc: 'Fund restart node B with BTC' },
  restartBCreateUtxos: { label: 'Restart Node B UTXOs', desc: 'Create UTXOs for restart node B' },
  restartCFund: { label: 'Restart Node C Fund', desc: 'Fund restart node C with BTC' },
  restartCCreateUtxos: { label: 'Restart Node C UTXOs', desc: 'Create UTXOs for restart node C' },
  restartNodeInfos: { label: 'Restart Node Infos', desc: 'Fetch pubkeys for restart nodes A and B' },
  restartConnectPeer: { label: 'Restart Connect Peer', desc: 'Connect B→A peer' },
  restartOpenChannel: { label: 'Restart Open Channel', desc: 'A opens channel to B; wait for funding' },
  restartPreRestartPayment: { label: 'Restart Pre-Restart Payment', desc: 'A pays B before restart' },
  restartShutdownA: { label: 'Restart Shutdown A', desc: 'Shutdown node A for restart' },
  restartShutdownB: { label: 'Restart Shutdown B', desc: 'Shutdown node B for restart' },
  restartShutdownC: { label: 'Restart Shutdown C', desc: 'Shutdown node C for restart' },
  restartARecreateCreateNode: { label: 'Restart A Recreate Create', desc: 'Recreate node A after shutdown' },
  restartARecreateInitNode: { label: 'Restart A Recreate Init', desc: 'Re-init node A after shutdown' },
  restartARecreateUnlockNode: { label: 'Restart A Recreate Unlock', desc: 'Re-unlock node A after shutdown' },
  restartBRecreateCreateNode: { label: 'Restart B Recreate Create', desc: 'Recreate node B after shutdown' },
  restartBRecreateInitNode: { label: 'Restart B Recreate Init', desc: 'Re-init node B after shutdown' },
  restartBRecreateUnlockNode: { label: 'Restart B Recreate Unlock', desc: 'Re-unlock node B after shutdown' },
  restartCRecreateCreateNode: { label: 'Restart C Recreate Create', desc: 'Recreate node C after shutdown' },
  restartCRecreateInitNode: { label: 'Restart C Recreate Init', desc: 'Re-init node C after shutdown' },
  restartCRecreateUnlockNode: { label: 'Restart C Recreate Unlock', desc: 'Re-unlock node C after shutdown' },
  restartWaitUsableChannel: { label: 'Restart Wait Usable Channel', desc: 'Wait for channel to become usable after restart' },
  restartVerifyPayment: { label: 'Restart Verify Payment', desc: 'Confirm pre-restart payment survived' },
  // ── Multi open/close flow steps ───────────────────────────────────────────
  mocACreateNode: { label: 'MOC Node A Create', desc: 'Create RLN node A for multi open/close flow' },
  mocAInitNode: { label: 'MOC Node A Init', desc: 'Initialize multi open/close node A' },
  mocAUnlockNode: { label: 'MOC Node A Unlock', desc: 'Unlock multi open/close node A' },
  mocBCreateNode: { label: 'MOC Node B Create', desc: 'Create RLN node B for multi open/close flow' },
  mocBInitNode: { label: 'MOC Node B Init', desc: 'Initialize multi open/close node B' },
  mocBUnlockNode: { label: 'MOC Node B Unlock', desc: 'Unlock multi open/close node B' },
  mocCCreateNode: { label: 'MOC Node C Create', desc: 'Create RLN node C for multi open/close flow' },
  mocCInitNode: { label: 'MOC Node C Init', desc: 'Initialize multi open/close node C' },
  mocCUnlockNode: { label: 'MOC Node C Unlock', desc: 'Unlock multi open/close node C' },
  mocAFund: { label: 'MOC Node A Fund', desc: 'Fund multi open/close node A' },
  mocACreateUtxos: { label: 'MOC Node A UTXOs', desc: 'Create UTXOs for multi open/close node A' },
  mocBFund: { label: 'MOC Node B Fund', desc: 'Fund multi open/close node B' },
  mocBCreateUtxos: { label: 'MOC Node B UTXOs', desc: 'Create UTXOs for multi open/close node B' },
  mocCFund: { label: 'MOC Node C Fund', desc: 'Fund multi open/close node C' },
  mocCCreateUtxos: { label: 'MOC Node C UTXOs', desc: 'Create UTXOs for multi open/close node C' },
  mocNodeInfos: { label: 'MOC Node Infos', desc: 'Fetch pubkeys for nodes A and B' },
  mocConnectPeers: { label: 'MOC Connect Peers', desc: 'Connect B→A and C→B peers' },
  mocOpenChannel1: { label: 'MOC Open Channel 1', desc: 'B opens channel to A — cycle 1' },
  mocKeysend1: { label: 'MOC Keysend 1', desc: 'A keysends 1000 sat to B — cycle 1' },
  mocBalanceCheck1: { label: 'MOC Balance Check 1', desc: 'Check BTC balances after keysend — cycle 1' },
  mocCloseChannel1: { label: 'MOC Close Channel 1', desc: 'Cooperative close channel — cycle 1' },
  mocOpenChannel2: { label: 'MOC Open Channel 2', desc: 'B opens channel to A — cycle 2' },
  mocKeysend2: { label: 'MOC Keysend 2', desc: 'A keysends 1000 sat to B — cycle 2' },
  mocBalanceCheck2: { label: 'MOC Balance Check 2', desc: 'Check BTC balances after keysend — cycle 2' },
  mocCloseChannel2: { label: 'MOC Close Channel 2', desc: 'Cooperative close channel — cycle 2' },
  // ── Concurrent BTC payments flow steps ───────────────────────────────────
  cbpACreateNode: { label: 'CBP Node A Create', desc: 'Create RLN node A for concurrent payments flow' },
  cbpAInitNode: { label: 'CBP Node A Init', desc: 'Initialize concurrent payments node A' },
  cbpAUnlockNode: { label: 'CBP Node A Unlock', desc: 'Unlock concurrent payments node A' },
  cbpBCreateNode: { label: 'CBP Node B Create', desc: 'Create RLN node B for concurrent payments flow' },
  cbpBInitNode: { label: 'CBP Node B Init', desc: 'Initialize concurrent payments node B' },
  cbpBUnlockNode: { label: 'CBP Node B Unlock', desc: 'Unlock concurrent payments node B' },
  cbpCCreateNode: { label: 'CBP Node C Create', desc: 'Create RLN node C for concurrent payments flow' },
  cbpCInitNode: { label: 'CBP Node C Init', desc: 'Initialize concurrent payments node C' },
  cbpCUnlockNode: { label: 'CBP Node C Unlock', desc: 'Unlock concurrent payments node C' },
  cbpDCreateNode: { label: 'CBP Node D Create', desc: 'Create RLN node D for concurrent payments flow' },
  cbpDInitNode: { label: 'CBP Node D Init', desc: 'Initialize concurrent payments node D' },
  cbpDUnlockNode: { label: 'CBP Node D Unlock', desc: 'Unlock concurrent payments node D' },
  cbpAFund: { label: 'CBP Node A Fund', desc: 'Fund concurrent payments node A' },
  cbpACreateUtxos: { label: 'CBP Node A UTXOs', desc: 'Create UTXOs for concurrent payments node A' },
  cbpBFund: { label: 'CBP Node B Fund', desc: 'Fund concurrent payments node B' },
  cbpBCreateUtxos: { label: 'CBP Node B UTXOs', desc: 'Create UTXOs for concurrent payments node B' },
  cbpCFund: { label: 'CBP Node C Fund', desc: 'Fund concurrent payments node C' },
  cbpCCreateUtxos: { label: 'CBP Node C UTXOs', desc: 'Create UTXOs for concurrent payments node C' },
  cbpDFund: { label: 'CBP Node D Fund', desc: 'Fund concurrent payments node D' },
  cbpDCreateUtxos: { label: 'CBP Node D UTXOs', desc: 'Create UTXOs for concurrent payments node D' },
  cbpNodeInfos: { label: 'CBP Node Infos', desc: 'Fetch pubkeys for nodes A and B' },
  cbpConnectPeers: { label: 'CBP Connect Peers', desc: 'Connect B→A, C→B, D→B peers' },
  cbpOpenChannelBtoA: { label: 'CBP Open Channel B→A', desc: 'B opens channel to A (routing channel)' },
  cbpOpenChannelCtoB: { label: 'CBP Open Channel C→B', desc: 'C opens channel to B' },
  cbpOpenChannelDtoB: { label: 'CBP Open Channel D→B', desc: 'D opens channel to B' },
  cbpCreateInvoices: { label: 'CBP Create Invoices', desc: 'A creates 2 invoices concurrently' },
  cbpConcurrentSend: { label: 'CBP Concurrent Send', desc: 'C and D send payments to A concurrently' },
  cbpWaitInvoice1: { label: 'CBP Wait Invoice 1', desc: 'Wait for invoice 1 SUCCEEDED on A' },
  cbpWaitInvoice2: { label: 'CBP Wait Invoice 2', desc: 'Wait for invoice 2 SUCCEEDED on A' },
  cbpWaitSenders: { label: 'CBP Wait Senders', desc: 'Wait for both C and D payments to succeed' },
  cbpFinalBalance: { label: 'CBP Final Balance', desc: 'Read final BTC balance on node A' },
  swapNodeACreateNode: { label: 'Swap Node A Create', desc: 'Create maker node A' },
  swapNodeAInitNode: { label: 'Swap Node A Init', desc: 'Initialize maker node A' },
  swapNodeAUnlockNode: { label: 'Swap Node A Unlock', desc: 'Unlock maker node A' },
  swapNodeBCreateNode: { label: 'Swap Node B Create', desc: 'Create taker node B' },
  swapNodeBInitNode: { label: 'Swap Node B Init', desc: 'Initialize taker node B' },
  swapNodeBUnlockNode: { label: 'Swap Node B Unlock', desc: 'Unlock taker node B' },
  swapNodeAFund: { label: 'Swap Node A Fund', desc: 'Fund node A with BTC' },
  swapNodeBFund: { label: 'Swap Node B Fund', desc: 'Fund node B with BTC' },
  swapNodeACreateUtxos: { label: 'Swap Node A UTXOs', desc: 'Create UTXOs for node A' },
  swapNodeBCreateUtxos: { label: 'Swap Node B UTXOs', desc: 'Create UTXOs for node B' },
  swapIssueAsset: { label: 'Swap Issue Asset', desc: 'Issue test asset for swap' },
  swapOpenChannels: { label: 'Swap Open Channels', desc: 'Open asset and BTC channels between nodes' },
  swapExecuteRoundtrip: { label: 'Swap Execute', desc: 'Run makerinit -> taker -> makerexecute sequence' },
  swapPostChecks: { label: 'Swap Post Checks', desc: 'Validate swap and balances after execution' },
  swapCloseChannels: { label: 'Swap Close Channels', desc: 'Close swap test channels' },
  // ── External signer issue asset flow steps ────────────────────────────────
  extIssueCreateNode: { label: 'Create Node', desc: 'Create RLN node with external signer' },
  extIssueCreateExternalSigner: { label: 'Create External Signer', desc: 'Create native external signer from BIP39 seed' },
  extIssueInitNode: { label: 'Init Node', desc: 'Initialize node using native external signer' },
  extIssueUnlockNode: { label: 'Unlock Node', desc: 'Unlock node using native external signer' },
  extIssueNodeInfoAfter: { label: 'Node Info (after unlock)', desc: 'Read node info after unlock' },
  extIssueFund: { label: 'Fund Node', desc: 'Fund node with BTC and mine confirmation blocks' },
  extIssueCreateUtxos: { label: 'Create UTXOs', desc: 'Create UTXOs for RGB asset operations' },
  extIssueAsset: { label: 'Issue Asset', desc: 'Issue NIA asset using external signer node' },
  // ── External signer channel payment flow steps ────────────────────────────
  extChanACreateNode: { label: 'Node A Create', desc: 'Create nodeA with external signer' },
  extChanACreateExternalSigner: { label: 'Node A Create Signer', desc: 'Create native external signer for nodeA' },
  extChanAInitNode: { label: 'Node A Init', desc: 'Init nodeA with external signer' },
  extChanAUnlockNode: { label: 'Node A Unlock', desc: 'Unlock nodeA with external signer' },
  extChanBCreateNode: { label: 'Node B Create', desc: 'Create nodeB with password auth' },
  extChanBInitNode: { label: 'Node B Init', desc: 'Init nodeB with password' },
  extChanBUnlockNode: { label: 'Node B Unlock', desc: 'Unlock nodeB with password' },
  extChanAFund: { label: 'Node A Fund', desc: 'Fund nodeA' },
  extChanACreateUtxos: { label: 'Node A UTXOs', desc: 'Create UTXOs for nodeA' },
  extChanBFund: { label: 'Node B Fund', desc: 'Fund nodeB' },
  extChanBCreateUtxos: { label: 'Node B UTXOs', desc: 'Create UTXOs for nodeB' },
  extChanNodeInfos: { label: 'Node Infos', desc: 'Fetch pubkeys for both nodes' },
  extChanConnectPeers: { label: 'Connect Peers', desc: 'NodeA connects to nodeB' },
  extChanOpenChannel: { label: 'Open BTC Channel', desc: 'Open 500k sat BTC channel nodeA→nodeB' },
  extChanPayment1: { label: 'Payment 1', desc: 'NodeB invoice, nodeA pays (3M msat)' },
  extChanRestartNodeA: { label: 'Restart NodeA', desc: 'Shutdown and restart nodeA with same external signer' },
  extChanPayment2: { label: 'Payment 2', desc: 'Second payment after nodeA restart' },
};

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FlowsScreen() {
  const RLN_ONLY_MODE = true;
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
  const [rlnPaymentResults, setRlnPaymentResults] = useState<FlowResults>(null);
  const [runningRlnPaymentFlow, setRunningRlnPaymentFlow] = useState(false);
  const rlnPaymentInFlightRef = useRef(false);
  const [rlnExternalSignerPayResults, setRlnExternalSignerPayResults] = useState<FlowResults>(null);
  const [runningRlnExternalSignerPayFlow, setRunningRlnExternalSignerPayFlow] = useState(false);
  const rlnExternalSignerPayInFlightRef = useRef(false);
  const [rlnSwapRoundtripResults, setRlnSwapRoundtripResults] = useState<FlowResults>(null);
  const [runningRlnSwapRoundtripFlow, setRunningRlnSwapRoundtripFlow] = useState(false);
  const rlnSwapRoundtripInFlightRef = useRef(false);
  const [rlnExternalSignerResults, setRlnExternalSignerResults] = useState<FlowResults>(null);
  const [runningRlnExternalSignerFlow, setRunningRlnExternalSignerFlow] = useState(false);
  const rlnExternalSignerInFlightRef = useRef(false);
  const [rlnExtIssueAssetResults, setRlnExtIssueAssetResults] = useState<FlowResults>(null);
  const [runningRlnExtIssueAssetFlow, setRunningRlnExtIssueAssetFlow] = useState(false);
  const rlnExtIssueAssetInFlightRef = useRef(false);
  const [rlnExtChanPayResults, setRlnExtChanPayResults] = useState<FlowResults>(null);
  const [runningRlnExtChanPayFlow, setRunningRlnExtChanPayFlow] = useState(false);
  const rlnExtChanPayInFlightRef = useRef(false);
  const effectiveRpcHost =
    process.env.EXPO_PUBLIC_RLN_BITCOIND_RPC_HOST ??
    (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
  const effectiveUnlockRequestFromConfig = {
    password: process.env.EXPO_PUBLIC_RLN_NODE_PASSWORD ?? 'password',
    bitcoindRpcUsername: process.env.EXPO_PUBLIC_RLN_BITCOIND_RPC_USERNAME ?? 'user',
    bitcoindRpcPassword: process.env.EXPO_PUBLIC_RLN_BITCOIND_RPC_PASSWORD ?? 'password',
    bitcoindRpcHost: effectiveRpcHost,
    bitcoindRpcPort: Number(process.env.EXPO_PUBLIC_RLN_BITCOIND_RPC_PORT ?? '18443'),
    indexerUrl: process.env.EXPO_PUBLIC_RLN_INDEXER_URL ?? `${effectiveRpcHost}:50001`,
    proxyEndpoint:
      process.env.EXPO_PUBLIC_RLN_PROXY_ENDPOINT ?? `rpc://${effectiveRpcHost}:3000/json-rpc`,
  };
  const rlnUnlockStep = [...(rlnPaymentResults?.steps ?? [])]
    .reverse()
    .find((step: any) => String(step?.step ?? '').endsWith('UnlockNode'));
  const rlnUnlockRequest =
    rlnUnlockStep?.data?.request ??
    rlnUnlockStep?.result?.request ??
    effectiveUnlockRequestFromConfig;
  const rlnEffectiveUnlockConfig = [
    ['password', rlnUnlockRequest?.password ?? '(unset)'],
    ['bitcoindRpcUsername', rlnUnlockRequest?.bitcoindRpcUsername ?? '(unset)'],
    ['bitcoindRpcPassword', rlnUnlockRequest?.bitcoindRpcPassword ?? '(unset)'],
    ['bitcoindRpcHost', rlnUnlockRequest?.bitcoindRpcHost ?? '(unset)'],
    ['bitcoindRpcPort', String(rlnUnlockRequest?.bitcoindRpcPort ?? '(unset)')],
    ['indexerUrl', rlnUnlockRequest?.indexerUrl ?? '(unset)'],
    ['proxyEndpoint', rlnUnlockRequest?.proxyEndpoint ?? '(unset)'],
  ] as const;

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

    // runSdkTests();
  }, []);

  // ── Flow handlers ─────────────────────────────────────────────────────────

  async function handleUtexoVssFlow() {
    if (RLN_ONLY_MODE) {
      return;
    }
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
    if (RLN_ONLY_MODE) {
      return;
    }
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
    if (RLN_ONLY_MODE) {
      return;
    }
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
    if (RLN_ONLY_MODE) {
      return;
    }
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

  async function handleRlnPaymentFlow() {
    if (rlnPaymentInFlightRef.current) {
      return;
    }
    rlnPaymentInFlightRef.current = true;
    try {
      setRunningRlnPaymentFlow(true);
      setRlnPaymentResults({ running: true, steps: [] });
      const r = await runRlnPaymentFlow();
      setRlnPaymentResults({ ...r, running: false });
    } catch (e: any) {
      setRlnPaymentResults({
        running: false,
        success: false,
        error: e instanceof Error ? e.message : String(e),
        steps: [],
      });
    } finally {
      setRunningRlnPaymentFlow(false);
      rlnPaymentInFlightRef.current = false;
    }
  }

  async function handleRlnExternalSignerPaymentFlow() {
    if (rlnExternalSignerPayInFlightRef.current) return;
    rlnExternalSignerPayInFlightRef.current = true;
    try {
      setRunningRlnExternalSignerPayFlow(true);
      setRlnExternalSignerPayResults({ running: true, steps: [] });
      const r = await runRlnExternalSignerPaymentFlow();
      setRlnExternalSignerPayResults({ ...r, running: false });
    } catch (e: any) {
      setRlnExternalSignerPayResults({
        running: false,
        success: false,
        error: e instanceof Error ? e.message : String(e),
        steps: [],
      });
    } finally {
      setRunningRlnExternalSignerPayFlow(false);
      rlnExternalSignerPayInFlightRef.current = false;
    }
  }

  async function handleRlnSwapRoundtripFlow() {
    if (rlnSwapRoundtripInFlightRef.current) {
      return;
    }
    rlnSwapRoundtripInFlightRef.current = true;
    try {
      setRunningRlnSwapRoundtripFlow(true);
      setRlnSwapRoundtripResults({ running: true, steps: [] });
      const r = await runRlnSwapRoundtripBuyFlow();
      setRlnSwapRoundtripResults({ ...r, running: false });
    } catch (e: any) {
      setRlnSwapRoundtripResults({
        running: false,
        success: false,
        error: e instanceof Error ? e.message : String(e),
        steps: [],
      });
    } finally {
      setRunningRlnSwapRoundtripFlow(false);
      rlnSwapRoundtripInFlightRef.current = false;
    }
  }

  async function handleRlnExternalSignerFlow() {
    if (rlnExternalSignerInFlightRef.current) {
      return;
    }
    rlnExternalSignerInFlightRef.current = true;
    try {
      setRunningRlnExternalSignerFlow(true);
      setRlnExternalSignerResults({ running: true, steps: [] });
      const r = await runRlnExternalSignerFlow();
      setRlnExternalSignerResults({ ...r, running: false });
    } catch (e: any) {
      setRlnExternalSignerResults({
        running: false,
        success: false,
        error: e instanceof Error ? e.message : String(e),
        steps: [],
      });
    } finally {
      setRunningRlnExternalSignerFlow(false);
      rlnExternalSignerInFlightRef.current = false;
    }
  }

  async function handleRlnExtIssueAssetFlow() {
    if (rlnExtIssueAssetInFlightRef.current) return;
    rlnExtIssueAssetInFlightRef.current = true;
    try {
      setRunningRlnExtIssueAssetFlow(true);
      setRlnExtIssueAssetResults({ running: true, steps: [] });
      const r = await runRlnExternalSignerIssueAssetFlow();
      setRlnExtIssueAssetResults({ ...r, running: false });
    } catch (e: any) {
      setRlnExtIssueAssetResults({
        running: false,
        success: false,
        error: e instanceof Error ? e.message : String(e),
        steps: [],
      });
    } finally {
      setRunningRlnExtIssueAssetFlow(false);
      rlnExtIssueAssetInFlightRef.current = false;
    }
  }

  async function handleRlnExtChanPayFlow() {
    if (rlnExtChanPayInFlightRef.current) return;
    rlnExtChanPayInFlightRef.current = true;
    try {
      setRunningRlnExtChanPayFlow(true);
      setRlnExtChanPayResults({ running: true, steps: [] });
      const r = await runRlnExternalSignerChannelPaymentFlow();
      setRlnExtChanPayResults({ ...r, running: false });
    } catch (e: any) {
      setRlnExtChanPayResults({
        running: false,
        success: false,
        error: e instanceof Error ? e.message : String(e),
        steps: [],
      });
    } finally {
      setRunningRlnExtChanPayFlow(false);
      rlnExtChanPayInFlightRef.current = false;
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
          {RLN_ONLY_MODE && (
            <View style={styles.rlnOnlyBanner}>
              <Text style={styles.rlnOnlyBannerText}>
                RLN-only mode is enabled. Other demo flows are disabled to avoid node-state conflicts.
              </Text>
            </View>
          )}
          <View style={styles.networkRow}>
            <View style={styles.networkBadge}>
              <View style={styles.networkDot} />
              <Text style={styles.networkText}>
                {Platform.OS === 'android' ? 'Android · 10.0.2.2:8000' : 'iOS · 127.0.0.1:8000'}
              </Text>
            </View>
          </View>
          <View style={styles.envCard}>
            <Text style={styles.envTitle}>Effective RLN unlock payload sent to SDK</Text>
            <Text style={styles.envSubtitle}>
              {rlnUnlockStep
                ? 'Captured from the latest `rlnUnlockNode` step.'
                : 'Pre-run payload derived from current runtime config (same defaults used by flow).'}
            </Text>
            {rlnEffectiveUnlockConfig.map(([key, value]) => (
              <View key={key} style={styles.envRow}>
                <Text style={styles.envKey}>{key}</Text>
                <Text style={styles.envValue}>{value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* SDK Tests */}
        <TestSummaryCard results={testResults} loading={testLoading} />

        {!RLN_ONLY_MODE && (
          <>
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
                    deferErrorDisplay={runningTestnetWalletFlow}
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
                    deferErrorDisplay={runningReuseAddressFlow}
                  />
                );
              })}
            </FlowCard>
          </>
        )}

        <FlowCard
          title="RLN Payment Flow"
          subtitle="PaymentTest parity"
          description="3-node regtest flow: fund/UTXO setup, B→A channel, 4 sequential BTC payments."
          accentColor="#1D4ED8"
          totalSteps={33}
          results={rlnPaymentResults}
          running={runningRlnPaymentFlow}
          onRun={handleRlnPaymentFlow}>
          {rlnPaymentResults?.steps?.map((step: any, idx: number, arr: any[]) => {
            const meta = RLN_DEMO_STEP_META[step.step] ?? { label: step.step, desc: '' };
            return (
              <StepCard
                key={idx}
                idx={idx}
                step={step}
                label={meta.label}
                desc={meta.desc}
                accentColor="#1D4ED8"
                isLast={idx === arr.length - 1}
                deferErrorDisplay={runningRlnPaymentFlow}
              />
            );
          })}
        </FlowCard>

        <FlowCard
          title="RLN External Signer Payment Flow"
          subtitle="PaymentTest parity with external signer"
          description="Same as Payment Flow but all nodes use a native external signer (BIP39 seed) instead of password+mnemonic for init and unlock."
          accentColor="#2563EB"
          totalSteps={33}
          results={rlnExternalSignerPayResults}
          running={runningRlnExternalSignerPayFlow}
          onRun={handleRlnExternalSignerPaymentFlow}>
          {rlnExternalSignerPayResults?.steps?.map((step: any, idx: number, arr: any[]) => {
            const meta = RLN_DEMO_STEP_META[step.step] ?? { label: step.step, desc: '' };
            return (
              <StepCard
                key={idx}
                idx={idx}
                step={step}
                label={meta.label}
                desc={meta.desc}
                accentColor="#2563EB"
                isLast={idx === arr.length - 1}
                deferErrorDisplay={runningRlnExternalSignerPayFlow}
              />
            );
          })}
        </FlowCard>

        <FlowCard
          title="RLN Swap Roundtrip Buy Flow"
          subtitle="SwapRoundtripBuyTest parity"
          description="Dual-node swap flow using maker/taker lifecycle, channel setup, and succeeded-status validation."
          accentColor="#1E3A8A"
          totalSteps={15}
          results={rlnSwapRoundtripResults}
          running={runningRlnSwapRoundtripFlow}
          onRun={handleRlnSwapRoundtripFlow}>
          {rlnSwapRoundtripResults?.steps?.map((step: any, idx: number, arr: any[]) => {
            const meta = RLN_DEMO_STEP_META[step.step] ?? { label: step.step, desc: '' };
            return (
              <StepCard
                key={idx}
                idx={idx}
                step={step}
                label={meta.label}
                desc={meta.desc}
                accentColor="#1E3A8A"
                isLast={idx === arr.length - 1}
                deferErrorDisplay={runningRlnSwapRoundtripFlow}
              />
            );
          })}
        </FlowCard>

        <FlowCard
          title="RLN External Signer Flow"
          subtitle="NativeExternalSigner lifecycle"
          description="Same baseline as Payment Flow but uses a native external signer (BIP39 seed) instead of a password for init and unlock."
          accentColor="#1D4ED8"
          totalSteps={11}
          results={rlnExternalSignerResults}
          running={runningRlnExternalSignerFlow}
          onRun={handleRlnExternalSignerFlow}>
          {rlnExternalSignerResults?.steps?.map((step: any, idx: number, arr: any[]) => {
            const meta = RLN_DEMO_STEP_META[step.step] ?? { label: step.step, desc: '' };
            return (
              <StepCard
                key={idx}
                idx={idx}
                step={step}
                label={meta.label}
                desc={meta.desc}
                accentColor="#1D4ED8"
                isLast={idx === arr.length - 1}
                deferErrorDisplay={runningRlnExternalSignerFlow}
              />
            );
          })}
        </FlowCard>

        <FlowCard
          title="RLN External Signer: Issue Asset"
          subtitle="Usage example — create node, fund, issue"
          description="Minimal example: create one node with a native external signer, fund it, create UTXOs, then issue an NIA asset."
          accentColor="#1D4ED8"
          totalSteps={8}
          results={rlnExtIssueAssetResults}
          running={runningRlnExtIssueAssetFlow}
          onRun={handleRlnExtIssueAssetFlow}>
          {rlnExtIssueAssetResults?.steps?.map((step: any, idx: number, arr: any[]) => {
            const meta = RLN_DEMO_STEP_META[step.step] ?? { label: step.step, desc: '' };
            return (
              <StepCard
                key={idx}
                idx={idx}
                step={step}
                label={meta.label}
                desc={meta.desc}
                accentColor="#1D4ED8"
                isLast={idx === arr.length - 1}
                deferErrorDisplay={runningRlnExtIssueAssetFlow}
              />
            );
          })}
        </FlowCard>

        <FlowCard
          title="RLN External Signer: Channel + Payment"
          subtitle="nodeA (ext signer) + nodeB (password) — BTC channel + 2 payments + restart"
          description="Opens a 500k sat BTC channel from nodeA (native external signer) to nodeB (password). Sends two payments; restarts nodeA between them to verify signer persistence."
          accentColor="#1E40AF"
          totalSteps={17}
          results={rlnExtChanPayResults}
          running={runningRlnExtChanPayFlow}
          onRun={handleRlnExtChanPayFlow}>
          {rlnExtChanPayResults?.steps?.map((step: any, idx: number, arr: any[]) => {
            const meta = RLN_DEMO_STEP_META[step.step] ?? { label: step.step, desc: '' };
            return (
              <StepCard
                key={idx}
                idx={idx}
                step={step}
                label={meta.label}
                desc={meta.desc}
                accentColor="#1E40AF"
                isLast={idx === arr.length - 1}
                deferErrorDisplay={runningRlnExtChanPayFlow}
              />
            );
          })}
        </FlowCard>

        {!RLN_ONLY_MODE && (
          <>
            {/* ── UTEXO VSS E2E Flow ────────────────────────────────────────── */}
            <FlowCard
              title="UTEXO VSS E2E"
              subtitle="Create → Backup → Restore"
              description="Full lifecycle: create wallet → fund → issue NIA → VSS backup → destroy → restore → verify."
              accentColor="#0891B2"
              totalSteps={16}
              results={utexoVssFlowResults}
              running={runningUtexoVssFlow}
              onRun={handleUtexoVssFlow}>
              {utexoVssFlowResults?.steps?.map((step: any, idx: number, arr: any[]) => {
                const meta = UTEXO_VSS_STEP_META[step.step] ?? { label: step.step, desc: '' };
                return (
                  <StepCard key={idx} idx={idx} step={step} label={meta.label} desc={meta.desc} accentColor="#0891B2" isLast={idx === arr.length - 1} deferErrorDisplay={runningUtexoVssFlow} />
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
                  <StepCard key={idx} idx={idx} step={step} label={meta.label} desc={meta.desc} accentColor="#7C3AED" isLast={idx === arr.length - 1} deferErrorDisplay={runningVssFlow} />
                );
              })}
            </FlowCard>
          </>
        )}

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
  rlnOnlyBanner: {
    marginTop: 4,
    backgroundColor: '#1E3A8A1F',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3B82F680',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rlnOnlyBannerText: {
    fontSize: 12,
    color: '#BFDBFE',
    lineHeight: 16,
    fontWeight: '600',
  },
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
  envCard: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.bgCard,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  envTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: AppColors.textSecondary,
  },
  envSubtitle: {
    fontSize: 11,
    color: AppColors.textTertiary,
  },
  envRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  envKey: {
    flex: 1,
    fontSize: 11,
    color: AppColors.textTertiary,
    fontFamily: MONO,
  },
  envValue: {
    flex: 1,
    fontSize: 11,
    color: AppColors.textSecondary,
    textAlign: 'right',
    fontFamily: MONO,
  },

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
  flowErrorBox: {
    marginHorizontal: 14,
    marginTop: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppColors.errorBorder,
    backgroundColor: AppColors.errorBg,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  flowErrorTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: AppColors.error,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  flowErrorText: {
    fontSize: 11,
    lineHeight: 16,
    color: '#FCA5A5',
    fontFamily: MONO,
  },

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
