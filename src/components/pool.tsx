/**
 * The odds, drawn as what they are: a ratio between two pools.
 *
 * ── The form, and why it is this one ───────────────────────────────────────────────────────────
 *
 * The data's job is part-to-whole with exactly two classes, so the form is a horizontal stacked
 * bar and not a two-slice pie, not a gauge, and not a pair of stat tiles. Both segments are
 * direct-labelled, because with two series a legend box would be a second place to look for
 * something the marks can say themselves.
 *
 * ── Colour ─────────────────────────────────────────────────────────────────────────────────────
 *
 * `--cf-viz-2` (teal) and `--cf-viz-3` (gold), which are slots 2 and 3 of the design system's
 * categorical ramp — adjacent slots, taken in order, never invented. Validated against this app's
 * ground (#12100f): worst-adjacent ΔE 13.7 protan, 19.8 tritan, 17.3 normal vision, both above
 * 3:1 contrast. Nothing here picks a hue by hand and nothing recolours on filter.
 *
 * These are CATEGORICAL slots and not the status palette, deliberately. YES and NO are identities,
 * not states: green-for-yes would say the platform thinks one outcome is the good one, in a
 * product whose whole claim is that it asserts nothing about which way a question goes.
 *
 * ── Never colour alone ─────────────────────────────────────────────────────────────────────────
 *
 * Three other channels carry the same distinction: each segment is direct-labelled with its name,
 * the key below repeats name + percentage + pool size as text, and the NO segment carries a 45°
 * hatch that survives `forced-colors` and a black-and-white print. A reader who sees no colour at
 * all loses nothing.
 *
 * ── And the sentence that must never be omitted ────────────────────────────────────────────────
 *
 * A parimutuel share is not a price, not a probability the platform asserts, and NOT a return.
 * `ForesightMarket.sol` and `pool.ts` both say it; this component prints it.
 */
import type { ReactNode } from 'react'
import { OUTCOME_NO, OUTCOME_YES } from '../lib/abi.ts'
import { oddsBps, totalOf, type Pools } from '../lib/pool.ts'
import { formatBps, formatEmber } from '../lib/units.ts'

export function PoolRatioBar({
  pools,
  note,
  tone,
}: {
  pools: Pools
  /** The observation line. Always rendered; see `market.observation`. */
  note: string
  tone: 'current' | 'stale' | 'never'
}) {
  const total = totalOf(pools)
  const yesBps = oddsBps(pools, OUTCOME_YES)
  const noBps = oddsBps(pools, OUTCOME_NO)
  const known = total !== null && total > 0n && yesBps !== null && noBps !== null

  return (
    <figure className="fs-pool">
      <figcaption className="fs-pool__caption">
        <span className="fs-pool__title">Pool split</span>
        <span className="fs-pool__sub">
          Odds here are the pool ratio and nothing else — the share of everything staked that sits
          on each side.
        </span>
      </figcaption>

      {known ? (
        <div
          className="fs-bar"
          role="img"
          aria-label={`Yes ${formatBps(yesBps)} of the pool, No ${formatBps(noBps)} of the pool.`}
        >
          {/*
            The share as flex-BASIS, not flex-grow, and the reason is the degenerate case. With
            `flexGrow` a side holding 0% of the pool gets no growth and therefore falls back to its
            content width — so a 100/0 market would draw a visible Yes segment wide enough to hold
            the words "Yes 0.0%". A mark whose length disagrees with the number printed on it is
            the whole failure a bar chart exists to avoid.

            With a percentage basis the two bases sum to 100% while the line is 2px shorter (the
            gap), so flex-shrink takes those 2px PROPORTIONALLY from both. The gap comes out of the
            layout rather than out of one side's data, and `min-width: 0` in the stylesheet lets a
            zero share reach zero width instead of being propped up by its own label.
          */}
          <div
            className="fs-bar__seg fs-bar__seg--yes"
            style={{ flex: `0 1 ${yesBps / 100}%` }}
          >
            <span className="fs-bar__label">Yes {formatBps(yesBps)}</span>
          </div>
          <div className="fs-bar__seg fs-bar__seg--no" style={{ flex: `0 1 ${noBps / 100}%` }}>
            <span className="fs-bar__label">No {formatBps(noBps)}</span>
          </div>
        </div>
      ) : (
        <p className="fs-bar fs-bar--empty" role="status">
          {total === null
            ? 'The pool could not be read, so there is no ratio to show.'
            : 'Nothing has been staked yet, so there is no ratio to show. That is not a 50/50 — it is no market yet.'}
        </p>
      )}

      {/*
        The table view. Every figure the bar encodes, as text, with its unit — which is also what a
        screen reader gets, and what survives a printout.
      */}
      <dl className="fs-key">
        <KeyRow side="yes" label="Yes" share={yesBps} wei={pools.yes} />
        <KeyRow side="no" label="No" share={noBps} wei={pools.no} />
        <div className="fs-key__row fs-key__row--total">
          <dt className="fs-key__name">
            <span className="fs-key__swatch fs-key__swatch--total" aria-hidden="true" />
            Total staked
          </dt>
          <dd className="fs-key__value cf-num">{amount(total)}</dd>
        </div>
      </dl>

      <p className={`fs-stamp fs-stamp--${tone}`} role={tone === 'stale' || tone === 'never' ? 'alert' : 'status'}>
        <span className="fs-stamp__icon" aria-hidden="true">
          {tone === 'never' ? '■' : tone === 'stale' ? '▲' : '◷'}
        </span>
        {note}
      </p>

      <p className="fs-caveat">
        A parimutuel payout is decided by the pool <em>at settlement</em>, not by the pool now.
        Anybody may stake after you, and every stake changes what every winning stake is worth.
        These figures are not a quoted return.
      </p>
    </figure>
  )
}

function KeyRow({
  side,
  label,
  share,
  wei,
}: {
  side: 'yes' | 'no'
  label: string
  share: number | null
  wei: bigint | null
}) {
  return (
    <div className="fs-key__row">
      <dt className="fs-key__name">
        <span className={`fs-key__swatch fs-key__swatch--${side}`} aria-hidden="true" />
        {label}
      </dt>
      <dd className="fs-key__value cf-num">
        {/* A share of nothing is not 0% — see `pool.oddsBps`. */}
        <span className="fs-key__share">{share === null ? 'no share yet' : formatBps(share)}</span>
        <span className="fs-key__wei">{amount(wei)}</span>
      </dd>
    </div>
  )
}

/**
 * An EMBER figure, or the words for its absence.
 *
 * `null` never becomes `0`. "A zero would be a valuation, and a valuation of zero is a lie about a
 * holding that exists" — `wallet/src/pricingclient.ts`, and the same applies to a pool.
 */
export function amount(wei: bigint | null | undefined): ReactNode {
  const shown = formatEmber(wei)
  if (shown === null) return <span className="fs-unknown">not known</span>
  return (
    <>
      {shown} <span className="fs-unit">EMBER</span>
    </>
  )
}
