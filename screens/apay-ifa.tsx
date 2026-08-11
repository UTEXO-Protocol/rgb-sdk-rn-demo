/**
 * APay Cart Checkout (IFA) — the same flow as apay-regular-channels.tsx, run
 * against the precision-6 IFA asset instead of the precision-0 NIA one.
 *
 * Two things differ, and both are the point of the screen:
 *
 *  1. Fractional amounts. Every RGB API takes *base units*; precision only
 *     scales the display. The checkout is 500_000 base units = 0.5 UTIF.
 *  2. A 1-sat HTLC. rgb-lightning-node negotiates VIRTUAL_HTLC_MIN_MSAT (1_000)
 *     on trusted_no_broadcast channels rather than the 3_000_000 msat floor a
 *     broadcastable commitment needs, so the LSP can run with
 *     MIN_AMT_MSAT=1000 — see start-lsp-regtest.sh.
 *
 * Both assets live on the same LSP (SUPPORTED_ASSET_IDS carries them both), so
 * its cron opens one channel per asset for every peer that connects.
 */
import React from 'react';

import ApayCartScreen from './apay-regular-channels';
import { IFA_ASSET } from './apay/config';

export default function ApayIfaScreen({ embedded = false }: { embedded?: boolean }) {
  return (
    <ApayCartScreen
      embedded={embedded}
      asset={IFA_ASSET}
      title="APay Cart Checkout · IFA"
      subtitle={`Regtest · precision-${IFA_ASSET.precision} asset, 1-sat HTLC on a virtual channel`}
      // Distinct storage + ports so this flow never collides with the UTST cart
      // one (they share the flow guard, but stale node dirs/ports would not).
      flowOptions={{
        storagePrefix: 'apay_ifa',
        merchantPortBase: 48000,
        buyerPortBase: 50000,
        // The IFA asset only exists if the checked-in script issued it; the
        // local start-lsp-local.sh variant the UTST cart hints at does not.
        setupScriptHint: './scripts/start-lsp-regtest.sh',
      }}
    />
  );
}
