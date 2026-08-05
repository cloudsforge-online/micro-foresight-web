/**
 * The header image: the requests it makes, the refusals it puts into words, and the claim it must
 * never make.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE FOUR THIS FILE EXISTS FOR.
 *
 *   * **THE UPLOAD BODY IS RAW BYTES.** micro-studio's `POST /v1/uploads` reads the request body
 *     AS THE IMAGE. `FormData` — the reflex for a file input — would send a multipart envelope
 *     whose first bytes are dashes, and studio, which decides by MAGIC BYTES, would refuse a
 *     perfectly good PNG as `unrecognised_format`. The refusal would be correct and the diagnosis
 *     impossible. So the outgoing body is asserted, not the parsed answer.
 *
 *   * **THE ADDRESS IS ASKED FOR, NEVER DERIVED.** `studio` has no row in the @cloudsforge/ui
 *     surfaces registry, so there is nothing to derive from. `lib/foresight.ts`'s header names the
 *     two defects this estate shipped by imagining a surface; this would have been the third.
 *
 *   * **STUDIO'S REFUSALS BECOME SENTENCES.** `svg_refused` and `too_large` above all — the two a
 *     real person hits. A machine token rendered at a user is an error code rendered at a user.
 *
 *   * **THE IMAGE IS NEVER PRESENTED AS VERIFIED.** Rendered markup is grepped for the words. On a
 *     page that recomputes a real hash in the browser and shows a real tick for it, a second tick
 *     that cannot fail would teach a reader the first one is decoration too.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import {
  installFetch,
  installStorage,
  installWindow,
  json,
  removeStorage,
  removeWindow,
  type FetchStub,
} from './browser-stubs.ts'
import { ApiError, __resetAuth, setTokens } from '../src/lib/api.ts'
import { clearMarketImage, setMarketImage, type MarketImageRef } from '../src/lib/foresight.ts'
import { canUpload, getImageConfig, uploadImage, uploadRefusal, type ImageConfig } from '../src/lib/studio.ts'
import { MarketImage, offersImageControl } from '../src/components/marketimage.tsx'
import { MarketArticle } from '../src/pages/market.tsx'
import { AuthProvider } from '../src/lib/auth.tsx'
import { detail, market } from './fixtures.ts'

const BASE = 'http://localhost:4021'
const STUDIO = 'https://studio.example.invalid'
const ASSET_ID = '11111111-1111-4111-8111-111111111111'
const CHECKSUM = `sha256:${'ab'.repeat(32)}`

const CONFIG: ImageConfig = {
  studioUrl: STUDIO,
  uploadPath: '/v1/uploads',
  visibility: 'public',
  accept: ['image/png', 'image/jpeg', 'image/webp'],
}

const IMAGE: MarketImageRef = {
  assetId: ASSET_ID,
  checksum: CHECKSUM,
  bytesUrl: `${STUDIO}/v1/assets/${ASSET_ID}/bytes`,
}

let fetchStub: FetchStub

function onlyCall() {
  assert.equal(fetchStub.calls.length, 1, `expected exactly one request, saw ${fetchStub.calls.length}`)
  const call = fetchStub.calls[0]
  assert.ok(call)
  return call
}

beforeEach(() => {
  installWindow('http://localhost:5182/markets/m-1')
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

/* ------------------------------------------------------------------ discovery */

describe('GET /image-config — the address is asked for, never derived', () => {
  it('asks micro-foresight where micro-studio is, unauthenticated', async () => {
    await getImageConfig()
    const call = onlyCall()
    assert.equal(call.method, 'GET')
    const url = new URL(call.url)
    assert.equal(url.origin, BASE)
    assert.equal(url.pathname, '/image-config')
    // Everything in the answer is a public hostname and a published path, and the pages that need
    // it are public. A token here would make an anonymous read look authenticated in the logs.
    assert.equal('authorization' in call.headers, false)
  })

  it('treats a null studioUrl as a real answer rather than something to work around', () => {
    assert.equal(canUpload({ ...CONFIG, studioUrl: null }), false)
    assert.equal(canUpload(null), false)
    assert.equal(canUpload(CONFIG), true)
  })
})

/* ------------------------------------------------------------------ the upload */

