/**
 * APay Bridge Asset · Signet (UTEXO) — the same checkout as the regtest screen
 * (`screens/apay-linked-asset.tsx`), run against a utexo-lsp deployed from
 * `utexo-lsp/.env.signet`. Flow logic: ./useApayLinkedAssetSignetFlow.ts
 *
 * The buyer pays in the canonical on-chain asset (USDT) and the merchant is
 * delivered the LSP's own (LNUSDT). Two unrelated IFA contracts; utexo-lsp's
 * CONVERTIBLE_PAIRS is the entire authorization for the 1:1 rate. No virtual
 * channels anywhere — both legs are real, confirmed on-chain RGB channels, so
 * the whole run is paced by signet blocks (~30 s each).
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

import { formatAssetAmount, short } from '../apay/config';
import { apayStyles as s, InfoCard, LogPane } from '../apay/ui';
import {
  AMOUNTS,
  ASSET_PRECISION,
  BRIDGE_ASSET_ID,
  BRIDGE_TICKER,
  CART_ITEM,
  CHANNEL_PROVISION_GRACE_MS,
  FAUCET_NODE_URL,
  LSP_URL,
  PAYOUT_ASSET_ID,
  PAYOUT_TICKER,
} from './config';
import {
  LINKED_SIGNET_PHASE_LABELS,
  useApayLinkedAssetSignetFlow,
  type LinkedSignetPhase,
} from './useApayLinkedAssetSignetFlow';

function phaseMessage(phase: LinkedSignetPhase): string {
  switch (phase) {
    case 'preflight':       return 'Checking the LSP config and the faucet balances…';
    case 'b_init':          return 'Creating merchant shop node on signet…';
    case 'b_fund':          return 'Faucet funding merchant — waiting for confirmation…';
    case 'b_utxos':         return 'Creating merchant UTXOs — waiting for confirmation…';
    case 'b_channel':       return `Provisioning grace, then LSP opens the merchant a ${PAYOUT_TICKER} channel…`;
    case 'register':        return 'Registering shop (enableLightningAddress)…';
    case 'a_init':          return 'Creating buyer node on signet…';
    case 'a_fund':          return 'Faucet funding buyer — waiting for confirmation…';
    case 'a_utxos':         return 'Creating buyer UTXOs — waiting for confirmation…';
    case 'a_asset_receive': return `Buyer receiving ${BRIDGE_TICKER} on-chain from the Faucet…`;
    case 'a_channel':       return `Buyer self-opening a ${BRIDGE_TICKER} channel — waiting for confirmations…`;
    case 'send':            return 'Buyer checkout — SDK picks the asset, LSP quotes it…';
    case 'settle':          return 'Waiting for the outbound leg to the merchant…';
    case 'refund_register': return 'Registering buyer address (APay refund)…';
    case 'refund':          return 'Merchant refunding the buyer through APay…';
    case 'refund_settle':   return 'Waiting for the refund to reach the buyer…';
    case 'topup':           return `Faucet paying the merchant on-chain in ${BRIDGE_TICKER}…`;
    case 'c_init':          return 'Creating recipient node (C)…';
    case 'c_fund':          return 'Faucet funding recipient — waiting for confirmation…';
    case 'c_utxos':         return 'Creating recipient UTXOs — waiting for confirmation…';
    case 'c_channel':       return 'Provisioning grace, then LSP opens the recipient a channel…';
    case 'c_register':      return 'Registering recipient address (enableLightningAddress)…';
    case 'c_pay':           return 'Merchant paying the recipient through APay…';
    case 'c_settle':        return 'Waiting for the payment to reach the recipient…';
    case 'ls_quote':        return 'Merchant relaying a plain BOLT11 via /lightning_send…';
    case 'ls_settle':       return 'Waiting for the relay to settle on both legs…';
    default:                return 'Working…';
  }
}

export default function ApayLinkedAssetSignetScreen({ embedded = false }: { embedded?: boolean }) {
  // Who quotes the cart. Off: the buyer's SDK picks the asset via payAddress.
  // On: the merchant quotes with requestExternalInvoice and the buyer settles
  // the raw BOLT11 — what a node that only speaks /sendpayment would do.
  const [externalInvoice, setExternalInvoice] = React.useState(false);
  const flow = useApayLinkedAssetSignetFlow({ externalInvoice });

  const { paymentAssetAmount, paymentMsat, refundAssetAmount, refundMsat, recipientAssetAmount } = AMOUNTS;
  const price = `${formatAssetAmount(paymentAssetAmount, ASSET_PRECISION)} ${PAYOUT_TICKER}`;
  const refundPrice = `${formatAssetAmount(refundAssetAmount, ASSET_PRECISION)} ${BRIDGE_TICKER}`;
  const recipientPrice = `${formatAssetAmount(recipientAssetAmount, ASSET_PRECISION)} ${PAYOUT_TICKER}`;

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
          <Text style={s.title}>APay Bridge Asset · Signet</Text>
          <Text style={s.subtitle}>UTEXO signet · on-chain only · LSP converts a configured pair 1:1</Text>
          <View style={s.badge}>
            <View style={[s.dot, { backgroundColor: flow.envReady ? AppColors.success : AppColors.error }]} />
            <Text style={s.badgeTxt}>
              {flow.envReady
                ? `LSP pays out ${PAYOUT_TICKER}, accepts ${BRIDGE_TICKER}`
                : 'Asset ids or faucet URL not configured'}
            </Text>
          </View>
        </View>

        {flow.phase !== 'idle' && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Phase: {LINKED_SIGNET_PHASE_LABELS[flow.phase]}</Text>
          </View>
        )}

        {flow.phase === 'idle' && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Bridge-Asset Checkout — Signet</Text>
            <Text style={s.cardDesc}>
              {'Same six legs as the regtest flow, against the live signet stack.\n' +
               'No mining: every confirmation is waited out at ~30 s per block, so\n' +
               'a full run takes tens of minutes rather than a couple.\n\n' +
               '🏪 Merchant (B)\n' +
               `   LSP opens a real channel to B in the payout asset (${PAYOUT_TICKER}).\n` +
               `   Expect ${CHANNEL_PROVISION_GRACE_MS / 1000}s of silence first — that is\n` +
               '   CHANNEL_PROVISION_GRACE, not a stall.\n\n' +
               '🛒 Buyer (A)\n' +
               `   Receives ${BRIDGE_TICKER} on-chain from the Faucet, then opens its\n` +
               '   OWN channel funded with it — self-funded outbound capacity,\n' +
               '   not LSP-pushed liquidity. It touches the LSP only at that\n' +
               '   point, so the cron never provisions it.\n\n' +
               '🔁 Conversion (on the LSP\'s books)\n' +
               '   The SDK reads the payout asset from LNURL discovery, sees no\n' +
               `   ${PAYOUT_TICKER} liquidity, and asks to be quoted in ${BRIDGE_TICKER}. One\n` +
               '   payment hash makes the two legs atomic. The assets are\n' +
               '   unrelated contracts; CONVERTIBLE_PAIRS authorizes the rate.\n\n' +
               '↩️ Refund (same conversion, reversed)\n' +
               `   The merchant pays ${refundPrice} back, quoting ${PAYOUT_TICKER} — the only\n` +
               '   asset it holds.\n\n' +
               '⬇️ Top-up (on-chain in, Lightning out)\n' +
               `   The merchant calls receiveAsset naming only ${PAYOUT_TICKER}; the LSP\n` +
               `   hands back an RGB invoice in ${BRIDGE_TICKER}, and the Faucet pays it.\n\n` +
               '👤 Recipient (C)\n' +
               `   A third node served the ordinary way and paid ${recipientPrice}. Both\n` +
               `   legs ${PAYOUT_TICKER} — the control case for plain APay.\n\n` +
               '🔀 Relay (/lightning_send)\n' +
               `   The buyer signs a plain ${BRIDGE_TICKER} BOLT11 and the merchant pays it\n` +
               `   holding only ${PAYOUT_TICKER}.\n\n` +
               'Requires utexo-lsp deployed from .env.signet (CONVERTIBLE_ASSET_IDS,\n' +
               'CONVERTIBLE_PAIRS, PAYOUT_ASSET_PREFERENCE, LIGHTNING_SEND_ENABLED=1,\n' +
               'no virtual channels) and a faucet node holding ' + BRIDGE_TICKER + '.'}
            </Text>

            <View style={cart.cartCard}>
              <Text style={cart.cartTitle}>Your cart</Text>
              <View style={cart.cartRow}>
                <Text style={cart.cartItem}>{CART_ITEM}</Text>
                <Text style={cart.cartPrice}>{price}</Text>
              </View>
              <View style={cart.cartRow}>
                <Text style={cart.cartTotalLabel}>Base units (precision {ASSET_PRECISION})</Text>
                <Text style={cart.cartTotalVal}>{paymentAssetAmount.toLocaleString()}</Text>
              </View>
              <View style={cart.cartDivider} />
              <View style={cart.cartRow}>
                <Text style={cart.cartTotalLabel}>LN fee (msat)</Text>
                <Text style={cart.cartTotalVal}>{paymentMsat.toLocaleString()}</Text>
              </View>
            </View>

            {!flow.envReady && (
              <View style={s.warnCard}>
                <Text style={s.warnTxt}>
                  {'Set in .env.local:\n\n' +
                   '  EXPO_PUBLIC_FAUCET_NODE_URL\n' +
                   '  EXPO_PUBLIC_SIGNET_BRIDGE_PAYOUT_ASSET_ID\n' +
                   '  EXPO_PUBLIC_SIGNET_BRIDGE_ASSET_ID\n\n' +
                   'The asset ids default to the ones in utexo-lsp/.env.signet.'}
                </Text>
              </View>
            )}

            <View style={s.paramCard}>
              <Text style={s.paramTitle}>Config</Text>
              <Text style={s.paramLine}>LSP API        {LSP_URL}</Text>
              <Text style={s.paramLine}>Faucet node    {FAUCET_NODE_URL || '(not set)'}</Text>
              <Text style={s.paramLine}>Payout asset   {PAYOUT_TICKER} · {PAYOUT_ASSET_ID ? short(PAYOUT_ASSET_ID, 24) : '(not set)'}</Text>
              <Text style={s.paramLine}>Bridge asset   {BRIDGE_TICKER} · {BRIDGE_ASSET_ID ? short(BRIDGE_ASSET_ID, 24) : '(not set)'}</Text>
              <Text style={s.paramLine}>Checkout       {paymentMsat / 1000} sat + {price}</Text>
              <Text style={s.paramLine}>Refund         {refundMsat / 1000} sat + {refundPrice}</Text>
            </View>

            <TouchableOpacity
              style={[cart.toggle, externalInvoice && cart.toggleOn]}
              onPress={() => setExternalInvoice(v => !v)}
              activeOpacity={0.8}>
              <Text style={cart.toggleTxt}>
                {(externalInvoice ? '☑' : '☐') + '  External-payer invoice'}
              </Text>
              <Text style={cart.toggleHint}>
                {externalInvoice
                  ? `Merchant quotes with requestExternalInvoice (asset from LNURL discovery, ${BRIDGE_TICKER}); ` +
                    'the buyer just pays the BOLT11 — no LNURL, no LSP client, exactly what an external ' +
                    'node would do with POST /sendpayment.'
                  : 'Buyer pays with lspA.payAddress and the SDK selects the asset from discovery + local liquidity.'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.startBtn, !flow.envReady && { opacity: 0.4 }]}
              onPress={flow.run}
              disabled={!flow.envReady}
              activeOpacity={0.8}>
              <Text style={s.startBtnTxt}>▶  Run Bridge-Asset Checkout on Signet</Text>
            </TouchableOpacity>
          </View>
        )}

        {flow.isRunning && (
          <View style={s.spinnerCard}>
            <ActivityIndicator size="large" color={AppColors.primary} />
            <Text style={s.spinnerTxt}>{phaseMessage(flow.phase)}</Text>
            <Text style={[s.spinnerTxt, { fontSize: 11, marginTop: 4 }]}>
              Signet — channels need 3 confirmations at ~30 s per block
            </Text>
          </View>
        )}

        {flow.hashPoolInfo && (
          <InfoCard title="Shop (enableLightningAddress)" accent={AppColors.primary} rows={[
            ['LN Address', flow.lnAddress || '(pending)'],
          ]} />
        )}

        {flow.channelB && (
          <InfoCard title="Channel · LSP → Merchant (payout, on-chain)" accent={AppColors.success} rows={[
            ['Asset',    `${PAYOUT_TICKER} · ${short(PAYOUT_ASSET_ID, 24)}`],
            ['Capacity', `${flow.channelB.capacitySat ?? flow.channelB.capacity_sat ?? '?'} sat`],
          ]} />
        )}
        {flow.channelA && (
          <InfoCard title="Channel · Buyer → LSP (bridge, self-opened)" accent={AppColors.success} rows={[
            ['Asset',    `${BRIDGE_TICKER} · ${short(BRIDGE_ASSET_ID, 24)}`],
            ['Capacity', `${flow.channelA.capacitySat ?? flow.channelA.capacity_sat ?? '?'} sat`],
          ]} />
        )}

        {flow.sendStatus && (
          <InfoCard title={`Buyer Payment (${BRIDGE_TICKER} → ${PAYOUT_TICKER}, converted by the LSP)`} accent={AppColors.primary} rows={[
            ['Hash',   short(flow.paymentHash, 28)],
            ['Status', flow.sendStatus],
          ]} />
        )}

        {flow.finalBalB && (
          <InfoCard title={`Merchant ${PAYOUT_TICKER} Balance After Delivery`} accent={AppColors.success} rows={[
            ['Offchain In',  String(flow.finalBalB.offchainInbound ?? 0)],
            ['Offchain Out', String(flow.finalBalB.offchainOutbound ?? 0)],
          ]} />
        )}

        {flow.buyerAddress && (
          <InfoCard title="Buyer Address (APay refund)" accent={AppColors.primary} rows={[
            ['LN Address', flow.buyerAddress],
          ]} />
        )}

        {flow.refundStatus && (
          <InfoCard title={`Refund (${PAYOUT_TICKER} → ${BRIDGE_TICKER}, converted by the LSP)`} accent={AppColors.primary} rows={[
            ['Hash',   short(flow.refundHash, 28)],
            ['Status', flow.refundStatus],
          ]} />
        )}

        {flow.refundBalA && (
          <InfoCard title={`Buyer ${BRIDGE_TICKER} Balance After Refund`} accent={AppColors.success} rows={[
            ['Offchain In',  String(flow.refundBalA.offchainInbound ?? 0)],
            ['Offchain Out', String(flow.refundBalA.offchainOutbound ?? 0)],
          ]} />
        )}

        {flow.topupBalB && (
          <InfoCard title={`Merchant ${PAYOUT_TICKER} Balance After On-Chain Top-Up`} accent={AppColors.success} rows={[
            ['Paid on-chain in', BRIDGE_TICKER],
            ['Delivered in',     PAYOUT_TICKER],
            ['Offchain Out',     String(flow.topupBalB.offchainOutbound ?? 0)],
          ]} />
        )}

        {flow.channelC && (
          <InfoCard title="Channel · LSP → Recipient (payout, on-chain)" accent={AppColors.success} rows={[
            ['Asset',    `${PAYOUT_TICKER} · ${short(PAYOUT_ASSET_ID, 24)}`],
            ['Capacity', `${flow.channelC.capacitySat ?? flow.channelC.capacity_sat ?? '?'} sat`],
          ]} />
        )}

        {flow.recipientAddress && (
          <InfoCard title="Recipient (C) Lightning Address" accent={AppColors.primary} rows={[
            ['LN Address', flow.recipientAddress],
            ['Pubkey',     short(flow.pubkeyC, 20)],
          ]} />
        )}

        {flow.recipientStatus && (
          <InfoCard title={`Merchant → Recipient (${PAYOUT_TICKER}, no conversion)`} accent={AppColors.primary} rows={[
            ['Hash',   short(flow.recipientHash, 28)],
            ['Status', flow.recipientStatus],
          ]} />
        )}

        {flow.finalBalC && (
          <InfoCard title={`Recipient ${PAYOUT_TICKER} Balance After Payment`} accent={AppColors.success} rows={[
            ['Offchain In',  String(flow.finalBalC.offchainInbound ?? 0)],
            ['Offchain Out', String(flow.finalBalC.offchainOutbound ?? 0)],
          ]} />
        )}

        {flow.relayStatus && (
          <InfoCard title={`Merchant → Buyer via /lightning_send (${PAYOUT_TICKER} → ${BRIDGE_TICKER})`} accent={AppColors.primary} rows={[
            ['Status', flow.relayStatus],
            ['Payee invoice', 'plain BOLT11, no APay'],
          ]} />
        )}

        {flow.relayBalA && (
          <InfoCard title={`Buyer ${BRIDGE_TICKER} Balance After Relay`} accent={AppColors.success} rows={[
            ['Offchain In',  String(flow.relayBalA.offchainInbound ?? 0)],
            ['Offchain Out', String(flow.relayBalA.offchainOutbound ?? 0)],
          ]} />
        )}

        {flow.phase === 'done' && (
          <View style={[s.card, { borderColor: AppColors.successBorder }]}>
            <Text style={[s.cardTitle, { color: AppColors.success }]}>✓ Bridge-Asset Checkout Complete</Text>
            <Text style={s.cardDesc}>
              {`1. Merchant received a real on-chain channel in ${PAYOUT_TICKER}\n` +
               `2. Buyer received ${BRIDGE_TICKER} on-chain, then self-opened its own\n` +
               '   real channel in it\n' +
               `3. The SDK quoted the checkout in ${BRIDGE_TICKER} — the only asset the\n` +
               '   buyer can spend — and the LSP converted 1:1 on its books\n' +
               `4. Merchant's ${PAYOUT_TICKER} balance moved by ${price}\n` +
               `5. Merchant refunded ${refundPrice} through APay, quoting ${PAYOUT_TICKER} —\n` +
               '   the LSP converted the same pair in the other direction\n' +
               `6. The Faucet topped the merchant up on-chain in ${BRIDGE_TICKER} and the\n` +
               `   LSP delivered ${PAYOUT_TICKER} over the existing channel\n` +
               `7. A third node (C) was served the ordinary way and paid ${recipientPrice}\n` +
               '   by the merchant — one asset on both legs, no conversion\n' +
               `8. The buyer signed a plain ${BRIDGE_TICKER} BOLT11 and the merchant paid it\n` +
               `   holding only ${PAYOUT_TICKER} via /lightning_send\n\n` +
               'Every leg shares its payment hash with its counterpart; no virtual\n' +
               'channels and no node-level swap anywhere in this flow.'}
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
  toggle:         { backgroundColor: AppColors.bgCardElevated, borderRadius: 10, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: AppColors.border },
  toggleOn:       { borderColor: AppColors.primary },
  toggleTxt:      { fontSize: 14, fontWeight: '600', color: AppColors.textPrimary, marginBottom: 6 },
  toggleHint:     { fontSize: 12, color: AppColors.textSecondary, lineHeight: 17 },
});
