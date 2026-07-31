/**
 * The route table: which component renders at each address.
 *
 * The ADDRESSES themselves are declared once, in `src/lib/routes.ts`, which the navigation derives
 * from and which `test/routes.test.ts` checks this file and `nginx.conf` against. nginx serves the
 * bundle only for the paths it enumerates and 404s everything else on purpose, so a route added
 * here and not there works under `pnpm dev` and dies on the first hard refresh in production. The
 * test is the mechanism; "remember to update nginx.conf" is not.
 *
 * ── Every route here is PUBLIC, and that is the design ────────────────────────────────────────
 *
 * There is no `ProtectedRoute` in this app. A market's resolution criteria are a contract with
 * strangers, and a contract nobody can read without an account is not one. The two things that
 * need a session — the stake intent, and reading your own address's positions — ask for it at the
 * point of use. `test/routes.test.ts` asserts that no route is wrapped, so a gate cannot arrive on
 * a browse page by habit.
 */
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/shell.tsx'
import { AuthProvider } from './lib/auth.tsx'
import { MarketPage } from './pages/market.tsx'
import { MarketsPage } from './pages/markets.tsx'
import { NotFoundPage } from './pages/not-found.tsx'
import { PortfolioPage } from './pages/portfolio.tsx'
import { RulesPage } from './pages/rules.tsx'

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<MarketsPage />} />
            {/* `markets/*`, because `/markets/<uuid>` is the address people share. */}
            <Route path="markets/*" element={<MarketPage />} />
            {/* `portfolio/*`, because `/portfolio/<address>` is a link to one staker's positions. */}
            <Route path="portfolio/*" element={<PortfolioPage />} />
            <Route path="rules" element={<RulesPage />} />
            {/* Unknown paths render inside the shell, so the reader keeps the navigation they need
                to get back out. The STATUS is nginx's doing, not this route's — see
                pages/not-found.tsx. */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