describe('POST /v1/uploads — raw bytes, to the address the service published', () => {
  it('sends the file itself as the body, NOT multipart/form-data', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    const bytes = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })

    let sentBody: unknown
    fetchStub.restore()
    fetchStub = installFetch((call) => {
      void call
      return json(201, { asset: { id: ASSET_ID, checksum: CHECKSUM }, deduplicated: false })
    })
    const original = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sentBody = init?.body
      return original(input, init)
    }) as typeof fetch

    const ref = await uploadImage(CONFIG, bytes)
    globalThis.fetch = original

    // ── The assertion this file exists for ────────────────────────────────────────────────────
    // A FormData body would arrive at studio as a multipart envelope beginning with dashes, and
    // studio reads MAGIC BYTES: it would refuse a real PNG as `unrecognised_format`.
    assert.equal(sentBody instanceof FormData, false, 'the body was multipart/form-data')
    assert.equal(sentBody, bytes, 'the body was not the raw file')

    assert.deepEqual(ref, { assetId: ASSET_ID, checksum: CHECKSUM })
  })

  it('posts to studio’s own path with visibility=public and a bearer token', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    fetchStub.restore()
    fetchStub = installFetch(() => json(201, { asset: { id: ASSET_ID, checksum: CHECKSUM } }))

    await uploadImage(CONFIG, new Blob([new Uint8Array([1])], { type: 'image/png' }))
    const call = onlyCall()
    const url = new URL(call.url)
    assert.equal(call.method, 'POST')
    // studio, not foresight. The bytes never pass through this product's own service.
    assert.equal(url.origin, STUDIO)
    assert.equal(url.pathname, '/v1/uploads')
    // `public` matters: studio's bytes route needs NO Authorization header for a public asset, and
    // a browser sends none on an `<img src>`. A private asset is a broken picture on a public page.
    assert.equal(url.searchParams.get('visibility'), 'public')
    assert.equal(call.headers['authorization'], 'Bearer access-1')
  })

  it('refuses to upload without a session rather than sending an anonymous request', async () => {
    await assert.rejects(
      () => uploadImage(CONFIG, new Blob([new Uint8Array([1])])),
      (err: unknown) => err instanceof ApiError && err.status === 401 && /Sign in/.test(err.message),
    )
    // Nothing left this bundle: studio would have answered 401 and the user would have been shown
    // "unauthenticated" for what is really "you are signed out".
    assert.equal(fetchStub.calls.length, 0)
  })

  it('treats a deduplicated 200 as a success, because re-uploading a picture is not an error', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    fetchStub.restore()
    fetchStub = installFetch(() => json(200, { asset: { id: ASSET_ID, checksum: CHECKSUM }, deduplicated: true }))
    assert.deepEqual(await uploadImage(CONFIG, new Blob([new Uint8Array([1])])), {
      assetId: ASSET_ID,
      checksum: CHECKSUM,
    })
  })

  it('refuses a response missing either half rather than storing half a reference', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    fetchStub.restore()
    fetchStub = installFetch(() => json(201, { asset: { id: ASSET_ID } }))
    await assert.rejects(
      () => uploadImage(CONFIG, new Blob([new Uint8Array([1])])),
      (err: unknown) => err instanceof ApiError && err.code === 'upload_malformed_response',
    )
  })
})

/* ------------------------------------------------------------------ the refusals, in words */

