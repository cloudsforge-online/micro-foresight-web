/**
 * UNKNOWN IS NOT ZERO, asserted on the rendered page rather than on the helper.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `src/lib/units.ts` already carries the rule in its header — "a valuation of zero is a lie about
 * a holding that exists" — and `test/units.test.ts`, `test/pool.test.ts` and `test/market.test.ts`
 * pin it at the function level. What none of them pin is the SCREEN. Every one of those functions
 * can go on returning `null` while a component quietly renders `{value ?? 0}` above it, and the
 * estate's two live examples of this class were both component-level: a wallet panel saying "There
 * is no balance to send" during an outage, and `BigInt('')` — which is `0n` — turning an empty
 * string into somebody's balance.
 *
 * So these two assert what a person sees, and they assert it NEGATIVELY: there is no digit. That
 * is the bar `tessera-web` set — when it cannot obtain a balance it prints no digit at all, rather
 * than a hopeful zero — and a positive assertion ("says not known") would still pass on a page
 * that said "not known" beside a 0.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen } from './dom.ts'
import * as fx from './fixtures.ts'
import { AuthProvider } from '../src/lib/auth.tsx'
import type { PoolView } from '../src/lib/foresight.ts'
import { MarketPage } from '../src/pages/market.tsx'
import { PortfolioPage } from '../src/pages/portfolio.tsx'

const ORIGIN = 'https://foresight.cloudsforge.online'

const page = (element: ReactElement, path: string): ReactElement =>
  h(MemoryRouter, { initialEntries: [path] }, h(AuthProvider, null, element) as ReactElement)

/**
 * The pool object a mirror that has never run produces.
 *
 * `null` on every wei field, which is what reaches the client when the sums are absent rather than
 * zero — `fromWeiString` refuses it, and the point of these tests is that the refusal survives all
 * the way to the DOM.
 */
const UNREADABLE_POOL = {
  ...fx.pool(),
  yes: null,
  no: null,
  total: null,
  yesBps: null,
  noBps: null,
  stakerCount: 0,
  asOf: null,
  lastBlock: null,
  tipBlock: null,
  behindBlocks: null,
  stale: true,
} as unknown as PoolView

describe('a pool that could not be read shows no figure at all', () => {
  it('the pool panel names the absence and prints no digit for either side', async () => {
    await withScreen(
      page(h(MarketPage), `/markets/${fx.MARKET_ID}`),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        routes: {
          'GET /auth/me': { body: fx.ME },
          [`GET /markets/${fx.MARKET_ID}`]: { body: fx.detail({ pool: UNREADABLE_POOL }) },
        },
      },
      async (s) => {
        await s.settle(20)

        const key = s.document.querySelector('.fs-key')
        assert.ok(key, 'the pool panel has no key rows at all')
        const shown = s.textOf(key)
        assert.equal(
          /\d/.test(shown),
          false,
          `the pool key printed a digit for a pool nobody could read: ${JSON.stringify(shown)}. ` +
            'A 0 there is an assertion that nothing is staked, which is a different fact from ' +
            'not having been able to look.',
        )
        assert.match(shown, /not known/i, 'the absence is not named')

        // And the bar says which of the two it is, in those words.
        assert.match(s.text(), /could not read the pool/i)
        assert.match(s.text(), /not known — not zero/i)
      },
    )
  })
})

describe('a position that could not be read shows no figure at all', () => {
  it('the row stays, is marked failed, and neither money cell holds a digit', async () => {
    await withScreen(
      page(h(PortfolioPage), `/portfolio/${fx.STAKER}`),
      {
        url: `${ORIGIN}/portfolio/${fx.STAKER}`,
        routes: {
          'GET /markets': { body: { markets: [fx.market()] } },
          [`GET /markets/${fx.MARKET_ID}/positions/${fx.STAKER}`]: {
            status: 503,
            body: fx.error('unavailable', 'the mirror did not answer'),
          },
        },
      },
      async (s) => {
        await s.settle(30)

        const row = s.document.querySelector('tr.is-failed')
        assert.ok(row, 'the failed position was dropped from the table rather than marked')
        const cells = [...row.querySelectorAll('td.fs-table__num')]
        assert.equal(cells.length, 2, 'the row does not have the two money cells')
        for (const cell of cells) {
          assert.equal(
            /\d/.test(s.textOf(cell)),
            false,
            `a money cell printed a digit for a position that did not load: ` +
              `${JSON.stringify(s.textOf(cell))}. This is the reader's own money, and a 0 here ` +
              'reads as "you staked nothing" when the truth is "we could not ask".',
          )
        }
      },
    )
  })
})
