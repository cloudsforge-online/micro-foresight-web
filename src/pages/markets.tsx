/**
 * Browse. The list of markets, with the one filter the service actually supports.
 *
 * `GET /markets?status=&limit=` — `foresight/src/server.ts:402`. The status names are the seven at
 * `server.ts:846-850` and nothing else; a filter this page offered that the service did not know
 * would be a 400 rendered at a reader who cannot act on it.
 *
 * The cards carry no pool, and that is deliberate rather than an omission: `GET /markets` returns
 * `publicView(market)` and nothing else (`server.ts:407`), so a bar drawn here would be drawn from
 * a number the response did not contain. The odds are on the page that has them.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { MarketImage } from '../components/marketimage.tsx'
import { OUTCOME_NO, OUTCOME_YES } from '../lib/abi.ts'
import { listMarkets, type MarketStatus, type MarketView } from '../lib/foresight.ts'
import { untilLabel, utcDateTime } from '../lib/format.ts'
import { phaseLabel, phaseOf } from '../lib/market.ts'
import { formatBps } from '../lib/units.ts'
import { useResource } from '../lib/resource.ts'
import { marketPath } from '../lib/routes.ts'

/**
 * The filters offered, and no others.
 *
 * `draft` and `approved` are deliberately left out of the UI even though the route accepts them:
 * a market that has not opened has no pool, no contract and nothing a reader can do, and putting
 * it in a public filter row invites the question of why it cannot be staked on.
 */
const FILTERS: readonly { readonly status: MarketStatus | null; readonly label: string }[] = [
  { status: 'open', label: 'Open' },
  { status: 'closed', label: 'Awaiting resolution' },
  { status: 'resolved', label: 'Resolved' },
  { status: 'settled', label: 'Settled' },
  { status: 'void', label: 'Void' },
  { status: null, label: 'Everything' },
]

export function MarketsPage() {
  const [status, setStatus] = useState<MarketStatus | null>('open')

  const load = useCallback(
    (signal: AbortSignal) => listMarkets({ ...(status ? { status } : {}), limit: 100, signal }),
    [status],
  )
  const markets = useResource(
    load,
    (data) => data.markets.length,
    'The market list could not be loaded.',
  )

  return (
    <div className="fs-page">
      <header className="fs-page__head">
        <h1 className="fs-page__title">Markets</h1>
        <p className="fs-page__lede">
          Questions about the future, staked and settled in EMBER on Hearth. Every market names the
          source that will resolve it <em>before</em> it opens, and the pool is divided among the
          winners by the contract — not by us.
        </p>
      </header>

      <div className="fs-filters" role="group" aria-label="Filter markets by status">
        {FILTERS.map((filter) => (
          <button
            key={filter.label}
            type="button"
            className={`fs-filter${filter.status === status ? ' is-active' : ''}`}
            aria-pressed={filter.status === status}
            onClick={() => setStatus(filter.status)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {markets.state === 'loading' && <Loading label="Loading markets" />}
      {markets.state === 'failed' && markets.error && (
        <Failed notice={markets.error} onRetry={markets.reload} title="The markets did not load" />
      )}
      {markets.state === 'forbidden' && <Forbidden notice={markets.error ?? undefined} />}
      {markets.state === 'empty' && (
        <Empty
          title={status === null ? 'There are no markets yet' : `No market is ${labelFor(status)}`}
          hint="An operator approves every market before it opens, so the list moves in steps rather than continuously."
          action={
            status === null ? undefined : (
              <button type="button" className="cf-btn" onClick={() => setStatus(null)}>
                Show everything
              </button>
            )
          }
        />
      )}
      {markets.state === 'ok' && markets.data && (
        <ul className="fs-cards">
          {markets.data.markets.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </ul>
      )}
    </div>
  )
}

function labelFor(status: MarketStatus): string {
  return FILTERS.find((f) => f.status === status)?.label.toLowerCase() ?? status
}

/**
 * One market in the list.
 *
 * ── There is no pool on this response, and the card says so rather than inventing one ──────────
 *
 * `GET /markets` returns `publicView(market)` and nothing else — `server.ts:407`. The pool lives
 * on `GET /markets/:id` (`server.ts:428`). A card that wanted odds would have to fetch every
 * market individually, which is a hundred requests to render a list. So the card shows what the
 * list route actually carries — the question, the phase, the close time, the resolution source —
 * and the odds are on the page that has them.
 *
 * The alternative, drawing a bar from a pool the response did not include, is the exact failure
 * this estate keeps writing tests against.
 */
function MarketCard({ market }: { market: MarketView }) {
  const now = useMemo(() => new Date(), [])
  const phase = phaseOf(market, now)
  const closesIn = untilLabel(market.closeTime, now)

  return (
    <li className="fs-card">
      {/*
        `GET /markets` DOES carry the image — `publicView` composes it per response — so unlike the
        pool, this is not a figure the list route omits. The card renders nothing when there is no
        image and nothing when `bytesUrl` is null; a placeholder frame would be a picture the
        market does not have.
      */}
      <Link className="fs-card__link" to={marketPath(market.id)}>
        <MarketImage image={market.image} question={market.question} className="fs-card__image" />
        <h2 className="fs-card__question">{market.question}</h2>
      </Link>
      <p className="fs-card__meta">
        {/* The phase is a WORD, not a colour. The dot is decorative and marked so. */}
        <span className={`fs-phase fs-phase--${phase}`}>
          <span className="fs-phase__dot" aria-hidden="true" />
          {phaseLabel(phase)}
        </span>
        <span className="fs-card__sep" aria-hidden="true">
          ·
        </span>
        <span className="fs-card__category">{market.category.replace(/_/g, ' ')}</span>
      </p>
      <dl className="fs-card__facts">
        <div>
          <dt>Closes</dt>
          <dd className="cf-num">
            {utcDateTime(market.closeTime) ?? 'not set'}
            {closesIn === null ? '' : ` · in ${closesIn}`}
          </dd>
        </div>
        <div>
          <dt>Resolved from</dt>
          <dd>{market.resolutionSourceKind.replace(/_/g, ' ')}</dd>
        </div>
        <div>
          <dt>Fee on the losing pool</dt>
          <dd className="cf-num">{formatBps(market.feeBps) ?? '—'}</dd>
        </div>
        {market.outcome !== null && (
          <div>
            <dt>Outcome</dt>
            {/* `0` is YES and is falsy — see `market.outcomeLabel` for why that matters. */}
            <dd>{market.outcome === OUTCOME_YES ? 'Yes' : market.outcome === OUTCOME_NO ? 'No' : '—'}</dd>
          </div>
        )}
      </dl>
      <Link className="fs-card__more" to={marketPath(market.id)}>
        Read the criteria and sources →
      </Link>
    </li>
  )
}
