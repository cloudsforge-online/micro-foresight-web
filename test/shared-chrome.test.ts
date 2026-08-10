/**
 * THE SHARED CHROME RENDERS HERE, AND ITS HOOKS ACTUALLY RUN.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY A TEST WHOSE SUBJECT IS ANOTHER REPOSITORY'S COMPONENT
 *
 * It is not asserting what `@cloudsforge/ui` draws — micro-ui owns that. It is asserting a fact
 * about THIS repository's test process: that `@cloudsforge/ui` and this app end up sharing ONE
 * React. They do not by default. `link:../ui/packages/ui` symlinks the design system's working
 * tree, that tree has its own `react` (a devDependency it genuinely needs to test itself), and
 * Node resolves a bare specifier from the importing file's REALPATH — so the design system's
 * components reach the second copy, share no dispatcher with ours, and the first hook they call
 * throws `Cannot read properties of null (reading 'useState')`.
 *
 * `--import @cloudsforge/ui/test-loader` in the `test` script is what collapses the two. This file
 * is what notices when it stops. Delete the flag and these tests are the first to go red.
 *
 * Publishing `dist` did NOT make that unnecessary, though eight repositories predicted it would:
 * `dist/index.js` has the same realpath as `src/index.tsx`, so it finds the same second copy. What
 * publishing `dist` did fix was the OTHER workaround — the classic JSX transform, and the
 * `globalThis.React` that used to sit in `test/dom.ts`.
 *
 * ── Why it clicks rather than only mounting ───────────────────────────────────────────────────
 *
 * A mount that does not throw is weak evidence: `CloudsForgeLogo` renders perfectly well with two
 * Reacts in the process, because it calls no hook — that was measured. The dropdowns are the ones
 * that break, so each is OPENED, which requires `useState` to hold a value across a re-render and
 * `useId` to have produced the id `aria-controls` names. A second dispatcher cannot fake that.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, test } from 'node:test'
import { AccountMenu, CloudsForgeBar, ProductSwitcher } from '@cloudsforge/ui'
import { createElement as h } from 'react'
import { App } from '../src/app.tsx'
import { PRODUCT } from '../src/lib/hosts.ts'
import { NAV } from '../src/lib/routes.ts'
import { withScreen, type Screen } from './dom.ts'

/**
 * `allowEmpty` because the subject is a strip of chrome, not a page: the bar's own text is well
 * under the 40 characters `assertMounted` requires of a mounted app. Every test below then asserts
 * on named elements instead, which is a stricter check than the length heuristic it waives.
 */
const CHROME = { allowEmpty: true } as const

/** The dropdown triggers, which is how they are found without hard-coding this surface's label. */
const triggers = (s: Screen): Element[] => [...s.document.querySelectorAll('[aria-haspopup="menu"]')]

test('the company bar renders, signed out', async () => {
  await withScreen(h(CloudsForgeBar, { current: PRODUCT, account: { signedIn: false } }), CHROME, async (s) => {
    assert.ok(s.document.querySelector('[role="banner"]'), 'CloudsForgeBar rendered no banner')
    s.byRole('link', 'CloudsForge home')
    s.byRole('button', 'Sign in')
    assert.equal(triggers(s).length, 1, 'signed out, the switcher is the only dropdown')
    s.clean('the bar, signed out')
  })
})

test('the product switcher opens, which means its useState held', async () => {
  await withScreen(h(CloudsForgeBar, { current: PRODUCT, account: { signedIn: false } }), CHROME, async (s) => {
    const trigger = triggers(s)[0] as Element
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
    assert.equal(s.document.querySelector('[role="menu"]'), null, 'the menu is closed to begin with')

    await s.click(trigger)

    assert.equal(trigger.getAttribute('aria-expanded'), 'true', 'the click did not reach state')
    const menu = s.document.querySelector('[role="menu"][aria-label="CloudsForge products"]')
    assert.ok(menu, 'the switcher opened no menu')
    assert.ok(
      menu.querySelectorAll('[role="menuitem"]').length > 1,
      'an open switcher with fewer than two products is not a switcher',
    )
    // `aria-controls` names the menu by an id from `useId`, which is the other hook in play.
    assert.equal(menu.getAttribute('id'), trigger.getAttribute('aria-controls'))
    s.clean('opening the product switcher')
  })
})

