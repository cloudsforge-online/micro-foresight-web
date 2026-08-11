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
  it('is the named-count grid, not the auto-fill one', () => {
    assert.match(
      markup,
      /className="fs-rules fs-rules--primer"/,
      'the four-tile primer must carry `fs-rules--primer`; plain `.fs-rules` is the auto-fill grid ' +
        'the rules page uses, and four items in it lay out three-then-one at every width from ' +
        '1024px up',
    )
  })

  it('holds a tile count that every column step divides', () => {
    const primer = markup.slice(markup.indexOf('fs-rules--primer'), markup.indexOf('fs-filters'))
    const tiles = primer.match(/className="fs-rule"/g)?.length ?? 0
    assert.ok(tiles > 0, 'the primer has no tiles — this test is looking in the wrong place')
    for (const columns of [1, 2, 4]) {
      assert.equal(
        tiles % columns,
        0,
        `${tiles} tiles do not fill ${columns} columns, so the last row is short. The grid steps ` +
          `1 → 2 → 4; either write the new tile as a PAIR, or move the steps in styles.css with it.`,
      )
    }
  })

  it('steps 1 → 2 → 4 and never 3', () => {
    const rule = declarations.slice(declarations.indexOf('.fs-rules--primer'))
    assert.match(rule, /\.fs-rules--primer\s*\{\s*grid-template-columns:\s*1fr;/)
    assert.match(rule, /@container fs-page \(min-width: 34rem\)[\s\S]*?repeat\(2, 1fr\)/)
    assert.match(rule, /@container fs-page \(min-width: 64rem\)[\s\S]*?repeat\(4, 1fr\)/)
    assert.doesNotMatch(
      rule.slice(0, rule.indexOf('.fs-rule ')),
      /repeat\(3, 1fr\)|repeat\(auto-f(it|ill)/,
      'three columns orphans the fourth tile, and an intrinsic track listing cannot avoid three ' +
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
