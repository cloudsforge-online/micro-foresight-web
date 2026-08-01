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
 *   2. **The service itself listens on 4021** — `micro-foresight/.env.example:13`, `PORT=4021`.
 *
 * So `cloudsforgeHosts().foresight` resolves to `http://localhost:4011` in a local stack, which is
 * Beacon. Every request this app makes under `pnpm dev` would go to the wrong service and fail in
 * a way that looks like this app being wrong.
 *
 */
import { cloudsforgeHosts, type CloudsForgeHosts, type SurfaceKey } from '@cloudsforge/ui'

/** The name reported to the observability ingest and shown in error copy. */
export const APP_NAME = 'foresight'

/**
 * The surface this application IS.
 *
 * `foresight` is a product in the registry (`ui/packages/ui/src/surfaces.ts:169`) and IS a
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
  return new URL(hosts.foresight).origin
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
