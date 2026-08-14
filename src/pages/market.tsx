/**
 * One market: everything a person needs to judge it, before they are offered a way to stake on it.
 *
 * ── The order of this page is an argument ──────────────────────────────────────────────────────
 *
 * The question, then the criteria, then the source that will settle it, then when it closes and
 * how long the dispute window is, then WHY THIS MARKET EXISTS — and only after all of that, the
 * pool and the stake form. A market's resolution criteria are a contract with strangers
 * (19-new-products.md §2.3.3), and putting the stake button above the terms would be the same
 * mistake as a signature line above a contract.
 *
 * ── The sources are the point, not a footnote ─────────────────────────────────────────────────
 *
 * `GET /markets/:id` carries the idea's provenance — query, sources, model id, prompt hash,
 * timestamp — and `foresight/src/server.ts` says why: "§2.3.3: sources are carried through
 * to the public market page, so a bettor can see *why* the market exists." The pipeline records it
 * precisely so this page can render it, and a page that dropped it would make the whole
 * provenance apparatus decorative.
 */
import { useCallback, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ClaimPanel } from '../components/claimpanel.tsx'
import { HouseSeedNotice } from '../components/houseseed.tsx'
import { MarketImage, MarketImagePanel } from '../components/marketimage.tsx'
import { PoolRatioBar } from '../components/pool.tsx'
import { StakePanel } from '../components/stakepanel.tsx'
import { CustodialStakePanel } from '../components/custodialstake.tsx'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { getMarket, type MarketDetail, type Provenance } from '../lib/foresight.ts'
import { durationLabel, utcDateTime } from '../lib/format.ts'
import { houseDisclosureOf } from '../lib/houseseed.ts'
import { checkDocument, observation, outcomeLabel, phaseLabel, phaseOf, takesStakes } from '../lib/market.ts'
import { poolsFrom, totalOf } from '../lib/pool.ts'
import { useResource } from '../lib/resource.ts'
import { formatBps, shortHex } from '../lib/units.ts'
import { useWalletAddress } from '../lib/usewallet.tsx'
import { NotFoundPage } from './not-found.tsx'

/** `/markets/<id>` — the id is the whole splat, and anything with a slash in it is not one. */
function idFromPath(pathname: string): string | null {
  const rest = pathname.replace(/^\/markets\/?/, '').replace(/\/$/, '')
  if (rest.length === 0 || rest.includes('/')) return null
  return decodeURIComponent(rest)
}

export function MarketPage() {
  const { pathname } = useLocation()
  const id = idFromPath(pathname)

  if (id === null) {
    // `/markets` on its own, or `/markets/a/b`. The market LIST is the index route, so there is
    // nothing at this address — and nginx has already given the response a 404.
    return <NotFoundPage />
  }
  return <MarketBody id={id} />
}

function MarketBody({ id }: { id: string }) {
  const load = useCallback((signal: AbortSignal) => getMarket(id, signal), [id])
  // `count` is 1 for a market that exists: the empty state here would mean "this id resolved to
  // nothing", which the service expresses as a 404 rather than an empty body.
  const detail = useResource(load, () => 1, 'This market could not be loaded.')

  // `detail.data === null` is doing real work here, and it is not defensive noise.
  //
  // A successful stake calls `onStaked` — `reload()` — because the pool has moved and the page
  // must not keep showing the old split. `useResource` sets `loading` on a reload, so the naive
  // `state === 'loading'` test replaced the WHOLE page with a spinner, unmounting `StakePanel`
  // and with it the `submitted` phase holding the transaction hash. The staker's only record of
  // what was just sent to their wallet was destroyed by the refresh their own stake triggered —
  // and what came back was a fresh, EMPTY, RE-ARMED stake form on a market they had just staked
  // on. On a surface where the commit is an irreversible on-chain transaction with no server-side
  // gate behind it, re-arming the form is the worst available outcome.
  //
  // Found by BJ-ADV-11-H2 of docs/ecosystem/22-browser-journeys.md. A refresh over data we already
  // have is not a load: the previous answer stays on screen until the new one arrives.
  if (detail.state === 'loading' && detail.data === null) {
    return <Loading label="Loading the market" />
  }
  if (detail.state === 'forbidden') return <Forbidden notice={detail.error ?? undefined} />
  if (detail.state === 'failed' && detail.error) {
    // 404 is its own sentence: an id that does not exist is not an outage.
    const missing = detail.error.message.includes('no market with that id')
    return missing ? (
      <Empty
        title="There is no market with that id"
        hint="The link may be out of date, or the market may never have been public."
        action={
          <Link className="cf-btn" to="/">
            Back to the markets
          </Link>
        }
      />
    ) : (
      <Failed notice={detail.error} onRetry={detail.reload} title="The market did not load" />
    )
  }
  if (!detail.data) return <Loading label="Loading the market" />

  return <MarketArticle detail={detail.data} reload={detail.reload} />
}

