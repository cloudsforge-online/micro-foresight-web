/**
 * The browser journeys of `docs/ecosystem/22-browser-journeys.md`, tiers 1 and 2, for this surface.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE RULE. Doc 22 §3: **a browser scenario may never assert a business rule.**
 *
 * A game client once withheld four SKUs from its UI while the payment routes stayed live and
 * chargeable (14 §11); a client-side test of the hidden catalogue would have passed, green,
 * against the defect. So every scenario below asserts one of exactly three things (§3.1): what a
 * human can see relative to what the API returned in the SAME run, what the client SENT, or where
 * the browser ended up.
 *
 * ── Why this surface is the one where that matters most ────────────────────────────────────────
 *
 * This is the only bundle in the estate that hands a transaction to a wallet. Once
 * `eth_sendTransaction` returns, nothing anybody does can change what was sent — there is no
 * server-side gate behind it, because the whole design is that the contract pays the winners
 * "whether or not this site is running". BJ-FOR-10 is therefore a `client-request` assertion in
 * the strictest sense available anywhere in this catalogue: the `to`, the calldata and the value
 * the browser handed the provider are compared, byte for byte, with the contract and the amount
 * that were on screen when the user pressed the button.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `test/houseseed.test.ts` already renders `MarketArticle` through `react-dom/server` and greps
 * the markup for the disclosure sentence. That test is kept and nothing here duplicates it. What
 * is added is what a string renderer cannot reach: document ORDER after the effects have run, the
 * live-region role, TAB order, and the transaction.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Routes, type Screen } from './dom.ts'
import * as fx from './fixtures.ts'
import { DOC22_IDS, SCENARIOS } from './journeys.ts'
import { App } from '../src/app.tsx'
import { AuthProvider } from '../src/lib/auth.tsx'
import { ROUTES } from '../src/lib/routes.ts'
import { OUTCOME_NO, OUTCOME_YES } from '../src/lib/abi.ts'
import { toWei } from '../src/lib/units.ts'
import { MarketPage } from '../src/pages/market.tsx'
import { MarketsPage } from '../src/pages/markets.tsx'
import { PortfolioPage } from '../src/pages/portfolio.tsx'
import { RulesPage } from '../src/pages/rules.tsx'

const ORIGIN = 'https://foresight.cloudsforge.online'
const at = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))

const page = (element: ReactElement, path: string): ReactElement =>
  h(MemoryRouter, { initialEntries: [path] }, h(AuthProvider, null, element) as ReactElement)

const marketAt = (path = `/markets/${fx.MARKET_ID}`) => page(h(MarketPage), path)

/** The market page's one read. */
const marketRoutes = (over: Routes = {}): Routes => ({
  'GET /auth/me': { body: fx.ME },
  [`GET /markets/${fx.MARKET_ID}`]: { body: fx.detail() },
  ...over,
})

