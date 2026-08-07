/**
 * What a market page has to work out for itself: whether the document is genuine, how old the
 * pool is, and where in its life the market currently sits.
 */
import type { MarketDetail, MarketStatus, MarketView, PoolView } from './foresight.ts'
import { ageLabel, asOfStamp, instant } from './format.ts'
import { keccak256Utf8 } from './keccak.ts'

/* ------------------------------------------------------------------ the document */

export interface DocumentCheck {
  /** keccak256 of the canonical bytes the service sent, computed here. */
  readonly recomputed: string
  /** The hash the service says belongs to this market. */
  readonly claimed: string
  /** True when they agree, AND when the market's own `questionHash` agrees with both. */
  readonly matches: boolean
}

/**
 * Recompute the question hash from the canonical document, and compare.
 *
 * ── Why this is not decoration ─────────────────────────────────────────────────────────────────
 *
 * `foresight/src/server.ts` gives the reason the canonical document is on the wire at all:
 *
 *   > so a reader can recompute `questionHash` themselves and check it against the contract,
 *   > rather than taking the platform's word that the criteria have not been edited since it
 *   > opened.
 *
 * The hash is in the market's constructor and is immutable (`ForesightMarket.sol`). An
 * operator who edited the criteria after opening would produce a page whose document no longer
 * hashes to the number the contract holds. A page that PRINTS the hash the server sent, beside the
 * document the server sent, has checked nothing at all — it would agree with a forged pair as
 * readily as with a real one. So this recomputes it, in the browser, from the bytes shown.
 *
 * Both comparisons matter: the `document.hash` field and the market's own `questionHash` are two
 * different fields of one response (`server.ts`, `markets.ts`), and a mismatch between
 * *them* is as interesting as a mismatch with the recomputed value.
 *
 * This still does not read the contract — that needs an archive node or an explorer, and the
 * market page links to one. What it proves is the half that can be proven from here: that the
 * criteria on screen are the criteria that were hashed.
 */
export function checkDocument(detail: Pick<MarketDetail, 'document' | 'market'>): DocumentCheck {
  const recomputed = keccak256Utf8(detail.document.canonical)
  const claimed = detail.document.hash
  const matches =
    recomputed.toLowerCase() === claimed.toLowerCase() &&
    claimed.toLowerCase() === detail.market.questionHash.toLowerCase()
  return { recomputed, claimed, matches }
}

/* ------------------------------------------------------------------ the observation */

export type ObservationTone = 'current' | 'stale' | 'never'

export interface Observation {
  readonly tone: ObservationTone
  /** The line that goes beside every figure taken from this pool. Never empty. */
  readonly text: string
}

/**
 * The sentence that must appear beside any figure derived from the mirror.
 *
 * Three cases, and they are three because collapsing them loses the thing a reader needs:
 *
 *   never   — the mirror has never run for this market. The pool reads as empty and it means
 *             "unknown". `mirror.ts`: "A mirror that has never run is stale, not empty.
 *             The two look identical in the numbers above and they mean opposite things to
 *             somebody about to stake."
 *   stale   — it ran, and it is at least a confirmation depth behind. The numbers were true once.
 *   current — it ran recently. Even here the time is printed: a figure with no observation time
 *             is a claim about now that is really a claim about whenever the mirror last synced.
 */
export function observation(pool: Pick<PoolView, 'asOf' | 'stale' | 'behindBlocks'>, now: Date = new Date()): Observation {
  if (pool.asOf === null) {
    return {
      tone: 'never',
      text: 'Nobody has read the chain for this market yet, which makes the figures below not known — not zero.',
    }
  }
  const stamp = asOfStamp(pool.asOf) ?? 'as of an unreadable time'
  const age = ageLabel(pool.asOf, now)
  const behind =
    pool.behindBlocks !== null && pool.behindBlocks > 0 ? `, ${pool.behindBlocks} blocks behind the tip` : ''
  if (pool.stale) {
    return {
      tone: 'stale',
      text: `Pool ${stamp}${age === null ? '' : ` (${age})`}${behind}. Our copy has fallen behind the chain, so treat these numbers as having moved.`,
    }
  }
  return {
    tone: 'current',
    text: `Pool ${stamp}${age === null ? '' : ` (${age})`}${behind}.`,
  }
}

/* ------------------------------------------------------------------ the lifecycle */

export type MarketPhase =
  | 'not_open'
  | 'open'
  | 'closing_soon'
  | 'closed'
  | 'resolved'
  | 'settled'
  | 'void'

/**
 * Where this market is, for a reader rather than for the state machine.
 *
 * `closing_soon` is not one of the service's seven statuses (`markets.ts`) — it is `open` with
 * less than an hour left, surfaced because the one thing a reader can no longer do after the close
 * time is the thing this page is for.
 */
export function phaseOf(market: Pick<MarketView, 'status' | 'closeTime'>, now: Date = new Date()): MarketPhase {
  switch (market.status) {
    case 'draft':
    case 'approved':
      return 'not_open'
    case 'closed':
      return 'closed'
    case 'resolved':
      return 'resolved'
    case 'settled':
      return 'settled'
    case 'void':
      return 'void'
    case 'open': {
      const closes = instant(market.closeTime)
      if (closes === null) return 'open'
      const left = closes.getTime() - now.getTime()
      if (left <= 0) return 'closed'
      return left <= 3_600_000 ? 'closing_soon' : 'open'
    }
  }
}

/** The word a reader sees for a phase. Never colour alone — this is the other channel. */
export function phaseLabel(phase: MarketPhase): string {
  switch (phase) {
    case 'not_open':
      return 'Not open yet'
    case 'open':
      return 'Open'
    case 'closing_soon':
      return 'Closing soon'
    case 'closed':
      return 'Closed, awaiting resolution'
    case 'resolved':
      return 'Resolved'
    case 'settled':
      return 'Settled'
    case 'void':
      return 'Void — refunds'
  }
}

/**
 * The outcome, as a word.
 *
 * `outcome` is `0` for YES and `1` for NO (`ForesightMarket.sol`), and `null` until it is
 * posted. `0` being falsy is exactly the trap here: `market.outcome ? 'No' : 'Yes'` would call an
 * unresolved market a YES, which is a wrong answer that renders confidently.
 */
export function outcomeLabel(outcome: number | null): string | null {
  if (outcome === 0) return 'Yes'
  if (outcome === 1) return 'No'
  return null
}

/** Whether a status can still take stakes. `server.ts` is the authority. */
export function takesStakes(status: MarketStatus): boolean {
  return status === 'open'
}
