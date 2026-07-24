/**
 * Scenario B — on-chain & UTXO (§7a.3).
 *
 * getAddress → fund via the local bitcoin bridge → mine → getBtcBalance →
 * createUtxos → listUnspents. The assertion that matters is the parsed
 * outpoint: `utxo.outpoint.txid` + numeric `vout`, never the raw `"txid:vout"`
 * string the binding returns.
 *
 * Leaves the wallet funded with colorable UTXOs — scenarios C, D and E all
 * depend on that and do not re-fund.
 */
import {
  expectFields,
  expectEach,
  expectNoWireKeys,
  HEX_32,
} from '@utexo/rgb-sdk-core/conformance';

import { mine, sendToAddress } from '@/utils/bitcoin-node';

import { assert, waitFor, type ScenarioContext } from '../harness';

const balanceSide = {
  settled: { type: 'number', min: 0 },
  future: { type: 'number', min: 0 },
  spendable: { type: 'number', min: 0 },
} as const;

/** Colorable UTXOs the later scenarios consume: issuance, IFA, channel open. */
export const UTXO_COUNT = 10;

export async function scenarioB(ctx: ScenarioContext): Promise<void> {
  const { wallet, step } = ctx;

  const address = await step(
    'getAddress',
    () => wallet.getAddress(),
    (a) => ({ address: a })
  );
  assert(
    address.startsWith('bcrt1'),
    `regtest bech32 address expected, got: ${address}`
  );

  const before = await step(
    'getBtcBalance (before funding)',
    () => wallet.getBtcBalance(),
    (b) => b
  );
  expectFields(before, {
    'vanilla.settled': balanceSide.settled,
    'vanilla.future': balanceSide.future,
    'vanilla.spendable': balanceSide.spendable,
    'colored.settled': balanceSide.settled,
    'colored.future': balanceSide.future,
    'colored.spendable': balanceSide.spendable,
  });
  expectNoWireKeys(before);

  const txid = await step(
    'fund via bridge',
    async () => {
      const id = await sendToAddress(address, 1);
      await mine(6);
      return id;
    },
    (id) => ({ txid: id })
  );
  assert(HEX_32.test(txid), `funding txid must be 64 hex chars, got: ${txid}`);

  // Esplora/electrs index the block asynchronously — poll rather than sleep
  // (the same race §6.0l hit on web and `waitForAssetSpendable` absorbs here).
  const after = await step(
    'getBtcBalance (after funding)',
    () =>
      waitFor(
        'vanilla balance to increase',
        async () => {
          await wallet.syncWallet();
          const bal = await wallet.getBtcBalance();
          return bal.vanilla.spendable > before.vanilla.spendable ? bal : null;
        },
        { attempts: 30, delayMs: 2000 }
      ),
    (b) => b
  );
  assert(
    after.vanilla.spendable > before.vanilla.spendable,
    'balance must actually increase after funding'
  );

  await step(
    'createUtxos',
    async () => {
      await wallet.syncWallet();
      await wallet.createUtxos({ upTo: false, num: UTXO_COUNT, feeRate: 7 });
      await mine(1);
      await wallet.syncWallet();
      return UTXO_COUNT;
    },
    (n) => ({ num: n })
  );

  const unspents = await step(
    'listUnspents',
    () =>
      waitFor(
        `${UTXO_COUNT} colorable unspents`,
        async () => {
          const list = await wallet.listUnspents();
          const colorable = list.filter((u) => u.utxo.colorable);
          return colorable.length >= UTXO_COUNT ? list : null;
        },
        {
          attempts: 30,
          delayMs: 2000,
          onAttempt: async () => {
            await mine(1);
            await wallet.syncWallet();
          },
        }
      ),
    (list) => ({
      count: list.length,
      colorable: list.filter((u) => u.utxo.colorable).length,
      first: list[0],
    })
  );

  expectEach(unspents, {
    'utxo.outpoint.txid': { type: 'string', pattern: HEX_32 },
    'utxo.outpoint.vout': { type: 'number', min: 0 },
    'utxo.btcAmount': { type: 'number', min: 0 },
    'utxo.colorable': { type: 'boolean' },
    rgbAllocations: { type: 'array' },
  });
  for (const u of unspents) expectNoWireKeys(u);

  const colorable = unspents.filter((u) => u.utxo.colorable);
  assert(
    colorable.length >= UTXO_COUNT,
    `createUtxos must have produced ${UTXO_COUNT} colorable UTXOs, got ${colorable.length}`
  );
}
