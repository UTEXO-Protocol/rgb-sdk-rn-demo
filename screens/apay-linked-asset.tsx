/**
 * APay Bridge Asset — checkout where the buyer pays in a bridged asset and the
 * merchant is delivered its own. Flow logic:
 * screens/apay/useApayLinkedAssetFlow.ts. See docs/apay-linked-asset-mvp.md and
 * docs/apay-linked-asset-options.uk.md (option A, as revised in §10).
 *
 * No virtual channels: LSP → merchant is a real on-chain channel in the payout
 * asset (LNUSDT); buyer → LSP is a real on-chain channel the buyer opens itself,
 * funded in the bridge asset (BUSDT). Both assets are ordinary IFA contracts
 * issued on the Faucet, unrelated to each other — utexo-lsp's CONVERTIBLE_PAIRS
 * is what makes them interchangeable. It quotes the buyer in BUSDT and pays the
 * merchant in LNUSDT, converting 1:1 between the two legs of one APay payment.
 * Requires:
 *
 *   TWO_ASSETS=1 ./scripts/start-lsp-regtest.sh
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

import { BRIDGE_ASSET, formatAssetAmount, LSP_URL, short } from './apay/config';
import { type LinkedPhase, LINKED_PHASE_LABELS, useApayLinkedAssetFlow } from './apay/useApayLinkedAssetFlow';
import { apayStyles as s, InfoCard, LogPane } from './apay/ui';

function phaseMessage(phase: LinkedPhase): string {
  switch (phase) {
    case 'b_init':          return 'Creating merchant shop node…';
    case 'b_fund':          return 'Funding merchant wallet…';
    case 'b_utxos':         return 'Creating merchant UTXOs…';
    case 'b_channel':       return 'LSP opening on-chain payout-asset channel to merchant…';
    case 'register':        return 'Registering shop (enableLightningAddress)…';
    case 'a_init':          return 'Creating buyer node…';
    case 'a_fund':          return 'Funding buyer wallet…';
    case 'a_utxos':         return 'Creating buyer UTXOs…';
    case 'a_asset_receive': return 'Buyer receiving bridge asset on-chain from Faucet…';
    case 'a_channel':       return 'Buyer self-opening on-chain bridge-asset channel to LSP…';
    case 'send':            return 'Buyer checkout — SDK picks the asset, LSP quotes it…';
    case 'settle':          return 'Waiting for the outbound leg to the merchant…';
    case 'refund_register': return 'Registering buyer address (APay refund)…';
    case 'refund':          return 'Merchant refunding the buyer through APay…';
    case 'refund_settle':   return 'Waiting for the refund to reach the buyer…';
    case 'topup':           return `Faucet paying the merchant on-chain in ${BRIDGE_ASSET.bridgeTicker}…`;
    case 'c_init':          return 'Creating recipient node (C)…';
    case 'c_fund':          return 'Funding recipient wallet…';
    case 'c_utxos':         return 'Creating recipient UTXOs…';
    case 'c_channel':       return 'Provisioning grace, then LSP opens the recipient a channel…';
    case 'c_register':      return 'Registering recipient address (enableLightningAddress)…';
    case 'c_pay':           return 'Merchant paying the recipient through APay…';
    case 'c_settle':        return 'Waiting for the payment to reach the recipient…';
    default:                return 'Working…';
  }
}

export default function ApayLinkedAssetScreen({ embedded = false }: { embedded?: boolean }) {
  // Who quotes the cart. Off: the buyer's SDK picks the asset via payAddress.
  // On: the merchant quotes with requestExternalInvoice and the buyer settles
  // the raw BOLT11 — what a node that only speaks /sendpayment would do.
  const [externalInvoice, setExternalInvoice] = React.useState(false);
  const flow = useApayLinkedAssetFlow({ externalInvoice });
  const { bridgeAssetId, bridgeTicker, payoutAssetId, payoutTicker, precision, paymentAssetAmount, paymentMsat, cartItem, refundAssetAmount, refundMsat, recipientAssetAmount } = BRIDGE_ASSET;
  const price = `${formatAssetAmount(paymentAssetAmount, precision)} ${payoutTicker}`;
  const refundPrice = `${formatAssetAmount(refundAssetAmount, precision)} ${bridgeTicker}`;
  const recipientPrice = `${formatAssetAmount(recipientAssetAmount, precision)} ${payoutTicker}`;

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
          <Text style={s.title}>APay Bridge Asset</Text>
          <Text style={s.subtitle}>Regtest · on-chain only · LSP converts a configured pair 1:1</Text>
          <View style={s.badge}>
            <View style={[s.dot, { backgroundColor: flow.envReady ? AppColors.success : AppColors.error }]} />
            <Text style={s.badgeTxt}>
              {flow.envReady
                ? `LSP pays out ${payoutTicker}, accepts ${bridgeTicker}`
                : `Run ${flow.setupScriptHint} first`}
            </Text>
          </View>
        </View>

        {flow.phase !== 'idle' && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Phase: {LINKED_PHASE_LABELS[flow.phase]}</Text>
          </View>
        )}

        {flow.phase === 'idle' && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Bridge-Asset Checkout Scenario</Text>
            <Text style={s.cardDesc}>
              {'No virtual channels anywhere in this flow — both legs are real,\n' +
               'confirmed on-chain RGB channels.\n\n' +
               '🏪 Merchant (B)\n' +
               `   LSP opens a real channel to B in the payout asset (${payoutTicker})\n` +
               '   — same cron mechanism as every other APay flow, just\n' +
               '   on-chain instead of trusted_no_broadcast.\n\n' +
               '🛒 Buyer (A)\n' +
               `   Receives ${bridgeTicker} on-chain from the Faucet, then opens its\n` +
               '   OWN channel to the LSP funded with it — genuine self-funded\n' +
               '   outbound capacity, not LSP-pushed liquidity.\n\n' +
               '🔁 Conversion (on the LSP\'s books)\n' +
               '   The SDK reads the payout asset from LNURL discovery, sees no\n' +
               `   ${payoutTicker} liquidity, and asks to be quoted in ${bridgeTicker}. The LSP\n` +
               `   holds the buyer's ${bridgeTicker} HODL and pays B ${payoutTicker} against the\n` +
               '   same payment hash. The two assets are unrelated contracts;\n' +
               '   CONVERTIBLE_PAIRS is what authorizes the 1:1 rate.\n\n' +
               '↩️ Refund (same conversion, reversed)\n' +
               `   The merchant then pays ${refundPrice} back through APay, quoting\n` +
               `   ${payoutTicker} — the only asset it holds. Needs utexo-lsp with\n` +
               '   CONVERTIBLE_ASSET_IDS / CONVERTIBLE_PAIRS /\n' +
               '   PAYOUT_ASSET_PREFERENCE set.\n\n' +
               '⬇️ Top-up (on-chain in, Lightning out)\n' +
               `   Finally the merchant calls receiveAsset naming only ${payoutTicker}.\n` +
               `   The LSP hands back an RGB invoice in ${bridgeTicker} — an id the\n` +
               '   client never configured — and the Faucet, a plain RLN node\n' +
               `   with no channel to anyone, pays it. Merchant ${payoutTicker} channel\n` +
               '   liquidity must move.\n\n' +
               '👤 Recipient (C)\n' +
               '   A third node with no history: it connects, the LSP cron opens it\n' +
               `   a ${payoutTicker} channel, it registers an address, and the merchant pays\n` +
               `   it ${recipientPrice}. Both legs ${payoutTicker} — the control case showing\n` +
               '   plain APay still works on a two-asset LSP.\n\n' +
               `Prerequisite: ${flow.setupScriptHint}`}
            </Text>

            <View style={cart.cartCard}>
              <Text style={cart.cartTitle}>Your cart</Text>
              <View style={cart.cartRow}>
                <Text style={cart.cartItem}>{cartItem}</Text>
                <Text style={cart.cartPrice}>{price}</Text>
              </View>
              <View style={cart.cartRow}>
                <Text style={cart.cartTotalLabel}>Base units (precision {precision})</Text>
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
                  {'Missing BRIDGE_ASSET_ID / IFA_ASSET_ID. Run:\n\n  ' + flow.setupScriptHint}
                </Text>
              </View>
            )}

            <View style={s.paramCard}>
              <Text style={s.paramTitle}>Config</Text>
              <Text style={s.paramLine}>LSP API        {LSP_URL}</Text>
              <Text style={s.paramLine}>Payout asset   {payoutTicker} · {payoutAssetId ? short(payoutAssetId, 24) : '(not set)'}</Text>
              <Text style={s.paramLine}>Bridge asset   {bridgeTicker} · {bridgeAssetId ? short(bridgeAssetId, 24) : '(not set)'}</Text>
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
                  ? `Merchant quotes with requestExternalInvoice (asset from LNURL discovery, ${bridgeTicker}); ` +
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
              <Text style={s.startBtnTxt}>▶  Run Linked-Asset Checkout Flow</Text>
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
          ]} />
        )}

        {flow.channelB && (
          <InfoCard title="Channel · LSP → Merchant (payout, on-chain)" accent={AppColors.success} rows={[
            ['Asset',    `${payoutTicker} · ${short(payoutAssetId, 24)}`],
            ['Capacity', `${flow.channelB.capacitySat ?? flow.channelB.capacity_sat ?? '?'} sat`],
          ]} />
        )}
        {flow.channelA && (
          <InfoCard title="Channel · Buyer → LSP (bridge, self-opened)" accent={AppColors.success} rows={[
            ['Asset',    `${bridgeTicker} · ${short(bridgeAssetId, 24)}`],
            ['Capacity', `${flow.channelA.capacitySat ?? flow.channelA.capacity_sat ?? '?'} sat`],
          ]} />
        )}

        {flow.sendStatus && (
          <InfoCard title={`Buyer Payment (${bridgeTicker} → ${payoutTicker}, converted by the LSP)`} accent={AppColors.primary} rows={[
            ['Hash',   short(flow.paymentHash, 28)],
            ['Status', flow.sendStatus],
          ]} />
        )}

        {flow.finalBalB && (
          <InfoCard title={`Merchant ${payoutTicker} Balance After Delivery`} accent={AppColors.success} rows={[
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
          <InfoCard title={`Refund (${payoutTicker} → ${bridgeTicker}, converted by the LSP)`} accent={AppColors.primary} rows={[
            ['Hash',   short(flow.refundHash, 28)],
            ['Status', flow.refundStatus],
          ]} />
        )}

        {flow.refundBalA && (
          <InfoCard title={`Buyer ${bridgeTicker} Balance After Refund`} accent={AppColors.success} rows={[
            ['Offchain In',  String(flow.refundBalA.offchainInbound ?? 0)],
            ['Offchain Out', String(flow.refundBalA.offchainOutbound ?? 0)],
          ]} />
        )}

        {flow.topupBalB && (
          <InfoCard title={`Merchant ${payoutTicker} Balance After On-Chain Top-Up`} accent={AppColors.success} rows={[
            ['Paid on-chain in', bridgeTicker],
            ['Delivered in',     payoutTicker],
            ['Offchain Out',     String(flow.topupBalB.offchainOutbound ?? 0)],
          ]} />
        )}

        {flow.channelC && (
          <InfoCard title="Channel · LSP → Recipient (payout, on-chain)" accent={AppColors.success} rows={[
            ['Asset',    `${payoutTicker} · ${short(payoutAssetId, 24)}`],
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
          <InfoCard title={`Merchant → Recipient (${payoutTicker}, no conversion)`} accent={AppColors.primary} rows={[
            ['Hash',   short(flow.recipientHash, 28)],
            ['Status', flow.recipientStatus],
          ]} />
        )}

        {flow.finalBalC && (
          <InfoCard title={`Recipient ${payoutTicker} Balance After Payment`} accent={AppColors.success} rows={[
            ['Offchain In',  String(flow.finalBalC.offchainInbound ?? 0)],
            ['Offchain Out', String(flow.finalBalC.offchainOutbound ?? 0)],
          ]} />
        )}

        {flow.relayStatus && (
          <InfoCard title={`Merchant → Buyer via /lightning_send (${payoutTicker} → ${bridgeTicker})`} accent={AppColors.primary} rows={[
            ['Status', flow.relayStatus],
            ['Payee invoice', 'plain BOLT11, no APay'],
          ]} />
        )}

        {flow.relayBalA && (
          <InfoCard title={`Buyer ${bridgeTicker} Balance After Relay`} accent={AppColors.success} rows={[
            ['Offchain In',  String(flow.relayBalA.offchainInbound ?? 0)],
            ['Offchain Out', String(flow.relayBalA.offchainOutbound ?? 0)],
          ]} />
        )}

        {flow.phase === 'done' && (
          <View style={[s.card, { borderColor: AppColors.successBorder }]}>
            <Text style={[s.cardTitle, { color: AppColors.success }]}>✓ Linked-Asset Checkout Complete</Text>
            <Text style={s.cardDesc}>
              {`1. Merchant received a real on-chain channel in ${payoutTicker}\n` +
               `2. Buyer received ${bridgeTicker} on-chain, then self-opened its own\n` +
               '   real channel in it\n' +
               `3. The SDK quoted the checkout in ${bridgeTicker} — the only asset the\n` +
               '   buyer can spend — and the LSP converted 1:1 on its books\n' +
               `4. Merchant's ${payoutTicker} balance moved by ${price}\n` +
               `5. Merchant refunded ${refundPrice} through APay, quoting ${payoutTicker} —\n` +
               '   the LSP converted the same pair in the other direction\n' +
               `6. The Faucet topped the merchant up on-chain in ${bridgeTicker} and the\n` +
               `   LSP delivered ${payoutTicker} over the existing channel\n` +
               `7. A third node (C) was served the ordinary way and paid ${recipientPrice}\n` +
               '   by the merchant — one asset on both legs, no conversion\n' +
               `8. The buyer signed a plain ${bridgeTicker} BOLT11 and the merchant paid it\n` +
               `   holding only ${payoutTicker}: /lightning_send held the merchant's HTLC\n` +
               "   until the LSP had paid the buyer, then claimed it with the buyer's\n" +
               '   own preimage\n\n' +
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