test('the account menu opens for a signed-in viewer, and offers sign out', async () => {
  const account = { signedIn: true, handle: 'ada' }
  await withScreen(h(CloudsForgeBar, { current: PRODUCT, account }), CHROME, async (s) => {
    const trigger = triggers(s)[1] as Element
    assert.match(s.textOf(trigger), /ada/, 'the second dropdown is not the account menu')

    await s.click(trigger)

    const menu = s.document.querySelector('[role="menu"][aria-label="Account"]')
    assert.ok(menu, 'the account menu opened nothing')
    assert.match(s.textOf(menu), /Sign out/)
    s.clean('opening the account menu')
  })
})

test('ProductSwitcher and AccountMenu also render standing alone', async () => {
  // Named directly, not only through the bar: these are the two components measured to throw
  // without deduplication, and a test that reached them only via a parent would stop covering
  // them the day the bar stopped composing them.
  await withScreen(h(ProductSwitcher, { current: PRODUCT }), CHROME, async (s) => {
    assert.equal(triggers(s).length, 1)
    s.clean('ProductSwitcher alone')
  })
  await withScreen(h(AccountMenu, { account: { signedIn: false } }), CHROME, async (s) => {
    s.byRole('button', 'Sign in')
    s.clean('AccountMenu alone')
  })
})

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   THE SECTION STRIP IS THE SHARED ONE, IN THE STYLESHEET AND ON SCREEN

   Two assertions, and they are deliberately not the same assertion twice.

   The first reads the two stylesheets: the shared classes must EXIST upstream, and this
   repository's private copy must be GONE. A `className` naming a class `ui.css` does not declare
   fails silently — the element renders with no styling and nothing anywhere reports it — and a
   private copy left beside the shared one is what produced the estate-wide drift in the first
   place. It is modelled on `explorer-web/test/tokens.test.ts`, "the shared form controls exist and
   the local copies are gone", which is the precedent for a class that moved into the design system.

   The second mounts the real `App` and looks at the document, because the first one cannot see a
   shell that imports `SubNav` and renders the local `<nav className="fs-subnav">` anyway. It
   addresses elements by CLASS, which is otherwise avoided here: the class IS the subject.
   `.cf-subnav` and `.fs-subnav` render the identical accessible tree — one `<nav>` named
   "Sections" holding the same links — and differ only in which stylesheet reaches them, so an
   assertion on roles and names would have passed against all ten drifted copies.

   ── The defect this closes (measured 2026-08-10) ──────────────────────────────────────────────

   Ten frontends declared this strip in their own stylesheet under six class prefixes. The census
   found three differences a reader could see, of which this repository had ONE: the current
   section marked in two channels rather than three. `white-space: nowrap`, `overflow-x: auto` and
   `--cf-max-w` were already right here. What cannot be asserted in this file is the CSS behaviour
   itself — happy-dom lays nothing out, and asserting computed style would be asserting happy-dom.
   `ui/packages/ui/src/subnav.test.ts` pins the scrolling, the nowrap, the measure and the three
   channels onto `.cf-subnav`; "the strip on screen is `.cf-subnav`" plus that file is the chain.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

const at = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))

/**
 * The stylesheet with its comments stripped.
 *
 * `src/styles.css` QUOTES the class names it no longer declares, in order to explain where they
 * went. A scan over the raw text matches the explanation and fails a correct file — a rule that can
 * only be satisfied by deleting the sentence explaining it is a rule somebody deletes.
 */
