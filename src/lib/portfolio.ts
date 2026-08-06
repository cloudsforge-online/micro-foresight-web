/**
 * One address's positions, assembled from a service that has no route for them.
 *
 * ── The N+1 is the service's shape ─────────────────────────────────────────────────────────────
 *
 * `foresight/src/server.ts` is the whole route table and there is no
 * `GET /positions?address=`. The public reads are `/markets` (`server.ts`), `/markets/:id`
 * (`server.ts`) and `/markets/:id/positions/:address` (`server.ts`). So a portfolio is a
 * list of markets and one position request per market.
 *
 * That has consequences this file is responsible for, and they are the whole of it:
 *
 *   1. **Bounded concurrency.** A hundred markets is a hundred requests, and firing them at once
 *      is how a page turns a healthy service into a busy one. Six at a time.
 *   2. **Per-market degradation, not per-page.** One market's position failing must not blank the
 *      other ninety-nine. `hub-web` has seven tests for this shape; the rule is the same here —
 *      render what answered and NAME what did not.
 *   3. **`asOf` per row.** Every position carries its own observation time, because they were
 *      fetched at different moments from a mirror that may have advanced in between. A single
 *      page-level stamp would be a claim that all hundred were true at one instant, which is the
 *      exact class of quiet lie this estate writes tests against.
 */
import type { MarketView, PositionResponse } from './foresight.ts'
import { fromWeiString } from './units.ts'

/** How many position requests are in flight at once. */
export const POSITION_CONCURRENCY = 6

export interface PositionRow {
  readonly market: MarketView
  /** Wei staked on YES, or `null` when this row could not be fetched. Never 0n for "unknown". */
  readonly stakedYes: bigint | null
  readonly stakedNo: bigint | null
  /** This row's own observation time — `server.ts`. */
  readonly asOf: string | null
  readonly stale: boolean
  readonly contractAddress: string | null
  /** Set when this one market's position did not load. The row still renders. */
  readonly error: string | null
}

/** A row from a successful response. */
export function rowFrom(market: MarketView, response: PositionResponse): PositionRow {
  return {
    market,
    stakedYes: fromWeiString(response.position.yes),
    stakedNo: fromWeiString(response.position.no),
    asOf: response.asOf,
    stale: response.stale,
    // The service's copy is the one to trust: `publicView` and the positions route read the same
    // row, but only the latter is guaranteed to have been read in the same request as the stake.
    contractAddress: response.contractAddress ?? market.contractAddress,
    error: null,
  }
}

/** A row for a market whose position could not be read. It renders, WITHOUT a figure. */
export function failedRow(market: MarketView, message: string): PositionRow {
  return {
    market,
    stakedYes: null,
    stakedNo: null,
    asOf: null,
    stale: false,
    contractAddress: market.contractAddress,
    error: message,
  }
}

/** True when this address has anything at all in this market. Unknown is not "nothing". */
export function hasStake(row: PositionRow): boolean {
  return (row.stakedYes ?? 0n) > 0n || (row.stakedNo ?? 0n) > 0n
}

/**
 * Fetch every position, `POSITION_CONCURRENCY` at a time, and never reject.
 *
 * The `fetchOne` callback is injected so `test/portfolio.test.ts` can drive the concurrency limit,
 * the failure isolation and the ordering without a network. It returns rows IN THE ORDER OF THE
 * MARKETS given, regardless of the order the responses arrive in — a portfolio that reshuffles as
 * it loads is a portfolio nobody can read while it is loading.
 */
export async function loadPositions(
  markets: readonly MarketView[],
  fetchOne: (market: MarketView) => Promise<PositionResponse>,
  onFailure: (market: MarketView, err: unknown) => string,
  concurrency: number = POSITION_CONCURRENCY,
): Promise<readonly PositionRow[]> {
  const rows = new Array<PositionRow | undefined>(markets.length)
  let next = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next
      next += 1
      if (index >= markets.length) return
      const market = markets[index]
      if (!market) return
      try {
        rows[index] = rowFrom(market, await fetchOne(market))
      } catch (err) {
        // One market's failure is one row's failure. This is the whole point of the loop.
        rows[index] = failedRow(market, onFailure(market, err))
      }
    }
  }

  const lanes = Math.max(1, Math.min(concurrency, markets.length))
  await Promise.all(Array.from({ length: lanes }, () => worker()))
  return rows.filter((row): row is PositionRow => row !== undefined)
}

export interface PortfolioSummary {
  /** Rows with a stake in them. */
  readonly held: number
  /** Rows that answered with nothing staked. A real answer, and a different one from a failure. */
  readonly empty: number
  /** Rows that did not load. Named on the page, never silently dropped. */
  readonly failed: number
  /** Rows whose mirror said it was behind. Their figures carry the warning. */
  readonly stale: number
  /**
   * The OLDEST observation among the rows that answered, or `null`.
   *
   * The oldest rather than the newest, and rather than "now". A page stamped with its newest
   * observation is a page claiming a currency its oldest row does not have — the same rule
   * `hub-api/src/portfolio.ts` applies to a valuation assembled from several quotes.
   */
  readonly oldestAsOf: string | null
}

export function summarise(rows: readonly PositionRow[]): PortfolioSummary {
  let held = 0
  let empty = 0
  let failed = 0
  let stale = 0
  let oldest: number | null = null
  let oldestIso: string | null = null

  for (const row of rows) {
    if (row.error !== null) {
      failed += 1
      continue
    }
    if (hasStake(row)) held += 1
    else empty += 1
    if (row.stale) stale += 1
    if (row.asOf !== null) {
      const at = new Date(row.asOf).getTime()
      if (!Number.isNaN(at) && (oldest === null || at < oldest)) {
        oldest = at
        oldestIso = row.asOf
      }
    }
  }

  return { held, empty, failed, stale, oldestAsOf: oldestIso }
}

/**
 * What is missing from this page, in one sentence, or `null` when nothing is.
 *
 * Rendered as a banner. `hub-web`'s rule: one upstream being down renders the rest and NAMES what
 * is missing — a page that quietly shows ninety-nine rows when a hundred were asked for is a page
 * that has lost a position without telling anybody.
 */
export function missingSentence(summary: PortfolioSummary): string | null {
  const parts: string[] = []
  if (summary.failed > 0) {
    parts.push(
      `${summary.failed} ${summary.failed === 1 ? 'market' : 'markets'} did not answer, so ${summary.failed === 1 ? 'its position is' : 'their positions are'} not shown`,
    )
  }
  if (summary.stale > 0) {
    parts.push(
      `${summary.stale} ${summary.stale === 1 ? 'row is' : 'rows are'} from a mirror that is behind the chain`,
    )
  }
  if (parts.length === 0) return null
  return `${parts.join('; ')}. Your stakes are in the contracts either way — this page is a copy of them, not the record.`
}
