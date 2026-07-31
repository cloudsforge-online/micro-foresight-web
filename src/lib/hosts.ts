/**
 * Where this app talks to, resolved at runtime.
 *
 * `cloudsforgeHosts()` reads `window.location.hostname` on every call, so the same bundle
 * addresses `http://localhost:4021` when served from localhost and `https://foresight.<apex>`
 * when served from the apex. Nothing here reads a build-time constant; see vite.config.ts.
 *
 * ── THE SURFACE REGISTRY HAS NO `foresight` KEY, AND THIS FILE IS THE CONSEQUENCE ─────────────
 *
 * `@cloudsforge/ui/surfaces.ts` enumerates twenty-one surfaces and Forge Foresight is not one of
 * them: this product was added to the programme by `docs/ecosystem/19-new-products.md` after the
 * registry was written. `micro-ui` is single-owner, so this repository REPORTS that gap rather
 * than editing it, and resolves its own host here in the meantime.
 *
 * The resolution is deliberately DERIVED FROM the registry rather than written beside it:
 *
 *   - `site` is the apex — its `subdomain` is `''` — so `cloudsforgeHosts().site` is exactly
 *     `https://<apex>` in production and `http://localhost:3000` in dev. Taking the apex from
 *     there means the known-subdomain stripping in `cloudsforgeHosts()` (which is what makes a
 *     preview deployment at `pr-42.example.dev` resolve to itself rather than to a guess) is
 *     applied to this host too, without being reimplemented.
 *   - The dev port is the service's own `PORT`, `foresight/.env.example:13`.
 *
 * When the registry gains a `foresight` entry, `FORESIGHT_SUBDOMAIN` and `FORESIGHT_DEV_PORT`
 * below are deleted and `foresightBase()` becomes the same two lines every other app has.
 * `test/registry.test.ts` fails on the day that happens, so nobody has to remember.
 */
import { cloudsforgeHosts, type CloudsForgeHosts, type SurfaceKey } from '@cloudsforge/ui'

/** The name reported to the observability ingest and shown in error copy. */
export const APP_NAME = 'foresight'

/**
 * What is passed to the shared bar as `current`.
 *
 * The switcher marks an entry current by matching this against its own keys, and Foresight is in
 * neither the registry nor the switcher — so nothing is marked, the trigger reads "Products", and
 * that is the correct rendering: a reader on Foresight is not inside one of the five products.
 * `site` produces exactly that behaviour today and is type-legal, which a cast to a key the type
 * does not have would not be.
 *
 * This is a placeholder for a registry entry, not a claim that this app is the marketing site.
 * `test/registry.test.ts` pins the behaviour that makes it safe — `site` is `inSwitcher: false` —
 * so if that ever changes, the bar does not quietly start telling readers they are on the site.
 */
export const BAR_CURRENT: SurfaceKey = 'site'

/** `foresight.<apex>` in production. Not in the registry yet; see the header. */
const FORESIGHT_SUBDOMAIN = 'foresight'

/** `micro-foresight/.env.example:13` — `PORT=4021`. */
const FORESIGHT_DEV_PORT = 4021

/** Every CloudsForge base URL, for the current environment. */
export function hosts(): CloudsForgeHosts {
  return cloudsforgeHosts()
}

/**
 * The absolute base URL of `micro-foresight`, derived from the registry's apex.
 *
 * Exported separately from `apiBase()` and taking `hosts` as an argument so the derivation can be
 * tested against a production apex, a localhost, and a preview deployment without a browser.
 */
export function foresightBase(hosts: CloudsForgeHosts): string {
  // `site` is the apex itself, so its origin is the apex origin in every environment.
  const apex = new URL(hosts.site)
  // A local stack runs every service on its own port on one hostname; there are no subdomains to
  // put a service under, so the port is the whole of the address.
  if (apex.hostname === 'localhost' || apex.hostname === '127.0.0.1' || apex.hostname.endsWith('.local')) {
    return `${apex.protocol}//${apex.hostname}:${FORESIGHT_DEV_PORT}`
  }
  return `${apex.protocol}//${FORESIGHT_SUBDOMAIN}.${apex.host}`
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
export function resolveApiBase(pageOrigin: string, hosts: CloudsForgeHosts): string {
  const own = foresightBase(hosts)
  // With no page origin there is nothing for a relative URL to resolve against, so the absolute
  // form is the only correct answer.
  if (!pageOrigin) return own
  return new URL(own).origin === pageOrigin ? '' : own
}

/** This app's API base, resolved now. Call it per request; never cache it in a module constant. */
export function apiBase(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return resolveApiBase(origin, cloudsforgeHosts())
}

/** The page origin, or a stable placeholder when there is no document (tests, prerender). */
export function pageOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost' : window.location.origin
}
