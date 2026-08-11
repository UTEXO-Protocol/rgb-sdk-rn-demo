/**
 * APay · Signet (UTEXO) tab — Async Payment on the live signet stack.
 * Flow logic: ./useApayFlow.ts  |  Visual components: ../apay/ui
 */
import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors } from '@/constants/theme';

import { formatAssetAmount, PHASES_P1, PHASES_P2, short, type Phase } from '../apay/config';
import { apayStyles as s, InfoCard, LogPane, PhaseRow } from '../apay/ui';
import {
  ASSET_ID,
  ASSET_PRECISION,
  ASSET_TICKER,
  LSP_URL,
  PAYMENT_ASSET_AMOUNT,
  PAYMENT_MSAT,
} from './config';
import { useApayFlow } from './useApayFlow';

/** Base units → "0.5 USDT" — every amount in this flow is in base units. */
const fmtAsset = (units: number) =>
  `${formatAssetAmount(units, ASSET_PRECISION)} ${ASSET_TICKER}`;

function phaseMessage(phase: Phase): string {
  switch (phase) {
    case 'b_init':    return 'Creating merchant (recipient) node on signet…';
    case 'b_fund':    return 'Faucet funding merchant — waiting for confirmation…';
    case 'b_utxos':   return 'Creating merchant UTXOs — waiting for confirmation…';
    case 'b_channel': return 'Opening RGB channel LSP → merchant (~10 min)…';
    case 'register':  return 'Registering hash pool (enableLightningAddress)…';
    case 'a_init':    return 'Creating buyer (sender) node on signet…';
    case 'a_fund':    return 'Faucet funding buyer — waiting for confirmation…';
    case 'a_utxos':   return 'Creating buyer UTXOs — waiting for confirmation…';
    case 'a_channel': return 'Opening RGB channel LSP → buyer (~10 min)…';
    case 'a_topup':   return 'Buyer deposit — faucet sends RGB → LSP (lightning_receive)…';
    case 'send':      return 'Buyer paying via Lightning Address (payAddress)…';
    case 'settle':    return 'Merchant online — LSP outbox settlement…';
    default:          return 'Working…';
  }
}

