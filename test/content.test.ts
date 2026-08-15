/**
 * COPY THAT COUNTS — OR NAMES — SOMETHING THIS APP DOES NOT HOLD.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `docs/ecosystem/32-roadmap-ui-and-content.md` §1.1 states the estate's rule for a figure on a
 * page: "No number goes on a page that is not checkable against something real. A figure is
 * admissible if it is read at runtime out of a response the page has already fetched, or if a test
 * binds it to the source constant it describes."
 *
 * §4.3 records this application breaking it. `src/pages/markets.tsx` said "Seven currencies and
 * every token minted on the platform are accepted", one card below a lede that names six by name —
 * Bitcoin, Ethereum, Litecoin, Solana, XRP and EMBER. The seventh was only reachable by counting
 * SHARD, and SHARD is retired: `isRetiredAsset` (`contracts/packages/chain/src/index.ts`) reports
 * it retired, and `foresight/src/stakeassets.ts` refuses it in `parseStakeAssetCode` before it can
 * ever appear in a `GET /stake-assets` body. So the numeral was not merely fragile — it was
 * already wrong, and nothing on the page could have said so.
 *
 * ── Why this is a scan over the source and not an assertion about one sentence ────────────────
 *
 * The sentence is fixed. What this file defends is the SHAPE: a hand-maintained count of a set the
 * service owns. The registry behind `GET /stake-assets` gains and loses rows in another repository
 * entirely (`foresight/src/stakeassets.ts`), so any count typed into this bundle is a claim that
 * goes stale on a commit that never opens this file — which is precisely how "Seven" survived. An
 * assertion pinned to the old wording would pass forever and protect nothing the day somebody
 * writes "Eight currencies" a paragraph further down.
 *
 * The admissible replacements are both still available and neither is forbidden here: enumerate a
 * fetched response (as `src/components/custodialstake.tsx` does, rendering exactly the assets the
 * registry returned), or point at that list in prose without restating its length, which is what
 * `markets.tsx` now does.
 *
 * ── AND THE SECOND HALF OF THE SAME DEFECT, FOUND ON 2026-08-09 ────────────────────────────────
 *
 * Deleting the numeral fixed the arithmetic and left behind the thing it was counting. Both pages
 * went on naming the currencies one by one — `markets.tsx`'s lede said "Bitcoin, Ethereum,
 * Litecoin, Solana, XRP, EMBER" and `market.tsx`'s pool note said "bitcoin, ether, litecoin,
 * solana, XRP, EMBER" — and `foresight`'s `stake_assets` registry has never held a row for SOL or
 * for XRP. Its seed is EMBER, BTC, ETH, LTC and one USDT urn (`foresight/src/migrations.ts`), and
 * a missing row is a **404 `unknown_asset`** from the quote route (`foresight/src/server.ts`). So
 * a reader who arrived with XRP because this page named XRP was refused by name.
 *
 * On `market.tsx` it was worse than stale: `CustodialStakePanel` fetches the registry and renders
 * it a few hundred pixels below that paragraph, so one page carried a typed list and a measured
 * list, disagreeing, with the typed one read first.
 *
 * A count and a roll-call are one defect wearing two hats — a hand-kept copy of a set another
 * repository owns — so the guard is one file and the second scan is built like the first: on the
 * SHAPE, not on the wording. `COIN_LIST` fires on three or more currency names close together,
 * which is what a roll-call is. Two is left alone deliberately: `markets.tsx` argues "Bitcoin and
 * Litecoin have no contract that could hold a pot", which names two accepted assets to make a
 * point about custody rather than to make an offer, and a rule that forbade it would be a rule
 * somebody relaxes.
 *
 * **The pressure this defends against is live.** micro-contracts `c0e7c77` added DOGE and ETC to
 * the asset union, and appending two more coins to a lede is the natural next move. It would be
 * wrong twice: the registry has no row for either, and the estate follows neither chain — no DOGE
 * or ETC deposit has ever been credited at any depth (`contracts/packages/chain/src/index.ts`).
 * Nameable by the platform and accepted at the door are different facts.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const root = fileURLToPath(new URL('..', import.meta.url))

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (['.ts', '.tsx'].includes(extname(entry.name))) out.push(full)
  }
  return out
}

/**
 * A source file with its prose removed.
 *
 * The comment block at the top of this file quotes the forbidden phrase four times in order to
 * explain why it is forbidden, and so does the JSX comment in `markets.tsx` that records the fix.
 * A scan of the raw text would fail the two files that are most careful about the rule, and a rule
 * that can only be satisfied by deleting its own explanation is a rule somebody deletes. Same
 * countermeasure `devportal-web/test/render.test.ts` uses, and for the same reason.
 *
 * Line comments are matched at the start of a line only, so a `https://` inside JSX survives.
 */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n')
}