/** The stake intent, as `foresight/src/server.ts:474-482` answers it. */
const intent = (over: Record<string, unknown> = {}) => ({
  to: fx.CONTRACT,
  data: `0x${'11'.repeat(36)}`,
  chainId: 4242,
  decisionId: 'policy-decision-1',
  ...over,
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   6.10 Group J — the player surface
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BJ-FOR — Forge Foresight', () => {
  it('BJ-FOR-01 ★ T1: the terms come before the pool, and the pool before the stake form', async () => {
    await withScreen(
      marketAt(),
      { url: `${ORIGIN}/markets/${fx.MARKET_ID}`, routes: marketRoutes() },
      async (s) => {
        const d = fx.detail()
        // Presentation relative to what the API returned in this same run.
        assert.ok(s.text().includes(d.market.question), 'the question is not on the page')
        assert.ok(s.text().includes(d.market.resolutionCriteria), 'the criteria are not on the page')

        // The order IS the argument. A stake button above the terms is a signature line above a
        // contract.
        s.before(d.market.question, 'What settles this', 'the question comes first')
        s.before('What settles this', 'Closes to new stakes', 'the criteria precede the clock')
        s.before('Closes to new stakes', 'Dispute window', 'the close precedes the dispute window')
        s.before('Dispute window', 'Stake', 'every term precedes the form')

        // Why this market exists — the provenance — is also above the form.
        s.before('Why this market exists', 'Stake', 'the provenance precedes the form')
        s.clean('BJ-FOR-01')
      },
    )
  })

  it('BJ-FOR-02 ★ T1: the disclosure is above the ratio bar, and therefore above the form', async () => {
    await withScreen(
      marketAt(),
      { url: `${ORIGIN}/markets/${fx.MARKET_ID}`, routes: marketRoutes() },
      async (s) => {
        const house = s.document.querySelector('.fs-house')
        assert.ok(house, 'the house-seed disclosure is not on the page at all')

        // Inside the pool panel, and above the bar within it.
        const bar = s.document.querySelector('.fs-pool')
        assert.ok(bar, 'there is no ratio bar to be above')
        assert.ok(
          house.compareDocumentPosition(bar) & 4 /* DOCUMENT_POSITION_FOLLOWING */,
          'the disclosure is rendered after the ratio bar. A reader who learns the composition ' +
            'of the odds after reading them has already formed a view.',
        )
        s.before(fx.seed().disclosure, 'Stake', 'and therefore above the stake form')

        // Running text at body size — a sentence in a <p>, not a chip, an icon or a title
        // attribute. A chip labelled "seeded" satisfies the letter of 21 §2 and none of it.
        const sentence = house.querySelector('p.fs-house__sentence')
        assert.ok(sentence, 'the disclosure is not a paragraph')
        assert.ok(s.textOf(sentence).length > 30, 'the disclosure is a label rather than a sentence')
      },
    )
  })

  it('BJ-FOR-03 ★ T1: the sentence is the service’s own, verbatim', async () => {
    const mine = 'CloudsForge seeded this pool with 7 EMBER, and this exact string is the test.'
    await withScreen(
      marketAt(),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        routes: marketRoutes({
          [`GET /markets/${fx.MARKET_ID}`]: {
            body: fx.detail({ houseSeed: fx.seed({ disclosure: mine }) }),
          },
        }),
      },
      async (s) => {
        const sentence = s.document.querySelector('p.fs-house__sentence')
        assert.equal(
          s.textOf(sentence),
          mine,
          'the client composed wording of its own. The platform words this once; a second ' +
            'wording here would be a second thing to keep true.',
        )
      },
    )
  })

  it('BJ-FOR-04 ★ T1: a seed that fails symmetry renders as an alert', async () => {
    // Asymmetric on the wire: 1 EMBER per outcome but 3 EMBER total. `lib/houseseed.ts` re-derives
    // the symmetry rather than believing a flag, which is what makes this reachable at all.
    const asymmetric = fx.seed({ totalWei: (3n * fx.ONE_EMBER).toString() })
    await withScreen(
      marketAt(),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        routes: marketRoutes({
          [`GET /markets/${fx.MARKET_ID}`]: { body: fx.detail({ houseSeed: asymmetric }) },
        }),
      },
      async (s) => {
        const house = s.document.querySelector('.fs-house')
        assert.ok(house)
        assert.equal(
          house.getAttribute('role'),
          'alert',
          'an asymmetric seed was announced as ordinary status. It is the page saying something ' +
            'the numbers on it do not support — the same failure as a hash mismatch.',
        )
        // Same shape as the document-hash mismatch, which is the comparison doc 22 draws.
        const hash = s.document.querySelector('.fs-hash')
        assert.ok(hash, 'the document hash line is gone')
        assert.equal(hash.getAttribute('role'), 'status', 'the hash matched, so it is not an alert')
      },
    )
  })

  it('BJ-FOR-05 T1: an explicit null disclosure renders nothing', async () => {
    await withScreen(
      marketAt(),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        routes: marketRoutes({
          [`GET /markets/${fx.MARKET_ID}`]: { body: fx.detail({ houseSeed: null }) },
        }),
      },
      async (s) => {
        assert.equal(
          s.document.querySelector('.fs-house'),
          null,
          'a market with no house money disclosed one anyway',
        )
        // And the page is otherwise whole — this is silence about one fact, not a broken render.
        assert.ok(s.text().includes(fx.market().question))
        assert.ok(s.queryByRole('button', /stake on/i), 'the rest of the page went with it')
      },
    )
  })

  it('BJ-FOR-06 T1: the share of the pool is re-derived from the pool, not repeated off the wire', async () => {
    // The wire carries a 2 EMBER seed. The pool it is in is 20 EMBER, so the share is 1000 bps.
    // Change ONLY the pool and the rendered share has to move — which it can only do if the
    // browser computed it.
    const bigger = fx.pool({
      yes: (10n * fx.ONE_EMBER).toString(),
      no: (10n * fx.ONE_EMBER).toString(),
      total: (20n * fx.ONE_EMBER).toString(),
    })
    const shareIn = async (pool: ReturnType<typeof fx.pool>): Promise<string> => {
      let captured = ''
      await withScreen(
        marketAt(),
        {
          url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
          routes: marketRoutes({
            [`GET /markets/${fx.MARKET_ID}`]: { body: fx.detail({ pool }) },
          }),
        },
        async (s) => {
          const facts = s.document.querySelector('.fs-house__facts')
          captured = s.textOf(facts)
        },
      )
      return captured
    }
    const tenEmberPool = await shareIn(fx.pool())
    const twentyEmberPool = await shareIn(bigger)
    assert.notEqual(
      tenEmberPool,
      twentyEmberPool,
      'the same seed reported the same share of two different pools, so the figure came off the ' +
        'wire rather than out of the numbers on the page',
    )
    assert.match(tenEmberPool, /20(\.0+)?\s?%/, '2 of 10 EMBER is a fifth of the pool')
    assert.match(twentyEmberPool, /10(\.0+)?\s?%/, '2 of 20 EMBER is a tenth of the pool')
  })

  it('BJ-FOR-07 ★ T2: the provenance is on the page', async () => {
    const p = fx.provenance()
    await withScreen(
      marketAt(),
      { url: `${ORIGIN}/markets/${fx.MARKET_ID}`, routes: marketRoutes() },
      async (s) => {
        // Each of the five the pipeline records so this page can show them. A page that dropped
        // them makes the whole provenance apparatus decorative.
        assert.ok(s.text().includes(p.searchQuery ?? ''), 'the search query is missing')
        assert.ok(s.text().includes(p.sources[0]?.title ?? ''), 'the source title is missing')
        assert.ok(s.text().includes(p.modelId ?? ''), 'the model id is missing')
        assert.ok(
          s.text().includes((p.promptSha256 ?? '').slice(0, 10)),
          'the prompt hash is missing',
        )
        // The source is a link somebody can open, not a bare string.
        const link = s.allByRole('link').find((el) => el.getAttribute('href') === p.sources[0]?.url)
        assert.ok(link, 'the source is rendered but not linked')
      },
    )
  })

  it('BJ-FOR-08 ★ T1: the stake panel says where the money goes', async () => {
    await withScreen(
      marketAt(),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        storage: fx.SIGNED_IN,
        routes: marketRoutes(),
        windowExtras: { ethereum: fx.fakeWallet() },
      },
      async (s) => {
        await s.settle(20)
        const panel = s.document.querySelector('.fs-stake')
        assert.ok(panel)
        const text = s.textOf(panel)
        assert.match(text, /never holds it/i, 'the panel does not say the site never holds the stake')
        assert.match(text, /cannot move it/i)
        assert.match(text, /cannot refund it/i)
        // And it names the contract, so a reader can check where it is going.
        assert.ok(
          s.text().includes(fx.CONTRACT.slice(0, 6)),
          'the contract the money goes to is not named anywhere on the page',
        )
      },
    )
  })

  it('BJ-FOR-09 ★ T1: the projection says it is a projection', async () => {
    await withScreen(
      marketAt(),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        storage: fx.SIGNED_IN,
        routes: marketRoutes(),
        windowExtras: { ethereum: fx.fakeWallet() },
      },
      async (s) => {
        await s.settle(20)
        await s.type(amountField(s), '1.5')
        const panel = s.document.querySelector('.fs-projection')
        assert.ok(panel, 'no projection was rendered for a valid amount')
        const text = s.textOf(panel)
        assert.match(
          text,
          /it is not a quote/i,
          'the projection is presented without the sentence that makes it a projection',
        )
        assert.match(text, /anybody may stake after you/i)
      },
    )
  })

  it('BJ-FOR-10 ★ T1: the transaction handed to the wallet is what was on screen', async () => {
    const wallet = fx.fakeWallet()
    const built = intent()
    await withScreen(
      marketAt(),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        storage: fx.SIGNED_IN,
        routes: marketRoutes({
          [`POST /markets/${fx.MARKET_ID}/stake-intent`]: { status: 201, body: built },
        }),
        windowExtras: { ethereum: wallet },
      },
      async (s) => {
        await s.settle(20)
        await s.type(amountField(s), '1.5')
        const button = s.byRole('button', /stake on yes/i)
        await s.click(button)
        await s.settle(20)

        // What the client SENT to the service: the amount as typed, and the outcome picked.
        const posted = s.api.matching(`POST /markets/${fx.MARKET_ID}/stake-intent`)[0]
        assert.ok(posted, 'no stake intent was requested')
        // `OUTCOME_YES = 0` and `OUTCOME_NO = 1` — the contract's own constants
        // (`src/lib/abi.ts:144-146`, `ForesightMarket.sol:59-60`). A client that read them the
        // human way round would stake every buyer on the opposite side of their own opinion.
        assert.deepEqual(posted.json, { amount: '1.5', outcome: OUTCOME_YES })

        // And what it handed the wallet — the last thing this application controls.
        const sent = wallet.calls.find((c) => c.method === 'eth_sendTransaction')
        assert.ok(sent, 'nothing was handed to the wallet')
        const tx = sent.params[0] as { to: string; data: string; value: string; from: string }
        assert.equal(tx.to, built.to, 'the transaction goes somewhere other than the intent said')
        assert.equal(
          tx.data,
          built.data,
          'the calldata was rebuilt locally. A second opinion about which outcome the user ' +
            'picked, indexed by the same policy decision id, is how the two disagree silently.',
        )
        // The value is the amount that was on screen, converted once.
        assert.equal(tx.value, `0x${(toWei('1.5') ?? 0n).toString(16)}`)
        assert.equal(tx.from, fx.STAKER)

        // The contract in the transaction is the contract the page rendered.
        assert.ok(s.text().includes(built.to.slice(0, 6)))
      },
    )
  })

  it('BJ-FOR-11 T1: a wallet rejection reads as a rejection, not as a failure', async () => {
    await withScreen(
      marketAt(),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        storage: fx.SIGNED_IN,
        routes: marketRoutes({
          [`POST /markets/${fx.MARKET_ID}/stake-intent`]: { status: 201, body: intent() },
        }),
        windowExtras: { ethereum: fx.fakeWallet({ reject: true }) },
      },
      async (s) => {
        await s.settle(20)
        await s.type(amountField(s), '1.5')
        await s.click(s.byRole('button', /stake on yes/i))
        await s.settle(20)

        assert.match(s.text(), /you declined in your wallet/i)
        assert.match(s.text(), /nothing was sent/i)
        // Not an alert: the user said no, which is not a fault and not something to escalate.
        const notes = [...s.document.querySelectorAll('.fs-stake [role="alert"]')]
        assert.deepEqual(
          notes.map((n) => s.textOf(n)),
          [],
          'declining in the wallet was announced as an error',
        )
        // And the form is armed again for another go.
        assert.ok(s.queryByRole('button', /stake on yes/i))
      },
    )
  })

  it('BJ-FOR-12 T1: with no injected provider the panel says so and offers no dead button', async () => {
    await withScreen(
      marketAt(),
      { url: `${ORIGIN}/markets/${fx.MARKET_ID}`, storage: fx.SIGNED_IN, routes: marketRoutes() },
      async (s) => {
        await s.settle(20)
        const panel = s.document.querySelector('.fs-stake')
        assert.ok(panel)
        assert.match(s.textOf(panel), /wallet/i, 'the panel does not mention the missing wallet')
        const button = s.byRole('button', /stake on/i)
        assert.ok(
          button.hasAttribute('disabled'),
          'a stake button was left clickable with no provider to hand the transaction to',
        )
        // But everything else on the page still renders: a reader with no wallet can still read
        // every market, source and pool.
        assert.ok(s.text().includes(fx.market().question))
        assert.ok(s.text().includes(fx.seed().disclosure))
      },
    )
  })

  it('BJ-FOR-13 T2: the filter set is statuses the service knows', async () => {
    await withScreen(
      page(h(MarketsPage), '/'),
      { url: `${ORIGIN}/`, routes: { 'GET /markets': { body: { markets: [fx.market()] } } } },
      async (s) => {
        const asked = s.api.matching('GET /markets')[0]
        assert.ok(asked)
        assert.match(asked.path, /status=open/, 'the default filter is not the open markets')

        // Every filter offered maps to a status the service's own list contains. A filter this
        // page offered that the service did not know would be a 400 rendered at a reader who
        // cannot act on it — the rule lives in `foresight/src/server.ts` and is cited in ownedBy.
        const KNOWN = ['open', 'closed', 'resolved', 'settled', 'void']
        const buttons = s.allByRole('button').map((el) => s.textOf(el).toLowerCase())
        const offered = buttons.filter((label) => label !== 'everything')
        assert.ok(offered.length > 0, 'no filters are offered at all')
        for (const label of offered) {
          const guessed = label === 'awaiting resolution' ? 'closed' : label
          assert.ok(
            KNOWN.includes(guessed),
            `the page offers a "${label}" filter, which is not one of the service's statuses`,
          )
        }
      },
    )
  })

  it('BJ-FOR-14 ★ T2: a portfolio by address renders with no account, and every figure carries its instant', async () => {
    await withScreen(
      page(h(PortfolioPage), `/portfolio/${fx.STAKER}`),
      {
        url: `${ORIGIN}/portfolio/${fx.STAKER}`,
        routes: {
          'GET /markets': { body: { markets: [fx.market()] } },
          [`GET /markets/${fx.MARKET_ID}/positions/${fx.STAKER}`]: {
            body: {
              marketId: fx.MARKET_ID,
              address: fx.STAKER,
              position: { yes: fx.ONE_EMBER.toString(), no: '0' },
              pool: fx.pool(),
              asOf: '2026-08-02T00:00:00.000Z',
            },
          },
        },
      },
      async (s) => {
        await s.settle(20)
        // No credential went out. A position belongs to whoever holds the key, and the mirror is
        // a copy of public chain state.
        for (const w of s.api.wire) {
          assert.equal(w.headers.authorization, undefined, `${w.path} carried a credential`)
        }
        assert.ok(s.text().includes(fx.market().question), 'the position has no market row')
        assert.match(s.text(), /observed|as of/i, 'no figure carries the instant it was observed')
      },
    )
  })

  it('BJ-FOR-14 ★ T2: a row that did not load says so instead of disappearing', async () => {
    await withScreen(
      page(h(PortfolioPage), `/portfolio/${fx.STAKER}`),
      {
        url: `${ORIGIN}/portfolio/${fx.STAKER}`,
        routes: {
          'GET /markets': { body: { markets: [fx.market()] } },
          [`GET /markets/${fx.MARKET_ID}/positions/${fx.STAKER}`]: {
            status: 503,
            body: fx.error('unavailable', 'the mirror did not answer'),
            requestId: 'req-mirror-1',
          },
        },
      },
      async (s) => {
        await s.settle(30)
        // The row is still there — a position that could not be read is not a position that is
        // not there, and a reader who sees a shorter list will conclude the second.
        assert.ok(
          s.text().includes(fx.market().question) || /could not|did not/i.test(s.text()),
          'a position that failed to load vanished without a word',
        )
        assert.match(s.text(), /could not|did not|unavailable/i)
      },
    )
  })

  it('BJ-FOR-15 T1: the mirror caveat is on the page beside the figures', async () => {
    await withScreen(
      page(h(PortfolioPage), `/portfolio/${fx.STAKER}`),
      {
        url: `${ORIGIN}/portfolio/${fx.STAKER}`,
        routes: {
          'GET /markets': { body: { markets: [fx.market()] } },
          [`GET /markets/${fx.MARKET_ID}/positions/${fx.STAKER}`]: {
            body: {
              marketId: fx.MARKET_ID,
              address: fx.STAKER,
              position: { yes: fx.ONE_EMBER.toString(), no: '0' },
              pool: fx.pool(),
              asOf: '2026-08-02T00:00:00.000Z',
            },
          },
        },
      },
      async (s) => {
        await s.settle(20)
        assert.match(
          s.text(),
          /mirror|copy of|not the record|contract/i,
          'the page presents a mirror as the record',
        )
      },
    )
  })

  it('BJ-FOR-16 T1: a resolved market offers the claim against the contract', async () => {
    await withScreen(
      marketAt(),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        storage: fx.SIGNED_IN,
        routes: marketRoutes({
          [`GET /markets/${fx.MARKET_ID}`]: {
            body: fx.detail({
              market: fx.market({
                status: 'resolved',
                outcome: 1,
                resolvedAt: '2026-08-02T12:00:00.000Z',
                closedAt: '2026-08-02T00:00:00.000Z',
              }),
            }),
          },
        }),
        windowExtras: { ethereum: fx.fakeWallet() },
      },
      async (s) => {
        await s.settle(30)
        const claim = s.document.querySelector('.fs-claim, [class*="claim" i]')
        assert.ok(claim, 'a resolved market offers no claim path')
        assert.match(
          s.text(),
          /contract/i,
          'the claim does not say it goes to the contract, which is the whole point: a dead ' +
            'mirror does not stop a claim',
        )
      },
    )
  })

  it('BJ-FOR-17 ★ T2: the refusal list renders without a token', async () => {
    await withScreen(
      page(h(RulesPage), '/rules'),
      {
        url: `${ORIGIN}/rules`,
        routes: {
          'GET /categories': {
            body: {
              version: 1,
              categories: [
                {
                  id: 'protocol_network',
                  title: 'Protocol and network',
                  description: 'Chain facts.',
                  sourceKinds: ['chain_rpc'],
                },
              ],
              refusals: [
                {
                  id: 'death',
                  reason: 'We will not run a market on whether a person dies.',
                },
              ],
            },
          },
        },
      },
      async (s) => {
        for (const w of s.api.wire) {
          assert.equal(
            w.headers.authorization,
            undefined,
            'the refusal list was fetched with a credential. A refusal list behind a token is a ' +
              'refusal list nobody can hold the platform to.',
          )
        }
        assert.match(s.text(), /We will not run a market on whether a person dies/i)
        assert.match(s.text(), /Protocol and network/i)
      },
    )
  })

  it('BJ-FOR-18 T2: /markets on its own and /markets/a/b are both nothing', async () => {
    for (const path of ['/markets', '/markets/a/b']) {
      await withScreen(marketAt(path), { url: `${ORIGIN}${path}`, routes: {} }, async (s) => {
        assert.match(s.text(), /not found|no page|does not exist/i, `${path} rendered something`)
        // And nothing was fetched for an address that names no market.
        assert.deepEqual(s.api.wire.map((w) => w.path), [], `${path} made a request`)
      })
    }
  })

  it('BJ-FOR-19 T1: a document hash mismatch renders as an alert', async () => {
    await withScreen(
      marketAt(),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        routes: marketRoutes({
          [`GET /markets/${fx.MARKET_ID}`]: {
            body: fx.detail({ market: fx.market({ questionHash: `0x${'99'.repeat(32)}` }) }),
          },
        }),
      },
      async (s) => {
        const hash = s.document.querySelector('.fs-hash')
        assert.ok(hash)
        assert.equal(
          hash.getAttribute('role'),
          'alert',
          'a hash that does not match the document was announced as ordinary status',
        )
        // Same shape as the seed symmetry failure, which is the comparison doc 22 draws.
        assert.match(hash.getAttribute('class') ?? '', /fs-hash--bad/)
      },
    )
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   6.19 Group S — the adversarial matrix
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BJ-ADV — the adversarial matrix', () => {
  it('BJ-ADV-11-H1 ★ T1: double-submitting the stake asks for one intent and sends one transaction', async () => {
    const wallet = fx.fakeWallet()
    await withScreen(
      marketAt(),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        storage: fx.SIGNED_IN,
        routes: marketRoutes({
          [`POST /markets/${fx.MARKET_ID}/stake-intent`]: { status: 201, body: intent(), delayMs: 10 },
        }),
        windowExtras: { ethereum: wallet },
      },
      async (s) => {
        await s.settle(20)
        await s.type(amountField(s), '1.5')
        const button = s.byRole('button', /stake on yes/i)

        // A real double-click is two events with a render between them, because React flushes a
        // discrete event before the next one arrives. So the first press is delivered, the tree
        // is allowed to settle, and the second press is delivered while the intent request is
        // still in flight — which is the hazard, and the only defence is the control disabling
        // itself. There is no idempotency key on this route and no server-side dedupe behind it:
        // two intents would be two policy decisions and two transactions, both mined.
        s.clickNoFlush(button)
        await s.settle(0)
        assert.ok(
          button.hasAttribute('disabled'),
          'the stake control stayed live while its own intent request was in flight',
        )
        s.clickNoFlush(button)
        await s.settle(60)

        assert.equal(
          s.api.matching(`POST /markets/${fx.MARKET_ID}/stake-intent`).length,
          1,
          'two presses produced two policy evaluations, and therefore two decision ids for one ' +
            'intent',
        )
        assert.equal(
          wallet.calls.filter((c) => c.method === 'eth_sendTransaction').length,
          1,
          'two presses handed the wallet two transactions. There is no server-side gate behind ' +
            'this: both would be mined.',
        )
      },
    )
  })

  it('BJ-ADV-11-H2 ★ T1: once the transaction is sent the form does not re-arm', async () => {
    const wallet = fx.fakeWallet()
    await withScreen(
      marketAt(),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        storage: fx.SIGNED_IN,
        routes: marketRoutes({
          [`POST /markets/${fx.MARKET_ID}/stake-intent`]: { status: 201, body: intent() },
        }),
        windowExtras: { ethereum: wallet },
      },
      async (s) => {
        await s.settle(20)
        await s.type(amountField(s), '1.5')
        await s.click(s.byRole('button', /stake on yes/i))
        await s.settle(30)

        // The form is frozen after a success — `isEditable(phase)` excludes `submitted`. Pressing
        // again cannot mint a second transaction against the same decision.
        const field = amountField(s)
        assert.ok(
          field.hasAttribute('disabled'),
          'the amount field was re-armed after the transaction went to the wallet',
        )
        const button = s.queryByRole('button', /stake on yes/i)
        if (button) await s.click(button)
        await s.settle(20)
        assert.equal(
          wallet.calls.filter((c) => c.method === 'eth_sendTransaction').length,
          1,
          'a second transaction left the browser for a settled intent',
        )
      },
    )
  })

  it('BJ-ADV-11-H4 ★ T1: a refused intent states the refusal and keeps the amount', async () => {
    await withScreen(
      marketAt(),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        storage: fx.SIGNED_IN,
        routes: marketRoutes({
          [`POST /markets/${fx.MARKET_ID}/stake-intent`]: {
            status: 403,
            body: fx.error('policy_denied', 'this account is over its daily limit'),
            requestId: 'req-policy-9',
          },
        }),
        windowExtras: { ethereum: fx.fakeWallet() },
      },
      async (s) => {
        await s.settle(20)
        await s.type(amountField(s), '1.5')
        await s.click(s.byRole('button', /stake on yes/i))
        await s.settle(30)

        const alert = s.document.querySelector('.fs-stake [role="alert"]')
        assert.ok(alert, 'a refused stake left nothing on screen')
        // The assertion is on the SENTENCE THE USER IS SHOWN, never on the refusal itself — doc
        // 22 §3.4. The rule is the service's, and it is `foresight/src/server.ts`'s test.
        assert.match(s.textOf(alert), /over its daily limit/i)
        assert.match(s.textOf(alert), /req-policy-9/, 'no request id to quote')
        // And the amount is still there. Retyping an 18-decimal figure after a refusal is how a
        // digit gets lost.
        assert.equal((amountField(s) as unknown as { value: string }).value, '1.5')
      },
    )
  })

  it('BJ-ADV-11-H6 ★ T1: a closed market offers no clickable stake control', async () => {
    await withScreen(
      marketAt(),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        storage: fx.SIGNED_IN,
        routes: marketRoutes({
          [`GET /markets/${fx.MARKET_ID}`]: {
            body: fx.detail({ market: fx.market({ status: 'closed', closedAt: '2026-08-02T00:00:00.000Z' }) }),
          },
        }),
        windowExtras: { ethereum: fx.fakeWallet() },
      },
      async (s) => {
        await s.settle(20)
        // Doc 22's H6 asks for "the control is disabled with the reason, rather than left
        // clickable into a service that will not answer". This surface goes one better and does
        // not mount the form at all — `takesStakes(market.status)` at `src/pages/market.tsx:254`
        // — which is the same rule applied harder, and the right one: a disabled Stake button on
        // a closed market reads as "not yet", and there is no yet.
        assert.equal(
          s.queryByRole('button', /stake on/i),
          null,
          'a closed market still offered a stake control',
        )
        // And the page says which phase it is in, so the absence is explained rather than felt.
        assert.match(s.text(), /awaiting resolution|closed/i)
        // Everything a reader came for is still there.
        assert.ok(s.text().includes(fx.market().question))
        assert.ok(s.text().includes(fx.seed().disclosure))
      },
    )
  })

  it('BJ-ADV-22 ★ T1: the page paints while its read is slow', async () => {
    await withScreen(
      marketAt(),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        routes: marketRoutes({
          [`GET /markets/${fx.MARKET_ID}`]: { body: fx.detail(), delayMs: 40 },
        }),
        allowEmpty: true,
      },
      async (s) => {
        assert.match(s.text(), /loading the market/i, 'the slow read is not marked pending')
        await s.settle(80)
        assert.ok(s.text().includes(fx.market().question), 'the slow read never landed')
      },
    )
  })

  it('BJ-ADV-23 ★ T1: every failure state offers a request id', async () => {
    const cases: ReadonlyArray<{ name: string; el: () => ReactElement; url: string; routes: Routes }> = [
      {
        name: 'the market read',
        el: () => marketAt(),
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        routes: marketRoutes({
          [`GET /markets/${fx.MARKET_ID}`]: {
            status: 500,
            body: fx.error('internal', 'it broke'),
            requestId: 'req-a',
          },
        }),
      },
      {
        name: 'the market list',
        el: () => page(h(MarketsPage), '/'),
        url: `${ORIGIN}/`,
        routes: {
          'GET /markets': { status: 500, body: fx.error('internal', 'it broke'), requestId: 'req-b' },
        },
      },
      {
        name: 'the rules read',
        el: () => page(h(RulesPage), '/rules'),
        url: `${ORIGIN}/rules`,
        routes: {
          'GET /categories': { status: 500, body: fx.error('internal', 'it broke'), requestId: 'req-c' },
        },
      },
    ]
    for (const c of cases) {
      await withScreen(c.el(), { url: c.url, routes: c.routes }, async (s) => {
        await s.settle(20)
        assert.match(s.text(), /req-[abc]/, `${c.name} failed without the request id to quote`)
      })
    }
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   6.20 Group T — accessibility
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BJ-A11Y — accessibility', () => {
  it('BJ-A11Y-03 ★ T1: a failure is announced and is not colour-only', async () => {
    await withScreen(
      marketAt(),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        routes: marketRoutes({
          [`GET /markets/${fx.MARKET_ID}`]: {
            status: 500,
            body: fx.error('internal', 'it broke'),
            requestId: 'req-a11y',
          },
        }),
      },
      async (s) => {
        await s.settle(20)
        const alert = s.document.querySelector('[role="alert"]')
        assert.ok(alert, 'the failure is not a live region, so it is never announced')
        assert.ok(s.textOf(alert).length > 20, 'the failure has no sentence in it')
      },
    )
  })

  it('BJ-A11Y-06 ★ T1: the disclosure precedes the stake form in TAB ORDER, and the form is keyboard-operable', async () => {
    const wallet = fx.fakeWallet()
    await withScreen(
      marketAt(),
      {
        url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
        storage: fx.SIGNED_IN,
        routes: marketRoutes({
          [`POST /markets/${fx.MARKET_ID}/stake-intent`]: { status: 201, body: intent() },
        }),
        windowExtras: { ethereum: wallet },
      },
      async (s) => {
        await s.settle(20)

        // Tab order, not visual order. A disclosure that is visually above the form and after it
        // in the tab sequence is a disclosure a keyboard user meets AFTER choosing a side.
        const order = s.tabbables()
        const house = s.document.querySelector('.fs-house')
        const stake = s.document.querySelector('.fs-stake')
        assert.ok(house && stake)
        const firstInStake = order.findIndex((el) => stake.contains(el))
        assert.ok(firstInStake >= 0, 'nothing in the stake panel is reachable by keyboard at all')
        const anyTabbableAfterHouse = order.findIndex((el) => house.contains(el))
        if (anyTabbableAfterHouse >= 0) {
          assert.ok(
            anyTabbableAfterHouse < firstInStake,
            'a control inside the disclosure comes after the stake form in tab order',
          )
        }
        // The house-seed section itself precedes the stake section in the document, which is what
        // puts everything inside it earlier in the sequence.
        assert.ok(house.compareDocumentPosition(stake) & 4)

        // And the whole commit is operable from the keyboard: side, amount, submit.
        const radios = s.allByRole('radio')
        assert.equal(radios.length, 2, 'the two outcomes are not radio inputs')
        const no = radios.find((el) => el.getAttribute('value') === String(OUTCOME_NO))
        assert.ok(no, 'the No side is not addressable by the contract’s own outcome value')
        ;(no as unknown as HTMLElement).focus()
        assert.equal(s.focused(), no, 'the outcome cannot take keyboard focus')
        // Space on a focused radio is how a keyboard user picks a side.
        await s.click(no)
        await s.type(amountField(s), '2')
        const submit = s.byRole('button', /stake on no/i)
        assert.ok(!submit.hasAttribute('disabled'), 'the commit is not reachable after a keyboard fill')
        await s.click(submit)
        await s.settle(30)
        const posted = s.api.matching(`POST /markets/${fx.MARKET_ID}/stake-intent`)[0]
        assert.deepEqual(
          posted?.json,
          { amount: '2', outcome: OUTCOME_NO },
          'the side chosen with the keyboard was not the side sent',
        )
      },
    )
  })

  it('BJ-A11Y-09 ★ T1: the house-seed panel is a live region either way', async () => {
    const roleFor = async (seed: ReturnType<typeof fx.seed> | null): Promise<string | null> => {
      let captured: string | null = null
      await withScreen(
        marketAt(),
        {
          url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
          routes: marketRoutes({
            [`GET /markets/${fx.MARKET_ID}`]: { body: fx.detail({ houseSeed: seed }) },
          }),
        },
        async (s) => {
          captured = s.document.querySelector('.fs-house')?.getAttribute('role') ?? null
        },
      )
      return captured
    }
    assert.equal(await roleFor(fx.seed()), 'status')
    assert.equal(
      await roleFor(fx.seed({ totalWei: (3n * fx.ONE_EMBER).toString() })),
      'alert',
      'a screen-reader user is not told the numbers stopped supporting the sentence',
    )
  })

  it('BJ-A11Y-10 T1: every phase and tone badge carries a word', async () => {
    await withScreen(
      marketAt(),
      { url: `${ORIGIN}/markets/${fx.MARKET_ID}`, routes: marketRoutes() },
      async (s) => {
        const badges = [...s.document.querySelectorAll('[class*="fs-phase" i], [class*="fs-note" i]')]
        assert.ok(badges.length > 0, 'the page renders no state badges at all')
        for (const badge of badges) {
          if (badge.getAttribute('aria-hidden') === 'true') continue
          assert.ok(
            s.textOf(badge).length > 0,
            `a badge rendered with no text: ${badge.outerHTML.slice(0, 120)}`,
          )
        }
      },
    )
  })

  it('BJ-A11Y-12 T1: one main landmark, a reachable skip link, no skipped heading level', async () => {
    await withScreen(
      h(App),
      { url: `${ORIGIN}/rules`, routes: { 'GET /categories': { body: { version: 1, categories: [], refusals: [] } } } },
      async (s) => {
        await s.settle(20)
        assert.equal(s.allByRole('main').length, 1)
        const skip = s.document.querySelector('a[href^="#"]')
        assert.ok(skip, 'no skip link')
        assert.ok(s.document.getElementById((skip.getAttribute('href') ?? '#').slice(1)))
        assert.equal(s.tabbables()[0], skip, 'the skip link is not first in the tab order')

        const levels = s.allByRole('heading').map((el) => Number(el.tagName.slice(1)))
        assert.equal(levels.filter((l) => l === 1).length, 1, 'a page has exactly one h1')
        let previous = 0
        for (const level of levels) {
          assert.ok(previous === 0 || level <= previous + 1, `heading order skips h${previous} → h${level}`)
          previous = level
        }
      },
    )
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   5.1 — the universal per-surface property
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('BJ-FORESIGHT-404 — an unowned address answers 404', () => {
  const directives = readFileSync(at('nginx.conf'), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')

  it('BJ-FORESIGHT-404 T2: nginx serves the shell through error_page 404, never try_files', () => {
    assert.match(directives, /error_page\s+404\s+\/index\.html/)
    assert.doesNotMatch(directives, /try_files\s+\$uri\s+(\$uri\/\s+)?\/index\.html/)
  })

  it('BJ-FORESIGHT-404 T2: the not-found screen renders inside the shell', async () => {
    await withScreen(h(App), { url: `${ORIGIN}/nothing-here`, routes: {} }, async (s) => {
      assert.match(s.text(), /not found|no page|does not exist/i)
      assert.ok(s.allByRole('link').length > 0, 'the not-found screen strands the reader')
      assert.ok(!ROUTES.map((r) => r.path).includes('nothing-here'))
    })
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   The meta-test. Doc 22 §3.2.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('the catalogue and this file agree', () => {
  it('every id doc 22 assigns to this surface is accounted for exactly once', () => {
    const ids = SCENARIOS.map((s) => s.id)
    assert.deepEqual([...new Set(ids)].sort(), [...ids].sort(), 'an id appears twice')
    assert.deepEqual([...ids].sort(), [...DOC22_IDS].sort())
  })

  it('a scenario whose outcome depends on a server rule carries an ownedBy path', () => {
    const REFUSAL = /\b(refus|denie|denial|reject|400|403|409|4xx)\w*/i
    for (const s of SCENARIOS) {
      if (s.blocked) continue
      if (!REFUSAL.test(s.what)) continue
      assert.ok(
        s.ownedBy,
        `${s.id} turns on a server-side refusal and names no test that owns it. Doc 22 §3.2.`,
      )
      assert.match(s.ownedBy.path, /^[a-z-]+\/src\/[\w./-]+\.ts$/)
    }
  })

  it('no scenario is marked implemented without a test named for it', () => {
    const source = readFileSync(at('test/journeys.test.ts'), 'utf8')
    for (const s of SCENARIOS) {
      if (s.blocked) continue
      assert.ok(
        new RegExp(`it\\('${s.id}[ ★]`).test(source),
        `${s.id} is in the catalogue as implemented and has no test named for it`,
      )
    }
  })

  it('every blocked scenario names its blocker and no blocker is a shrug', () => {
    for (const s of SCENARIOS) {
      if (!s.blocked) continue
      assert.ok(s.blocked.length > 60, `${s.id}'s blocker is too short to be a reason`)
      assert.ok(
        /doc 22|§|does not exist|no UI|tier 3|micro-beacon|not installed/i.test(s.blocked),
        `${s.id}'s blocker does not name a fact about the estate: ${s.blocked}`,
      )
    }
  })

  it('nothing here is tier 3 and implemented — tier 3 lives in micro-beacon', () => {
    for (const s of SCENARIOS) {
      if (s.tier !== 'T3') continue
      assert.ok(s.blocked, `${s.id} is tier 3 and not blocked; doc 22 §4 puts tier 3 in beacon`)
    }
  })
})

/* ── helpers ────────────────────────────────────────────────────────────────────────────────── */

/** The stake amount field: the one text input inside the stake panel. */
function amountField(s: Screen): Element {
  const field = s.document.querySelector('.fs-stake input[type="text"]')
  assert.ok(field, 'the stake panel has no amount field')
  return field
}