export default function ApaySignetScreen({ embedded = false }: { embedded?: boolean }) {
  const flow = useApayFlow();

  const hodlStatus = flow.merchantOnline
    ? (flow.sendStatus === 'Succeeded' ? 'Settled ✓' : flow.sendStatus || 'Settling…')
    : flow.phase === 'send' || flow.phase === 'settle'
      ? flow.phase === 'settle' ? 'Merchant online — settling' : 'HTLC held — merchant offline'
      : 'Pending';

  const Root = embedded ? View : SafeAreaView;
  const rootProps = embedded
    ? { style: s.embedded }
    : { style: s.safe, edges: ['top', 'left', 'right'] as const };

  return (
    <Root {...rootProps}>
      <ScrollView
        style={embedded ? undefined : s.scroll}
        contentContainerStyle={s.content}
        scrollEnabled={!embedded}
        nestedScrollEnabled={embedded}>

        <View style={s.header}>
          <Text style={s.title}>Async Payment · Signet</Text>
          <Text style={s.subtitle}>UTEXO signet · recipient offline → LSP holds HTLC → online settlement</Text>
          <View style={s.badge}>
            <View style={[s.dot, { backgroundColor: flow.envReady ? AppColors.success : AppColors.error }]} />
            <Text style={s.badgeTxt}>
              {flow.envReady ? `${ASSET_TICKER} · precision ${ASSET_PRECISION}` : 'Asset not configured'}
            </Text>
          </View>
        </View>

        {flow.phase !== 'idle' && (
          <>
            <PhaseRow phases={PHASES_P1} phase={flow.phase} />
            <PhaseRow phases={PHASES_P2} phase={flow.phase} />
          </>
        )}

        {flow.phase === 'idle' && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Async Payment (APay) — Signet</Text>
            <Text style={s.cardDesc}>
              {'Same APay flow as regtest, but against the live signet stack —\n' +
               'virtual channels and no manual mining (waits for confirmations).\n\n' +
               'Part 1 — Recipient (merchant)\n' +
               '   Faucet funds BTC → createUtxos → LSP opens an RGB channel.\n' +
               '   enableLightningAddress registers a hash pool → Lightning Address.\n\n' +
               'Part 2 — Sender (buyer)\n' +
               '   Faucet funds BTC → LSP opens an RGB channel.\n' +
               '   Buyer tops up RGB via lightning_receive (faucet is the external\n' +
               '   on-chain RGB sender), then pays the merchant Lightning Address.\n' +
               '   HTLC is held at the LSP (recipient treated as offline).\n\n' +
               'Part 3 — LSP outbox settlement\n' +
               '   Merchant reconnects → LSP outbox pays the merchant → merchant\n' +
               '   auto-claims → LSP settles the buyer HTLC. No claimHodlInvoice.'}
            </Text>

            <View style={s.paramCard}>
              <Text style={s.paramTitle}>Config</Text>
              <Text style={s.paramLine}>LSP     {LSP_URL}</Text>
              <Text style={s.paramLine}>Asset   {ASSET_ID ? short(ASSET_ID, 28) : '(not set)'}</Text>
              <Text style={s.paramLine}>Ticker  {ASSET_TICKER} (IFA, precision {ASSET_PRECISION})</Text>
              <Text style={s.paramLine}>
                Pay     {PAYMENT_MSAT / 1000} sat + {fmtAsset(PAYMENT_ASSET_AMOUNT)} ({PAYMENT_ASSET_AMOUNT} base units)
              </Text>
            </View>

            <TouchableOpacity
              style={[s.startBtn, !flow.envReady && { opacity: 0.4 }]}
              onPress={flow.run}
              disabled={!flow.envReady}
              activeOpacity={0.8}>
              <Text style={s.startBtnTxt}>▶  Run on Signet</Text>
            </TouchableOpacity>
          </View>
        )}

        {flow.isRunning && !flow.awaitingContinue && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>{phaseMessage(flow.phase)}</Text>
            <Text style={[s.spinnerTxt, { fontSize: 11, marginTop: 4 }]}>
              Signet — confirmations can take several minutes
            </Text>
          </View>
        )}

        {flow.awaitingContinue && (
          <View style={s.spinnerCard}>
            <Text style={s.spinnerTxt}>⏸  Paused — Lightning Address ready</Text>
            <Text style={[s.spinnerTxt, { fontSize: 11, marginTop: 4 }]}>
              Inspect the address below, then continue to create the buyer and pay
            </Text>
            <TouchableOpacity
              style={[s.startBtn, { marginTop: 14 }]}
              onPress={flow.continueFlow}
              activeOpacity={0.8}>
              <Text style={s.startBtnTxt}>▶  Continue</Text>
            </TouchableOpacity>
          </View>
        )}

        {flow.hashPoolInfo && (
          <InfoCard title="Lightning Address (enableLightningAddress)" accent={AppColors.primary} rows={[
            ['LN Address', flow.lnAddress || '(pending)'],
            ['Username',   flow.lnaddrUsername || '—'],
          ]} />
        )}

        {flow.channelB && (
          <InfoCard title="RGB Channel (LSP → Merchant)" accent={AppColors.success} rows={[
            ['Asset',    short(ASSET_ID, 28)],
            ['Capacity', `${flow.channelB.capacitySat ?? flow.channelB.capacity_sat ?? '?'} sat`],
            ['Status',   'Usable ✓'],
          ]} />
        )}
        {flow.channelA && (
          <InfoCard title="RGB Channel (LSP → Buyer)" accent={AppColors.success} rows={[
            ['Asset',    short(ASSET_ID, 28)],
            ['Capacity', `${flow.channelA.capacitySat ?? flow.channelA.capacity_sat ?? '?'} sat`],
            ['Status',   'Usable ✓'],
          ]} />
        )}

        {flow.hodlBolt11 && (
          <InfoCard title="HODL BOLT11 (LSP holding HTLC)" accent={AppColors.warning} rows={[
            ['Invoice',  short(flow.hodlBolt11, 32)],
            ['Amount',   `${PAYMENT_MSAT / 1000} sat + ${fmtAsset(PAYMENT_ASSET_AMOUNT)}`],
            ['Pmt Hash', short(flow.paymentHash, 28)],
            ['Status',   hodlStatus],
          ]} />
        )}

        {flow.finalBalB && (
          <InfoCard title="Merchant Final Balance" accent={AppColors.success} rows={[
            ['Offchain In',  fmtAsset(Number(flow.finalBalB.offchainInbound ?? 0))],
            ['Offchain Out', fmtAsset(Number(flow.finalBalB.offchainOutbound ?? 0))],
          ]} />
        )}

        {flow.phase === 'done' && (
          <View style={[s.card, { borderColor: AppColors.successBorder }]}>
            <Text style={[s.cardTitle, { color: AppColors.success }]}>✓ Async Payment Complete</Text>
            <Text style={s.cardDesc}>
              {'1. Merchant registered hash pool → LSP created Lightning Address\n' +
               '2. Buyer paid via LNURL-pay → LSP held HTLC while merchant offline\n' +
               '3. Merchant came online → LSP outbox settled outbound\n' +
               '4. LSP claimed inbound HTLC with the preimage\n\n' +
               'Full async payment lifecycle on signet — no manual claim.'}
            </Text>
          </View>
        )}

        {flow.phase === 'error' && (
          <View style={[s.card, { borderColor: AppColors.errorBorder, backgroundColor: AppColors.errorBg }]}>
            <Text style={[s.cardTitle, { color: AppColors.error }]}>Flow failed</Text>
            <Text style={[s.cardDesc, { color: '#FCA5A5' }]}>{flow.errorMsg}</Text>
          </View>
        )}

        {(flow.phase === 'done' || flow.phase === 'error') && (
          <TouchableOpacity style={s.resetBtn} onPress={flow.reset} activeOpacity={0.8}>
            <Text style={s.resetBtnTxt}>↺  Reset</Text>
          </TouchableOpacity>
        )}
        {flow.isRunning && (
          <TouchableOpacity style={s.cancelBtn} onPress={flow.reset} activeOpacity={0.8}>
            <Text style={s.cancelBtnTxt}>✕  Cancel</Text>
          </TouchableOpacity>
        )}

        {flow.log.length > 0 && <LogPane entries={flow.log} />}
      </ScrollView>
    </Root>
  );
}
