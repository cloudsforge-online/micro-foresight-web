/**
 * The app shell: the company bar, this app's own navigation, and the page.
 *
 * The bar is `CloudsForgeBar` from @cloudsforge/ui and is never reimplemented — it is the thing
 * that makes moving between surfaces feel like one application.
 *
 * `current={PRODUCT}` marks Foresight as the current entry in the switcher, which it now is:
 * `ui/packages/ui/src/surfaces.ts:169` registers it as a product with `inSwitcher: true`.
 */
import { useEffect } from 'react'
import {
  CloudsForgeBar,
  CloudsForgeFooter,
  CookieBanner,
  MainRegion,
  SkipLink,
} from '@cloudsforge/ui'
import { applyHead, surfaceMeta } from '@cloudsforge/ui/seo'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { PRODUCT } from '../lib/hosts.ts'
import { NAV, ROUTES } from '../lib/routes.ts'
import { useSession } from '../lib/auth.tsx'

export function AppShell() {
  const { account, signIn, signOut } = useSession()

  return (
    <>
      {/*
        The skip link is the first focusable thing in the document, and it is now the SHARED one.
        This app had its own — a `.fs-skip` anchor pointing at `#main` — and it was half of the
        pattern: `<main id="main">` carried no `tabIndex={-1}`, so in Chrome and Safari following
        the link scrolled the page and left focus on the link itself, and the next Tab went back
        to the second item in the company bar. `MainRegion` below is the half that was missing.
      */}
      <SkipLink>Skip to the markets</SkipLink>
      <CloudsForgeBar
        current={PRODUCT}
        account={account}
        onSignIn={() => signIn()}
        onSignOut={signOut}
      />
      {/*
        Sticky at exactly `var(--cf-bar-h)` — the bar's own height token, not a number copied out
        of it. When the bar's height changes this moves with it; a hard-coded 46px would leave a
        seam that only appears on the surfaces nobody rechecked.
      */}
      <nav className="fs-subnav" aria-label="Sections">
        <div className="fs-subnav__inner">
          <span className="fs-wordmark">
            Forge <b>Foresight</b>
          </span>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              // `end` only on the index: without it, `/` matches every path and the Markets tab
              // stays highlighted on every page.
              end={item.to === '/'}
              className={({ isActive }) => `fs-subnav__link${isActive ? ' is-active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <DocumentMeta />
      {/*
        `MainRegion` rather than a hand-written `<main>`: it sets `id={MAIN_ID}` and `tabIndex={-1}`
        together, which is the pair the skip link needs and the pair this file used to get half
        right. The id is `cf-main` now, not `main` — nothing else in this app referenced the old
        one, and the shared `SkipLink` composes its href from the same constant, so the two cannot
        disagree.
      */}
      <MainRegion className="fs-main">
        <Outlet />
      </MainRegion>
      {/*
        The company footer, from @cloudsforge/ui, REPLACING the `fs-footer` this file used to
        write itself.

        The bespoke version was one paragraph and no links. That paragraph was the good half — it
        is the sentence this product turns on, and it is preserved verbatim as `note`. What it was
        missing is everything a footer is for: there was no way from any page of Forge Foresight
        to the developer console, to the status page, to Terms, or to any other product, and the
        surface registry has been claiming since it was written that the developer console is
        "reached from the footer". Three other frontends had grown their own paragraph-only
        footer in the same shape; this is the extraction of the four.
      */}
      <CloudsForgeFooter
        current={PRODUCT}
        account={account}
        note={
          <>
            Stakes go from your wallet to the market's contract on Hearth. This site never holds
            them, and a winner can claim from the contract whether or not this site is running.
          </>
        }
      />

      {/*
        Last in the document, and therefore last in the tab order. That is deliberate: the banner
        is a dialog and is explicitly NOT modal, so a reader who came here to read a market's
        resolution criteria can read them and answer afterwards. A consent banner that traps focus
        is the coercion the regulation is about. It renders nothing at all until it knows the
        reader has not already answered, and nothing on an origin where analytics would not report
        anyway — which is every local stack.
      */}
      <CookieBanner />
    </>
  )
}

/**
 * Keep `document.title`, the description, the Open Graph tags and the canonical link in step with
 * the address.
 *
 * A component in the shell rather than a hook called by each page, because the failure mode of the
 * second shape is the page that forgets to call it — and the page that forgets is the one added
 * last, which is the one nobody has bookmarked yet and therefore the one nobody notices is titled
 * with the previous page's title.
 *
 * ── What this does NOT replace ────────────────────────────────────────────────────────────────
 *
 * The static tags in `index.html`. They are what a link-preview fetcher gets — the ones used by
 * chat and social clients generally do not execute JavaScript — so the shell keeps its own title,
 * description and card, and this is the layer a browser and the crawlers that do execute
 * JavaScript see. That trade is inherited rather than introduced; it is written down at the top of
 * `@cloudsforge/ui/seo` so the next person makes it deliberately instead of finding it in a link
 * preview.
 *
 * ── Where the words come from ─────────────────────────────────────────────────────────────────
 *
 * `surfaceMeta('foresight', …)` derives the name and the description from the surface registry,
 * which already holds both. The only thing this file adds is which page you are on, and that is
 * read off `ROUTES` — the same declaration the navigation and nginx are derived from — rather than
 * typed again here. A route with no navigation label (`/markets/<id>`) gets the surface name
 * alone: the shell cannot know a market's question, and "Market" would be a second declaration of
 * something no reader is helped by.
 */
function DocumentMeta() {
  const { pathname } = useLocation()

  useEffect(() => {
    const segment = pathname.split('/')[1] ?? ''
    const label = ROUTES.find((route) => route.path === segment)?.label ?? undefined
    applyHead(
      surfaceMeta(PRODUCT, { ...(label === null ? {} : { title: label }), path: pathname }),
      window.location.origin,
    )
  }, [pathname])

  return null
}
