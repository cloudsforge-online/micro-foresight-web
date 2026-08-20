/**
 * The three descriptions of this app's addresses, checked against each other.
 *
 *   1. `src/lib/routes.ts` — the declaration, from which the navigation is derived.
 *   2. `src/app.tsx`       — which component renders at each path.
 *   3. `nginx.conf`        — which addresses are served the app shell at all.
 *
 * The third is what makes this test worth having. nginx enumerates the real routes and 404s
 * everything else on purpose, so a route added to the router and not to nginx works perfectly under
 * `pnpm dev` and 404s on the first hard refresh in production. That failure survives review because
 * nothing about the diff looks wrong.
 *
 * `app.tsx` is read as TEXT rather than imported: importing would pull in React, the router and
 * every page, and this suite deliberately has no DOM.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { BASE, NAV, NON_INDEX_PATHS, ROUTES, marketPath, portfolioPath } from '../src/lib/routes.ts'

const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

const appSource = read('src/app.tsx')
const nginx = read('nginx.conf')

/**
 * nginx.conf with its comments stripped.
 *
 * The file's own header QUOTES the directive it forbids, in order to explain why the routes are
 * enumerated by hand, so a grep over the raw text matches the warning and fails a correct file. The
 * rule is about DIRECTIVES; strip the prose before checking it.
 */
const directives = nginx
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')

/**
 * Every path enumerated by a `location ~ ^/…` block, from all of them.
 *
 * There is more than one such block now, and reading only the first would be a check that silently
 * shrinks: `/markets` was split into a block of its own so that `Vary: Accept` could go on the one
 * client route the gateway negotiates and nowhere else (see nginx.conf). A reader of only the first
 * block would then have concluded that this app no longer serves /portfolio.
 */
function nginxPaths(): string[] {
  // Both blocks are mounted since wave 3i — `^<BASE>/markets(/|$)` and
  // `^<BASE>/(portfolio|rules)(/|$)`. The mount goes into the PATTERN and comes back off the
  // RESULT, so every caller below keeps comparing against the ROUTER paths `src/lib/routes.ts`
  // declares, which is the source this file exists to hold nginx against.
  const mount = BASE.replace(/\//g, '\\/')
  const blocks = [
    ...directives.matchAll(
      new RegExp(`location\\s+~\\s+\\^${mount}\\/\\(?([^)$]+?)\\)?\\((?:\\/\\|\\$)\\)`, 'g'),
    ),
  ]
  assert.ok(blocks.length > 0, 'nginx.conf has no enumerated route block')
  return blocks.flatMap((match) => (match[1] ?? '').split('|').map((p) => p.trim()))
}

describe('the route declaration', () => {
  it('is not empty, so this whole file cannot pass for the wrong reason', () => {
    assert.ok(ROUTES.length >= 4, `expected the route table, found ${ROUTES.length} entries`)
  })

  it('has exactly one index route', () => {
    assert.equal(ROUTES.filter((r) => r.path === '').length, 1)
  })

  it('declares no duplicate path', () => {
    const paths = ROUTES.map((r) => r.path)
    assert.equal(new Set(paths).size, paths.length)
  })

  it('declares no path with a slash: these are TOP-LEVEL segments', () => {
    // nginx matches on the first segment and everything under it. A declaration of
    // `markets/detail` would produce a location block that does not mean what it says.
    for (const route of ROUTES) {
      assert.ok(!route.path.includes('/'), `${route.path} is not a top-level segment`)
    }
  })

  it('marks the two routes that own everything beneath them', () => {
    // `/markets/<uuid>` and `/portfolio/<address>` are the addresses people paste at each other.
    const wildcards = ROUTES.filter((r) => r.wildcard).map((r) => r.path)
    assert.deepEqual(wildcards.sort(), ['markets', 'portfolio'])
  })
})

describe('the navigation', () => {
  it('is derived from the declaration rather than restated', () => {
    const labelled = ROUTES.filter((r) => r.label !== null)
    assert.equal(NAV.length, labelled.length)
    assert.deepEqual(
      NAV.map((n) => n.to),
      labelled.map((r) => `/${r.path}`),
    )
  })

  it('points the first entry at the index', () => {
    assert.equal(NAV[0]?.to, '/')
  })

  it('does not offer /markets, because the index already IS the list of markets', () => {
    assert.ok(!NAV.some((n) => n.to === '/markets'))
  })
})

describe('the router', () => {
  it('has a <Route> for every declared path', () => {
    for (const route of ROUTES) {
      if (route.path === '') {
        assert.match(appSource, /<Route\s+index/, 'no index route in app.tsx')
        continue
      }
      const expected = route.wildcard ? `path="${route.path}/*"` : `path="${route.path}"`
      assert.ok(appSource.includes(expected), `app.tsx has no ${expected}`)
    }
  })

  it('declares no <Route path=…> that the declaration does not know about', () => {
    const declared = new Set(NON_INDEX_PATHS)
    for (const match of appSource.matchAll(/path="([^"]+)"/g)) {
      const path = (match[1] ?? '').replace(/\/\*$/, '')
      if (path === '*') continue
      assert.ok(declared.has(path), `app.tsx routes ${path}, which lib/routes.ts does not declare`)
    }
  })

  it('keeps the catch-all, which is what renders the honest 404 page', () => {
    assert.ok(appSource.includes('path="*"'))
    assert.ok(appSource.includes('NotFoundPage'))
  })

  it('PUTS NO ROUTE BEHIND A SESSION GATE — this is a public surface', () => {
    // The inverse of hub-web's rule, and asserted for the same reason: a gate added to a browse
    // page by habit would make a market's resolution criteria unreadable without an account, and
    // criteria nobody can read before signing in are not a contract with strangers.
    // The JSX element, not the word: `app.tsx` explains in prose that there is no gate here, and
    // a grep for the bare identifier matches its own explanation.
    assert.equal(appSource.includes('<ProtectedRoute'), false, 'a route was put behind a gate')
    assert.equal(/ProtectedRoute[,\s]*\}?\s*from/.test(appSource), false, 'a gate was imported')
  })
})

