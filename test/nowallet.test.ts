/**
 * THE READER WHO PICKED A SIDE AND HAS NO WALLET.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT WENT WRONG, IN THE ORDER THE READER MET IT
 *
 * A signed-in reader opened a market, chose Yes, typed an amount, and the panel answered with a
 * requirement and nothing else: connect a wallet. `stakeGate`'s other six blockers all have a
 * remedy on the screen — `signed_out` has a button beside it, the two amount ones are typed away,
 * the three market ones are facts about the market that no one can act on — so `no_wallet` was the
 * one refusal that named a condition and offered no way to meet it.
 *
 * And the alternative that was supposed to catch exactly this reader was invisible.
 * `CustodialStakePanel` — bet with coins already deposited here, no wallet anywhere in it —
 * returns `null` when it cannot read `GET /stake-assets`, and the estate gateway routed no such
 * path on the foresight host, so it returned `null` on every market page on both networks. The
 * screen was a demand for a wallet above an empty space where the other way to bet should have
 * been. Two independent defects landing on one reader.
 *
 * The route is fixed in `deploy/gateway/dynamic/estate-web.yml` and held there by
 * `deploy/scripts/check-gateway-covers-api-paths.py`. This file holds the other half, which a
 * route cannot fix: when the second panel is absent — switched off, not deployed, registry
 * unreadable — its absence has to MEAN something to the person reading the page.
 *
 * ── Why the assertions are on rendered text and not on a class name ───────────────────────────
 *
 * `.fs-nowallet` existing proves a div rendered. It does not prove the reader was told what a
 * wallet is, that no one here can switch one on for them, where EMBER's chain details are, or what
 * the missing panel below means. Each of those is a separate sentence that could be deleted on its
 * own, so each is asserted on its own.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Routes, type Screen } from './dom.ts'
import * as fx from './fixtures.ts'
import { AuthProvider } from '../src/lib/auth.tsx'
import { MarketPage } from '../src/pages/market.tsx'

const ORIGIN = 'https://foresight.cloudsforge.online'

const page = (element: ReactElement, path: string): ReactElement =>
  h(MemoryRouter, { initialEntries: [path] }, h(AuthProvider, null, element) as ReactElement)

/**
 * The registry as this deployment actually answers it: readable, and staking switched off.
 *
 * `custodialStakingAvailable` is the service's own flag and it is false wherever
 * `FORESIGHT_CUSTODIAL_ADDRESS` is unset, which is every estate today. So this is not a contrived
 * failure — it is the live configuration, and the one that leaves the second panel absent.
 */
const REGISTRY_OFF = {
  poolAsset: 'EMBER',
  custodialStakingAvailable: false,
  disclosure: 'A stake made with coins we hold for you is a record in our ledger, not a coin in a contract.',
  assets: [],
}

const marketRoutes = (over: Routes = {}): Routes => ({
  'GET /auth/me': { body: fx.ME },
  [`GET /markets/${fx.MARKET_ID}`]: { body: fx.detail() },
  // Explicit, and required: `CustodialStakePanel` asks for this on mount, and `dom.ts` throws on an
  // unrouted request rather than 404ing it, precisely so a scenario cannot assert a degraded state
  // it never arranged. This scenario arranges it.
  'GET /stake-assets': { body: REGISTRY_OFF },
  ...over,
})

/** The sentence `blockerSentence('no_wallet', …)` produces, by its load-bearing clause. */
const DEMAND = /You need a wallet in this browser to take a side/i

const stakePanel = (s: Screen): Element => {
  const panel = s.document.querySelector('.fs-stake')
  assert.ok(panel, 'the wallet stake panel did not render at all — the scenario proves nothing')
  return panel
}

const help = (s: Screen): Element | null => s.document.querySelector('.fs-nowallet')

/* ── the dead end ───────────────────────────────────────────────────────────────────────────── */

