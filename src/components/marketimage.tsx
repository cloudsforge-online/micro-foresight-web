/**
 * The header image on a market: how it is shown, and how an operator changes it.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THE PICTURE IS DECORATION AND MUST NEVER READ AS EVIDENCE.**
 *
 * This page already carries two things that ARE evidence: the canonical document, whose hash is
 * recomputed in the browser and compared (`lib/market.ts`, `checkDocument`), and the house seed
 * disclosure, whose symmetry is re-derived from the numbers beside it. Both are rendered with
 * ticks, alarms and hashes, because both are claims a reader can check.
 *
 * An image is none of that. foresight stores studio's asset id and the checksum studio reported,
 * and never re-measures either. So:
 *
 *   * No tick, no badge, no "verified" chip, and none of the words verified, attested, on-chain
 *     or anchored anywhere near it.
 *   * It is NOT placed inside the terms panel and NOT beside the contract address or the document
 *     hash. It sits in the header, above the question, where a masthead image goes — because a
 *     picture rendered inside the panel that proves the criteria would borrow that panel's
 *     authority without having earned any of it.
 *   * The checksum is shown only in the operator's own panel, labelled "hash recorded", which is
 *     the strongest true statement available.
 *
 * The reason to be this careful is specific to this product. Foresight really does talk to a
 * chain, so a reader here is primed to read a hex digest as an on-chain fact. And the false claim
 * would never be caught: Hearth has no Registry of Authorship contract — the Solidity was never
 * written (`tessera/src/kiln.ts`) — and studio's `anchor.state` is `unanchored` on every
 * asset it has produced. A tick that cannot fail is worse than no tick, on a surface where the
 * ticks that CAN fail are the ones telling somebody whether to stake.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { noticeFor, type ErrorNotice } from '../lib/api.ts'
import { useSession } from '../lib/auth.tsx'
import { clearMarketImage, setMarketImage, type MarketImageRef, type MarketView } from '../lib/foresight.ts'
import { canUpload, getImageConfig, uploadImage, type ImageConfig } from '../lib/studio.ts'
import { shortHex } from '../lib/units.ts'

/**
 * The image itself.
 *
 * Renders NOTHING when there is no image, and nothing when `bytesUrl` is null. The second case is
 * the one worth stating: a null `bytesUrl` means the deployment has no public studio address, so
 * the reference is real but unfetchable. An `<img>` pointed at a guessed address would be a broken
 * picture; an empty frame with a placeholder would be a picture the market does not have. Nothing
 * is the honest rendering of "there is an image somewhere this page cannot reach".
 *
 * `alt` is the question, prefixed. It is not the empty string: this is content, not an icon, and a
 * reader using a screen reader is owed the same "there is a picture here, of this market" the
 * sighted reader gets. It is not the checksum either — a hex digest read aloud is noise.
 */
export function MarketImage({
  image,
  question,
  className = 'fs-market__image',
}: {
  image: MarketImageRef | null
  question: string
  className?: string
}) {
  if (image === null || image.bytesUrl === null) return null
  return (
    <img
      className={className}
      src={image.bytesUrl}
      // Truncated: an `alt` is read in full and a 500-character question is a paragraph.
      alt={`Illustration for the market: ${question.slice(0, 120)}`}
      // Below the fold on a list and above it on a market page; `lazy` is right for both, because
      // a card image that is never scrolled to is a request never worth making.
      loading="lazy"
      // The bytes come from another origin. Neither attribute is a security control — studio
      // serves with `nosniff` and its own CSP — but a referrer carrying this app's full URL to a
      // media host is a leak with nothing to gain.
      referrerPolicy="no-referrer"
      decoding="async"
    />
  )
}

type Phase = 'idle' | 'uploading' | 'saving'