describe('nginx', () => {
  it('enumerates every declared path', () => {
    const served = new Set(nginxPaths())
    for (const path of NON_INDEX_PATHS) {
      assert.ok(served.has(path), `nginx.conf does not serve /${path}; it will 404 on a hard refresh`)
    }
  })

  it('enumerates nothing the app does not route', () => {
    // The other direction: a stale entry serves the shell with a 200 for an address that renders
    // the not-found page, which is the exact dishonesty the enumeration exists to prevent.
    const declared = new Set(NON_INDEX_PATHS)
    for (const path of nginxPaths()) {
      assert.ok(declared.has(path), `nginx.conf serves /${path}, which this app does not route`)
    }
  })

  it('serves the index explicitly', () => {
    assert.match(nginx, /location\s+=\s+\/foresight\s*\{/)
  })

  it('never falls back to index.html with a 200 for an unknown path', () => {
    assert.equal(
      /try_files\s+\$uri\s+(\$uri\/\s+)?\/index\.html/.test(directives),
      false,
      'the catch-all falls back to the shell with a 200',
    )
    assert.ok(directives.includes(`error_page 404 ${BASE}/index.html`))
    // …and the comment that explains the rule is still there, since it is the only reason anybody
    // reading this file later will understand why the routes are enumerated by hand.
    assert.match(nginx, /404, not 200/)
  })

  it('does not let a missing asset fall through to the shell', () => {
    // A JavaScript request answered with HTML fails with a syntax error naming the wrong file.
    assert.match(directives, /location\s+\/foresight\/assets\/\s*\{[\s\S]*?try_files\s+\$uri\s+=404;/)
  })

  it('serves the deep link CI probes, and 404s one it does not own', () => {
    // The workflow asserts a REAL route returns 200 and an unknown one 404s. `deep-link-path` in
    // ci.yml must therefore be an address this block matches.
    // `nginxPaths()` returns ROUTER paths, so the mount goes back on here — this regex is
    // matched against the PUBLIC address a CI probe requests.
    const block = new RegExp(`^${BASE}/(${nginxPaths().join('|')})(/|$)`)
    // The addresses a CI probe requests are PUBLIC ones — the container serves the mount and
    // nothing else. The regex above carries `BASE`, so these must too.
    assert.ok(block.test(`${BASE}/markets/11111111-2222-3333-4444-555555555555`))
    assert.ok(block.test(`${BASE}/portfolio/0x00112233445566778899aabbccddeeff00112233`))
    assert.equal(block.test('/nope/not/a/route'), false)
  })

  it('sets the frame-ancestors header this surface needs', () => {
    // A signing prompt reached through somebody else's iframe is a clickjacking surface for a
    // transaction that moves EMBER.
    assert.match(directives, /X-Frame-Options.*SAMEORIGIN/)
  })
})

describe('the path builders', () => {
  it('build the addresses nginx serves', () => {
    assert.equal(marketPath('abc'), '/markets/abc')
    assert.equal(portfolioPath('0xABC'), '/portfolio/0xABC')
  })

  it('escape a segment that would otherwise change the path', () => {
    assert.equal(marketPath('../rules'), '/markets/..%2Frules')
  })
})