describe('studio’s refusals become sentences a person can act on', () => {
  it('explains svg_refused as a decision rather than a gap in support', () => {
    const message = uploadRefusal('upload_svg_refused', 'fallback')
    assert.match(message, /SVG/)
    // The REASON, not just the refusal. A user told only "not supported" will try renaming it —
    // and SVG is refused precisely because it is a document that can carry script.
    assert.match(message, /script/)
    assert.match(message, /PNG, JPEG or WebP/)
    assert.equal(message.includes('upload_'), false, 'a machine token reached the user')
  })

  it('explains too_large with something to do next', () => {
    const message = uploadRefusal('upload_too_large', 'fallback')
    assert.match(message, /too large/i)
    assert.match(message, /smaller|lower quality/i)
  })

  it('covers every reason studio can answer with, and none of them reads as a code', () => {
    // studio's own list: empty | too_large | svg_refused | unrecognised_format |
    // dimensions_unreadable | dimensions_out_of_range | pixel_budget_exceeded | truncated, plus
    // 429 upload_quota_exceeded.
    for (const reason of [
      'empty',
      'too_large',
      'svg_refused',
      'unrecognised_format',
      'dimensions_unreadable',
      'dimensions_out_of_range',
      'pixel_budget_exceeded',
      'truncated',
      'quota_exceeded',
    ]) {
      const message = uploadRefusal(`upload_${reason}`, 'FALLBACK')
      assert.notEqual(message, 'FALLBACK', `upload_${reason} has no sentence`)
      assert.equal(message.includes('_'), false, `upload_${reason} leaked a machine token`)
    }
  })

  it('falls through to studio’s own message for a code it has not been taught', () => {
    // A refusal this table does not know about is still one somebody wrote a sentence for.
    assert.equal(uploadRefusal('upload_something_new', 'studio said this'), 'studio said this')
    assert.equal(uploadRefusal(undefined, 'studio said this'), 'studio said this')
  })

  it('turns a studio refusal into an ApiError carrying the plain-language sentence', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    fetchStub.restore()
    fetchStub = installFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'upload_svg_refused', reason: 'svg_refused' } }), {
          status: 400,
          headers: { 'content-type': 'application/json', 'x-request-id': 'cf-abc' },
        }),
    )
    await assert.rejects(
      () => uploadImage(CONFIG, new Blob([new Uint8Array([1])])),
      (err: unknown) =>
        err instanceof ApiError &&
        err.status === 400 &&
        err.code === 'upload_svg_refused' &&
        err.requestId === 'cf-abc' &&
        /script/.test(err.message),
    )
  })
})

/* ------------------------------------------------------------------ attaching it */

describe('PUT and DELETE /markets/:id/image', () => {
  it('sends BOTH halves of the reference, with a token', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    await setMarketImage('m-1', { assetId: ASSET_ID, checksum: CHECKSUM })
    const call = onlyCall()
    const url = new URL(call.url)
    assert.equal(call.method, 'PUT')
    assert.equal(url.origin, BASE)
    assert.equal(url.pathname, '/markets/m-1/image')
    assert.equal(call.headers['authorization'], 'Bearer access-1')
    // Half a reference is refused by the route and by `markets_image_is_whole`. Both go, always.
    assert.deepEqual(JSON.parse(call.body ?? '{}'), { assetId: ASSET_ID, checksum: CHECKSUM })
  })

  it('clears with DELETE and no body', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    await clearMarketImage('m-1')
    const call = onlyCall()
    assert.equal(call.method, 'DELETE')
    assert.equal(new URL(call.url).pathname, '/markets/m-1/image')
    assert.equal(call.body, undefined)
  })

  it('encodes the id rather than pasting it into the path', async () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    await clearMarketImage('a/b')
    assert.equal(new URL(onlyCall().url).pathname, '/markets/a%2Fb/image')
  })
})

/* ------------------------------------------------------------------ what is rendered */

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ['/markets/m-1'] }, createElement(AuthProvider, null, node)),
  )
}

describe('the image on the page', () => {
  it('renders the bytes URL the service sent, with the question as its alt text', () => {
    const html = render(createElement(MarketImage, { image: IMAGE, question: 'Will X happen?' }))
    assert.ok(html.includes(`src="${IMAGE.bytesUrl}"`), html)
    // Not `alt=""`. This is content, not an icon: a reader on a screen reader is owed the same
    // "there is a picture here, of this market" a sighted reader gets.
    assert.match(html, /alt="Illustration for the market: Will X happen\?"/)
    assert.match(html, /loading="lazy"/)
  })

  it('renders NOTHING when there is no image', () => {
    assert.equal(render(createElement(MarketImage, { image: null, question: 'Q' })), '')
  })

  it('renders NOTHING when the reference exists but bytesUrl is null', () => {
    // The deployment has no public studio address. The reference is real and unfetchable, so the
    // honest rendering is nothing — not a broken `<img>`, and not a placeholder frame, which would
    // be a picture the market does not have.
    const html = render(
      createElement(MarketImage, { image: { ...IMAGE, bytesUrl: null }, question: 'Q' }),
    )
    assert.equal(html, '')
  })

  it('the market page shows the image above the question', () => {
    // The whole article, not the component in isolation — `houseseed.test.ts`'s argument: a test
    // that mounted the component directly would keep passing the day the page stopped mounting it.
    const html = render(
      createElement(MarketArticle, {
        detail: { ...detail(), market: market({ image: IMAGE }) },
        reload: () => undefined,
      }),
    )
    const imageAt = html.indexOf(IMAGE.bytesUrl!)
    const questionAt = html.indexOf('fs-market__question')
    assert.ok(imageAt >= 0, 'the market page did not render the image')
    assert.ok(imageAt < questionAt, 'the image is not above the question')
  })

  it('a market with no image renders the page unchanged', () => {
    const html = render(
      createElement(MarketArticle, { detail: detail(), reload: () => undefined }),
    )
    assert.equal(html.includes('fs-market__image'), false)
  })
})

