/**
 * The app shell: the company bar, this app's own navigation, and the page.
 *
 * The bar is `CloudsForgeBar` from @cloudsforge/ui and is never reimplemented — it is the thing
 * that makes moving between surfaces feel like one application.
 *
 * `current={BAR_CURRENT}` marks NOTHING as current in the switcher, and that is correct: Forge
 * Foresight is not one of the five products and is not in the registry at all yet. See the header
 * of `lib/hosts.ts`.
 */
import { CloudsForgeBar } from '@cloudsforge/ui'
import { NavLink, Outlet } from 'react-router-dom'
import { BAR_CURRENT } from '../lib/hosts.ts'
import { NAV } from '../lib/routes.ts'
import { useSession } from '../lib/auth.tsx'

export function AppShell() {
  const { account, signIn, signOut } = useSession()

  return (
    <>
      <a className="fs-skip" href="#main">
        Skip to the markets
      </a>
      <CloudsForgeBar
        current={BAR_CURRENT}
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
      <main className="fs-main" id="main">
        <Outlet />
      </main>
      <footer className="fs-footer">
        <p>
          Stakes go from your wallet to the market's contract on Hearth. This site never holds
          them, and a winner can claim from the contract whether or not this site is running.
        </p>
      </footer>
    </>
  )
}
