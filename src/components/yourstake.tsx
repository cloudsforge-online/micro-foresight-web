/**
 * What THIS reader has on this market, staked from their CloudsForge balance.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THE MISSING RECEIPT.**
 *
 * A custodial stake is a ledger entry, not a transaction — there is no hash to keep, no explorer
 * to open, and nothing in the contract with the reader's name on it. So the only evidence they
 * ever get that their money took a side is what this page shows them afterwards. It showed them
 * nothing: the stake succeeded, the panel said "that is placed", the page reloaded, and the pool
 * still read zero on both sides because the pool it was reading was the contract's.
 *
 * This is the receipt. It asks the one route that knows — `GET /markets/:id/custodial-position`,
 * keyed by session because a custodial position has no address — and prints the answer in the
 * unit that decides the payout.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * It renders NOTHING when there is nothing to say: signed out, unreadable, or both sides empty.
 * A panel that says "you have 0 EMBER on this market" to every visitor is noise on every market
 * they have not staked on, which is nearly all of them.
 */
import { useEffect, useState } from 'react'
import { getCustodialPosition, type CustodialPositionResponse } from '../lib/foresight.ts'
import { useSession } from '../lib/auth.tsx'
import { formatEmber, fromWeiString } from '../lib/units.ts'

export function YourCustodialStake({
  marketId,
  refreshKey,
}: {
  marketId: string
  /** Bumped by a successful stake. The position has moved, so the figure on screen is wrong. */
  refreshKey: number
}) {
  const { status } = useSession()
  const signedIn = status === 'signedIn'
  const [position, setPosition] = useState<CustodialPositionResponse | null>(null)

  useEffect(() => {
    if (!signedIn) {
      setPosition(null)
      return
    }
    const controller = new AbortController()
    let live = true
    void getCustodialPosition(marketId, controller.signal)
      .then((body) => {
        if (live) setPosition(body)
      })
      .catch(() => {
        // No figure rather than a wrong one, and no error either: a reader who has staked nothing
        // is the ordinary case, and it fails the same way as an outage from here.
        if (live) setPosition(null)
      })
    return () => {
      live = false
      controller.abort()
    }
  }, [marketId, signedIn, refreshKey])

  const yes = fromWeiString(position?.yes)
  const no = fromWeiString(position?.no)
  if (position === null || yes === null || no === null) return null
  if (yes === 0n && no === 0n) return null

  const asset = position.asset
  return (
    <section className="fs-panel fs-panel--yours" aria-labelledby="your-stake-heading">
      <p className="fs-panel__eyebrow">Yours on this market</p>
      <h2 className="fs-panel__title" id="your-stake-heading">
        You have taken a side
      </h2>
      <dl className="fs-yours">
        {yes > 0n && (
          <div className="fs-yours__row">
            <dt className="fs-yours__side">Yes</dt>
            <dd className="fs-yours__amount cf-num">
              {formatEmber(yes)} <span className="fs-unit">{asset}</span>
            </dd>
          </div>
        )}
        {no > 0n && (
          <div className="fs-yours__row">
            <dt className="fs-yours__side">No</dt>
            <dd className="fs-yours__amount cf-num">
              {formatEmber(no)} <span className="fs-unit">{asset}</span>
            </dd>
          </div>
        )}
      </dl>
      {/* Staked from the balance, so it is counted against the CloudsForge pot above and not
          against the contract's. Said here as well as there, because this is the panel a reader
          who has just staked actually reads. */}
      <p className="fs-note">
        Staked from your CloudsForge balance, and counted in {asset} from here on. What it pays
        depends on how the CloudsForge pot is split when this market settles — not on how it is
        split now.
      </p>
      <p className="fs-note fs-note--warn">{position.disclosure}</p>
    </section>
  )
}
