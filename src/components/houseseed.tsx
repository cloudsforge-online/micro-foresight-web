/**
 * The house seed disclosure, on the page — docs/ecosystem/21 §5 and §7.6.
 *
 * ── Where this sits, and why there ─────────────────────────────────────────────────────────────
 *
 * Inside the pool panel, ABOVE the ratio bar, and therefore above the stake form.
 *
 * The market page's ordering is an argument (see the header of `pages/market.tsx`): the terms
 * before the button, "the same mistake as a signature line above a contract". The house seed
 * belongs to the same argument one level down. It is not a footnote about the platform — it is a
 * fact about the two numbers immediately below it. Some fraction of the Yes bar and the No bar is
 * the platform's own money, and a reader who learns that after reading the odds has already
 * formed a view from a figure they were not told the composition of.
 *
 * It is not in the header either, tempting as prominence is. The header carries what the market
 * IS; the seed is a property of the pool, and putting it beside the question would make it read
 * as a disclaimer about the market rather than a disclosure about the odds.
 *
 * ── Never a badge alone ────────────────────────────────────────────────────────────────────────
 *
 * The disclosure is a SENTENCE, in running text, at body size — not an icon, not a chip, not a
 * tooltip. 21 §2: "Every Shard the platform puts into a room below is **labelled as the
 * platform's**, on the surface where users see it." A chip labelled "seeded" satisfies the letter
 * of that and none of it: it is dismissible, it is unreadable to anyone who does not already know
 * the scheme exists, and it is the first thing a redesign drops.
 *
 * ── What is asserted and what is checked ───────────────────────────────────────────────────────
 *
 * The sentence is the platform's own, rendered verbatim. Everything under it is the evidence for
 * it, and two of those figures are re-derived in the browser rather than repeated from the wire —
 * the symmetry and the share of the pool. See `lib/houseseed.ts`. A seed that fails its symmetry
 * check renders as an alert in the same shape as a document-hash mismatch, because it is the same
 * kind of failure: the page saying something the numbers on it do not support.
 */
import { amount } from './pool.tsx'
import { utcDateTime } from '../lib/format.ts'
import type { HouseDisclosure } from '../lib/houseseed.ts'
import { formatBps, shortHex } from '../lib/units.ts'

export function HouseSeedNotice({ disclosure }: { disclosure: HouseDisclosure | null }) {
  // The ONE case that renders nothing, and it is the service's explicit null: no house money was
  // ever planned for this market. Every other degradation still discloses — `lib/houseseed.ts`.
  if (disclosure === null) return null

  const symmetryFailed = disclosure.symmetric === false

  return (
    <section
      className={`fs-house${symmetryFailed ? ' fs-house--bad' : ''}`}
      aria-labelledby="house-seed-heading"
      // `alert` when the numbers do not support the sentence, `status` otherwise. Both are live
      // regions, so a reader who arrives on this page with a screen reader is told either way.
      role={symmetryFailed ? 'alert' : 'status'}
    >
      <h3 className="fs-house__title" id="house-seed-heading">
        {disclosure.state === 'staked'
          ? 'Some of the money below is ours'
          : 'Some of the money here will be ours'}
      </h3>

      {/* The sentence. 21 §5 words it; the service composes it once; this renders it as sent. */}
      <p className="fs-house__sentence">{disclosure.sentence}</p>

      <p className="fs-house__why">
        {disclosure.state === 'staked' ? (
          <>
            A pool with one person in it just hands that person their money back, so CloudsForge
            puts the <strong>same amount on each answer</strong> as a market opens, and never
            touches it again. That gives the first arrivals a real split to look at without us
            leaning either way. If our side wins we collect like anyone else; if it loses, the
            winners share our money exactly as they share yours.
          </>
        ) : (
          <>
            This market is approved with money set aside that has not gone in. It cannot open until
            an equal amount sits on both answers, sent from the address below.
          </>
        )}
      </p>

      <dl className="fs-house__facts">
        <div>
          <dt>On each outcome</dt>
          <dd className="cf-num">{amount(disclosure.perOutcomeWei)}</dd>
        </div>
        <div>
          <dt>Total from the platform</dt>
          <dd className="cf-num">{amount(disclosure.totalWei)}</dd>
        </div>
        <div>
          <dt>Share of everything staked</dt>
          <dd className="cf-num">
            {/*
              `null` is not 0%. For a planned seed the money is not in the pool at all, and for an
              unreadable pool the share is unknown — and "0% of this pool is the platform's" is
              the single most misleading thing this panel could say.
            */}
            {disclosure.shareBps === null ? (
              <span className="fs-unknown">
                {disclosure.state === 'planned' ? 'not in the pool yet' : 'not known'}
              </span>
            ) : (
              formatBps(disclosure.shareBps)
            )}
          </dd>
        </div>
        {disclosure.houseAddress !== null && (
          <div>
            <dt>Platform address</dt>
            <dd className="cf-num" title={disclosure.houseAddress}>
              {shortHex(disclosure.houseAddress)}
            </dd>
          </div>
        )}
        {disclosure.stakedAt !== null && (
          <div>
            <dt>Staked at</dt>
            <dd className="cf-num">{utcDateTime(disclosure.stakedAt) ?? disclosure.stakedAt}</dd>
          </div>
        )}
      </dl>

      {disclosure.evidence.length > 0 && (
        <p className="fs-house__evidence">
          On chain as{' '}
          {disclosure.evidence.map((item, index) => (
            <span key={item.txHash}>
              {index > 0 && ' and '}
              {item.outcome}{' '}
              <code className="cf-num" title={item.txHash}>
                {shortHex(item.txHash, 12, 8)}
              </code>
            </span>
          ))}
          . Both of those are the same <code className="cf-num">stake(uint8)</code> call anybody
          here makes. There is no back door into this contract, and we do not have one.
        </p>
      )}

      {symmetryFailed && (
        <p className="fs-house__alarm">
          <strong>
            Our money is not evenly placed here: the total is not twice the per-answer amount.
          </strong>{' '}
          Placing it evenly is the whole of what &ldquo;we take no view&rdquo; means, and these
          figures do not add up. Keep your money out of this market until somebody explains it.
        </p>
      )}
    </section>
  )
}
