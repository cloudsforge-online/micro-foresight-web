/**
 * Browse. The list of markets, with the one filter the service actually supports.
 *
 * `GET /markets?status=&limit=` — `foresight/src/server.ts`. The status names are the seven at
 * `server.ts` and nothing else; a filter this page offered that the service did not know
 * would be a 400 rendered at a reader who cannot act on it.
 *
 * The cards carry no pool, and that is deliberate rather than an omission: `GET /markets` returns
 * `publicView(market)` and nothing else (`server.ts`), so a bar drawn here would be drawn from
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
        <h1 className="fs-page__title">Back your read on what happens next</h1>
        {/*
          THE ROLL-CALL IS GONE, AND IT WAS NOT MERELY FRAGILE — IT WAS OVER-CLAIMING BY TWO.

          This read "Bitcoin, Ethereum, Litecoin, Solana, XRP, EMBER or any token launched on
          CloudsForge", and `foresight`'s `stake_assets` registry has never held a row for SOL or
          for XRP. A reader who arrived with either got a 404 `unknown_asset` — "SOL is not a
          stake asset" — from a page that had just invited them by name. Same defect as the
          "Seven currencies" count one card below, which `test/content.test.ts` was written for:
          a set the SERVICE owns, restated by hand in a bundle nothing notifies when it changes.
          Deleting the numeral fixed the arithmetic and left the roll-call it was counting.

          The pressure to re-type it is real and is why this note is long. micro-contracts
          `c0e7c77` added DOGE and ETC to the asset union, and the natural next move is to append
          two more coins here. It would be wrong twice over: the registry has no row for either,
          and the estate follows neither chain — no DOGE or ETC deposit has ever been credited at
          any depth (`contracts/packages/chain/src/index.ts`). Being NAMEABLE by the platform and
          being ACCEPTED at the door are different facts, and only the second one belongs in a
          lede.

          The card below points at the live list instead, `CustodialStakePanel` renders it from
          `GET /stake-assets`, and `test/content.test.ts` now guards the shape as well as the
          count.
        */}
        <p className="fs-page__lede">
          Take a side with the coin you already hold. You see the conversion rate before you
          commit, and what you bring joins one shared pool. When the answer is in, a contract on
          Hearth splits that pool between the people who called it right.
        </p>
      </header>

      {/*
        The four sentences a stranger needs before the first card, and the reason they are here
        rather than a page away: the strongest thing about this product — that you can arrive with
        almost any coin, and that the payout does not depend on us staying up — was written down
        nowhere a reader would meet it.
      */}
      <ul className="fs-rules">
        <li className="fs-rule">
          <h2 className="fs-rule__title">Bring the coin you already hold</h2>
          {/*
            NO COUNT HERE. This sentence said "Seven currencies", and the lede one card above
            names six by name — the seventh was only reachable by counting SHARD, which
            `parseStakeAssetCode` refuses outright through `isRetiredAsset`
            (`contracts/packages/chain/src/index.ts`, `foresight/src/stakeassets.ts`). So the
            number was wrong on the day it was written, and it would have gone on being wrong
            silently, because nothing on this page fetches the registry that would contradict it.

            This page loads `GET /markets` and nothing else, so it holds no list to enumerate.
            The market page does: `CustodialStakePanel` fetches `GET /stake-assets` and renders
            what came back — the accepted currencies in its "Pay with" select, and the refused
            ones, with each reason, under "Currencies we are not accepting, and why". Pointing at
            that list rather than restating its length is the whole fix: the registry can gain or
            lose a row and no sentence here goes stale.
          */}
          <p className="fs-rule__body">
            The currencies listed on any market page are accepted, and so is every token minted on
            the platform. We quote the conversion, you decide, and only then does the money move.
            From that point your position, your odds and your payout are all counted in EMBER.
          </p>
        </li>
        <li className="fs-rule">
          <h2 className="fs-rule__title">One pool, whatever you paid with</h2>
          <p className="fs-rule__body">
            Everything converges into a single pool per market instead of one pot per currency.
            Bitcoin and Litecoin have no contract that could hold a pot, so a per-currency pool
            would be a figure we held and promised to share out. A shared pool is a figure the
            chain holds instead.
          </p>
        </li>
        <li className="fs-rule">
          <h2 className="fs-rule__title">The contract pays, not the company</h2>
          <p className="fs-rule__body">
            Claiming reads nothing but the contract&apos;s own storage. Switch off every server we
            run and a winner with a wallet and a block explorer still gets paid. That is the line
            between a prediction market and a bookmaker.
          </p>
        </li>
        <li className="fs-rule">
          <h2 className="fs-rule__title">Your return follows the crowd, not a quote</h2>
          <p className="fs-rule__body">
            The winning side shares the losing side&apos;s money in proportion to what each person
            put in. Nobody quotes you fixed odds, because the pool at close is the pool that pays.
            Every market names the source that will settle it before it opens.
          </p>
        </li>
      </ul>

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
          hint="A person reads and approves every question before it goes live, so this list arrives in batches rather than a trickle."
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
 * `GET /markets` returns `publicView(market)` and nothing else — `server.ts`. The pool lives
 * on `GET /markets/:id` (`server.ts`). A card that wanted odds would have to fetch every
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
        See what settles this, and take a side →
      </Link>
    </li>
  )
}
