/**
 * Uploading a header image to `micro-studio`, and saying in plain language why it refused.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THIS APP DOES NOT KNOW WHERE micro-studio IS, AND MUST NOT GUESS.**
 *
 * `hosts.ts` resolves every other address from `@cloudsforge/ui`'s surfaces registry at runtime.
 * There is NO `studio` row in that registry — it is not a product surface, it has no subdomain
 * there, and in the estate today it is published on `127.0.0.1:4111` with no public hostname at
 * all. So `cloudsforgeHosts().studio` does not exist, and the obvious workaround — swapping the
 * first hostname label for `studio` — would invent an address nobody has published.
 *
 * `lib/foresight.ts`'s header names the two defects this estate has already shipped of exactly
 * that kind: `micro-wallet` calling `POST /v1/quotes` at a service that serves `/rates`, and
 * `micro-market` calling a `/v1` path at a service with no `/v1` routes, which 403'd every
 * listing. Both were a client written against a surface somebody imagined.
 *
 * So the address is ASKED FOR: `GET /image-config` on micro-foresight answers with the studio
 * origin the deployment was configured with, the upload path spelled as studio spells it, the
 * visibility to use, and the media types worth offering in a file picker. `studioUrl: null` is a
 * real answer — "this deployment cannot serve images from here" — and the UI renders it as a
 * sentence rather than as an upload control that fails.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THE BODY IS RAW BYTES. IT IS NOT `multipart/form-data`.**
 *
 * studio's `POST /v1/uploads` reads the request body AS THE IMAGE. A `FormData` body — the reflex
 * for a file input — would send a multipart envelope whose first bytes are `--------------------`,
 * and studio, which decides what a file is by reading its MAGIC BYTES, would correctly refuse it
 * as `unrecognised_format`. The refusal would be right and the diagnosis would be impossible: the
 * user picked a real PNG and was told it is not an image.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **NOTHING HERE VALIDATES AN IMAGE, AND THE `accept` ATTRIBUTE IS NOT A CONTROL.**
 *
 * studio validates magic bytes, REFUSES SVG outright, bounds dimensions and pixel count, strips
 * EXIF and GPS, and serves with `nosniff` and a restrictive CSP. Every one of those decisions is
 * made on the server, on the bytes, after they arrive. `accept="image/png,image/jpeg,image/webp"`
 * on the input exists so a user is not offered files that will be refused — it is a courtesy to
 * the file picker. It can be defeated by dragging a file, by a keyboard, or by any caller that is
 * not a browser, and re-checking the MIME type here would only move a refusal earlier while
 * changing nothing about what is enforced.
 *
 * A client-side check would also be actively worse in one specific way: the browser's `File.type`
 * comes from the file EXTENSION on most platforms, so a `.png` full of SVG would pass it. SVG is
 * the one format studio refuses on purpose, because an SVG is a document that can carry script.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { ApiError, api, getAccessToken } from './api.ts'

/** The body of `GET /image-config` — `foresight/src/server.ts`, `buildRoutes()`. */
export interface ImageConfig {
  /** studio's browser-reachable origin, or `null` when this deployment has none configured. */
  readonly studioUrl: string | null
  /** studio's own spelling of the upload path. Never composed here. */
  readonly uploadPath: string
  readonly visibility: string
  /** For the file input's `accept`. A convenience, never a control — see the header. */
  readonly accept: readonly string[]
}

/** A whole reference, as `foresight/src/images.ts` defines it: both halves or neither. */
export interface ImageRef {
  readonly assetId: string
  /** `sha256:<64 lowercase hex>` as studio spelled it. RECORDED by foresight, never verified. */
  readonly checksum: string
}

export function getImageConfig(signal?: AbortSignal): Promise<ImageConfig> {
  // Unauthenticated: everything in the answer is a hostname and a path that are public by
  // construction, and the market pages that need it are public too.
  return api<ImageConfig>('/image-config', { auth: false, ...(signal ? { signal } : {}) })
}

/**
 * Whether the deployment can accept an upload at all.
 *
 * Separate from the upload call so the UI can say "not configured here" up front rather than
 * offering a control that fails after the user has chosen a file.
 */
export function canUpload(config: ImageConfig | null): config is ImageConfig & { studioUrl: string } {
  return config !== null && config.studioUrl !== null
}

/**
 * studio's refusals, in words a person can act on.
 *
 * ── Why this is a table rather than the server's sentence ──────────────────────────────────────
 *
 * studio answers `{error: {code: "upload_<reason>", reason}}`, and the `reason` is a machine token:
 * `svg_refused`, `pixel_budget_exceeded`, `dimensions_out_of_range`. Rendering those verbatim
 * would be the same failure as printing an error code at a user — and two of them, `svg_refused`
 * and `too_large`, are the ones a real person actually hits, so they are the two that most need a
 * sentence saying what to do next.
 *
 * `svg_refused` in particular deserves its reason rather than a shrug: SVG is refused because it
 * is a document that can carry script, not because it is an unusual format. A user told only "not
 * supported" will reasonably try to rename it.
 *
 * An unrecognised code falls through to studio's own message rather than to a generic one, because
 * a refusal this table has not been taught about is still a refusal somebody wrote a sentence for.
 */
