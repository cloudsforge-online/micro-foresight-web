/**
 * THE TWO GRID DEFECTS THIS PAGE SHIPPED, AND WHY A SOURCE SCAN IS THE RIGHT GUARD FOR BOTH.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **1. A ROW OF ONE, ON EVERY DESKTOP THERE IS.**
 *
 * `markets.tsx` states four things a stranger needs before the first market, in a `<ul>` that
 * carried plain `.fs-rules` — `repeat(auto-fill, minmax(300px, 1fr))`. `.fs-main` is
 * `min(100vw, --cf-max-w) − 2 × --cf-space-xl`, so the widest that grid is ever offered is
 * 1168px, and three 300px tracks plus two 16px gaps is 932px while four is 1248px. Three columns
 * was therefore not the answer at one unlucky window size; it was the answer at 1024px and at
 * every width above it, for ever. Four tiles in three columns is three and then one, and a row of
 * one immediately above the markets reads as a tile that failed to load.
 *
 * Measured in headless Chrome against this stylesheet, before the fix: rows `[3, 1]` at container
 * widths 992, 1068 and 1168 — i.e. at viewports 1024, 1100, 1280 and 1440.
 *
 * **No `minmax()` floor could have fixed it, and that is arithmetic rather than taste.** With four
 * items the orphan-free column counts are 1, 2 and 4. `auto-fit` and `auto-fill` produce a
 * MONOTONE count — as the container grows it goes 1, 2, 3, 4 — and three columns fit strictly more
 * easily than four, so no floor value admits four while skipping three. Every possible
 * `repeat(auto-fit, minmax(<n>rem, 1fr))` has a band of widths that orphans; the only thing the
 * floor chooses is which band, and with the measure capped at 1168px the band that matters is the
 * whole desktop. So `.fs-rules--primer` names the counts — 1 → 2 → 4 — and a container query says
 * when.
 *
 * **2. A 300px FLOOR IN A 288px PAGE.**
 *
 * `minmax(300px, 1fr)` and `minmax(320px, 1fr)` are floors the track cannot go under even when the
 * container is narrower than the floor. At a 320px viewport `.fs-page` is 288px wide, and both
 * grids laid out tracks wider than that: the whole document scrolled sideways on the narrowest
 * phones still sold. `min(100%, 300px)` states the floor as an intent rather than as a promise the
 * box cannot keep.
 *
 * ── WHY THIS FILE SCANS THE SOURCE ────────────────────────────────────────────────────────────
 *
 * Neither defect is reachable from this suite by rendering. `happy-dom` has no layout engine — it
 * resolves no grid, gives every element a zero rect, and would report both the orphan row and the
 * overflow as passing. The facts that decide both are STATIC and they are all in two files: how
 * many `<li>` the primer holds, and what the column tracks are. So the invariant is asserted where
 * it lives, and the rendered result was checked in a real engine once, by hand, at 320, 390, 480,
 * 600, 768, 820, 900, 1024, 1100, 1200, 1280 and 1440 CSS px.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const markets = readFileSync(new URL('../src/pages/markets.tsx', import.meta.url), 'utf8')

/**
 * The stylesheet with its comments stripped, for the reason `cache-headers.test.ts` gives: the
 * prose in `styles.css` quotes the declarations it is explaining — including the `minmax(300px,
 * 1fr)` it replaced — so a scan over the raw text matches the explanation and not the code.
 */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The JSX with its `{/* … *\/}` comments stripped, same reason. */