describe('the operator control is offered to operators and nobody else', () => {
  it('is offered only when identity says admin', () => {
    assert.equal(offersImageControl(['admin']), true)
    assert.equal(offersImageControl(['player', 'admin']), true)
    assert.equal(offersImageControl(['player']), false)
    // The two cases `auth.tsx`'s header is about: identity nests the profile under `user`, and
    // reading `roles` from the wrong level made this `undefined` for every operator in the estate
    // while nothing failed and the menu was silently short. Both must be false, not throw.
    assert.equal(offersImageControl(null), false)
    assert.equal(offersImageControl(undefined), false)
    // `Admin` is not `admin`. A case-insensitive check here would accept a role identity does not
    // issue, which is a permission invented by a client.
    assert.equal(offersImageControl(['Admin']), false)
  })

  it('the market page renders no authoring panel for an anonymous reader', () => {
    const html = render(
      createElement(MarketArticle, {
        detail: { ...detail(), market: market({ image: IMAGE }) },
        reload: () => undefined,
      }),
    )
    // The picture is public. The control that changes it is not.
    assert.ok(html.includes(IMAGE.bytesUrl!), 'the image itself should still be public')
    assert.equal(html.includes('fs-imagepanel'), false, 'an anonymous reader was offered the control')
    assert.equal(html.includes('type="file"'), false)
  })
})

/* ------------------------------------------------------------------ the honesty constraint */

describe('the image is never presented as verified, attested, on-chain or anchored', () => {
  it('says none of those words anywhere in the rendered market page', () => {
    // ══════════════════════════════════════════════════════════════════════════════════════════
    // This page recomputes a REAL hash in the browser and renders a REAL tick for it
    // (`lib/market.ts`, `checkDocument`). A second tick beside the picture — one that cannot fail,
    // because foresight never re-measures the bytes and Hearth has no Registry of Authorship
    // contract to check against — would teach a reader that the first one is decoration too. On a
    // surface where the checks that CAN fail are the ones telling somebody whether to stake, that
    // is the most expensive thing this component could do.
    // ══════════════════════════════════════════════════════════════════════════════════════════
    const html = render(
      createElement(MarketArticle, {
        detail: { ...detail(), market: market({ image: IMAGE }) },
        reload: () => undefined,
      }),
    )
    // The window around the image, so the assertion is about the image rather than the page: the
    // criteria panel legitimately says "hashed into the contract" about the DOCUMENT.
    const at = html.indexOf('fs-market__image')
    assert.ok(at >= 0)
    const around = html.slice(Math.max(0, at - 600), at + 600).toLowerCase()
    for (const forbidden of ['verified', 'attested', 'anchored', 'on-chain', 'authentic']) {
      assert.equal(around.includes(forbidden), false, `the image sits beside the word "${forbidden}"`)
    }
  })

  it('the component source uses none of the forbidden words in a rendered string', async () => {
    // A grep, because the failure mode is somebody adding a reassuring word in a hurry — and the
    // rendered-markup test above only covers the states a fixture happens to produce.
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../src/components/marketimage.tsx', import.meta.url), 'utf8')
    // Strip comments: the file's own header QUOTES the forbidden words in order to forbid them,
    // exactly as `routes.test.ts` strips nginx's prose before checking its directives.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .toLowerCase()
    for (const forbidden of ['verified', 'attested', 'anchored', 'on-chain', 'on chain']) {
      assert.equal(code.includes(forbidden), false, `marketimage.tsx has a live "${forbidden}"`)
    }
    // And the label that IS used is the strongest true one.
    assert.ok(source.includes('Hash recorded'))
  })
})
