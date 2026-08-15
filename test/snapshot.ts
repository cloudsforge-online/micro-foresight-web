/**
 * A throwaway that renders the market page with the journey fixtures and writes the resulting
 * markup, wrapped in the real stylesheet, to /tmp — so a real browser can lay it out and be
 * photographed. `test/dom.ts` explicitly refuses to assert geometry (happy-dom does not lay pages
 * out); this does not assert anything, it just produces the HTML a browser needs.
 *
 * Not part of `pnpm test` — the glob is `test/*.test.ts`.
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement as h } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { mount, type Routes } from './dom.ts'
import * as fx from './fixtures.ts'
import { AuthProvider } from '../src/lib/auth.tsx'
import { MarketPage } from '../src/pages/market.tsx'

const at = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))
const ORIGIN = 'https://foresight.cloudsforge.online'

const ASSETS = [
  { assetCode: 'EMBER', displayName: 'Ember', decimals: 18, enabled: true, blockedReason: null },
  { assetCode: 'BTC', displayName: 'Bitcoin', decimals: 8, enabled: true, blockedReason: null },
  { assetCode: 'LTC', displayName: 'Litecoin', decimals: 8, enabled: true, blockedReason: null },
  { assetCode: 'DOGE', displayName: 'Dogecoin', decimals: 8, enabled: true, blockedReason: null },
]

const routes: Routes = {
  'GET /auth/me': { body: fx.ME },
  [`GET /markets/${fx.MARKET_ID}`]: {
    body: fx.detail({
      market: fx.market({
        image: {
          assetId: 'asset-1',
          checksum: `sha256:${'ab'.repeat(32)}`,
          bytesUrl: 'https://example.invalid/market.png',
        },
      }),
    }),
  },
  'GET /stake-assets': {
    body: {
      poolAsset: 'EMBER',
      custodialStakingAvailable: true,
      disclosure:
        'A stake taken from your CloudsForge balance is a ledger entry with us. It is not in the contract, and it settles against the CloudsForge pool.',
      assets: ASSETS,
    },
  },
  'GET /me/stake-balances': {
    body: {
      poolAsset: 'EMBER',
      degraded: false,
      assets: ASSETS.map((a) => ({ ...a, available: a.assetCode === 'EMBER' ? '4200000000000000000' : '250000' })),
    },
  },
  [`GET /markets/${fx.MARKET_ID}/me/stake`]: { body: { staked: [] } },
}

const screen = await mount(
  h(
    MemoryRouter,
    { initialEntries: [`/markets/${fx.MARKET_ID}`] },
    h(AuthProvider, null, h(MarketPage)),
  ),
  { url: `${ORIGIN}/markets/${fx.MARKET_ID}`, routes },
)

const body = screen.document.body.innerHTML
const tokens = readFileSync(at('../ui/packages/ui/src/tokens.css'), 'utf8')
const base = readFileSync(at('../ui/packages/ui/src/ui.css'), 'utf8')
const mine = readFileSync(at('src/styles.css'), 'utf8')

writeFileSync(
  '/tmp/fs-market.html',
  `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8">
<style>${tokens}</style><style>${base}</style><style>${mine}</style>
<style>img{background:#243}</style>
</head><body><main class="fs-main">${body}</main></body></html>`,
)
console.log('wrote /tmp/fs-market.html', body.length, 'bytes of markup')
process.exit(0)