/**
 * The page itself, given a market that has loaded.
 *
 * Exported so `test/houseseed.test.ts` can render THIS — the whole article, from a real
 * `MarketDetail` — rather than the disclosure panel in isolation. 21 §7.6 asks for the market
 * page to render the disclosure, and a test that mounted only `HouseSeedNotice` would keep
 * passing on the day somebody deleted the one line below that mounts it.
 *
 * Named `MarketArticle` and not `MarketView` because `MarketView` is the wire type for one market
 * (`lib/foresight.ts`), and a component and a payload sharing a name is how an import picks the
 * wrong one.
 */
export function MarketArticle({ detail, reload }: { detail: MarketDetail; reload: () => void }) {
  const { market, pool, provenance } = detail
  const now = useMemo(() => new Date(), [])
  const phase = phaseOf(market, now)
  const pools = poolsFrom(pool)
  const poolIsKnown = totalOf(pools) !== null && pool.asOf !== null
  const obs = observation(pool, now)
  const document = checkDocument(detail)
  // The house seed, if there is one — 21 §7.6. Computed against the SAME `pools` the ratio bar
  // draws, so the share it reports and the split it explains are the same two numbers.
  const houseSeed = houseDisclosureOf(detail, pools)
  // Whichever address the wallet has already granted. Nothing prompts on load; see `usewallet`.
  const wallet = useWalletAddress()

  return (
    <article className="fs-page fs-market">
      <header className="fs-market__head">
        <p className="fs-market__crumb">
          <Link to="/">Markets</Link>
        </p>
        {/*
          ABOVE the question and OUTSIDE the terms panel, deliberately.

          The page's ordering is an argument (see the file header): the terms before the button.
          The image is a masthead, so it goes where a masthead goes — and it is kept out of the
          panel that carries the criteria and the recomputed document hash, because a picture
          rendered inside the panel that PROVES something would borrow that panel's authority
          without having earned any of it. See `components/marketimage.tsx`: foresight records
          studio's checksum and never re-measures it, so the image is evidence of nothing.
        */}
        <MarketImage image={market.image} question={market.question} />
        <h1 className="fs-market__question">{market.question}</h1>
        <p className="fs-market__meta">
          <span className={`fs-phase fs-phase--${phase}`}>
            <span className="fs-phase__dot" aria-hidden="true" />
            {phaseLabel(phase)}
          </span>
          <span className="fs-card__sep" aria-hidden="true">
            ·
          </span>
          <span>{market.category.replace(/_/g, ' ')}</span>
          {outcomeLabel(market.outcome) !== null && (
            <>
              <span className="fs-card__sep" aria-hidden="true">
                ·
              </span>
              <strong>Resolved {outcomeLabel(market.outcome)}</strong>
            </>
          )}
        </p>
        {market.voidReason && (
          <p className="fs-note fs-note--warn" role="status">
            <span className="fs-note__icon" aria-hidden="true">
              ⊘
            </span>
            Void: {market.voidReason}. Everyone is paid back in full, and we take nothing.
          </p>
        )}
      </header>

      {/* ───────────────────────── the terms, before anything else ───────────────────────── */}

      <section className="fs-panel" aria-labelledby="terms-heading">
        <h2 className="fs-panel__title" id="terms-heading">
          What settles this
        </h2>
        <p className="fs-criteria">{market.resolutionCriteria}</p>
        <dl className="fs-terms">
          <div>
            <dt>Resolution source, named at open</dt>
            <dd>
              <span className="fs-terms__kind">{market.resolutionSourceKind.replace(/_/g, ' ')}</span>
              <span className="fs-terms__ref cf-num">{market.resolutionSourceRef}</span>
            </dd>
          </div>
          <div>
            <dt>Closes to new stakes</dt>
            <dd className="cf-num">{utcDateTime(market.closeTime) ?? 'not set'}</dd>
          </div>
          <div>
            <dt>Dispute window after resolution</dt>
            <dd className="cf-num">{durationLabel(market.disputeWindowSeconds) ?? 'not set'}</dd>
          </div>
          <div>
            <dt>Settlement fee</dt>
            <dd className="cf-num">
              {formatBps(market.feeBps) ?? '—'} <span className="fs-terms__gloss">of the losing pool only</span>
            </dd>
          </div>
          <div>
            <dt>Chain</dt>
            <dd className="cf-num">
              {market.chain} · {market.network}
            </dd>
          </div>
          {market.contractAddress && (
            <div>
              <dt>Contract</dt>
              <dd className="cf-num" title={market.contractAddress}>
                {shortHex(market.contractAddress)}
              </dd>
            </div>
          )}
        </dl>

        <p className="fs-terms__why">
          The source is fixed on the day the market opens and hashed into the contract, so nobody
          can trade it for a kinder one. If it vanishes before the answer is in, the market is{' '}
          <strong>void</strong> and every stake goes back whole.
        </p>

        {/* The hash, recomputed here rather than displayed on trust. */}
        <p className={`fs-hash fs-hash--${document.matches ? 'ok' : 'bad'}`} role={document.matches ? 'status' : 'alert'}>
          <span className="fs-note__icon" aria-hidden="true">
            {document.matches ? '✓' : '■'}
          </span>
          {document.matches ? (
            <>
              The criteria above hash to{' '}
              <code className="cf-num" title={document.recomputed}>
                {shortHex(document.recomputed, 12, 8)}
              </code>
              , recomputed in your browser from the document this page was served. That is the value
              the contract was deployed with.
            </>
          ) : (
            <>
              <strong>The criteria on this page do not hash to the value the service reports.</strong>{' '}
              Recomputed <code className="cf-num">{shortHex(document.recomputed, 12, 8)}</code>,
              reported <code className="cf-num">{shortHex(document.claimed, 12, 8)}</code>. Do not
              stake on this market until that is explained.
            </>
          )}
        </p>
        <details className="fs-doc">
          <summary>The exact bytes that were hashed</summary>
          <pre className="fs-doc__body cf-num">{detail.document.canonical}</pre>
        </details>
      </section>

      {/* ───────────────────────── why this market exists ───────────────────────── */}

      <ProvenancePanel provenance={provenance} />

      {/* ───────────────────────── the pool ───────────────────────── */}

      <section className="fs-panel" aria-labelledby="pool-heading">
        <h2 className="fs-panel__title" id="pool-heading">
          The pool
        </h2>
        {/*
          THE ROLL-CALL IS GONE, AND THIS PAGE IS WHERE IT WAS WORST: the real list is fetched
          and rendered a few hundred pixels further down. This sentence named "bitcoin, ether,
          litecoin, solana, XRP, EMBER"; `CustodialStakePanel` asks `GET /stake-assets` and
          renders what came back, and the registry has never held a row for SOL or for XRP. So
          one page carried a typed list and a measured list, disagreeing, with the typed one read
          first.

          Nothing replaces it and nothing needs to. "Whichever currency they arrived with" is the
          whole claim this paragraph is making — the sentence is about the POOL, not about the
          door — and the panel below is the only honest place a set the service owns can be
          stated. A pointer here would have to be conditional too: the panel mounts only while
          `takesStakes(market.status)`, so on a closed market it would point at nothing.
        */}
        <p className="fs-note">
          The losing side&apos;s money is shared out among the winning side in proportion to what
          each person put in, so your return moves with the split until the market closes. Nobody
          here can hand you fixed odds.
        </p>
        {/*
          BEFORE the ratio bar, deliberately. Part of the two numbers below may be the platform's
          own money, and a reader who is told that after reading the odds has already formed a
          view from a figure whose composition they were not given. See `components/houseseed.tsx`.
        */}
        <HouseSeedNotice disclosure={houseSeed} />
        <PoolRatioBar pools={pools} note={obs.text} tone={obs.tone} />
        <p className="fs-stakers">
          {pool.stakerCount > 0
            ? `${pool.stakerCount} ${pool.stakerCount === 1 ? 'address has' : 'addresses have'} staked.`
            : 'No address has staked yet.'}
        </p>
      </section>

      {/* ───────────────────────── act ───────────────────────── */}

      {takesStakes(market.status) && (
        <>
          {/*
            THE CUSTODIAL PANEL IS FIRST, AND THAT ORDER IS THE FIX FOR A REAL DEFECT.

            A reader who has deposited coins with CloudsForge needs no wallet, no extension and no
            EMBER to bet — and for the whole life of this page they met a demand for a browser
            wallet first, with the path that already worked for them somewhere below it. The
            majority of people who can act on this page can act through the ledger, so the ledger
            goes on top.

            Still a separate section, a separate heading and a separate disclosure — never a second
            tab on the wallet panel. Two stake paths that look alike and fail oppositely is the
            confusion 25-wallet-clients.md §1 names as the most dangerous thing this estate can
            build; the ORDER changed, the separation did not.
          */}
          <CustodialStakePanel market={market} onStaked={reload} />
          {/*
            Self-custody, demoted but not hidden. `<details>` keeps every word of it in the
            document — the panel below explains what a wallet is, that nobody here can switch one
            on for a reader, and where EMBER's chain details are — while giving the page one
            primary way to act instead of two competing ones.
          */}
          <details className="fs-alt">
            <summary className="fs-alt__summary">
              Or stake from your own wallet, straight to the contract
            </summary>
            <p className="fs-alt__note">
              A stake sent from your own address is yours in the contract, claimable with a wallet
              and a block explorer even with every machine of ours switched off. It needs a browser
              wallet and EMBER of your own.
            </p>
            <StakePanel market={market} pools={pools} poolIsKnown={poolIsKnown} onStaked={reload} />
          </details>
        </>
      )}

      {/*
        LAST on the page, and only for an operator — `MarketImagePanel` returns null otherwise.

        Below the stake form on purpose: this is authoring, and nothing about it should come
        between a reader and the terms or the pool. The role check decides what is offered; what is
        ENFORCED is `requireAdmin` on the route.
      */}
      <MarketImagePanel market={market} onChanged={reload} />

      {(market.status === 'resolved' || market.status === 'settled' || market.status === 'void') && (
        <ClaimPanel
          mirror={{
            contractAddress: market.contractAddress,
            marketStatus: market.status,
            resolvedAt: market.resolvedAt,
            disputeWindowSeconds: market.disputeWindowSeconds,
            stale: pool.stale,
            stakedYes: null,
            stakedNo: null,
          }}
          address={wallet.address}
        />
      )}
    </article>
  )
}

