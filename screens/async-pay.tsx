/**
 * Async Payment tab — APay flow via useApayFlow (SDK helpers).
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

import {
  ASSET_ID,
  LSP_URL,
  PAYMENT_ASSET_AMOUNT,
  PAYMENT_MSAT,
  PHASES_P1,
  PHASES_P2,
  short,
  type Phase,
} from './apay/config';
import { useApayFlow } from './apay/useApayFlow';
import { apayStyles as s, InfoCard, LogPane, PhaseRow } from './apay/ui';

function phaseMessage(phase: Phase): string {
  switch (phase) {
    case 'b_init':    return 'Creating User B (recipient) node…';
    case 'b_fund':    return 'Funding User B…';
    case 'b_utxos':   return 'Creating User B UTXOs…';
    case 'b_channel': return 'Opening RGB channel LSP → User B…';
    case 'register':  return 'Registering hash pool (enableLightningAddress)…';
    case 'a_init':    return 'Creating User A (sender) node…';
    case 'a_fund':    return 'Funding User A…';
    case 'a_utxos':   return 'Creating User A UTXOs…';
    case 'a_channel': return 'Opening RGB channel LSP → User A…';
    case 'a_topup':   return 'User A deposit — receiving RGB via lightning_receive…';
    case 'send':      return 'User A paying via Lightning Address (payAddress)…';
    case 'settle':    return 'User B online — LSP outbox settlement…';
    default:          return 'Working…';
  }
}

export default function AsyncPayScreen({ embedded = false }: { embedded?: boolean }) {
  const flow = useApayFlow({
    variant: 'async',
    merchantKeepalive: false,
    settlementDiagnostics: false,
  });

  const hodlStatus = flow.merchantOnline
    ? (flow.sendStatus === 'Settled' ? 'Settled ✓' : flow.sendStatus || 'Settling…')
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
          <Text style={s.title}>Async Payment</Text>
          <Text style={s.subtitle}>Regtest · recipient offline → LSP holds HTLC → online settlement</Text>
          <View style={s.badge}>
            <View style={[s.dot, { backgroundColor: flow.envReady ? AppColors.success : AppColors.error }]} />
            <Text style={s.badgeTxt}>{flow.envReady ? 'LSP configured' : `Run ${flow.setupScriptHint}`}</Text>
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
            <Text style={s.cardTitle}>Async Payment (APay)</Text>
            <Text style={s.cardDesc}>
              {'APay (Async Payments) lets someone pay a Lightning Address even when\n' +
               'the recipient app is not actively listening. The LSP holds the HTLC\n' +
               'and completes delivery when the recipient comes back online.\n\n' +
               'Part 1 — Recipient (User B) registers with the LSP\n' +
               '   Opens an RGB channel to the LSP.\n' +
               '   Registers N payment hashes (enableLightningAddress →\n' +
               '   apayNewWithAddress) → LSP assigns a Lightning Address\n' +
               '   keyed to their pubkey.\n\n' +
               'Part 2 — Sender (User A) pays via LNURL\n' +
               '   Opens an RGB channel (needs spendable RGB).\n' +
               '   GET /.well-known/lnurlp/{username} → callback → HODL BOLT11.\n' +
               '   Pays the invoice. HTLC is held at the LSP — payment is NOT\n' +
               '   settled yet (User B is treated as "offline").\n\n' +
               'Part 3 — LSP outbox settlement (no manual claim on recipient)\n' +
               '   User B reconnects to the LSP peer.\n' +
               '   LSP outbox: request outbound invoice from B → pay B → B\n' +
               '   auto-claims → preimage released → LSP settles A\'s HTLC.\n' +
               '   Recipient does NOT call claimHodlInvoice in APay.\n\n' +
               `Prerequisite: ${flow.setupScriptHint}`}
            </Text>

            {!flow.envReady && (
              <View style={s.warnCard}>
                <Text style={s.warnTxt}>{`Run:\n\n  ${flow.setupScriptHint}`}</Text>
              </View>
            )}

            <View style={s.paramCard}>
              <Text style={s.paramTitle}>Config</Text>
              <Text style={s.paramLine}>LSP     {LSP_URL}</Text>
              <Text style={s.paramLine}>Asset   {ASSET_ID ? short(ASSET_ID, 28) : '(not set)'}</Text>
              <Text style={s.paramLine}>Pay     {PAYMENT_MSAT / 1000} sat + {PAYMENT_ASSET_AMOUNT} RGB</Text>
            </View>

            <TouchableOpacity
              style={[s.startBtn, !flow.envReady && { opacity: 0.4 }]}
              onPress={flow.run}
              disabled={!flow.envReady}
              activeOpacity={0.8}>
              <Text style={s.startBtnTxt}>▶  Run Async Payment Flow</Text>
            </TouchableOpacity>
          </View>
        )}

        {flow.isRunning && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>{phaseMessage(flow.phase)}</Text>
          </View>
        )}

        {flow.hashPoolInfo && (
          <InfoCard title="Hash Pool (enableLightningAddress)" accent={AppColors.primary} rows={[
            ['LN Address', flow.lnAddress || '(pending)'],
            ['Username',   flow.lnaddrUsername || '—'],
          ]} />
        )}

        {flow.channelB && (
          <InfoCard title="RGB Channel (LSP → User B)" accent={AppColors.success} rows={[
            ['Asset',    short(ASSET_ID, 28)],
            ['Capacity', `${flow.channelB.capacitySat ?? flow.channelB.capacity_sat ?? '?'} sat`],
            ['Status',   'Usable ✓'],
          ]} />
        )}
        {flow.channelA && (
          <InfoCard title="RGB Channel (LSP → User A)" accent={AppColors.success} rows={[
            ['Asset',    short(ASSET_ID, 28)],
            ['Capacity', `${flow.channelA.capacitySat ?? flow.channelA.capacity_sat ?? '?'} sat`],
            ['Status',   'Usable ✓'],
          ]} />
        )}

        {flow.hodlBolt11 && (
          <InfoCard title="HODL BOLT11 (LSP holding HTLC)" accent={AppColors.warning} rows={[
            ['Invoice',  short(flow.hodlBolt11, 32)],
            ['Amount',   `${PAYMENT_MSAT / 1000} sat`],
            ['Pmt Hash', short(flow.paymentHash, 28)],
            ['Status',   hodlStatus],
          ]} />
        )}

        {flow.finalBalB && (
          <InfoCard title="User B Final Balance" accent={AppColors.success} rows={[
            ['Offchain In',  String(flow.finalBalB.offchainInbound ?? 0)],
            ['Offchain Out', String(flow.finalBalB.offchainOutbound ?? 0)],
          ]} />
        )}

        {flow.phase === 'done' && (
          <View style={[s.card, { borderColor: AppColors.successBorder }]}>
            <Text style={[s.cardTitle, { color: AppColors.success }]}>✓ Async Payment Complete</Text>
            <Text style={s.cardDesc}>
              {'1. User B registered hash pool → LSP created Lightning Address\n' +
               '2. User A paid via LNURL-pay → LSP held HTLC while B was offline\n' +
               '3. User B came online → LSP outbox settled outbound to B\n' +
               '4. LSP claimed inbound HTLC from User A with the preimage\n\n' +
               'Full async payment lifecycle — RGB delivered without manual claim.'}
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
