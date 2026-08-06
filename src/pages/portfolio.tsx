/**
 * Positions: what one address has staked, across every market it appears in.
 *
 * ── This page is a MIRROR, and it says so on every row ─────────────────────────────────────────
 *
 * The service's `positions` table is a copy of chain events fed by `micro-indexer`
 * (19-new-products.md §2.3.1). It is used for browsing and notifications, and it is not the
 * record: "If the mirror dies, funds are untouched and `claim` still works against the contract."
 * So every figure here carries the instant it was observed, the page carries the OLDEST of those
 * instants, and a row that did not load says so instead of disappearing.
 *
 * ── Keyed by address, not by session ──────────────────────────────────────────────────────────
 *
 * `GET /markets/:id/positions/:address` (`foresight/src/server.ts`) is unauthenticated,
 * because a position belongs to whoever holds the key and the mirror is a copy of public chain
 * state. That is why `/portfolio/<address>` is a link somebody can send, and why a reader with no
 * wallet can still look one up.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Empty, Failed, Loading } from '../components/states.tsx'
import { amount } from '../components/pool.tsx'
import { isAddress } from '../lib/abi.ts'
import { noticeFor } from '../lib/api.ts'
import { getPosition, listMarkets } from '../lib/foresight.ts'
import { asOfStamp, ageLabel } from '../lib/format.ts'
import { phaseLabel, phaseOf } from '../lib/market.ts'
import {
  hasStake,
  loadPositions,
  missingSentence,
  summarise,
  type PositionRow,
} from '../lib/portfolio.ts'
import { useResource } from '../lib/resource.ts'
import { marketPath, portfolioPath } from '../lib/routes.ts'
import { useWalletAddress } from '../lib/usewallet.tsx'

/** `/portfolio/<address>` — the address is the whole splat. */
function addressFromPath(pathname: string): string | null {
  const rest = pathname.replace(/^\/portfolio\/?/, '').replace(/\/$/, '')
  return rest.length === 0 || rest.includes('/') ? null : decodeURIComponent(rest)
}

export function PortfolioPage() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const wallet = useWalletAddress()
  const [typed, setTyped] = useState('')

  const fromPath = addressFromPath(pathname)
  // The path wins over the wallet: a link somebody sent must show what it says, not what the
  // reader's own wallet happens to hold.
  const address = fromPath ?? wallet.address

  return (
    <div className="fs-page">
      <header className="fs-page__head">
        <h1 className="fs-page__title">Where your money is riding</h1>
        <p className="fs-page__lede">
          Every open bet held by one address, in one table. We keep a copy of the chain to draw
          this, which means the numbers here trail the real thing by a little; each row tells you
          when it was last read. The bets themselves live in the markets&apos; contracts, and that
          is what pays out.
        </p>
      </header>

      <form
        className="fs-lookup"
        onSubmit={(event) => {
          event.preventDefault()
          const candidate = typed.trim()
          if (!isAddress(candidate)) return
          navigate(portfolioPath(candidate.toLowerCase()))
        }}
      >
        <label className="fs-field">
          <span className="fs-field__label">Look up an address</span>
          <span className="fs-field__row">
            <input
              className="fs-field__input cf-num"
              type="text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="0x…"
              aria-describedby="lookup-help"
              spellCheck={false}
            />
            <button type="submit" className="cf-btn" disabled={!isAddress(typed.trim())}>
              Show
            </button>
          </span>
          <span className="fs-field__help" id="lookup-help">
            Any address at all — what somebody has riding on a market is public, so this needs no
            account. Type it with capitals in it and we verify the checksum before looking it up,
            which catches a mistyped character.
          </span>
        </label>
        {wallet.available && wallet.address === null && (
          <button type="button" className="cf-btn" disabled={wallet.connecting} onClick={wallet.connect}>
            {wallet.connecting ? 'Connecting…' : 'Use my wallet'}
          </button>
        )}
      </form>

      {address === null ? (
        <Empty
          title="No address yet"
          hint={
            wallet.available
              ? 'Connect your wallet, or paste in any address.'
              : 'Paste in any address. You only need a wallet to place a bet or collect one.'
          }
        />
      ) : (
        <Positions address={address} />
      )}
    </div>
  )
}

