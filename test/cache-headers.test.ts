/**
 * What the app shell says about caching, and about the header that chose it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS FILE EXISTS FOR (micro-org#234), AND WHY A ROUTE TEST WOULD NOT HAVE CAUGHT IT.
 *
 * `/markets/<uuid>` is two resources at one address. The gateway sends it to micro-foresight when
 * the request carries `Accept: application/json` and here otherwise, so a browser navigation gets
 * the shell and the bundle's own fetch for the SAME address gets the market as JSON.
 *
 * The shell went out with no `Vary` and no `Cache-Control` — measured against the running estate
 * on 2026-08-09, from inside the container so that nothing at the edge was in the way:
 *
 *     GET /markets/<uuid>  →  200 text/html, ETag, Last-Modified, no Cache-Control, no Vary
 *
 * So the navigation left a heuristically cacheable text/html entry under a cache key that ignored
 * `Accept`, the bundle's JSON fetch matched it, and the page sat on "Loading the market" for ever.
 * Every shared link, reload and bookmark into a market was broken. `test/routes.test.ts` was green
 * throughout and was right to be: the ROUTE was correct: the response's description of itself was
 * not, and a route table cannot see that.
 *
 * This file reads the same nginx.conf and asserts the headers instead. It is the cheap half; the
 * `image` job in .github/workflows/ci.yml boots the built image and asserts the same three facts
 * over real HTTP, which is the half that would still fail if nginx stopped honouring the file.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const nginx = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8')

/**
 * nginx.conf with its comments stripped, for the reason `routes.test.ts` gives: the prose in this
 * file quotes the headers it is explaining, so a grep over the raw text matches the explanation.
 */
const directives = nginx
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')

/** The body of one `location <matcher> { … }`, brace-matched rather than guessed at with `[^}]`. */
function body(matcher: string): string {
  const start = directives.indexOf(`location ${matcher} {`)
  assert.notEqual(start, -1, `nginx.conf has no \`location ${matcher}\``)
  let depth = 0
  for (let i = directives.indexOf('{', start); i < directives.length; i += 1) {
    if (directives[i] === '{') depth += 1
    if (directives[i] === '}') {
      depth -= 1
      if (depth === 0) return directives.slice(directives.indexOf('{', start) + 1, i)
    }
  }
  throw new Error(`\`location ${matcher}\` is not closed`)
}

/** Every block that answers with the app shell rather than with a file or a literal. */
const SHELL_BLOCKS = ['= /', '~ ^/markets(/|$)', '~ ^/(portfolio|rules)(/|$)'] as const

/** The one the gateway splits on `Accept`, and the only one entitled to say so. */
const NEGOTIATED = '~ ^/markets(/|$)'

describe('the app shell', () => {
  it('is served by the blocks this file thinks it is', () => {
    // Guards every assertion below against passing because a block was renamed and `body()` was
    // reading something that no longer serves the shell.
    for (const matcher of SHELL_BLOCKS) {
      assert.match(body(matcher), /try_files\s+\/index\.html\s+=404;/, `${matcher} does not serve the shell`)
    }
  })

  it('is never stored, at any address it is served from', () => {
    // The shell names the current asset hashes. A stored copy pins a browser to a deploy that no
    // longer exists — which is why `location = /index.html` has always been `no-store`, and the
    // defect was that the addresses people actually visit reach the same file by another route.
    for (const matcher of [...SHELL_BLOCKS, '= /index.html']) {
      assert.match(
        body(matcher),
        /add_header\s+Cache-Control\s+"no-store"\s+always;/,
        `${matcher} lets the shell be cached`,
      )
    }
  })

  it('keeps the three security headers in every block that declares any header at all', () => {
    // add_header does not accumulate: a location declaring ANY add_header inherits NONE from the
    // level above. This file records three earlier instances of that trap; adding Cache-Control to
    // the shell blocks would have been the fourth, silently dropping nosniff from every page.
    for (const matcher of [...SHELL_BLOCKS, '= /index.html']) {
      const block = body(matcher)
      for (const header of [
        /add_header\s+X-Content-Type-Options\s+"nosniff"\s+always;/,
        /add_header\s+X-Frame-Options\s+"SAMEORIGIN"\s+always;/,
        /add_header\s+Referrer-Policy\s+"strict-origin-when-cross-origin"\s+always;/,
      ]) {
        assert.match(block, header, `${matcher} declares headers and lost ${header.source}`)
      }
    }
  })
})

describe('the negotiated address', () => {
  it('says that its body was chosen by `Accept`', () => {
    // The assertion the defect was: without this, a cache keyed on the address alone answers the
    // bundle's JSON fetch with the entry the navigation stored.
    assert.match(body(NEGOTIATED), /add_header\s+Vary\s+"Accept"\s+always;/)
  })

  it('is the ONLY shell block that claims to vary', () => {
    // `/`, `/portfolio` and `/rules` are served by this container whatever the request asks for.
    // A `Vary` they do not have is a false statement about a cache key, and it is the kind that
    // never fails visibly — so it is asserted away rather than left to habit.
    for (const matcher of SHELL_BLOCKS) {
      if (matcher === NEGOTIATED) continue
      assert.equal(
        /add_header\s+Vary\s/.test(body(matcher)),
        false,
        `${matcher} declares a Vary, and the gateway negotiates nothing at that address`,
      )
    }
  })

  it('covers /markets itself as well as one market beneath it', () => {
    // The gateway's rule is `PathPrefix(/markets)`, so the LIST is negotiated too. A matcher of
    // `^/markets/` would have left the list address undeclared.
    const matcher = /^\/markets(\/|$)/
    assert.ok(matcher.test('/markets'))
    assert.ok(matcher.test('/markets/11111111-2222-3333-4444-555555555555'))
    assert.equal(matcher.test('/marketsomething'), false)
  })
})
