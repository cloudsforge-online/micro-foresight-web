/**
 * Times, and the observation stamps that go beside every figure on this site.
 *
 * ── Rule one of this estate: every figure carries its observation time ─────────────────────────
 *
 * The positions table and the pools are a MIRROR of chain state, fed by `micro-indexer`. A number
 * from a mirror with no `asOf` beside it is a claim about now that is really a claim about
 * whenever the mirror last synced, and the difference is the whole distance between a pool a user
 * can stake against and a pool that was true four minutes ago. `foresight/src/mirror.ts:259-262`
 * carries `asOf`, `lastBlock`, `tipBlock` and `behindBlocks` for exactly this reason, and
 * `server.ts:466-467` repeats `asOf` on the positions route rather than making a client dig it
 * out of a sibling object: "A portfolio page that shows a number without saying when it was true
 * is the page that makes somebody think the mirror is the ledger."
 *
 * So `stamp()` returns `null` when there is no instant, and no caller may substitute "just now".
 *
 * ── Times are UTC, with a fixed locale ─────────────────────────────────────────────────────────
 *
 * The same instant must read identically on a developer's machine, in CI, and in the screenshot a
 * user attaches when they say the page was wrong. A close time rendered in the viewer's zone
 * makes two people reading one market disagree about when it shuts, which is the one thing a
 * close time exists to settle.
 */

/** `14:22` UTC. `null` for anything unparseable — never a fallback string that looks like a time. */
export function utcTime(iso: string | null | undefined): string | null {
  const at = instant(iso)
  if (at === null) return null
  return at.toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** `14 Mar 2026, 14:22` UTC — the form a close time and a dispute deadline are written in. */
export function utcDateTime(iso: string | null | undefined): string | null {
  const at = instant(iso)
  if (at === null) return null
  const date = at.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  return `${date}, ${utcTime(iso)} UTC`
}

/** A parsed instant, or `null`. The one place a date string is trusted. */
export function instant(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? null : at
}

/**
 * The stamp that goes beside a mirrored figure: `as of 14:22 UTC`.
 *
 * `null` when the mirror has never run. The caller renders "not yet observed" rather than a time,
 * because a missing observation and an old one are different facts and only one of them means the
 * number above it was ever true.
 */
export function asOfStamp(iso: string | null | undefined): string | null {
  const time = utcTime(iso)
  return time === null ? null : `as of ${time} UTC`
}

/**
 * How long ago, in words. `null` for a missing or future instant.
 *
 * A future `asOf` is a clock disagreement between this browser and the indexer, not a negative
 * age, and rendering "in 3 minutes" beside a pool would be worse than rendering nothing.
 */
export function ageLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  const at = instant(iso)
  if (at === null) return null
  const ms = now.getTime() - at.getTime()
  if (ms < 0) return null
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return seconds < 5 ? 'just now' : `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * How long until an instant, in words: `3d 4h`, `12 min`, or `null` once it has passed.
 *
 * Coarse on purpose. A market that closes in three days does not need a seconds counter, and a
 * ticking one is motion this page has no reason to make — `prefers-reduced-motion` aside, a
 * countdown implies urgency the product does not want to manufacture around somebody's money.
 */
export function untilLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  const at = instant(iso)
  if (at === null) return null
  const ms = at.getTime() - now.getTime()
  if (ms <= 0) return null
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${minutes % 60} min`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

/**
 * A duration in seconds as a phrase — how a dispute window is written.
 *
 * `disputeWindowSeconds` is an integer on the market (`foresight/src/markets.ts:92`) and is shown
 * before anybody stakes, because it is the time between a resolution being posted and the money
 * becoming claimable, which is the window in which a wrong resolution can still be voided.
 */
export function durationLabel(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null
  if (seconds === 0) return 'none'
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60)
    return `${minutes} minute${minutes === 1 ? '' : 's'}`
  }
  if (seconds < 86_400) {
    const hours = Math.round(seconds / 3600)
    return `${hours} hour${hours === 1 ? '' : 's'}`
  }
  const days = Math.round(seconds / 86_400)
  return `${days} day${days === 1 ? '' : 's'}`
}

/** Unix seconds to an ISO instant. What a `uint64` off the contract has to become to be shown. */
export function fromUnixSeconds(seconds: bigint | null): string | null {
  if (seconds === null || seconds <= 0n) return null
  // Milliseconds past what a Date can hold render as "Invalid Date"; refuse rather than show it.
  const ms = seconds * 1000n
  if (ms > 8_640_000_000_000_000n) return null
  return new Date(Number(ms)).toISOString()
}
