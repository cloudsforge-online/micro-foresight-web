/**
 * The route table, as data, in one place.
 *
 * Three files describe this app's addresses and all three have to agree:
 *
 *   1. `src/app.tsx`               — which component renders at each path,
 *   2. `src/components/shell.tsx`  — which of them the navigation offers,
 *   3. `nginx.conf`                — which of them are served the app shell at all.
 *
 * The third is the one that bites, and it bites late. nginx enumerates this app's real routes and
 * 404s everything else *on purpose*, so that a wrong address answers 404 rather than 200. The
 * price of that honesty is this list, in triplicate — so the navigation is DERIVED from here
 * rather than restated, and `test/routes.test.ts` reads `nginx.conf` and `app.tsx` and fails the
 * build when either has drifted. "Remember to update nginx.conf" is not a mechanism; a test is.
 *
 * This module deliberately imports nothing — not React, not the router — so the test that reads it
 * does not have to boot a browser to find out what the routes are.
 */

export interface ForesightRoute {
  /** The top-level path segment, without a leading slash. `''` is the index route. */
  readonly path: string
  /** The navigation label, or null for a route that is reachable but not offered. */
  readonly label: string | null
  /** True when the route owns everything beneath it (`/markets/<uuid>`). */
  readonly wildcard: boolean
}

export const ROUTES: readonly ForesightRoute[] = [
  { path: '', label: 'Markets', wildcard: false },
  // Wildcard: `/markets/<uuid>` is one market, and it is the address people paste at each other.
  // It is not offered in the navigation because the index IS the list of markets; a second entry
  // pointing at the same content costs a slot in a list whose whole job is separation.
  { path: 'markets', label: null, wildcard: true },
  // Wildcard: `/portfolio/<address>` is one staker's positions, so a reader can look at their own
  // without connecting a wallet and can link to it.
  { path: 'portfolio', label: 'Positions', wildcard: true },
  // The allowlist and the refusals, published. `foresight/src/server.ts:386-390`: "A refusal list
  // behind a token is a refusal list nobody can hold the platform to."
  { path: 'rules', label: 'What we run', wildcard: false },
]

/** What the navigation renders, with the leading slash a `NavLink` wants. */
export const NAV: ReadonlyArray<{ to: string; label: string }> = ROUTES.filter(
  (route): route is ForesightRoute & { label: string } => route.label !== null,
).map((route) => ({ to: `/${route.path}`, label: route.label }))

/** Every path nginx has to serve the shell for, excluding the index. */
export const NON_INDEX_PATHS: readonly string[] = ROUTES.filter((r) => r.path !== '').map(
  (r) => r.path,
)

/** The address of one market. Built here so no page composes it by hand. */
export function marketPath(id: string): string {
  return `/markets/${encodeURIComponent(id)}`
}

/** The address of one staker's positions. */
export function portfolioPath(address: string): string {
  return `/portfolio/${encodeURIComponent(address)}`
}
