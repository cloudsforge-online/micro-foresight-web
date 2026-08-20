/**
 * Where this app talks to, resolved at runtime.
 *
 * `cloudsforgeHosts()` reads `window.location.hostname` on every call, so the same bundle
 * addresses this service on localhost when served from localhost and `https://foresight.<apex>`
 * when served from the apex. Nothing here reads a build-time constant; see vite.config.ts.
 *
 * ── ONE LOCAL OVERRIDE, AND IT IS A DEFECT IN micro-ui, NOT A PREFERENCE ──────────────────────
 *
 * `@cloudsforge/ui/surfaces.ts` gives `foresight` `devPort: 4011`. Two things are wrong with that
 * and both bite only in local development:
 *
 *   1. **It collides with `beacon`, which is also 4011.** Two surfaces cannot share a localhost
 *      port, and whichever process bound it first answers for both.
 *   2. **The service itself listens on 4021** — `micro-foresight/.env.example`, `PORT=4021`.
 *
 * So `cloudsforgeHosts().foresight` resolves to `http://localhost:4011` in a local stack, which is
 * Beacon. Every request this app makes under `pnpm dev` would go to the wrong service and fail in
 * a way that looks like this app being wrong.
 *
 */
import { cloudsforgeHosts, type CloudsForgeHosts, type SurfaceKey } from '@cloudsforge/ui'
import { viewedHosts } from './viewed.ts'

/** The name reported to the observability ingest and shown in error copy. */
export const APP_NAME = 'foresight'

/**
 * The surface this application IS.
 *
 * `foresight` is a product in the registry (`ui/packages/ui/src/surfaces.ts`) and IS a
 * switcher entry, so passing it as `current` marks Foresight as the current product — which is
 * correct, and is what a reader who opens the switcher from here should see.
 */
export const PRODUCT: SurfaceKey = 'foresight'

/** Every CloudsForge base URL, for the current environment. */
export function hosts(): CloudsForgeHosts {
  return cloudsforgeHosts()
}

/**
 * The absolute base URL of `micro-foresight`.
 *
 * The registry decides the host in every environment, untouched. This briefly overrode the port on
 * a local host, because the registry gave foresight `devPort: 4011` — Beacon's — so a local stack
 * sent every request to the monitoring service. That is corrected upstream to 4021, the port the
 * service binds, so the override and the `isLocal` helper it needed are gone and this is the same
 * shape every other app has.
 */
export function foresightBase(hosts: CloudsForgeHosts): string {
  // ── THE WHOLE URL, NOT ITS ORIGIN — AND `.origin` WAS THE DEFECT ───────────────────────────
  //
  // `.origin` was right while this surface had a hostname to itself: the registry value was
  // `https://foresight.<apex>` and its origin was the same string. Since wave 3i the value is
  // `https://<apex>/foresight`, and taking the origin throws the mount away — so every read
  // composes `<apex>/markets`, which micro-site answers with its SPA shell: 200, an HTML body
  // where JSON was expected.
  //
  // This is precisely the pattern `deploy/docs/apex-consolidation.md` records after wave 3h's
  // cross-repo fallout: "the consumers that call `.origin` on a registry URL are exactly the
  // ones a mount breaks — silently, with a 200". That sweep looked at what OTHER repositories
  // compose and missed the surface's own, which is the easiest one to assume is fine.
  //
  // The trailing slash is stripped so that appending `/markets` cannot produce `//markets`.
  return hosts.foresight.replace(/\/+$/, '')
}

/**
 * This app's API base: `''` when the page and the service share an origin, absolute otherwise.
 *
 * In production the SPA and the service are the same origin — nginx serves the bundle, the
 * service serves the routes behind the same hostname — so every request stays relative. Under
 * `pnpm dev` the page is on Vite's port (5182) while the service is on 4021, so the base is
 * absolute and the request goes cross-origin.
 *
 * The difference is derived by COMPARING ORIGINS rather than by a `DEV` flag, because a flag is a
 * build-time constant and this repository has none: an image built for production and opened on
 * localhost would then point at a host that is not there.
 */
/** The same four names `cloudsforgeHosts()` treats as development. */
function isLocal(hostname: string): boolean {
  return (
    hostname === '' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.local')
  )
}

export function resolveApiBase(pageOrigin: string, hosts: CloudsForgeHosts): string {
  const own = foresightBase(hosts)
  // With no page origin there is nothing for a relative URL to resolve against, so the absolute
  // form is the only correct answer.
  if (!pageOrigin) return own
  const parsed = new URL(own)
  if (parsed.origin !== pageOrigin) {
    // ── A DEV STACK HAS NO GATEWAY TO STRIP THE MOUNT ─────────────────────────────────────────
    //
    // Cross-origin is the production answer when the reader is viewing the sibling estate, and
    // under `pnpm dev` it is how this bundle reaches micro-foresight: a different port on
    // localhost. But the registry composes a dev URL as `http://localhost:4021` PLUS the
    // basePath, and the service binds that port directly — nothing in front of it takes
    // `/foresight` back off, so every read would 404.
    return isLocal(parsed.hostname) ? parsed.origin : own
  }
  // ── SAME ORIGIN, AND THE ANSWER IS THE MOUNT RATHER THAN THE EMPTY STRING ───────────────────
  //
  // `''` meant "issue a relative request, we are already here", which was complete while this
  // surface had a hostname to itself. Since wave 3i a relative `/markets` from a page at
  // `/foresight/portfolio` resolves at the APEX ROOT — micro-site's — which answers its SPA
  // shell with a 200 and an HTML body where JSON was expected. That is decision 4's failure, and
  // it is sharper here than anywhere: these are UNVERSIONED root paths, so `/markets` and `/me`
  // at the apex are names the marketing site could plausibly want.
  const mount = parsed.pathname.replace(/\/+$/, '')
  return mount === '' ? '' : mount
}

/**
 * This app's API base, resolved now. Call it per request; never cache it in a module constant.
 *
 * `viewedHosts()` rather than `cloudsforgeHosts()` is the whole of the in-place network view at
 * this layer (micro-org#459). It returns the map it was given, unchanged, until the reader picks
 * the other network in the bar, and the sibling estate's origins after that — so this line is a
 * no-op in development, in a preview deployment and for every reader who never touches the
 * switcher. The `-testnet` WEB hostnames are retired and 302 to their mainnet siblings, but `/v1`
 * on them is not: that path still answers from the testnet services, which is what makes reading
 * the other network from this page possible at all. See `lib/viewed.ts`.
 */
export function apiBase(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return resolveApiBase(origin, viewedHosts())
}

/** The page origin, or a stable placeholder when there is no document (tests, prerender). */
export function pageOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost' : window.location.origin
}