/**
 * Whether to OFFER the image control. Pure, and exported so it can be asserted.
 *
 * ── This is not the security boundary, and saying so is the point of the doc comment ───────────
 *
 * What is ENFORCED is `requireAdmin` on `PUT`/`DELETE /markets/:id/image` in micro-foresight. A
 * reader who edits their own bundle, or calls the route directly, meets that check and never this
 * one. Rendering the panel to a non-operator would not be a vulnerability — it would be a control
 * that always 403s, which is worse for the reader and better for nobody.
 *
 * `'admin'` is the estate's spelling and it is checked against the list identity actually sends:
 * `@cloudsforge/ui` reads `account.roles?.includes('admin')` in the same shape. `auth.tsx`'s header
 * records what happens when this is got wrong — the profile is nested under `user`, and reading
 * `roles` from the top level made it `undefined` for every operator in the estate while nothing
 * failed and the menu was simply, silently, short.
 */
export function offersImageControl(roles: readonly string[] | null | undefined): boolean {
  return roles?.includes('admin') ?? false
}

/**
 * The operator's control: choose a file, upload it to studio, attach it to the market.
 *
 * ── Why this is on the public market page at all ───────────────────────────────────────────────
 *
 * This application has no create or edit flow. Markets are created and approved in `admin-web`'s
 * `/foresight` section, and there is nothing in this bundle that writes a market — until now, this
 * was a read-and-stake surface. So the "edit flow" the image needed is this: the market page,
 * shown only to a signed-in operator, on the market they are already looking at. Adding a whole
 * authoring section here to hold one control would be a second admin surface competing with the
 * real one.
 *
 * ── Hiding it is not the boundary ──────────────────────────────────────────────────────────────
 *
 * The role check below decides what is OFFERED. What is ENFORCED is `requireAdmin` on
 * `PUT/DELETE /markets/:id/image` in the service, which is where it has to be: a reader who edits
 * their own bundle, or curls the route, meets that check and not this one. Rendering the panel to
 * a non-operator would not be a vulnerability — it would be a control that always 403s, which is
 * worse UX for no security gain.
 *
 * ── Two calls, and the order matters ───────────────────────────────────────────────────────────
 *
 * The bytes go to studio FIRST and the reference to foresight second. The reverse is impossible —
 * there is no id to attach until studio has answered — and it is also the safe order: a crash
 * between them leaves an orphaned asset in studio, which costs storage, rather than a market
 * pointing at bytes that do not exist, which is a broken page.
 */
