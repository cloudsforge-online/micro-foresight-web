/**
 * COPY THAT COUNTS SOMETHING THIS APP DOES NOT HOLD.
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

describe('the browse page points at the registry instead of restating its length', () => {
  const markets = FILES.find((f) => f.name.endsWith(`pages${'/'}markets.tsx`))

  it('the page is where this test thinks it is', () => {
    assert.ok(markets, 'src/pages/markets.tsx was not found; this whole file is checking nothing')
  })

  it('the card names the list rather than its size', () => {
    assert.match(
      markets?.code ?? '',
      /The currencies listed on any market page are accepted/,
      'the "bring the coin you already hold" card no longer names where the list lives',
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