const CSS = readFileSync(at('src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Where a micro-ui checkout is, in the order CI and a developer's machine put it. */
const UI_ROOT = [process.env['CLOUDSFORGE_UI_DIR'], at('../ui')]
  .filter((v): v is string => Boolean(v))
  .find((p) => existsSync(`${p}/packages/ui/src/ui.css`))

describe('the shared sub-nav exists and the local copy is gone', () => {
  if (UI_ROOT === undefined) {
    it('SKIPPED: no micro-ui checkout — CI checks one out and requires this to run', () => {
      assert.ok(true)
    })
  } else {
    const ui = readFileSync(`${UI_ROOT}/packages/ui/src/ui.css`, 'utf8')
    const declared = new Set([...ui.matchAll(/\.(cf-[a-z0-9_-]+)/g)].map((m) => m[1] ?? ''))

    it('reads a ui.css with classes in it, so this cannot pass on an empty match', () => {
      assert.ok(declared.size >= 20, `found ${declared.size} cf- classes in ui.css`)
    })

    it('the design system declares every class this shell now names', () => {
      for (const present of [
        'cf-subnav',
        'cf-subnav__inner',
        'cf-subnav__link',
        'cf-subnav__link--current',
      ]) {
        assert.ok(declared.has(present), `.${present} is missing from ui.css`)
      }
    })

    it('src/styles.css declares no .fs-subnav rule of any kind', () => {
      const survivors = [...CSS.matchAll(/\.fs-subnav[a-z0-9_-]*/g)].map((m) => m[0])
      assert.deepEqual(
        survivors,
        [],
        `src/styles.css still declares ${survivors.join(', ')}; the strip is SubNav's now`,
      )
    })

    it('nothing spells the sub-nav’s current section `is-active` any more', () => {
      // `is-active` was this repository's spelling of the modifier; the shared one is
      // `cf-subnav__link--current`. NOT a blanket ban on the string: `.fs-filter.is-active` is the
      // market-list filter chips, a different control that this change does not touch and that has
      // every right to keep the spelling. What must be gone is `is-active` attached to a link.
      const onALink = [...CSS.matchAll(/\.[a-z0-9_-]*(?:subnav|link)[a-z0-9_-]*\.is-active/g)].map(
        (m) => m[0],
      )
      assert.deepEqual(onALink, [], `src/styles.css still styles ${onALink.join(', ')}`)
    })

    it('and it does not restyle the shared classes either, which is the same drift reversed', () => {
      // A local `.cf-subnav__link { … }` would put this repository's opinion back on top of the
      // shared strip, which is exactly the state the adoption was for. The `--cf-*` PROPERTIES are
      // a different matter and are read freely; this is about the class rules.
      const restyled = [...CSS.matchAll(/\.cf-subnav[a-z0-9_-]*\s*[,{]/g)].map((m) => m[0])
      assert.deepEqual(restyled, [], `src/styles.css restyles ${restyled.join(', ')}`)
    })

    it('the wordmark stayed local, because it is not the design system’s', () => {
      assert.match(CSS, /\.fs-wordmark\s*\{/, 'the product wordmark lost its rule')
    })
  }
})

test('the sub-nav on screen is the shared strip, and every section link is a shared link', async () => {
  const routes = { 'GET /categories': { body: { version: 1, categories: [], refusals: [] } } }
  await withScreen(h(App), { url: 'https://foresight.cloudsforge.online/rules', routes }, async (s) => {
    await s.settle(20)

    // The landmark. Named, because the bar is the other `<nav>` in this document and two unnamed
    // ones are announced as "navigation" and "navigation" — `SubNav` requires `label` for that
    // reason, and this surface's own wording is kept.
    const strip = s.document.querySelector('nav.cf-subnav')
    assert.ok(strip, 'the sub-nav on screen is not the shared strip')
    assert.equal(strip.getAttribute('aria-label'), 'Sections')
    assert.ok(strip.querySelector('.cf-subnav__inner'), 'the shared strip has no scrolling inner')

    // The private copy is not rendered anywhere, under any of its names. Adopting the shared strip
    // and leaving the old one in the tree is the one way the assertion above passes on a defect.
    assert.equal(
      s.document.querySelector('[class*="fs-subnav"]'),
      null,
      'the local .fs-subnav markup is still in the document beside the shared one',
    )

    // EVERY section, not "at least one": a partial adoption is the shape this catches. `NAV` is the
    // same declaration the shell maps over, so a section added later is covered without an edit.
    const links = [...strip.querySelectorAll('a')]
    assert.equal(
      links.length,
      NAV.length,
      `the strip holds ${links.length} links for ${NAV.length} sections`,
    )
    for (const item of NAV) {
      const link = links.find((a) => (a.textContent ?? '').trim() === item.label)
      assert.ok(link, `no link in the sub-nav is labelled ${item.label}`)
      assert.ok(
        link.classList.contains('cf-subnav__link'),
        `the ${item.label} link carries "${link.getAttribute('class')}", not cf-subnav__link`,
      )
    }

    // The current section, marked with the SHARED modifier. `is-active` was this repository's own
    // spelling and it styles nothing now, so a link still wearing it would be a section the reader
    // cannot see they are in. This mount is at /rules.
    const current = [...strip.querySelectorAll('.cf-subnav__link--current')]
    assert.equal(current.length, 1, `${current.length} sections are marked current on /rules`)
    assert.equal((current[0]?.textContent ?? '').trim(), 'What we run')
    assert.equal(
      strip.querySelector('.is-active'),
      null,
      'a link still carries the local is-active modifier, which no stylesheet styles',
    )

    // The one thing in the strip that is deliberately NOT a link: the product wordmark.
    const wordmark = strip.querySelector('.fs-wordmark')
    assert.ok(wordmark, 'the wordmark left the strip')
    assert.equal(wordmark.tagName, 'SPAN', 'the wordmark became something a reader can press')

    s.clean('the shared sub-nav')
  })
})
