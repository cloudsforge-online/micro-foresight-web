/**
 * THE MARKET PAGE RENDERS THE HOUSE SEED DISCLOSURE — docs/ecosystem/21 §7.6, presence with force.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **WHY A TEST OF THE API RESPONSE IS NOT THIS TEST.**
 *
 * `foresight/src/houseseed.test.ts:429` already asserts, with force, that `GET /markets/:id`
 * SERVES the disclosure whenever a house stake exists. That test passed while this application
 * rendered nothing at all, because serving a field and showing it are two different claims and
 * only the second one is the property §7.6 states:
 *
 *   > 6. The foresight market page **renders** the house seed disclosure whenever a house stake
 *   >    exists — asserted the way admin-web asserts its missing og card: presence with force.
 *
 * A bettor cannot read a JSON body. The house seed is symmetric, at-open-only and
 * trigger-enforced precisely so that it CAN be disclosed rather than hidden (21 §5), which makes
 * the disclosure the load-bearing one: an undisclosed house position would make the other four
 * properties pointless, because every one of them is something the reader is asked to take on
 * trust *because* the position is disclosed. 21 §2 calls the alternative what it is: "invisible
 * house positions — is refused outright … it is fraud."
 *
 * **SO THIS TEST RENDERS THE PAGE.** `renderToStaticMarkup` over the real `MarketArticle`, from a
 * real `MarketDetail`, and greps the HTML that a browser would be handed.
 *
 * ── There is still no DOM in this suite ────────────────────────────────────────────────────────
 *
 * `test/browser-stubs.ts` states the rule: "There is no DOM in this suite on purpose: jsdom is a
 * second browser implementation to keep current … a test that renders a component in it proves
 * the component renders in jsdom." That rule is kept. `react-dom/server` is not a DOM: it is
 * React's own string renderer, it ships in the dependency this app already has, it runs no
 * effect and touches no global, and what it produces is markup rather than a simulated document.
 * What it proves is exactly the claim under test — that the sentence is in the bytes the reader's
 * browser receives — and nothing beyond it.
 *
 * ── And it renders the WHOLE ARTICLE, not the panel ────────────────────────────────────────────
 *
 * `HouseSeedNotice` is mounted from one line in `pages/market.tsx`. A test that constructed the
 * panel directly would prove the panel works and would keep passing on the day that line was
 * deleted in a refactor — which is the exact regression this file exists to catch. So the unit
 * under test is the page.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../src/lib/auth.tsx'
import { MarketArticle } from '../src/pages/market.tsx'
import { houseDisclosureOf } from '../src/lib/houseseed.ts'
import type { HouseSeedView, MarketDetail, MarketView, PoolView } from '../src/lib/foresight.ts'
import { keccak256Utf8 } from '../src/lib/keccak.ts'

/** `canonicalDocument` — `foresight/src/questiondoc.ts:66-80`, as `market.test.ts` reproduces it. */
function canonical(fields: readonly string[]): string {
  const field = (value: string): string => `${new TextEncoder().encode(value).length}:${value}`
  return ['cloudsforge.foresight.market/1', ...fields].map(field).join('')
}

const DOC = canonical([
  'Will block 21,000,000 be reached by 2026-12-31?',
  'YES if the chain reports a block at height 21,000,000 or above.',
  'protocol_network',
  '1',
  'chain_rpc',
  'https://rpc.hearth.example/',
  '1798761600',
  '86400',
  '500',
])

const ONE_EMBER = 1_000_000_000_000_000_000n

const HOUSE = '0x00112233445566778899aabbccddeeff00112233'