/**
 * The provenance panel — the cited sources, and everything else about where the question came from.
 *
 * ── AN EMPTY PROVENANCE RENDERS NOTHING, AND THAT IS THE POINT ────────────────────────────────
 *
 * `null` provenance means an operator wrote the question themselves (`origin: 'operator'`,
 * `foresight/src/server.ts`). This used to spend a whole panel — heading, border, its own scroll
 * position — on a paragraph whose entire content was that there was nothing to put in it: "there
 * is no search behind it to show you. The criteria above remain the entire basis on which it will
 * be decided." Both halves are already elsewhere on the page. The criteria are printed in full,
 * with their hash recomputed in the reader's browser, immediately above; and a section that exists
 * only to disclaim itself teaches a reader that panels on this page can be skipped.
 *
 * So: no sources, no section. The panel appears when there is something cited to show, which is
 * the only state in which it was ever telling the reader something they could act on.
 */
function ProvenancePanel({ provenance }: { provenance: Provenance | null }) {
  if (provenance === null) return null

  return (
    <section className="fs-panel" aria-labelledby="why-heading">
      <h2 className="fs-panel__title" id="why-heading">
        Why this market exists
      </h2>
      <p className="fs-provenance__lede">
        {provenance.origin === 'model'
          ? 'A model drafted this question from the reading below. Somebody on our team then went through the sources, made whatever edits it needed, and put it live. A model cannot open a market on its own.'
          : 'Somebody on our team wrote this question, working from the reading below.'}
      </p>

      {provenance.sources.length > 0 ? (
        <ol className="fs-sources">
          {provenance.sources.map((source, index) => (
            <li key={`${source.url}-${index}`} className="fs-sources__item">
              <a
                className="fs-sources__link"
                href={source.url}
                target="_blank"
                // `noopener` is the security half and `noreferrer` the privacy half. A market page
                // links to strangers' sites by design, so both are mandatory here.
                rel="noopener noreferrer"
              >
                {source.title || source.url}
              </a>
              <span className="fs-sources__url cf-num">{source.url}</span>
              <span className="fs-sources__when">
                retrieved {utcDateTime(source.retrievedAt) ?? 'at an unrecorded time'}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="fs-note" role="status">
          No sources were recorded with this proposal.
        </p>
      )}

      <dl className="fs-provenance">
        {provenance.searchQuery !== null && (
          <div>
            <dt>Search that found them</dt>
            <dd className="cf-num">{provenance.searchQuery}</dd>
          </div>
        )}
        {provenance.modelId !== null && (
          <div>
            <dt>Model</dt>
            <dd className="cf-num">{provenance.modelId}</dd>
          </div>
        )}
        {provenance.promptSha256 !== null && (
          <div>
            <dt>Prompt hash</dt>
            <dd className="cf-num" title={provenance.promptSha256}>
              {shortHex(provenance.promptSha256, 12, 8)}
            </dd>
          </div>
        )}
        <div>
          <dt>Proposed</dt>
          <dd className="cf-num">{utcDateTime(provenance.proposedAt) ?? 'at an unrecorded time'}</dd>
        </div>
      </dl>
      <p className="fs-provenance__note">
        We keep a fingerprint of the instructions given to the model, never the instructions
        themselves. That ties a draft to exactly what produced it while the text stays out of the
        record.
      </p>
    </section>
  )
}
