/**
 * THE REQUEST, not the response.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Every existing suite in this estate stubs `fetch` and asserts what came back. That is exactly
 * the shape of test that let two defects ship:
 *
 *   - `micro-wallet` called `POST /v1/quotes`. `micro-pricing` serves `/rates`.
 *   - `micro-market` called `POST /v1/decisions/market.listing`. `micro-policy` has **no `/v1`
 *     routes at all**, takes the action in the body, and registers `market.listing.create`. Every
 *     listing 403'd.
 *
 * Both suites were green. A stub answers whatever it is told to answer, no matter what path it was
 * asked for — so a test that checks the parsed body proves the parser and nothing else.
 *
 * So this file asserts the OUTGOING call: the exact URL, the method, the query string, the body,
 * and whether a bearer token was attached. Each expectation carries the line of
 * `foresight/src/server.ts` the route is declared on, verified by reading `buildRoutes()`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { installFetch, installStorage, installWindow, json, removeStorage, removeWindow, type FetchStub } from './browser-stubs.ts'
import { __resetAuth, setTokens } from '../src/lib/api.ts'
import {
  createStakeIntent,
  getCategories,
  getMarket,
  getPosition,
  listMarkets,
  MARKET_STATUSES,
} from '../src/lib/foresight.ts'

/**
 * The service's base under `pnpm dev`: the page is on Vite's port and the service on its own, so
 * the request is absolute and cross-origin. `PORT=4021`, `foresight/.env.example:13`.
 */
const BASE = 'http://localhost:4021'

let fetchStub: FetchStub

/** The one call made, as a parsed URL. Fails loudly if zero or several were made. */
function onlyCall(): { url: URL; method: string; headers: Record<string, string>; body: string | undefined } {
  assert.equal(fetchStub.calls.length, 1, `expected exactly one request, saw ${fetchStub.calls.length}`)
  const call = fetchStub.calls[0]
  assert.ok(call)
  return { url: new URL(call.url), method: call.method, headers: call.headers, body: call.body }
}

beforeEach(() => {
  installWindow('http://localhost:5182/markets')
  installStorage()
  __resetAuth()
  fetchStub = installFetch(() => json(200, {}))
})

afterEach(() => {
  fetchStub.restore()
  removeStorage()
  removeWindow()
  __resetAuth()
})

describe('GET /markets — foresight/src/server.ts:402', () => {
  it('asks for /markets, with no /v1 prefix anywhere in the path', async () => {
    await listMarkets()
    const call = onlyCall()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.origin, BASE)
    assert.equal(call.url.pathname, '/markets')
    // The defect that shipped twice. `buildRoutes()` registers bare paths; there is no version
    // segment on any route in this service.
    assert.equal(call.url.pathname.includes('/v1'), false)
  })

  it('sends the status and limit the route parses, and nothing it does not', async () => {
    await listMarkets({ status: 'open', limit: 100 })
    const call = onlyCall()
    // `parseStatus` (server.ts:846) and `parseLimit` (server.ts:852) read exactly these two names
    // off the query string.
    assert.equal(call.url.searchParams.get('status'), 'open')
    assert.equal(call.url.searchParams.get('limit'), '100')
    assert.deepEqual([...call.url.searchParams.keys()].sort(), ['limit', 'status'])
  })

  it('omits the status entirely rather than sending an empty one', async () => {
    // `?status=` reaches `parseStatus('')`, which throws BadRequestError. An absent parameter is
    // the documented way to ask for every status (`server.ts:403-404`).
    await listMarkets({ limit: 10 })
    assert.equal(onlyCall().url.searchParams.has('status'), false)
  })

  it('sends no bearer token, because browsing is public', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    await listMarkets()
    assert.equal('authorization' in onlyCall().headers, false)
  })

  it('refuses a status the route would 400, before it reaches the wire', async () => {
    await assert.rejects(
      () => listMarkets({ status: 'nonsense' as never }),
      /unknown market status/,
    )
    assert.equal(fetchStub.calls.length, 0)
  })

  it('refuses a limit outside 1..200, which is the route’s own bound', async () => {
    // server.ts:855 — "limit must be a whole number between 1 and 200".
    for (const limit of [0, 201, 1.5, -1]) {
      await assert.rejects(() => listMarkets({ limit }), /limit must be a whole number/)
    }
    assert.equal(fetchStub.calls.length, 0)
  })

  it('accepts every status the route accepts', async () => {
    // The seven at server.ts:847. If the service adds an eighth, this list is what has to move.
    assert.deepEqual([...MARKET_STATUSES].sort(), [
      'approved',
      'closed',
      'draft',
      'open',
      'resolved',
      'settled',
      'void',
    ])
    for (const status of MARKET_STATUSES) {
      fetchStub.calls.length = 0
      await listMarkets({ status })
      assert.equal(onlyCall().url.searchParams.get('status'), status)
    }
  })
})