const FILES = sourceFiles(join(root, 'src')).map((path) => ({
  name: relative(root, path),
  code: codeOf(readFileSync(path, 'utf8')),
}))

const HTML = readFileSync(join(root, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')

/**
 * A quantity written as a word or as digits.
 *
 * "a" and "an" are deliberately absent: "a currency" is an article, not a count, and including
 * them would make this scan fire on ordinary English and therefore get relaxed.
 */
const COUNT = String.raw`(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|\d+)`

/** The nouns whose membership is decided by `GET /stake-assets`, not by this bundle. */
const COUNTED_NOUN = String.raw`(?:currenc(?:y|ies)|coins?|assets?|tokens?)`

const COUNTED_CLAIM = new RegExp(String.raw`\b${COUNT}\s+(?:\w+\s+)?${COUNTED_NOUN}\b`, 'i')

/**
 * The currencies by name, as copy writes them.
 *
 * `EMBER` is deliberately absent, and it is the one name that may be typed anywhere: it is the
 * pool's unit rather than a member of the registry, every payout on this surface is denominated in
 * it, and `POOL_ASSET` in `foresight/src/stakeassets.ts` is a constant rather than a row. Nothing
 * about it can go stale when `stake_assets` changes.
 *
 * `ether` and `bitcoin` are matched in lower case too, because that is how `market.tsx` wrote them
 * — a scan that only saw the capitalised forms would have passed the exact sentence that prompted
 * this. `ether` must not also match `Ethereum`, which is why the alternation puts the longer form
 * first and the boundary is a word boundary.
 */
const COIN_NAME =
  /\b(?:bitcoin|ethereum|ether|litecoin|solana|ripple|xrp|dogecoin|doge|ethereum classic|btc|eth|etc|ltc|sol|doge)\b/gi

/**
 * A ROLL-CALL: three or more currency names inside one 200-character stretch.
 *
 * Three, not two. A sentence naming two coins is making an argument — "Bitcoin and Litecoin have
 * no contract that could hold a pot" is about custody, and both of those ARE accepted — whereas
 * three in a row is a list, and a list of a set this bundle does not own is the defect. The window
 * is a distance rather than a sentence because the roll-calls that shipped ran across a JSX line
 * break, so a `.`-delimited split would have seen three fragments of one and none of them.
 */
function rollCallIn(code: string): string | null {
  const hits = [...code.matchAll(COIN_NAME)]
  for (let i = 0; i + 2 < hits.length; i++) {
    const first = hits[i]
    const third = hits[i + 2]
    if (first === undefined || third === undefined) continue
    if (third.index - first.index <= 200) {
      return code.slice(first.index, third.index + third[0].length).replace(/\s+/g, ' ')
    }
  }
  return null
}

describe('the scan can see the source at all', () => {
  it('found the tree', () => {
    // A scan over an empty list passes for the wrong reason, which is the one way every assertion
    // below could silently stop protecting anything.
    assert.ok(FILES.length >= 15, `expected the source tree, found ${FILES.length} files`)
  })

  it('and the comment stripping left the code behind', () => {
    const total = FILES.reduce((sum, file) => sum + file.code.length, 0)
    assert.ok(total > 10_000, `stripping left only ${total} characters; the extractor is broken`)
  })

  it('and it would catch the sentence it was written for', () => {
    // The guard on the guard. If this pattern ever stops matching the original defect, every
    // assertion below is green for no reason.
    assert.match(
      'Seven currencies and every token minted on the platform are accepted.',
      COUNTED_CLAIM,
    )
    assert.match('We accept 7 currencies.', COUNTED_CLAIM)
    assert.match('Eight coins are supported.', COUNTED_CLAIM)
    assert.match('Six stake assets are enabled.', COUNTED_CLAIM)
    // And that it does not fire on ordinary English, which is what would get it relaxed.
    assert.doesNotMatch('Bring the coin you already hold', COUNTED_CLAIM)
    assert.doesNotMatch('every token minted on the platform is accepted', COUNTED_CLAIM)
    assert.doesNotMatch('any token launched on CloudsForge', COUNTED_CLAIM)
  })

  it('and it would catch the roll-call the count was counting', () => {
    // The guard on the second guard, written against the two sentences that actually shipped —
    // both of them, verbatim, including the lower-case one, because a scan tuned to the capitalised
    // form would have let `market.tsx` through.
    assert.ok(
      rollCallIn('Take a side with Bitcoin, Ethereum, Litecoin, Solana, XRP, EMBER or any token'),
      'the markets lede that shipped is not caught',
    )
    assert.ok(
      rollCallIn('whichever currency they arrived with — bitcoin, ether, litecoin, solana, XRP'),
      'the market pool note that shipped is not caught',
    )
    assert.ok(rollCallIn('BTC, ETH and LTC are accepted'), 'the code forms are not caught')
    // And the two things that must stay sayable, or this rule gets relaxed rather than obeyed.
    assert.equal(
      rollCallIn('Bitcoin and Litecoin have no contract that could hold a pot'),
      null,
      'an argument naming two assets is not a roll-call, and forbidding it would get this deleted',
    )
    assert.equal(rollCallIn('Take a side with the coin you already hold'), null)
    assert.equal(rollCallIn('your position, your odds and your payout are all counted in EMBER'), null)
  })
})

describe('no screen counts the currencies a bettor may bring', () => {
  for (const file of FILES) {
    it(`${file.name} states no count of accepted currencies`, () => {
      assert.doesNotMatch(
        file.code,
        COUNTED_CLAIM,
        `${file.name} counts the accepted currencies. The set is the service's ` +
          '(`GET /stake-assets`), it has already been counted wrong once — "Seven" included ' +
          'SHARD, which `isRetiredAsset` refuses — and a count typed here goes stale on a commit ' +
          'in another repository. Enumerate the fetched registry, or name it without its length.',
      )
    })
  }

  it('index.html, which is where a crawler reads the product, counts nothing either', () => {
    assert.doesNotMatch(HTML, COUNTED_CLAIM, 'index.html counts the accepted currencies')
  })
})

describe('nor does any screen name them one by one', () => {
  for (const file of FILES) {
    it(`${file.name} names no roll-call of currencies`, () => {
      const found = rollCallIn(file.code)
      assert.equal(
        found,
        null,
        `${file.name} lists the accepted currencies by name: "${found}". The set is the ` +
          "service's (`GET /stake-assets`), and the list typed here has already been wrong — it " +
          'named SOL and XRP, for which `stake_assets` has never held a row, so the quote route ' +
          'answered 404 unknown_asset to a reader this page had invited by name. Enumerate the ' +
          'fetched registry, or say "the coin you already hold" and let the panel name them.',
      )
    })
  }

  it('index.html names none either, because a crawler reads it before any fetch has happened', () => {
    const found = rollCallIn(HTML)
    assert.equal(found, null, `index.html lists the accepted currencies by name: "${found}"`)
  })
})

describe('the browse page points at the registry instead of restating its length', () => {
  const markets = FILES.find((f) => f.name.endsWith(`pages${'/'}markets.tsx`))

  it('the page is where this test thinks it is', () => {
    assert.ok(markets, 'src/pages/markets.tsx was not found; this whole file is checking nothing')
  })

  /*
   * The claim moved out of a card and into the folded primer when the browse page became a board
   * (`pages/markets.tsx`), and it was shortened on the way. What is asserted is the INVARIANT, not
   * the old sentence: the page must point at the market page as the place the accepted set is
   * enumerated, and must not enumerate or count it here. A regex over the whole line rather than
   * the exact wording, so a copy edit that keeps the pointer does not fail this.
   */
  it('the primer names the list rather than its size', () => {
    assert.match(
      markets?.code ?? '',
      /a market page lists is accepted/,
      'the "bring the coin you already hold" entry no longer names where the list lives. It must ' +
        'point at the market page, whose `CustodialStakePanel` renders the fetched registry — a ' +
        'set restated by hand here has already shipped wrong twice.',
    )
  })

  it('and the list it names is one this estate actually renders from a response', () => {
    // The claim above is only honest while some screen enumerates the fetched registry. That
    // screen is the custodial stake panel, mounted from the market page: it renders the enabled
    // assets in its "Pay with" select and the refused ones, with each reason, beneath it.
    const panel = FILES.find((f) => f.name.endsWith(`components${'/'}custodialstake.tsx`))
    assert.ok(panel, 'src/components/custodialstake.tsx was not found')
    assert.match(panel.code, /getStakeAssets\(\)/, 'the panel no longer fetches the registry')
    assert.match(panel.code, /enabled\.map\(/, 'the panel no longer enumerates the accepted assets')
    assert.match(panel.code, /blocked\.map\(/, 'the panel no longer enumerates the refused assets')
    const market = FILES.find((f) => f.name.endsWith(`pages${'/'}market.tsx`))
    assert.match(
      market?.code ?? '',
      /<CustodialStakePanel/,
      'the market page no longer mounts the panel, so no market page lists the currencies',
    )
  })
})