function Positions({ address }: { address: string }) {
  const load = useCallback(
    async (signal: AbortSignal): Promise<readonly PositionRow[]> => {
      // Every status, not just `open`: a position in a resolved market is the one a reader most
      // wants to find, because it is the one they can claim.
      const { markets } = await listMarkets({ limit: 200, signal })
      return loadPositions(
        markets,
        (market) => getPosition(market.id, address, signal),
        (_market, err) => noticeFor(err, 'This market did not answer.').message,
      )
    },
    [address],
  )

  const rows = useResource(load, (data) => data.length, 'Positions could not be loaded.')

  if (rows.state === 'loading') return <Loading label="Reading positions" />
  if (rows.state === 'failed' && rows.error) {
    return <Failed notice={rows.error} onRetry={rows.reload} title="Positions did not load" />
  }
  if (rows.state === 'empty' || !rows.data) {
    return <Empty title="No markets to look through yet" hint="As soon as one opens, anything this address puts on it turns up here." />
  }

  const summary = summarise(rows.data)
  const staked = rows.data.filter((row) => hasStake(row) || row.error !== null)
  const missing = missingSentence(summary)

  return (
    <>
      <p className="fs-portfolio__stamp" role="status">
        {summary.oldestAsOf === null ? (
          <>None of this has been read off the chain yet.</>
        ) : (
          <>
            The furthest behind anything here is {asOfStamp(summary.oldestAsOf)}
            {ageLabel(summary.oldestAsOf) === null ? '' : ` (${ageLabel(summary.oldestAsOf)})`}. Every
            row shows its own reading.
          </>
        )}
      </p>

      {missing !== null && (
        <p className="fs-note fs-note--warn" role="alert">
          <span className="fs-note__icon" aria-hidden="true">
            ▲
          </span>
          {missing}
        </p>
      )}

      {staked.length === 0 ? (
        <Empty
          title="Nothing riding on anything"
          hint={`We looked through ${summary.empty} ${summary.empty === 1 ? 'market' : 'markets'} and this address has money in none of them.`}
          action={
            <Link className="cf-btn" to="/">
              Find something to back
            </Link>
          }
        />
      ) : (
        <div className="fs-table__scroll">
          <table className="fs-table">
            <caption className="cf-sr">
              Positions held by {address}, with the time each row was last read from the chain.
            </caption>
            <thead>
              <tr>
                <th scope="col">Market</th>
                <th scope="col">Status</th>
                <th scope="col" className="fs-table__num">
                  On Yes
                </th>
                <th scope="col" className="fs-table__num">
                  On No
                </th>
                <th scope="col">Observed</th>
              </tr>
            </thead>
            <tbody>
              {staked.map((row) => (
                <Row key={row.market.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function Row({ row }: { row: PositionRow }) {
  const phase = useMemo(() => phaseOf(row.market), [row.market])
  return (
    <tr className={row.error !== null ? 'is-failed' : undefined}>
      <th scope="row" className="fs-table__market">
        <Link to={marketPath(row.market.id)}>{row.market.question}</Link>
      </th>
      <td>
        <span className={`fs-phase fs-phase--${phase}`}>
          <span className="fs-phase__dot" aria-hidden="true" />
          {phaseLabel(phase)}
        </span>
      </td>
      {/* A row that failed shows no figures at all. A dash is not a number and 0 would be a lie. */}
      <td className="fs-table__num cf-num">{row.error === null ? amount(row.stakedYes) : <span className="fs-unknown">—</span>}</td>
      <td className="fs-table__num cf-num">{row.error === null ? amount(row.stakedNo) : <span className="fs-unknown">—</span>}</td>
      <td className="fs-table__when">
        {row.error !== null ? (
          <span className="fs-unknown">{row.error}</span>
        ) : row.asOf === null ? (
          <span className="fs-unknown">not observed yet</span>
        ) : (
          <>
            <span className="cf-num">{asOfStamp(row.asOf)}</span>
            {row.stale && (
              <span className="fs-stale" title="The mirror is behind the chain">
                {' '}
                ▲ behind
              </span>
            )}
          </>
        )}
      </td>
    </tr>
  )
}
