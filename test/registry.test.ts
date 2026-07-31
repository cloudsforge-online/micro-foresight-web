/**
 * Two live defects in `@cloudsforge/ui`, pinned so this app's workarounds delete themselves.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `micro-ui` is single-owner. This repository REPORTS what it found rather than editing it, and
 * every assertion below is written to FAIL THE DAY THE DEFECT IS FIXED — which is the only way a
 * workaround gets removed rather than quietly outliving its reason.
 *
 * ── 1. `foresight`'s accent selector is spelled wrong ─────────────────────────────────────────
 *
 * `ui/packages/ui/src/tokens.css:332` reads `[data-product='foresight']`. Every other product
 * selector in that file — twelve of them — reads `[data-cf-product='…']`, and tokens.css:140 says
 * `data-cf-product` is the attribute a product sets on `<html>`. So the rule carrying Foresight's
 * accent (#1e89c7) matches nothing and the page falls back to the company ember.
 *
 * tokens.css:363 already documents this exact failure happening once before, with
 * `data-cf-product="admin"` against a selector that did not exist. This is the second time.
 *
 * Workaround: index.html carries both spellings. Zero brand values are copied into this repo.
 *
 * ── 2. `foresight`'s dev port collides with `beacon`, and is not the service's port ────────────
 *
 * `surfaces.ts` gives `foresight` `devPort: 4011`. `beacon` is also 4011, and two surfaces cannot
 * share a localhost port. Worse, `micro-foresight` listens on 4021 — `.env.example:13` — so
 * `cloudsforgeHosts().foresight` resolves a local stack to Beacon.
 *
 * Workaround: `src/lib/hosts.ts` overrides the PORT, on a local host only. The subdomain, which is
 * correct, comes from the registry untouched.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'
import { SURFACES, surface } from '@cloudsforge/ui/surfaces'

const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

/** tokens.css as shipped by the linked design system, read from the package itself. */
function tokensCss(): string {
  const require = createRequire(import.meta.url)
  return readFileSync(require.resolve('@cloudsforge/ui/tokens.css'), 'utf8')
}

describe('the registry knows this product', () => {
  it('registers `foresight` as a product', () => {
    const entry = surface('foresight')
    assert.equal(entry.kind, 'product')
    assert.equal(entry.name, 'Forge Foresight')
  })

  it('gives it the subdomain this app resolves through', () => {
    assert.equal(surface('foresight').subdomain, 'foresight')
  })

  it('puts it in the switcher, which is what makes `current={PRODUCT}` correct', () => {
    assert.equal(surface('foresight').inSwitcher, true)
  })
})

describe('DEFECT 1 — the accent selector in tokens.css is missing its `cf-` prefix', () => {
  it('still spells Foresight’s selector `[data-product=…]` — delete the extra attribute when fixed', () => {
    const css = tokensCss()
    assert.ok(
      css.includes("[data-product='foresight']"),
      'tokens.css no longer has the mis-spelled selector: delete data-product="foresight" from index.html and the note above it',
    )
    assert.equal(
      css.includes("[data-cf-product='foresight']"),
      false,
      'tokens.css now has the correct selector: delete data-product="foresight" from index.html',
    )
  })

  it('spells every OTHER product selector correctly, which is what makes this a typo', () => {
    const css = tokensCss()
    for (const key of ['network', 'trade', 'create', 'market', 'worlds', 'hub', 'site']) {
      assert.ok(css.includes(`[data-cf-product='${key}']`), `${key} is also mis-spelled`)
    }
  })

  it('is worked around by carrying both spellings on <html>, and only both spellings', () => {
    const html = read('index.html')
    assert.match(html, /data-cf-product="foresight"/)
    assert.match(html, /\sdata-product="foresight"/)
    // …and no copy of the accent value lives in this repository. The colour stays the design
    // system's; only the attribute is duplicated.
    assert.equal(read('src/styles.css').includes('1e89c7'), false, 'a brand accent was copied here')
  })
})

describe('DEFECT 2 — the dev port collides with beacon and is not the service’s', () => {
  it('still gives foresight beacon’s port — delete the local override when fixed', () => {
    assert.equal(
      surface('foresight').devPort,
      4011,
      'the registry’s foresight devPort changed: delete LOCAL_SERVICE_PORT and its branch from src/lib/hosts.ts and resolve through cloudsforgeHosts() untouched',
    )
  })

  it('demonstrates the collision rather than asserting it abstractly', () => {
    const collisions = SURFACES.filter((s) => s.devPort === surface('foresight').devPort).map((s) => s.key)
    assert.deepEqual(collisions.sort(), ['beacon', 'foresight'])
  })

  it('disagrees with micro-foresight’s own PORT, which is 4021', () => {
    // `micro-foresight/.env.example:13`. Read from the sibling repository when it is there, so
    // this is a fact about the service rather than a number retyped here.
    const env = new URL('../../foresight/.env.example', import.meta.url)
    let declared: number | null = null
    try {
      const match = /^PORT=(\d+)$/m.exec(readFileSync(env, 'utf8'))
      declared = match ? Number(match[1]) : null
    } catch {
      // The sibling is not checked out in this job; the assertion below still holds the registry
      // to the number this app was written against.
      declared = 4021
    }
    assert.equal(declared, 4021)
    assert.notEqual(surface('foresight').devPort, declared, 'the registry and the service now agree')
  })
})

describe('this app’s own declarations', () => {
  it('sets the product and substrate on <html>, statically, so no paint flashes the default', () => {
    const html = read('index.html')
    assert.match(html, /<html[^>]*data-cf-product="foresight"/)
    assert.match(html, /<html[^>]*data-cf-substrate="warm"/)
  })

  it('carries the release meta tag src/lib/obs.ts reads', () => {
    assert.match(read('index.html'), /name="cf-release" content="dev"/)
  })

  it('names no CloudsForge hostname anywhere in src', () => {
    // A literal hostname is a second, unversioned copy of the surface registry, and the copy is
    // the one that will be wrong. CI greps for this too; here so it fails on a laptop first.
    for (const file of ['src/lib/hosts.ts', 'src/lib/foresight.ts', 'src/lib/api.ts', 'src/lib/obs.ts']) {
      assert.equal(read(file).includes('cloudsforge.online'), false, `${file} names a hostname`)
    }
  })
})