export function uploadRefusal(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'upload_svg_refused':
      return (
        'SVG images are not accepted. An SVG is a document that can carry script, so it is refused ' +
        'on purpose rather than for lack of support. Export the artwork as PNG, JPEG or WebP and ' +
        'try again.'
      )
    case 'upload_too_large':
      return 'That file is too large. Try a smaller image, or export it at a lower quality.'
    case 'upload_empty':
      return 'That file is empty — there were no bytes to upload.'
    case 'upload_unrecognised_format':
      return (
        'That file is not a PNG, JPEG or WebP image. The check is on the file’s actual contents ' +
        'rather than its name, so renaming it will not help.'
      )
    case 'upload_truncated':
      return 'That image is incomplete — the file ends part way through. It may have been cut off during a download or a copy.'
    case 'upload_dimensions_unreadable':
      return 'The image’s width and height could not be read, so it cannot be accepted.'
    case 'upload_dimensions_out_of_range':
      return 'That image’s width or height is outside the range this platform accepts. Resize it and try again.'
    case 'upload_pixel_budget_exceeded':
      return 'That image has too many pixels overall. A very wide or very tall image can exceed the limit even when neither side looks large.'
    case 'upload_quota_exceeded':
      return 'You have uploaded a lot of images recently and have reached the limit. Wait a little and try again.'
    default:
      return fallback
  }
}

/**
 * Send one image to studio and return the reference micro-foresight stores.
 *
 * `visibility` comes from the config rather than being written here, and the value the service
 * publishes is `public`. That is not cosmetic: studio's `GET /v1/assets/:id/bytes` requires no
 * Authorization header for a public asset and requires one for a private asset, and a browser
 * sends no bearer token on an `<img src>`. A private header image is a broken picture on a public
 * page.
 *
 * A missing access token is refused here rather than sent as an anonymous request: studio would
 * answer 401 and the user would be shown "unauthenticated" for what is really "you are signed out".
 */
export async function uploadImage(
  config: ImageConfig,
  file: Blob,
  signal?: AbortSignal,
): Promise<ImageRef> {
  const origin = config.studioUrl
  if (origin === null) {
    throw new ApiError(0, 'This deployment has no image service configured, so images cannot be uploaded here.')
  }
  const token = getAccessToken()
  if (!token) throw new ApiError(401, 'Sign in before uploading an image.')

  const url = new URL(config.uploadPath, origin)
  url.searchParams.set('visibility', config.visibility)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        // The browser's guess at the type, passed through as a HINT. studio reads the magic bytes
        // and does not trust this; sending nothing at all would be equally correct, and sending it
        // makes a proxy in between less likely to mangle the body.
        'content-type': file.type || 'application/octet-stream',
        accept: 'application/json',
      },
      // RAW BYTES. See the header: a FormData body here would arrive as a multipart envelope and
      // be refused as `unrecognised_format`, which is correct and undiagnosable.
      body: file,
      ...(signal ? { signal } : {}),
    })
  } catch {
    throw new ApiError(0, 'The image service could not be reached. Check your connection and try again.')
  }

  const requestId = res.headers.get('x-request-id') ?? undefined

  if (!res.ok) {
    let code: string | undefined
    let message = `The image was refused (${res.status}).`
    try {
      const parsed = (await res.json()) as { error?: { code?: unknown; message?: unknown } }
      if (typeof parsed.error?.code === 'string') code = parsed.error.code
      if (typeof parsed.error?.message === 'string') message = parsed.error.message
    } catch {
      // A non-JSON body means something in front of studio answered. The status still tells us
      // enough to say something true, and `uploadRefusal` falls through to it.
    }
    throw new ApiError(res.status, uploadRefusal(code, message), code, requestId)
  }

  // 201 for a new upload, 200 with `deduplicated: true` when this owner already uploaded these
  // exact bytes. Both are successes and both carry the same asset, so neither is special-cased:
  // re-uploading the same picture is not an error and must not read as one.
  const body = (await res.json()) as { asset?: { id?: unknown; checksum?: unknown } }
  const assetId = body.asset?.id
  const checksum = body.asset?.checksum
  if (typeof assetId !== 'string' || typeof checksum !== 'string') {
    // Refused rather than half-stored. foresight's `markets_image_is_whole` would reject half a
    // reference anyway; failing here gives the user a sentence instead of a 400 they cannot act on.
    throw new ApiError(
      502,
      'The image service answered without an asset id and checksum, so there is nothing to attach.',
      'upload_malformed_response',
      requestId,
    )
  }
  return { assetId, checksum }
}
