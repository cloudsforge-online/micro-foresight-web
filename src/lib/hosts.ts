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
 * `micro-ui` is single-owner, so this repository REPORTS that and overrides only the port, only on
 * a local host. The SUBDOMAIN comes from the registry and is correct, so production and every
 * preview deployment resolve through `cloudsforgeHosts()` untouched. `test/registry.test.ts` fails
 * the day the registry's port is corrected, at which point `LOCAL_SERVICE_PORT` and the branch
 * that uses it are deleted and this file becomes the same six lines every other app has.
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

/**
 * The port `micro-foresight` actually listens on locally — `micro-foresight/.env.example:13`.
 *
 * Delete with the branch that uses it when the registry's `devPort` is corrected; see the header.
 */
const LOCAL_SERVICE_PORT = 4021

/** Every CloudsForge base URL, for the current environment. */
export function hosts(): CloudsForgeHosts {
  return cloudsforgeHosts()
}

/** True for the hostnames `cloudsforgeHosts()` itself treats as a local stack. */
function isLocal(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local')
}

/**
 * The absolute base URL of `micro-foresight`.
 *
 * The registry decides the host in every environment. The only thing this function changes is the
 * PORT, and only on a local host, and only because the registry's is wrong — see the header.
 */
export function foresightBase(hosts: CloudsForgeHosts): string {
  const own = new URL(hosts.foresight)
  if (!isLocal(own.hostname)) return own.origin
  return `${own.protocol}//${own.hostname}:${LOCAL_SERVICE_PORT}`
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
