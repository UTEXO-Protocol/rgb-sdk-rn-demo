/**
 * APay Cart Checkout — virtual RGB channels + LSP auto-settlement.
 * Flow logic: screens/apay/useApayFlow.ts (SDK: lsp.connect, waitForChannel, enableLightningAddress, …)
 */
import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppColors } from '@/constants/theme';

import {
  ASSET_ID,
  CART_ITEM,
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
    case 'b_init':    return 'Creating merchant shop node…';
    case 'b_fund':    return 'Funding merchant wallet…';
    case 'b_utxos':   return 'Creating merchant UTXOs…';
    case 'b_channel': return 'Opening virtual RGB channel LSP → merchant…';
    case 'register':  return 'Registering shop (enableLightningAddress)…';
    case 'a_init':    return 'Creating buyer node…';
    case 'a_fund':    return 'Funding buyer wallet…';
    case 'a_utxos':   return 'Creating buyer UTXOs…';
    case 'a_channel': return 'Opening virtual RGB channel LSP → buyer…';
    case 'send':      return 'Buyer checkout — payAddress (LNURL + HODL pay)…';
    case 'settle':    return 'Waiting for LSP auto-settlement…';
    default:          return 'Working…';
  }
}

export default function ApayRegularChannelsScreen({ embedded = false }: { embedded?: boolean }) {
  const flow = useApayFlow({ variant: 'cart' });

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
          <Text style={s.title}>APay Cart Checkout</Text>
          <Text style={s.subtitle}>Regtest · RGB shop checkout via Async Payments (APay)</Text>
          <View style={s.badge}>
            <View style={[s.dot, { backgroundColor: flow.envReady ? AppColors.success : AppColors.error }]} />
            <Text style={s.badgeTxt}>{flow.envReady ? 'LSP configured' : `Run ${flow.setupScriptHint} first`}</Text>
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
            <Text style={s.cardTitle}>Cart Checkout Scenario</Text>
            <Text style={s.cardDesc}>
              {'Async Payments (APay) let a shop receive RGB Lightning while the LSP\n' +
               'coordinates delivery. The merchant never manually claims — the LSP\n' +
               'outbox drives settlement once both sides have LSP channels.\n\n' +
               '🏪 Merchant (Bob / User B)\n' +
               '   Opens a virtual RGB channel with the LSP.\n' +
               '   Registers a hash pool → gets a Lightning Address\n' +
               '   (e.g. brisk-river@lsp). Stays peer-connected to the LSP\n' +
               '   so the outbox can reach the shop node.\n\n' +
               '🛒 Customer (Alice / User A)\n' +
               `   Opens an LSP channel with RGB to spend (needs ≥${PAYMENT_ASSET_AMOUNT} unit).\n` +
               '   Checks out via LNURL-pay: discovers the shop address,\n' +
               '   gets a HODL BOLT11 from the LSP, pays it.\n\n' +
               '📦 LSP delivery (automatic — steps ⑤⑥ in APay spec)\n' +
               '   LSP holds the buyer HTLC, requests an outbound invoice\n' +
               '   from the merchant over P2P, pays the merchant, merchant\n' +
               '   auto-claims (async_payment_recipient). LSP then settles\n' +
               '   the buyer HTLC with the preimage. No claimHodlInvoice.\n\n' +
               `Prerequisite: ${flow.setupScriptHint} (virtual LSP stack).`}
            </Text>

            <View style={cart.cartCard}>
              <Text style={cart.cartTitle}>Your cart</Text>
              <View style={cart.cartRow}>
                <Text style={cart.cartItem}>{CART_ITEM}</Text>
                <Text style={cart.cartPrice}>{PAYMENT_ASSET_AMOUNT} UTST</Text>
              </View>
              <View style={cart.cartDivider} />
              <View style={cart.cartRow}>
                <Text style={cart.cartTotalLabel}>LN fee (msat)</Text>
                <Text style={cart.cartTotalVal}>{PAYMENT_MSAT.toLocaleString()}</Text>
              </View>
            </View>

            {!flow.envReady && (
              <View style={s.warnCard}>
                <Text style={s.warnTxt}>{`Run:\n\n  ${flow.setupScriptHint}`}</Text>
              </View>
            )}

            <View style={s.paramCard}>
              <Text style={s.paramTitle}>Config</Text>
              <Text style={s.paramLine}>LSP API     {LSP_URL}</Text>
              <Text style={s.paramLine}>Asset ID    {ASSET_ID ? short(ASSET_ID, 28) : '(not set)'}</Text>
              <Text style={s.paramLine}>Checkout    {PAYMENT_MSAT / 1000} sat + {PAYMENT_ASSET_AMOUNT} RGB</Text>
            </View>

            <TouchableOpacity
              style={[s.startBtn, !flow.envReady && { opacity: 0.4 }]}
              onPress={flow.run}
              disabled={!flow.envReady}
              activeOpacity={0.8}>
              <Text style={s.startBtnTxt}>▶  Run Cart Checkout Flow</Text>
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
          <InfoCard title="Shop (enableLightningAddress)" accent={AppColors.primary} rows={[
            ['LN Address', flow.lnAddress || '(pending)'],
            ['Username',   flow.lnaddrUsername || '—'],
            ['Domain',     flow.lnaddrDomain || '—'],
          ]} />
        )}

        {flow.channelB && (
          <InfoCard title="Channel · LSP → Merchant" accent={AppColors.success} rows={[
            ['Asset',    short(ASSET_ID, 28)],
            ['Capacity', `${flow.channelB.capacitySat ?? flow.channelB.capacity_sat ?? '?'} sat`],
          ]} />
        )}
        {flow.channelA && (
          <InfoCard title="Channel · LSP → Buyer" accent={AppColors.success} rows={[
            ['Asset',    short(ASSET_ID, 28)],
            ['Capacity', `${flow.channelA.capacitySat ?? flow.channelA.capacity_sat ?? '?'} sat`],
          ]} />
        )}

        {flow.hodlBolt11 && (
          <InfoCard title="Checkout Invoice (HODL)" accent={AppColors.warning} rows={[
            ['Item',    CART_ITEM],
            ['Invoice', short(flow.hodlBolt11, 32)],
            ['RGB',     String(PAYMENT_ASSET_AMOUNT)],
            ['Status',  flow.phase === 'send' ? 'Paying…' : flow.sendStatus || 'Held at LSP'],
          ]} />
        )}

        {flow.sendStatus && (
          <InfoCard title="Buyer Payment" accent={AppColors.primary} rows={[
            ['Hash',   short(flow.paymentHash, 28)],
            ['Status', flow.sendStatus],
          ]} />
        )}

        {flow.finalBalB && (
          <InfoCard title="Merchant Balance After Delivery" accent={AppColors.success} rows={[
            ['Offchain In',  String(flow.finalBalB.offchainInbound ?? 0)],
            ['Offchain Out', String(flow.finalBalB.offchainOutbound ?? 0)],
          ]} />
        )}

        {flow.phase === 'done' && (
          <View style={[s.card, { borderColor: AppColors.successBorder }]}>
            <Text style={[s.cardTitle, { color: AppColors.success }]}>✓ Cart Checkout Complete</Text>
            <Text style={s.cardDesc}>
              {'1. Merchant registered a Lightning Address (hash pool on LSP)\n' +
               '2. Buyer checked out via LNURL-pay and paid the HODL invoice\n' +
               '3. LSP outbox delivered RGB to merchant over Lightning\n' +
               '4. Buyer payment reached Settled — 1 RGB moved buyer → merchant\n\n' +
               'Virtual channels + LSP auto-settlement. Merchant never called claimHodlInvoice.'}
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

const cart = StyleSheet.create({
  cartCard:       { backgroundColor: AppColors.bgCardElevated, borderRadius: 10, padding: 14, marginVertical: 12, borderWidth: 1, borderColor: AppColors.border },
  cartTitle:      { fontSize: 12, fontWeight: '700', color: AppColors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },
  cartRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  cartItem:       { fontSize: 14, color: AppColors.textPrimary, flex: 1 },
  cartPrice:      { fontSize: 14, fontWeight: '600', color: AppColors.primary, fontFamily: AppColors.mono },
  cartDivider:    { height: 1, backgroundColor: AppColors.border, marginVertical: 8 },
  cartTotalLabel: { fontSize: 13, color: AppColors.textSecondary },
  cartTotalVal:   { fontSize: 13, color: AppColors.textAccent, fontFamily: AppColors.mono },
});