describe('a signed-in reader with no wallet is not left holding a requirement', () => {
  const noWallet = async (body: (s: Screen) => Promise<void>, over: Routes = {}): Promise<void> =>
    withScreen(
      page(h(MarketPage), `/markets/${fx.MARKET_ID}`),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        storage: fx.SIGNED_IN,
        routes: marketRoutes(over),
        // NO `windowExtras.ethereum`. That is the whole scenario: `getProvider()` finds nothing,
        // `stakeGate` returns `no_wallet`, and this is the browser of somebody who has never
        // installed an extension — which is most people who will ever open this page.
      },
      async (s) => {
        await s.settle(20)
        await body(s)
      },
    )

  it('reproduces the refusal: the demand for a wallet is on the screen', async () => {
    await noWallet(async (s) => {
      assert.match(s.textOf(stakePanel(s)), DEMAND)
    })
  })

  it('the second way to bet really is absent, so the help below is load-bearing', async () => {
    await noWallet(async (s) => {
      assert.equal(
        s.document.querySelector('.fs-panel--custodial'),
        null,
        'the custodial panel rendered, so this scenario is no longer the reader with nothing to ' +
          'fall back on and the sentence about its absence is now false on this page',
      )
    })
  })

  it('says what a wallet is, rather than assuming the reader already knows', async () => {
    await noWallet(async (s) => {
      const text = s.textOf(help(s))
      assert.match(text, /holds a key of yours and signs with it/i)
    })
  })

  it('says the requirement is structural — nobody here can switch one on for them', async () => {
    await noWallet(async (s) => {
      // Without this the reader's next move is to ask support to enable something, and there is
      // nothing to enable: the estate holds no key of theirs to sign with.
      assert.match(s.textOf(help(s)), /nothing we can switch on to do this for you/i)
    })
  })

  it('points at the chain details a wallet needs before it can send to a market', async () => {
    await noWallet(async (s) => {
      const link = help(s)?.querySelector('a')
      assert.ok(link, 'the help has no link, so a reader who installs a wallet still cannot use it')
      const href = link.getAttribute('href') ?? ''
      assert.match(href, /^https?:\/\/network\./, `the chain details link points at ${href}`)
      assert.ok(href.endsWith('#coin'), `the link must land on the coin block, not the top: ${href}`)
      // The link text has to say what is behind it. "here" alone is a link nobody clicks.
      assert.match(s.textOf(link), /chain id and the endpoint/i)
    })
  })

  it('names no wallet product and offers no download link', async () => {
    await noWallet(async (s) => {
      const text = s.textOf(help(s))
      // This file cannot check that a third party still ships what it shipped. A stale
      // recommendation on the screen where somebody is about to move money is worse than none.
      for (const brand of ['MetaMask', 'Rabby', 'Coinbase Wallet', 'Trust Wallet', 'Phantom']) {
        assert.ok(!text.includes(brand), `the help recommends ${brand} by name`)
      }
      for (const link of help(s)?.querySelectorAll('a') ?? []) {
        const href = link.getAttribute('href') ?? ''
        assert.match(
          href,
          /cloudsforge|^\//,
          `the help links off the estate to ${href}, which nothing in this repository can keep true`,
        )
      }
    })
  })

  it('explains what the missing second panel means, so the empty space is not a mystery', async () => {
    await noWallet(async (s) => {
      const text = s.textOf(help(s))
      assert.match(text, /coins you have already deposited with CloudsForge/i)
      assert.match(text, /not switched on here yet/i)
    })
  })

  it('holds when the registry cannot be read at all, which is what the missing route did', async () => {
    // The gateway answered `/stake-assets` with the SPA's HTML at 200, so the fetch resolved and
    // only the parse failed. This harness cannot serve `text/html` — it forces a JSON
    // content-type — so the body below reproduces the branch that matters: something readable as
    // JSON that is not a registry. `parseStakeAssets` returns null and the panel renders nothing.
    await noWallet(
      async (s) => {
        assert.equal(s.document.querySelector('.fs-panel--custodial'), null)
        assert.match(s.textOf(stakePanel(s)), DEMAND)
        assert.match(s.textOf(help(s)), /not switched on here yet/i)
      },
      { 'GET /stake-assets': { body: '<!doctype html><title>Forge Foresight</title>' } },
    )
  })
})

/* ── the control ────────────────────────────────────────────────────────────────────────────── */

describe('the help appears only for the blocker it answers', () => {
  it('a reader with a wallet is not told how to get one', async () => {
    await withScreen(
      page(h(MarketPage), `/markets/${fx.MARKET_ID}`),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        storage: fx.SIGNED_IN,
        routes: marketRoutes(),
        windowExtras: { ethereum: fx.fakeWallet() },
      },
      async (s) => {
        await s.settle(20)
        // Both halves: an explanation that outlives its blocker is three paragraphs of noise on
        // the screen of somebody who is ready to sign.
        assert.equal(help(s), null, 'the no-wallet help rendered for a reader who has a wallet')
        assert.doesNotMatch(s.textOf(stakePanel(s)), DEMAND)
      },
    )
  })
})
