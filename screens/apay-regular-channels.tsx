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
  formatAssetAmount,
  LSP_URL,
  PHASES_P1,
  PHASES_P2,
  short,
  UTST_ASSET,
  type ApayAsset,
  type Phase,
} from './apay/config';
import { useApayFlow, type UseApayFlowOptions } from './apay/useApayFlow';
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
    case 'a_topup':   return 'Buyer deposit — receiving RGB via lightning_receive…';
    case 'send':      return 'Buyer checkout — payAddress (LNURL + HODL pay)…';
    case 'settle':    return 'Waiting for LSP auto-settlement…';
    default:          return 'Working…';
  }
}

export type ApayCartScreenProps = {
  embedded?: boolean;
  /** Which demo asset to check out with. Defaults to UTST (NIA, precision 0). */
  asset?: ApayAsset;
  title?: string;
  subtitle?: string;
  /** Node storage prefix + port bases — must differ per screen so two cart flows can coexist. */
  flowOptions?: Pick<
    UseApayFlowOptions,
    'storagePrefix' | 'merchantPortBase' | 'buyerPortBase' | 'setupScriptHint'
  >;
};

export default function ApayRegularChannelsScreen({
  embedded = false,
  asset = UTST_ASSET,
  title = 'APay Cart Checkout',
  subtitle = 'Regtest · RGB shop checkout via Async Payments (APay)',
  flowOptions,
}: ApayCartScreenProps) {
  const flow = useApayFlow({ variant: 'cart', asset, ...flowOptions });

  const { assetId, cartItem, paymentAssetAmount, paymentMsat, precision, ticker } = asset;
  const price = `${formatAssetAmount(paymentAssetAmount, precision)} ${ticker}`;

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
          <Text style={s.title}>{title}</Text>
          <Text style={s.subtitle}>{subtitle}</Text>
          <View style={s.badge}>
            <View style={[s.dot, { backgroundColor: flow.envReady ? AppColors.success : AppColors.error }]} />
            <Text style={s.badgeTxt}>
              {flow.envReady
                ? `LSP serving ${ticker}`
                : assetId && !flow.assetActive
                  ? `LSP is serving "${flow.activeAssetKey}", not ${ticker}`
                  : `Run ${flow.startCommand} first`}
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
               `   Opens an LSP channel with RGB to spend (needs ≥${price}).\n` +
               '   Checks out via LNURL-pay: discovers the shop address,\n' +
               '   gets a HODL BOLT11 from the LSP, pays it.\n\n' +
               '📦 LSP delivery (automatic — steps ⑤⑥ in APay spec)\n' +
               '   LSP holds the buyer HTLC, requests an outbound invoice\n' +
               '   from the merchant over P2P, pays the merchant, merchant\n' +
               '   auto-claims (async_payment_recipient). LSP then settles\n' +
               '   the buyer HTLC with the preimage. No claimHodlInvoice.\n\n' +
               `Prerequisite: ${flow.startCommand} (virtual LSP stack).`}
            </Text>

            <View style={cart.cartCard}>
              <Text style={cart.cartTitle}>Your cart</Text>
              <View style={cart.cartRow}>
                <Text style={cart.cartItem}>{cartItem}</Text>
                <Text style={cart.cartPrice}>{price}</Text>
              </View>
              {precision > 0 && (
                <View style={cart.cartRow}>
                  <Text style={cart.cartTotalLabel}>Base units (precision {precision})</Text>
                  <Text style={cart.cartTotalVal}>{paymentAssetAmount.toLocaleString()}</Text>
                </View>
              )}
              <View style={cart.cartDivider} />
              <View style={cart.cartRow}>
                <Text style={cart.cartTotalLabel}>LN fee (msat)</Text>
                <Text style={cart.cartTotalVal}>{paymentMsat.toLocaleString()}</Text>
              </View>
            </View>

            {!flow.envReady && (
              <View style={s.warnCard}>
                <Text style={s.warnTxt}>
                  {assetId && !flow.assetActive
                    ? 'The LSP opens one virtual channel per peer, so it serves a\n' +
                      `single asset per run — right now that is "${flow.activeAssetKey}".\n\n` +
                      `Run:\n\n  ${flow.startCommand}`
                    : `Run:\n\n  ${flow.startCommand}`}
                </Text>
              </View>
            )}

            <View style={s.paramCard}>
              <Text style={s.paramTitle}>Config</Text>
              <Text style={s.paramLine}>LSP API     {LSP_URL}</Text>
              <Text style={s.paramLine}>Asset       {ticker} · precision {precision}</Text>
              <Text style={s.paramLine}>Asset ID    {assetId ? short(assetId, 28) : '(not set)'}</Text>
              <Text style={s.paramLine}>Checkout    {paymentMsat / 1000} sat + {price}</Text>
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
            ['Asset',    `${ticker} · ${short(assetId, 24)}`],
            ['Capacity', `${flow.channelB.capacitySat ?? flow.channelB.capacity_sat ?? '?'} sat`],
          ]} />
        )}
        {flow.channelA && (
          <InfoCard title="Channel · LSP → Buyer" accent={AppColors.success} rows={[
            ['Asset',    `${ticker} · ${short(assetId, 24)}`],
            ['Capacity', `${flow.channelA.capacitySat ?? flow.channelA.capacity_sat ?? '?'} sat`],
          ]} />
        )}

        {flow.hodlBolt11 && (
          <InfoCard title="Checkout Invoice (HODL)" accent={AppColors.warning} rows={[
            ['Item',    cartItem],
            ['Invoice', short(flow.hodlBolt11, 32)],
            ['RGB',     `${price}  (${paymentAssetAmount} base units)`],
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
               `4. Buyer payment reached Settled — ${price} moved buyer → merchant\n\n` +
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
