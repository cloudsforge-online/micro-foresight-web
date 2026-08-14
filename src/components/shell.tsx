/**
 * The app shell: the company bar, this app's own navigation, and the page.
 *
 * The bar is `CloudsForgeBar` from @cloudsforge/ui and is never reimplemented — it is the thing
 * that makes moving between surfaces feel like one application.
 *
 * `current={PRODUCT}` marks Foresight as the current entry in the switcher, which it now is:
 * `ui/packages/ui/src/surfaces.ts` registers it as a product with `inSwitcher: true`.
 */
import { useEffect, useState } from 'react'
import {
  CloudsForgeBar,
  CloudsForgeFooter,
  CookieBanner,
  MainRegion,
  SkipLink,
  SubNav,
  miningOnHub,
} from '@cloudsforge/ui'
import { applyHead, surfaceMeta } from '@cloudsforge/ui/seo'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { PRODUCT, hosts } from '../lib/hosts.ts'
import { NAV, ROUTES } from '../lib/routes.ts'
import { useSession } from '../lib/auth.tsx'
import { setViewedNetwork, viewedNetwork, type ViewedNetwork } from '../lib/viewed.ts'

export function AppShell() {
  // The viewed network: in-tab memory, defaulting to the hostname's own (micro-org#459).
  // `setViewedNetwork` runs first in the handler below so the remounted tree reads the new value
  // on its very first render.
  const [viewed, setViewed] = useState<ViewedNetwork>(viewedNetwork())
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
      {/*
        `mining` is the design system's own control, and the bar seats it immediately before the
        account menu, on every page of this surface.

        The owner's report was that starting a browser miner is "hidden deep in mining page"; the
        remedy is a place in the one strip of chrome every surface renders. What this app passes is
        `miningOnHub()` — the `elsewhere` state — and that is a statement of fact rather than a
        weaker choice: the miner is a WebSocket and two Web Workers on ONE origin, `hub.<apex>` is
        not this origin, and no code in this bundle can start, observe or stop a session there. A
        Start button here would promise something this bundle cannot deliver, which on a surface
        that takes stakes is the last habit worth acquiring.

        So it is an ANCHOR. It can be middle-clicked, opened in a new tab, copied, and read by
        everything that reads links — none of which is true of a destination expressed as an
        onClick, and an onClick destination is how micro-hub-web's account entry spent four months
        pointing at the wrong page.

        `hosts().hub`, never a literal: the same bundle is served from localhost, from a preview
        host and from the apex, and a written-out URL would be correct on exactly one of them.
      */}
      {/*
        In-app network context (micro-org#459, the combined view). The reader's choice lives in
        `lib/viewed.ts` — module memory, never storage — and the `key` on the Outlet below is the
        refetch mechanism: switching remounts the page tree, and `apiBase()` reads `viewedHosts()`,
        so the same page re-reads itself from the other estate WITHOUT going anywhere. The band and
        the switcher both follow the selection, so testnet data under a mainnet address bar is
        never unmarked. The bar also stamps `?net=` onto its product links, which is what carries
        the choice across a product switch — every surface is its own origin, so nothing else can.
      */}
      <CloudsForgeBar
        current={PRODUCT}
        account={account}
        onSignIn={() => signIn()}
        onSignOut={signOut}
        mining={miningOnHub(hosts().hub)}
        networkSwitch={{
          selected: viewed,
          onSelect: (n) => {
            setViewedNetwork(n)
            setViewed(n)
          },
        }}
      />
      {/*
        THE SECTION STRIP IS THE SHARED ONE NOW, AND THE LOCAL `.fs-subnav*` RULES ARE GONE WITH IT.

        The strip itself — sticky at the bar's own `--cf-bar-h`, the bar's measure, the horizontal
        scroll, the narrow-viewport gutter, the three-channel current marker — is `SubNav` from
        @cloudsforge/ui. Measured 2026-08-10 across the estate: ten frontends declared this row in
        their own stylesheet under six class prefixes, from what was plainly one original that had
        then been edited in ten places.

        This copy had drifted in two ways a reader can see. `.fs-subnav__link.is-active` marked the
        current section in TWO channels, ink and underline, where the estate's rule is three. And
        the gutter was `--cf-space-xl` at every width while the bar above it narrows to
        `--cf-space-md` under 560px, so on a phone the second row of the header sat 12px proud of
        the first on each side — the same defect as the estate-wide 76rem one, arrived at from the
        other direction.

        `aria-label` stays "Sections" — this repo's own wording, passed through as `label`. Only the
        strip is homogenised, not the sentence a screen reader reads.

        The wordmark stays. It is a local extra INSIDE the shared strip, not one of its links: it is
        not a destination, and this is the only surface in the estate that puts its product name in
        this row rather than relying on the company bar. `SubNav` takes the caller's own children,
        so it costs the design system nothing.
      */}
      <SubNav label="Sections">
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
            className={({ isActive }) =>
              `cf-subnav__link${isActive ? ' cf-subnav__link--current' : ''}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </SubNav>
      <DocumentMeta />
      {/*
        `MainRegion` rather than a hand-written `<main>`: it sets `id={MAIN_ID}` and `tabIndex={-1}`
        together, which is the pair the skip link needs and the pair this file used to get half
        right. The id is `cf-main` now, not `main` — nothing else in this app referenced the old
        one, and the shared `SkipLink` composes its href from the same constant, so the two cannot
        disagree.
      */}
      <MainRegion className="fs-main">
        <Outlet key={viewed} />
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