export function MarketImagePanel({ market, onChanged }: { market: MarketView; onChanged: () => void }) {
  const { account } = useSession()
  const isOperator = offersImageControl(account.roles)

  const [config, setConfig] = useState<ImageConfig | null>(null)
  const [configFailed, setConfigFailed] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [notice, setNotice] = useState<ErrorNotice | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  /**
   * The double-submit latch, for `StakePanel`'s reason in miniature.
   *
   * `phase` is read out of a render that has not committed when a second change event arrives, so
   * the `disabled` attribute is not on the node yet. A ref is mutated synchronously and is already
   * true. Two uploads of one file is not a money defect here, but it is two assets in studio and
   * two writes racing to be the market's image — and the loser is the one the user picked.
   */
  const busy = useRef(false)

  useEffect(() => {
    if (!isOperator) return
    const controller = new AbortController()
    getImageConfig(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setConfig(value)
      })
      .catch(() => {
        // A failed config read is not an outage for this page: everything else on it still works.
        // It only means the control cannot be offered, and the panel says so rather than showing
        // a file picker whose destination is unknown.
        if (!controller.signal.aborted) setConfigFailed(true)
      })
    return () => controller.abort()
  }, [isOperator])

  const onPick = useCallback(
    async (file: File | undefined) => {
      if (!file || busy.current || !canUpload(config)) return
      busy.current = true
      setNotice(null)
      setPhase('uploading')
      try {
        const reference = await uploadImage(config, file)
        setPhase('saving')
        // Both halves together. `markets_image_is_whole` refuses anything else, and `ImageRef`
        // gives this call no way to send one of them.
        await setMarketImage(market.id, reference)
        onChanged()
      } catch (err) {
        // `uploadImage` has already turned studio's `upload_<reason>` into a sentence a person can
        // act on — `svg_refused` and `too_large` above all. `noticeFor` keeps the request id.
        setNotice(noticeFor(err, 'The image could not be attached to this market.'))
      } finally {
        setPhase('idle')
        busy.current = false
        // Cleared so that picking the SAME file again fires a change event. Without this, a user
        // whose upload failed for a transient reason cannot retry with the same picture.
        if (input.current) input.current.value = ''
      }
    },
    [config, market.id, onChanged],
  )

  const onClear = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setNotice(null)
    setPhase('saving')
    try {
      await clearMarketImage(market.id)
      onChanged()
    } catch (err) {
      setNotice(noticeFor(err, 'The image could not be removed.'))
    } finally {
      setPhase('idle')
      busy.current = false
    }
  }, [market.id, onChanged])

  if (!isOperator) return null

  const working = phase !== 'idle'

  return (
    <section className="fs-panel fs-imagepanel" aria-labelledby="market-image-heading">
      <h2 className="fs-panel__title" id="market-image-heading">
        Header image
      </h2>
      <p className="fs-imagepanel__lede">
        Shown above the question, on this page and on the market card. It is decoration: it is not
        part of the resolution criteria, it is not in the hashed document, and changing it does not
        alter this market&rsquo;s question hash.
      </p>

      {configFailed && (
        <p className="fs-note fs-note--warn" role="status">
          The image service&rsquo;s address could not be read, so an image cannot be uploaded right
          now. Everything else on this page is unaffected.
        </p>
      )}

      {config !== null && !canUpload(config) && (
        <p className="fs-note fs-note--warn" role="status">
          This deployment has no public image service configured, so images cannot be uploaded or
          shown here.
        </p>
      )}

      {canUpload(config) && (
        <div className="fs-imagepanel__controls">
          <label className="fs-imagepanel__pick">
            <span>{market.image === null ? 'Choose an image' : 'Replace the image'}</span>
            <input
              ref={input}
              type="file"
              /*
               * A CONVENIENCE FOR THE FILE PICKER, NOT A SECURITY CONTROL.
               *
               * It stops a user being offered files that will be refused. It decides nothing:
               * micro-studio reads the MAGIC BYTES and is the only thing that decides what an
               * upload is. `accept` is defeated by a drag-and-drop, by a keyboard, and by anything
               * that is not a browser — and `File.type` comes from the EXTENSION on most
               * platforms, so a `.png` full of SVG would pass a client-side check. SVG is exactly
               * the format studio refuses on purpose, because an SVG is a document that can carry
               * script. The list comes from the service so it cannot drift from what studio takes.
               */
              accept={config.accept.join(',')}
              disabled={working}
              onChange={(event) => void onPick(event.target.files?.[0])}
            />
          </label>
          {market.image !== null && (
            <button type="button" className="cf-btn" disabled={working} onClick={() => void onClear()}>
              Remove the image
            </button>
          )}
        </div>
      )}

      {working && (
        <p className="fs-note" role="status">
          {phase === 'uploading' ? 'Uploading the image…' : 'Attaching it to the market…'}
        </p>
      )}

      {notice && (
        <p className="fs-note fs-note--warn" role="alert">
          {notice.message}
          {notice.requestId && (
            <>
              {' '}
              <span className="cf-num">({notice.requestId})</span>
            </>
          )}
        </p>
      )}

      {market.image !== null && (
        <dl className="fs-imagepanel__facts">
          <div>
            {/*
              "Hash recorded" is the strongest TRUE label available and it is the one used.
              micro-studio measured this digest and micro-foresight stored it; neither this app nor
              foresight ever re-measures the bytes. "Verified" would be a claim about a property
              nothing here has, and — because Hearth has no Registry of Authorship to check against
              — a claim that could never be seen to fail.
            */}
            <dt>Hash recorded</dt>
            <dd className="cf-num" title={market.image.checksum}>
              {shortHex(market.image.checksum.replace(/^sha256:/, ''), 12, 8)}
            </dd>
          </div>
          <div>
            <dt>Asset</dt>
            <dd className="cf-num" title={market.image.assetId}>
              {market.image.assetId.slice(0, 8)}…
            </dd>
          </div>
        </dl>
      )}
    </section>
  )
}
