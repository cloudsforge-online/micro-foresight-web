/**
 * Host resolution, including the part this app has to do for itself.
 *
 * The registry decides the HOST in every environment; this app changes only the PORT, only on a
 * local host, and only because the registry's `devPort` for `foresight` is Beacon's — see
 * `test/registry.test.ts`, which fails the day that is corrected.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import type { CloudsForgeHosts } from '@cloudsforge/ui'
import { installWindow, removeWindow } from './browser-stubs.ts'
import { APP_NAME, PRODUCT, apiBase, foresightBase, hosts, resolveApiBase } from '../src/lib/hosts.ts'

/** A hosts record with only the field `foresightBase` reads. */
const at = (foresight: string): CloudsForgeHosts => ({ foresight }) as CloudsForgeHosts

afterEach(() => {
  removeWindow()
})

describe('foresightBase', () => {
  it('takes the local port from the registry, untouched', () => {
    // This once overrode the port: the registry gave foresight 4011, which is Beacon's, while the
    // service binds 4021. The registry now says 4021, so there is nothing left to correct — and
    // that is the property worth asserting, since a second override would be invisible otherwise.
    assert.equal(foresightBase(at('http://localhost:4021')), 'http://localhost:4021')
  })

  it('takes the production host from the registry, untouched', () => {
    assert.equal(
      foresightBase(at('https://foresight.cloudsforge.online')),
      'https://foresight.cloudsforge.online',
    )
  })

  it('follows a preview deployment wherever the registry put it', () => {
    // `cloudsforgeHosts()` leaves an unknown prefix alone, so a preview's requests stay inside the
    // preview. Nothing here second-guesses that.
    assert.equal(foresightBase(at('https://foresight.pr-42.example.dev')), 'https://foresight.pr-42.example.dev')
  })

  it('treats every local hostname the same as any other — no special cases remain', () => {
    assert.equal(foresightBase(at('http://127.0.0.1:4021')), 'http://127.0.0.1:4021')
    assert.equal(foresightBase(at('http://machine.local:4021')), 'http://machine.local:4021')
  })

  it('keeps a non-standard remote port rather than dropping it', () => {
    assert.equal(foresightBase(at('https://foresight.staging.internal:8443')), 'https://foresight.staging.internal:8443')
  })

  it('drops any basePath the registry carries, because a base URL is an origin', () => {
    assert.equal(foresightBase(at('https://foresight.example.dev/somewhere')), 'https://foresight.example.dev')
  })
})

describe('resolveApiBase', () => {
  it('is relative when the page and the service share an origin', () => {
    // Production: nginx serves the bundle and the service serves the routes behind one hostname.
    assert.equal(
      resolveApiBase('https://foresight.cloudsforge.online', at('https://foresight.cloudsforge.online')),
      '',
    )
  })

  it('is absolute when they do not', () => {
    // `pnpm dev`: the page is on Vite's 5182 and the service on 4021.
    assert.equal(resolveApiBase('http://localhost:5182', at('http://localhost:4021')), 'http://localhost:4021')
  })

  it('is absolute when there is no page origin to resolve against', () => {
    assert.equal(
      resolveApiBase('', at('https://foresight.cloudsforge.online')),
      'https://foresight.cloudsforge.online',
    )
  })

  it('compares ORIGINS rather than whole URLs', () => {
    // A trailing path on either side must not make a surface look cross-origin to itself.
    assert.equal(resolveApiBase('https://foresight.example.dev', at('https://foresight.example.dev/')), '')
  })
})

describe('apiBase, from a real window', () => {
  it('resolves through the live registry on localhost', () => {
    installWindow('http://localhost:5182/markets')
    assert.equal(apiBase(), 'http://localhost:4021')
  })

  it('is relative when the page is served from the service’s own host', () => {
    installWindow('https://foresight.cloudsforge.online/markets')
    assert.equal(apiBase(), '')
  })

  it('is read per call rather than cached, so one bundle serves every environment', () => {
    installWindow('http://localhost:5182/')
    const local = apiBase()
    removeWindow()
    installWindow('https://cloudsforge.online/')
    assert.notEqual(apiBase(), local)
  })
})

describe('the registry surfaces this app does use', () => {
  it('resolves nimbus, lantern and account from the registry, never by name', () => {
    installWindow('https://cloudsforge.online/')
    const resolved = hosts()
    assert.equal(resolved.nimbus, 'https://nimbus.cloudsforge.online')
    assert.equal(resolved.lantern, 'https://lantern.cloudsforge.online')
    assert.equal(resolved.account, 'https://account.cloudsforge.online')
  })
})

describe('identity', () => {
  it('reports itself as foresight to the observability ingest', () => {
    assert.equal(APP_NAME, 'foresight')
  })

  it('passes the bar its own registry key, so the switcher marks Foresight current', () => {
    assert.equal(PRODUCT, 'foresight')
  })
})