function market(over: Partial<MarketView> = {}): MarketView {
  return {
    id: 'm-1',
    status: 'open',
    question: 'Will block 21,000,000 be reached by 2026-12-31?',
    resolutionCriteria: 'YES if the chain reports a block at height 21,000,000 or above.',
    category: 'protocol_network',
    categoryVersion: 1,
    resolutionSourceKind: 'chain_rpc',
    resolutionSourceRef: 'https://rpc.hearth.example/',
    questionHash: keccak256Utf8(DOC),
    closeTime: '2099-09-01T00:00:00.000Z',
    disputeWindowSeconds: 86_400,
    feeBps: 500,
    chain: 'hearth',
    network: 'testnet',
    contractAddress: '0x44556677889900aabbccddeeff00112233445566',
    outcome: null,
    voidReason: null,
    openedAt: '2026-08-01T00:00:00.000Z',
    closedAt: null,
    resolvedAt: null,
    settledAt: null,
    voidedAt: null,
    ...over,
  }
}

/** A pool holding the 2 EMBER seed plus 8 EMBER of other people's money — the house is a fifth. */
function pool(over: Partial<PoolView> = {}): PoolView {
  return {
    yes: (5n * ONE_EMBER).toString(),
    no: (5n * ONE_EMBER).toString(),
    total: (10n * ONE_EMBER).toString(),
    yesBps: 5_000,
    noBps: 5_000,
    stakerCount: 4,
    asOf: '2026-08-02T00:00:00.000Z',
    lastBlock: 900,
    tipBlock: 901,
    behindBlocks: 1,
    stale: false,
    ...over,
  }
}

/** `houseSeedView` — `foresight/src/houseseed.ts:230-243`, field for field. */
function seed(over: Partial<HouseSeedView> = {}): HouseSeedView {
  return {
    state: 'staked',
    houseAddress: HOUSE,
    amountPerOutcomeWei: ONE_EMBER.toString(),
    totalWei: (2n * ONE_EMBER).toString(),
    asset: 'EMBER',
    stakedAt: '2026-08-01T00:00:00.000Z',
    txHashYes: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    txHashNo: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    disclosure: 'CloudsForge seeded this pool with 2 EMBER so early odds exist.',
    ...over,
  }
}

function detail(over: Partial<MarketDetail> = {}): MarketDetail {
  return {
    market: market(),
    pool: pool(),
    houseSeed: seed(),
    document: { canonical: DOC, hash: keccak256Utf8(DOC) },
    provenance: null,
    ...over,
  }
}

/**
 * The page, as bytes.
 *
 * The two wrappers are the ones `app.tsx` puts above every route and are not test scaffolding:
 * the crumb is a `<Link>` and needs a router, and `StakePanel` reads `useSession`, which throws
 * outside a provider by design ("returning a signed-out default … would show an anonymous UI to
 * a signed-in user and nobody would ever see why" — `lib/auth.tsx`). Rendering under both is what
 * makes this the page rather than a fragment of it. No effect runs under `renderToStaticMarkup`,
 * so neither wrapper reaches the network.
 */
function render(value: MarketDetail): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [`/markets/${value.market.id}`] },
      createElement(
        AuthProvider,
        null,
        createElement(MarketArticle, { detail: value, reload: () => undefined }),
      ),
    ),
  )
}

/**
 * Just the disclosure panel's markup, for assertions that must not be satisfied by the rest of
 * the page. `'0 EMBER'` is the reason this exists: it is a substring of the pool's own
 * `'10 EMBER'` total, so "the seed did not render as zero" is only a real assertion when it is
 * asked of the seed. The panel contains no nested `<section>`, so the first close is its own.
 */
function houseSectionOf(html: string): string {
  const start = html.indexOf('<section class="fs-house')
  if (start === -1) return ''
  const end = html.indexOf('</section>', start)
  return html.slice(start, end === -1 ? undefined : end + '</section>'.length)
}