const markup = markets.replace(/\/\*[\s\S]*?\*\//g, '')

describe('the primer above the markets', () => {
  /*
   * The primer is no longer four raised tiles in a grid — it is a folded `<details>` whose body is
   * a four-entry `<dl>` (`pages/markets.tsx`). The DEFECT it can still ship is identical, so these
   * tests moved with it rather than being deleted: four items in an intrinsic grid lay out
   * three-then-one at every width this page is ever offered, and a short last row of text columns
   * is milder than a short last row of tiles but is still the thing the arithmetic in this file's
   * header rules out.
   */
  it('is folded, so the questions are the first thing on the page', () => {
    assert.match(
      markup,
      /<details className="fs-primer">/,
      'the primer must stay folded. Unfolded it was four panels and ~360 words standing between a ' +
        'reader and the first market, which is the defect the board layout was written to end.',
    )
  })

  it('holds an entry count that every column step divides', () => {
    const primer = markup.slice(markup.indexOf('fs-primer__body'), markup.indexOf('fs-filters'))
    const entries = primer.match(/<dt>/g)?.length ?? 0
    assert.ok(entries > 0, 'the primer has no entries — this test is looking in the wrong place')
    for (const columns of [1, 2, 4]) {
      assert.equal(
        entries % columns,
        0,
        `${entries} entries do not fill ${columns} columns, so the last row is short. The grid ` +
          `steps 1 → 2 → 4; either write the new entry as a PAIR, or move the steps in styles.css.`,
      )
    }
  })

  it('steps 1 → 2 → 4 and never 3', () => {
    const rule = declarations.slice(declarations.indexOf('.fs-primer__body'))
    assert.match(rule, /\.fs-primer__body\s*\{[\s\S]*?grid-template-columns:\s*1fr;/)
    assert.match(rule, /@container fs-page \(min-width: 34rem\)[\s\S]*?repeat\(2, 1fr\)/)
    assert.match(rule, /@container fs-page \(min-width: 64rem\)[\s\S]*?repeat\(4, 1fr\)/)
    assert.doesNotMatch(
      rule.slice(0, rule.indexOf('.fs-hero')),
      /repeat\(3, 1fr\)|repeat\(auto-f(it|ill)/,
      'three columns orphans the fourth entry, and an intrinsic track listing cannot avoid three ' +
        'while allowing four — see the header of this file',
    )
  })

  it('asks the page for its width rather than the window', () => {
    assert.match(
      declarations,
      /\.fs-page\s*\{[^}]*container-type:\s*inline-size/,
      '`@container fs-page` needs a container to ask; without `container-type` on `.fs-page` the ' +
        'queries never match and the primer is one column at every width',
    )
  })
})

/**
 * The board, and the one thing about it that can regress into what it replaced.
 *
 * The page was a grid of identically sized raised panels in which the majority of the ink was a
 * constant — `feeBps` is 200 on every market in the estate and was printed on every card. What
 * makes the board a board is that rows sit on the page ground with hairline separators and are
 * broken into counted groups, so the tests here are the two facts that stop it drifting back:
 * nothing on this page may restate a per-market constant, and the rows may not become panels.
 */
describe('the board', () => {
  it('does not print the fee on every row', () => {
    const rows = markup.slice(markup.indexOf('function Row('))
    assert.doesNotMatch(
      rows,
      /feeBps/,
      'the fee is the same on every market in the estate, so a row that prints it prints a ' +
        'constant once per market — which is most of what made the old card grid unreadable. It ' +
        'is stated once in the folded primer and in full on the market page, where the pool it ' +
        'applies to actually is.',
    )
  })

  it('does not label every countdown with the same word', () => {
    const rows = markup.slice(markup.indexOf('function Row('), markup.indexOf('function phaseWord('))
    assert.doesNotMatch(
      rows,
      /'to close'/,
      'a note reading "to close" under every countdown is `feeBps` in a smaller font: identical on ' +
        'every row, at a fixed pitch, and therefore ink that teaches a reader to skip a column. ' +
        'The group heading above already says "Closing this month". The note belongs only where ' +
        'the big figure is NOT a countdown, because there it differs from row to row.',
    )
  })

  it('does not list the market it just promoted', () => {
    assert.match(
      markup,
      /markets\.data\.markets\.filter\(\(market\) => market\.id !== hero\.id\)/,
      'the hero has to cost the list its copy of that market. Without this the soonest market is ' +
        'rendered twice in one screenful and the group under it reads "Closing this week — 1" ' +
        'pointing at the band directly above.',
    )
  })

  it('lays rows on the page rather than in panels', () => {
    /*
     * The RESTING state only. `.fs-row__link:hover` does raise the ground and should — the point
     * is that a row is flat until it is pointed at, not that the token is banned from the file. So
     * the two resting blocks are matched by their exact selectors rather than by slicing a span,
     * which would have swept the hover rule in with them.
     */
    const blocks = ['.fs-row', '.fs-row__link'].map((selector) => {
      const found = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(declarations)
      assert.ok(found, `no \`${selector} { … }\` rule found — this test is looking in the wrong place`)
      return { selector, body: found[1] ?? '' }
    })
    for (const { selector, body } of blocks) {
      assert.doesNotMatch(
        body,
        /background:\s*var\(--cf-bg-raised\)/,
        `${selector} fills its ground, which makes a row a card again. The category rail ` +
          '(`.fs-row__link::before`) and the hairline carry the separation; the raised ground is ' +
          'reserved for hover.',
      )
      assert.doesNotMatch(
        body,
        /border-radius/,
        `${selector} is rounded. Rounding a row turns the board back into the grid of panels this ` +
          'layout replaced.',
      )
    }
  })

  it('groups carry a count, because that is what earns the header its line', () => {
    assert.match(
      markup,
      /className="fs-group__count cf-num">\{group\.markets\.length\}/,
      'a group header that only names a bucket is decoration. The count tells a reader how much ' +
        'of the page is theirs before they scroll it.',
    )
  })
})

describe('every intrinsic grid', () => {
  /**
   * A bare pixel floor in `minmax()` is a MINIMUM the track keeps even when the grid is narrower
   * than it. `min(100%, <n>px)` is the same intent expressed as a ceiling on the floor, and it is
   * the difference between a 288px page and a sideways scrollbar.
   */
  it('has a floor that collapses when the container is narrower than it', () => {
    const floors = [...declarations.matchAll(/minmax\(\s*([^,]+?)\s*,/g)].map((m) => m[1] ?? '')
    assert.ok(floors.length > 0, 'no minmax() tracks found — this test is looking in the wrong file')
    /** The narrowest `.fs-page` this app is laid out in: a 320px viewport less `.fs-main`'s gutters. */
    const NARROWEST_PAGE_PX = 320 - 2 * 16

    for (const floor of floors) {
      const bare = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(floor)
      if (!bare) continue // a var(), a min(), an auto — already relative, or not a length
      const px = Number.parseFloat(bare[1] ?? '0') * (bare[2] === 'rem' ? 16 : 1)
      assert.ok(
        px <= NARROWEST_PAGE_PX,
        `\`minmax(${floor}, …)\` is a floor the track keeps even when the grid is narrower than ` +
          `it, and ${px}px does not fit the ${NARROWEST_PAGE_PX}px this page gets at a 320px ` +
          `viewport — the whole document scrolls sideways. Write it as \`min(100%, ${floor})\`.`,
      )
    }
  })
})