describe('GET /markets/:id — foresight/src/server.ts:417', () => {
  it('puts the id in the path, not in a query parameter', async () => {
    await getMarket('11111111-2222-3333-4444-555555555555')
    const call = onlyCall()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/markets/11111111-2222-3333-4444-555555555555')
    assert.equal([...call.url.searchParams.keys()].length, 0)
  })

  it('escapes an id that would otherwise change the path', async () => {
    // `uuidParam` refuses anything that is not a uuid (server.ts:840), so this can only ever be a
    // 400 — but it must be a 400 at THIS route, not a request to some other one.
    await getMarket('../categories')
    assert.equal(onlyCall().url.pathname, '/markets/..%2Fcategories')
  })

  it('sends no bearer token', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    await getMarket('abc')
    assert.equal('authorization' in onlyCall().headers, false)
  })
})

describe('GET /markets/:id/positions/:address — foresight/src/server.ts:448', () => {
  it('puts both the market and the address in the path, in that order', async () => {
    await getPosition('m-1', '0x00112233445566778899aabbccddeeff00112233')
    const call = onlyCall()
    assert.equal(call.method, 'GET')
    assert.equal(
      call.url.pathname,
      '/markets/m-1/positions/0x00112233445566778899aabbccddeeff00112233',
    )
  })

  it('is unauthenticated: a position is public chain state', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    await getPosition('m-1', '0x00112233445566778899aabbccddeeff00112233')
    assert.equal('authorization' in onlyCall().headers, false)
  })
})

describe('POST /markets/:id/stake-intent — foresight/src/server.ts:483', () => {
  beforeEach(() => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  })

  it('POSTs to the market’s own stake-intent path', async () => {
    fetchStub.restore()
    fetchStub = installFetch(() => json(200, { marketId: 'm-1' }))
    await createStakeIntent('m-1', { amount: '1.5', outcome: 0 })
    const call = onlyCall()
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, '/markets/m-1/stake-intent')
    assert.equal(call.url.pathname.includes('/v1'), false)
  })

  it('sends amount as a STRING and outcome as a NUMBER, and nothing else', async () => {
    fetchStub.restore()
    fetchStub = installFetch(() => json(200, {}))
    await createStakeIntent('m-1', { amount: '1.5', outcome: 1 })
    const body = JSON.parse(onlyCall().body ?? '{}') as Record<string, unknown>
    // `requireDecimal` (server.ts:892) refuses a number outright: "amount must be a positive
    // decimal string, not a number". `requireInteger` (server.ts:489) wants 0 or 1.
    assert.equal(typeof body['amount'], 'string')
    assert.equal(body['amount'], '1.5')
    assert.equal(typeof body['outcome'], 'number')
    assert.equal(body['outcome'], 1)
    assert.deepEqual(Object.keys(body).sort(), ['amount', 'outcome'])
  })

  it('attaches the bearer token — this is the one authenticated call in the bundle', async () => {
    fetchStub.restore()
    fetchStub = installFetch(() => json(200, {}))
    await createStakeIntent('m-1', { amount: '1', outcome: 0 })
    assert.equal(onlyCall().headers['authorization'], 'Bearer access-1')
  })

  it('sends a JSON content type, because the route reads a JSON body', async () => {
    fetchStub.restore()
    fetchStub = installFetch(() => json(200, {}))
    await createStakeIntent('m-1', { amount: '1', outcome: 0 })
    assert.equal(onlyCall().headers['content-type'], 'application/json')
  })
})

describe('GET /categories — foresight/src/server.ts:391', () => {
  it('asks for /categories, unauthenticated', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    await getCategories()
    const call = onlyCall()
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/categories')
    // server.ts:386-390 — "A refusal list behind a token is a refusal list nobody can hold the
    // platform to." Sending one anyway would make an anonymous read look authenticated in the logs.
    assert.equal('authorization' in call.headers, false)
  })
})

describe('the surface as a whole', () => {
  it('calls no path this service does not register', async () => {
    // Every public route in `buildRoutes()`, by the line it is declared on. A call to anything
    // else is the defect this file exists to prevent.
    const registered = [
      /^\/markets$/, //                         server.ts:402
      /^\/markets\/[^/]+$/, //                  server.ts:417
      /^\/markets\/[^/]+\/positions\/[^/]+$/, // server.ts:448
      /^\/markets\/[^/]+\/stake-intent$/, //     server.ts:483
      /^\/categories$/, //                      server.ts:391
    ]

    setTokens({ accessToken: 'a', refreshToken: 'r' })
    await listMarkets({ status: 'open' })
    await getMarket('m-1')
    await getPosition('m-1', '0x00112233445566778899aabbccddeeff00112233')
    await createStakeIntent('m-1', { amount: '1', outcome: 0 })
    await getCategories()

    assert.equal(fetchStub.calls.length, 5)
    for (const call of fetchStub.calls) {
      const path = new URL(call.url).pathname
      assert.ok(
        registered.some((pattern) => pattern.test(path)),
        `${path} is not a route micro-foresight registers`,
      )
    }
  })

  it('never sends a request to a versioned path', async () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' })
    await listMarkets()
    await getMarket('m-1')
    await getCategories()
    for (const call of fetchStub.calls) {
      assert.equal(new URL(call.url).pathname.startsWith('/v1'), false, `${call.url} is versioned`)
    }
  })

  it('addresses the service’s own host rather than the page’s', async () => {
    await listMarkets()
    // Under `pnpm dev` the page is on 5182 and the service on 4021. A relative request would go to
    // Vite, which serves the bundle and would answer HTML.
    assert.equal(onlyCall().url.origin, BASE)
  })
})