/** Markup carries `&#x27;` and friends; the assertions are about words, so normalise first. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

describe('§7.6 — the disclosure, on the page, with force', () => {
  it('THE MARKET PAGE RENDERS THE HOUSE SEED DISCLOSURE WHENEVER A HOUSE STAKE EXISTS', () => {
    const html = render(detail())
    const text = textOf(html)

    // PRESENCE WITH FORCE. Not "if rendered, then correct" — rendered, or this test fails the
    // build. This is the assertion 21 §7.6 asks for, and it is the one that was missing.
    assert.ok(
      text.includes('CloudsForge seeded this pool with 2 EMBER so early odds exist.'),
      'the market page must RENDER the house seed disclosure whenever a house stake exists ' +
        `(21 §7.6) — the sentence is not in the markup:\n${text}`,
    )
  })

  it('the sentence is the service’s own, rendered verbatim', () => {
    // `houseSeedView` composes it once so every client says the same thing (houseseed.ts:213-218).
    // A page that reworded it would be a page whose disclosure the platform did not write.
    const wording = 'CloudsForge seeded this pool with 17.5 EMBER so early odds exist.'
    const text = textOf(
      render(
        detail({
          houseSeed: seed({
            amountPerOutcomeWei: (8_750_000_000_000_000_000n).toString(),
            totalWei: (17_500_000_000_000_000_000n).toString(),
            disclosure: wording,
          }),
        }),
      ),
    )
    assert.ok(text.includes(wording), `the service's sentence must be rendered as sent:\n${text}`)
  })

  it('the disclosure is rendered BEFORE the odds it explains', () => {
    // The page's ordering is its argument (see `pages/market.tsx`). A reader who learns that part
    // of the pool is the platform's only after reading the split has already formed a view from a
    // figure whose composition they were not given — and the stake form is further down still.
    const html = render(detail())
    const disclosure = html.indexOf('so early odds exist')
    const bar = html.indexOf('fs-bar')
    const stake = html.indexOf('fs-stake')
    assert.ok(disclosure >= 0 && bar >= 0, 'both the disclosure and the ratio bar must render')
    assert.ok(disclosure < bar, 'the disclosure must come before the pool ratio bar')
    if (stake >= 0) assert.ok(disclosure < stake, 'the disclosure must come before the stake form')
  })

  it('the evidence renders: the platform address and both transaction hashes', () => {
    // 21 §3 — the platform's addresses are "published … disclosed, not discovered". The panel
    // carries the address and the two ordinary `stake(uint8)` transactions behind the seed, so a
    // reader can check the claim against a chain rather than against this page.
    const html = render(detail())
    assert.ok(html.includes(HOUSE), 'the house address must be rendered (it is in the title attr)')
    assert.ok(
      html.includes('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      'the YES transaction hash must be rendered',
    )
    assert.ok(
      html.includes('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
      'the NO transaction hash must be rendered',
    )
  })

  it('the share of the pool is computed here and shown — 2 of 10 EMBER is 20%', () => {
    // The one figure on the panel that exists nowhere on the wire, because only the client holds
    // both halves. It is what tells a reader how much of the odds above is the platform's money.
    const text = textOf(render(detail()))
    assert.ok(text.includes('Share of everything staked'), 'the share must be labelled')
    assert.ok(text.includes('20.0%'), `the house's share of the pool must be shown:\n${text}`)
  })

  it('an unseeded market renders no disclosure at all', () => {
    // The other direction, and it matters as much: a disclosure on a market the platform is not
    // in would be a false statement about the platform, and it would also make the assertion
    // above pass for a page that simply always prints the sentence.
    const text = textOf(render(detail({ houseSeed: null })))
    assert.ok(!text.includes('so early odds exist'), 'an unseeded market must not claim a seed')
    assert.ok(!text.includes('The platform has staked in this pool'), 'nor carry the heading')
    // And the rest of the page is untouched — the seed machinery is invisible to a market
    // without one, which is the same property `houseseed.test.ts` asserts on the service side.
    assert.ok(text.includes('Pool split'), 'the pool still renders')
  })

  it('a planned seed says so, and claims no share of a pool it is not in', () => {
    const text = textOf(
      render(
        detail({
          market: market({ status: 'approved', openedAt: null }),
          houseSeed: seed({ state: 'planned', stakedAt: null, txHashYes: null, txHashNo: null }),
        }),
      ),
    )
    assert.ok(text.includes('The platform will stake in this pool'), 'a planned seed is not a stake')
    assert.ok(
      text.includes('not in the pool yet'),
      `a planned seed has no share of the pool, and 0% would be a lie:\n${text}`,
    )
  })

  it('a seed the numbers do not support renders an alarm, not a quiet sentence', () => {
    // Symmetry is what "the house expresses no opinion" means, and it is the one claim on this
    // panel a browser can settle by itself. Rendering the platform's sentence over numbers that
    // contradict it is the same failure as printing a document hash the document does not have.
    const text = textOf(
      render(
        detail({
          houseSeed: seed({
            amountPerOutcomeWei: ONE_EMBER.toString(),
            // Three EMBER total against one per side: somebody's seed is lopsided.
            totalWei: (3n * ONE_EMBER).toString(),
          }),
        }),
      ),
    )
    assert.ok(text.includes('is not symmetric'), `a lopsided seed must be called out:\n${text}`)
    assert.ok(text.includes('Do not stake on this market until that is explained'))
  })

  it('a malformed field degrades the figures, never the disclosure', () => {
    // The rule in `lib/houseseed.ts`: a seed that exists always produces a disclosure. Absence is
    // the one degradation that would itself be a claim — a market page with no disclosure tells
    // every reader the platform has no position in it.
    const html = render(
      detail({
        houseSeed: seed({
          // Everything a strict client would refuse: no sentence, no amounts, no evidence.
          disclosure: '',
          amountPerOutcomeWei: '',
          totalWei: 'not-a-number',
          txHashYes: null,
          txHashNo: null,
          stakedAt: null,
        }),
      }),
    )
    const panel = textOf(houseSectionOf(html))
    assert.ok(
      panel.includes('CloudsForge holds a position in this pool.'),
      `the fact must survive every field being unreadable:\n${panel}`,
    )
    // And `BigInt('')` is `0n`, which is why the amounts go through `fromWeiString` and not
    // through the constructor: an empty string must read as "not known", never as a free seed.
    assert.ok(!panel.includes('EMBER'), `an unreadable amount must not render as a figure:\n${panel}`)
    assert.ok(panel.includes('not known'), 'an unreadable amount reads as unknown')
  })
})

describe('houseDisclosureOf — the arithmetic behind the panel', () => {
  const pools = { yes: 5n * ONE_EMBER, no: 5n * ONE_EMBER }

  it('null only when there is no seed', () => {
    assert.equal(houseDisclosureOf({ houseSeed: null }, pools), null)
    assert.notEqual(houseDisclosureOf({ houseSeed: seed() }, pools), null)
  })

  it('checks symmetry rather than repeating it', () => {
    assert.equal(houseDisclosureOf({ houseSeed: seed() }, pools)?.symmetric, true)
    const lopsided = seed({ totalWei: (3n * ONE_EMBER).toString() })
    assert.equal(houseDisclosureOf({ houseSeed: lopsided }, pools)?.symmetric, false)
    // Unreadable is not asymmetric. `false` here would accuse the platform on a failed parse.
    const unreadable = seed({ totalWei: '' })
    assert.equal(houseDisclosureOf({ houseSeed: unreadable }, pools)?.symmetric, null)
  })

  it('a share of an unknown pool is unknown, never zero', () => {
    assert.equal(houseDisclosureOf({ houseSeed: seed() }, { yes: null, no: 5n })?.shareBps, null)
    assert.equal(houseDisclosureOf({ houseSeed: seed() }, { yes: 0n, no: 0n })?.shareBps, null)
  })

  it('a house share larger than the pool is a mirror to distrust, not a figure to print', () => {
    // The seed is IN the pool it is divided by, so this cannot happen on chain. If it arrives,
    // the two numbers came from different moments and no percentage of them means anything.
    const small = { yes: ONE_EMBER / 2n, no: ONE_EMBER / 2n }
    assert.equal(houseDisclosureOf({ houseSeed: seed() }, small)?.shareBps, null)
  })

  it('an unrecognised state is treated as staked, not as an intention', () => {
    const odd = { ...seed(), state: 'settled' as unknown as 'staked' }
    assert.equal(houseDisclosureOf({ houseSeed: odd }, pools)?.state, 'staked')
  })
})
