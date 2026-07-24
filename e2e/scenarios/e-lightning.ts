/**
 * Scenario E — Lightning (§7a.3).
 *
 * connectPeer(Faucet) → openChannel → mine → listChannels →
 * createLightningInvoice → Faucet pays it → getLightningReceiveStatus.
 *
 * **Direct channel to the Faucet, not the utexo-lsp order flow** (§6.0m): the
 * LSP path exercises the LSP's own ordering logic, which is not what this suite
 * is verifying. The wallet opens the channel and pushes msat across, so the
 * Faucet ends up with the outbound liquidity to pay an invoice back — the
 * shortest route to a real settled HTLC.
 *
 * Field checks that matter here: channel objects must carry `isPublic`, never
 * the wire `public`/`isActive`; statuses must be canonical (`Succeeded`, not
 * `SUCCEEDED` or `Paid`) — the exact cast this migration removed.
 */
import {
  expectFields,
  expectEach,
  expectNoWireKeys,
  CANONICAL_INVOICE_STATUSES,
  CANONICAL_PAYMENT_STATUSES,
  CANONICAL_CHANNEL_STATUSES,
  HEX_32,
  HEX_PUBKEY,
} from '@utexo/rgb-sdk-core/conformance';

import { mine } from '@/utils/bitcoin-node';

import { assert, assertEq, hostAddr, hostUrl, waitFor, type ScenarioContext } from '../harness';

const CAPACITY_SAT = 100_000;
/** Pushed to the Faucet — this is the liquidity it pays our invoice from. */
const PUSH_MSAT = 50_000_000;
const INVOICE_SATS = 3_000;

export async function scenarioE(ctx: ScenarioContext): Promise<void> {
  const { wallet, fx, step } = ctx;

  const peerUri = `${fx.FAUCET_PUBKEY}@${hostAddr(fx.FAUCET_PEER_PORT)}`;

  await step(
    'connectPeer (Faucet)',
    async () => {
      await wallet.connectPeer(peerUri);
      return peerUri;
    },
    (uri) => ({ peerUri: uri })
  );

  const peers = await step(
    'listPeers',
    () => wallet.listPeers(),
    (p) => p
  );
  expectEach(peers, { pubkey: { type: 'string', pattern: HEX_PUBKEY } });
  expectNoWireKeys(peers);
  assert(
    peers.some((p) => p.pubkey === fx.FAUCET_PUBKEY),
    `Faucet ${fx.FAUCET_PUBKEY} must appear in listPeers`
  );

  const opened = await step(
    'openChannel',
    () =>
      wallet.openChannel({
        peerPubkey: peerUri,
        capacitySat: CAPACITY_SAT,
        pushMsat: PUSH_MSAT,
        isPublic: true,
        withAnchors: true,
      }),
    (r) => r
  );
  expectFields(opened, { temporaryChannelId: { type: 'string', nonEmpty: true } });

  const channel = await step(
    'listChannels (wait for ready)',
    () =>
      waitFor(
        'the channel to become ready',
        async () => {
          await wallet.syncWallet();
          const channels = await wallet.listChannels();
          return channels.find((c) => c.peerPubkey === fx.FAUCET_PUBKEY && c.ready) ?? null;
        },
        {
          attempts: 60,
          delayMs: 2000,
          onAttempt: async () => {
            await mine(1);
          },
        }
      ),
    (c) => c
  );
  expectFields(channel, {
    channelId: { type: 'string', nonEmpty: true },
    peerPubkey: { type: 'string', pattern: HEX_PUBKEY },
    capacitySat: { type: 'number', min: CAPACITY_SAT, max: CAPACITY_SAT },
    ready: { type: 'boolean' },
    isPublic: { type: 'boolean' },
    status: { oneOf: CANONICAL_CHANNEL_STATUSES, optional: true },
    fundingTxid: { type: 'string', pattern: HEX_32, optional: true },
  });
  // The wire names, spelled out: their presence means an un-mapped object.
  expectNoWireKeys(channel, ['public', 'isActive']);
  assertEq(channel.ready, true, 'channel.ready');
  ctx.state.channelId = channel.channelId;

  const invoice = await step(
    'createLightningInvoice',
    () => wallet.createLightningInvoice({ amountSats: INVOICE_SATS, expirySeconds: 900 }),
    (r) => r
  );
  expectFields(invoice, { lnInvoice: { type: 'string', nonEmpty: true } });
  expectNoWireKeys(invoice);
  const lnInvoice = invoice.lnInvoice;

  const decoded = await step(
    'decodeLnInvoice',
    () => wallet.decodeLnInvoice(lnInvoice),
    (d) => d
  );
  expectFields(decoded, {
    paymentHash: { type: 'string', pattern: HEX_32 },
    // number | bigint on the wire — min/max accept both, `type` would not.
    amtMsat: { min: INVOICE_SATS * 1000, max: INVOICE_SATS * 1000 },
  });
  expectNoWireKeys(decoded);

  const status0 = await step(
    'getLightningReceiveStatus (pending)',
    () => wallet.getLightningReceiveStatus(lnInvoice),
    (s) => ({ status: s })
  );
  assert(
    (CANONICAL_INVOICE_STATUSES as readonly string[]).includes(status0),
    `invoice status must be canonical, got ${status0}`
  );

  // The Faucet pays over its own REST API — nothing else in the stack can move
  // sats into our node, and the payment must come from a real peer for the
  // HTLC to settle.
  await step(
    'Faucet /sendpayment',
    async () => {
      const url = `${hostUrl(fx.FAUCET_URL)}/sendpayment`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice: lnInvoice }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Faucet ${url} -> HTTP ${res.status}: ${text}`);
      return JSON.parse(text) as Record<string, unknown>;
    },
    (r) => r
  );

  const settled = await step(
    'getLightningReceiveStatus (settled)',
    () =>
      waitFor(
        'the invoice to be paid',
        async () => {
          const status = await wallet.getLightningReceiveStatus(lnInvoice);
          if (status === 'Failed' || status === 'Expired') {
            throw new Error(`invoice terminated as ${status}`);
          }
          return status === 'Succeeded' ? status : null;
        },
        { attempts: 45, delayMs: 2000 }
      ),
    (s) => ({ status: s })
  );
  assertEq(settled, 'Succeeded', 'invoice must settle as canonical Succeeded');

  const payments = await step(
    'listPayments',
    () => wallet.listPayments(),
    (p) => ({ count: p.length, statuses: p.map((x) => x.status) })
  );
  assert(payments.length > 0, 'the settled payment must be listed');
  expectEach(payments, {
    paymentHash: { type: 'string', pattern: HEX_32 },
    status: { oneOf: CANONICAL_PAYMENT_STATUSES },
  });
  for (const p of payments) expectNoWireKeys(p);
  assert(
    payments.some((p) => p.status === 'Succeeded' && p.inbound !== false),
    'an inbound Succeeded payment must be listed'
  );
}
