/**
 * One market: everything a person needs to judge it, and the desk they act at.
 *
 * ── THE READING AND THE DESK ───────────────────────────────────────────────────────────────────
 *
 * This page used to be nine identical bordered boxes in one 1168px column, each opening with a
 * heading and two or three sentences of prose, with the only thing that MOVES — the pool — buried
 * in the middle of them and the only thing a reader came to DO two and a half thousand pixels
 * down. Every box had the same weight, so none of them had any.
 *
 * It is now two things side by side. On the left, THE READING: the resolution document with its
 * seal, the docket of terms, and where the question came from — static, long, and the reason a
 * person can judge this market at all. On the right, THE DESK: the pools, this reader's own
 * position, and the way to take a side — live, short, and `position: sticky`, so the numbers stay
 * on screen while the terms are read.
 *
 * ── AND THE ORDERING ARGUMENT SURVIVES THE CHANGE ──────────────────────────────────────────────
 *
 * The old header said: the criteria are a contract with strangers (19-new-products.md §2.3.3), so
 * putting the stake button above the terms is a signature line above a contract. That still holds
 * and is still obeyed. Under 60rem there is ONE column and the order is exactly what it was — the
 * question, the terms, the provenance, then the pool and the forms. Above it, the terms are not
 * BELOW the button, they are BESIDE it at the same eye level and cannot be scrolled away from,
 * which is a stronger version of the same guarantee than a reader who scrolled past them.
 *
 * ── The sources are the point, not a footnote ─────────────────────────────────────────────────
 *
 * `GET /markets/:id` carries the idea's provenance — query, sources, model id, prompt hash,
 * timestamp — and `foresight/src/server.ts` says why: "§2.3.3: sources are carried through
 * to the public market page, so a bettor can see *why* the market exists." The pipeline records it
 * precisely so this page can render it, and a page that dropped it would make the whole
 * provenance apparatus decorative.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ClaimPanel } from '../components/claimpanel.tsx'
import { HouseSeedNotice } from '../components/houseseed.tsx'
import { MarketImage, MarketImagePanel } from '../components/marketimage.tsx'
import { PoolRatioBar } from '../components/pool.tsx'
import { StakePanel } from '../components/stakepanel.tsx'
import { CustodialStakePanel } from '../components/custodialstake.tsx'
import { YourCustodialStake } from '../components/yourstake.tsx'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { getMarket, type MarketDetail, type Provenance } from '../lib/foresight.ts'
import { durationLabel, untilLabel, utcDateTime } from '../lib/format.ts'
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
  // The custodial book, when the service is new enough to send it. `undefined` is an older
  // service and renders as one pool, exactly as this page did before — never as an empty book,
  // which would be this app asserting that nobody has staked that way.
  const custodial = detail.custodialPool
  const custodialPools = useMemo(
    () => (custodial === undefined ? null : poolsFrom(custodial)),
    [custodial],
  )
  /**
   * Bumped by a successful stake, and threaded into the reader's own position.
   *
   * `reload()` re-reads the MARKET; it cannot reach into a component that holds its own resource.
   * Without this the receipt panel below went on showing the position from before the stake — on
   * the one screen whose entire job is to prove the stake happened.
   */
  const [staked, setStaked] = useState(0)
  const onStaked = useCallback(() => {
    setStaked((n) => n + 1)
    reload()
  }, [reload])
  const document = checkDocument(detail)
  // The house seed, if there is one — 21 §7.6. Computed against the SAME `pools` the ratio bar
  // draws, so the share it reports and the split it explains are the same two numbers.
  const houseSeed = houseDisclosureOf(detail, pools)
  // Whichever address the wallet has already granted. Nothing prompts on load; see `usewallet`.
  const wallet = useWalletAddress()

  const closesIn = untilLabel(market.closeTime, now)

  return (
    <article className="fs-page fs-market">
      {/*
        ── THE MASTHEAD ──────────────────────────────────────────────────────────────────────────

        The question is the thesis of this page, so it is set at page-title scale and given the
        whole width, over the illustration rather than under it. The illustration is a BAND: it
        was a floating picture in the document flow, which made a decorative asset look like the
        page's first piece of content.

        It is still OUTSIDE the terms panel and still carries no tick, badge or hash — see
        `components/marketimage.tsx`. foresight records studio's checksum and never re-measures
        it, so an image inside the panel that PROVES the criteria would borrow authority it has
        not earned. A dark scrim carries the question over it; the scrim is a gradient on the
        band, never on the picture, so nothing about the asset itself is altered.
      */}
      <header className="fs-mast">
        <p className="fs-mast__crumb">
          <Link to="/">← All markets</Link>
        </p>
        <div className={`fs-mast__band${market.image?.bytesUrl ? ' fs-mast__band--lit' : ''}`}>
          <MarketImage image={market.image} question={market.question} className="fs-mast__image" />
          <div className="fs-mast__plate">
            <p className="fs-mast__tags">
              <span className={`fs-phase fs-phase--${phase}`}>
                <span className="fs-phase__dot" aria-hidden="true" />
                {phaseLabel(phase)}
              </span>
              <span className="fs-mast__tag">{market.category.replace(/_/g, ' ')}</span>
              {closesIn !== null && phase === 'open' && (
                <span className="fs-mast__tag fs-mast__tag--clock">Closes in {closesIn}</span>
              )}
              {outcomeLabel(market.outcome) !== null && (
                <span className="fs-mast__tag fs-mast__tag--outcome">
                  Resolved {outcomeLabel(market.outcome)}
                </span>
              )}
            </p>
            <h1 className="fs-mast__question">{market.question}</h1>
          </div>
        </div>
        {market.voidReason && (
          <p className="fs-note fs-note--warn" role="status">
            <span className="fs-note__icon" aria-hidden="true">
              ⊘
            </span>
            Void: {market.voidReason}. Everyone is paid back in full, and we take nothing.
          </p>
        )}
      </header>

      <div className="fs-layout">

      {/* ═══════════════════════ the reading: what this market actually says ═══════════════════ */}

      <div className="fs-layout__read">
      <section className="fs-panel" aria-labelledby="terms-heading">
        <h2 className="fs-panel__title" id="terms-heading">
          What settles this
        </h2>
        {/*
          ── THE SIGNATURE OF THIS PAGE: THE DOCUMENT, WITH ITS SEAL ──────────────────────────────

          Foresight has one thing a bookmaker does not: the words that decide the payout are hashed
          into the contract, and the hash is recomputed HERE, in the reader's browser, from the
          bytes this page was served. That was a grey sentence under a paragraph. It is now a
          stamp band across the top of the document it is about, so the claim and the thing
          claimed are one object.

          The band is the whole state machine. Matching: accent rule, a tick, the digest. Not
          matching: critical rule, a filled square, both digests and an instruction not to stake.
          It is never colour alone — the glyph and the words carry it in forced-colors and in
          print.

          The band does NOT carry the live region, though it is the loudest thing here. The
          announcement belongs to the paragraph below it, because that is the one that says what
          to do about a mismatch; announcing the band as well would read the same state twice and
          give a reader the summary instead of the instruction.
        */}
        <div className={`fs-doc-seal fs-doc-seal--${document.matches ? 'ok' : 'bad'}`}>
          <p className="fs-doc-seal__band cf-num">
            <span className="fs-doc-seal__mark" aria-hidden="true">
              {document.matches ? '✓' : '■'}
            </span>
            <span className="fs-doc-seal__label">
              {document.matches ? 'Checked in your browser' : 'Does not match'}
            </span>
            <span className="fs-doc-seal__hash" title={document.recomputed}>
              sha-256 {shortHex(document.recomputed, 10, 6)}
            </span>
          </p>
          <p className="fs-criteria">{market.resolutionCriteria}</p>
        </div>
        <p
          className={`fs-hash fs-hash--${document.matches ? 'ok' : 'bad'}`}
          role={document.matches ? 'status' : 'alert'}
        >
          {document.matches ? (
            <>
              That digest was recomputed from the document this page was served, and it is the
              value the contract was deployed with. Nobody can edit these words without the two
              disagreeing.
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

      {/* ───────────────────────── the docket ───────────────────────── */}

      <section className="fs-panel" aria-labelledby="docket-heading">
        <h2 className="fs-panel__title" id="docket-heading">
          The terms
        </h2>
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
      </section>

      {/* ───────────────────────── why this market exists ───────────────────────── */}

      <ProvenancePanel provenance={provenance} />

      {/*
        LAST in the reading column, and only for an operator — `MarketImagePanel` returns null
        otherwise. This is authoring, and nothing about it should come between a reader and the
        terms. The role check decides what is OFFERED; what is ENFORCED is `requireAdmin` on the
        route.
      */}
      <MarketImagePanel market={market} onChanged={reload} />
      </div>

      {/* ═══════════════════════ the desk: where the money is, and what you can do ═════════════ */}

      {/*
        `position: sticky` on wide screens, in normal flow below the reading on narrow ones. The
        pool is the only thing on this page that MOVES, and it belonged next to the reader's
        attention rather than a screen and a half away from it.
      */}
      <aside className="fs-layout__desk" aria-label="The pool, and how to take a side">
        <section className="fs-desk" aria-labelledby="pool-heading">
          <h2 className="fs-desk__title" id="pool-heading">
            Where the money is
          </h2>
          {/*
            ── TWO POTS, AND THE PAGE ONLY EVER SHOWED ONE ──────────────────────────────────────

            A stake taken from a CloudsForge balance is a ledger entry; a stake sent from a wallet
            is in the contract. They are two parimutuel pools on one question and they settle
            independently — `foresight/src/custodialstakes.ts` refuses to add them. This page read
            only the contract's, so somebody who staked 10 EMBER from their balance came back to a
            market that said nobody had staked at all.

            The CloudsForge pot goes FIRST, for the same reason the CloudsForge stake panel does:
            it is the one most readers here can act in.
          */}
          {custodialPools !== null && custodial !== undefined && (
            <>
              <p className="fs-desk__note">
                Two pots, kept apart. You are paid out of the one you staked into, at that pot&apos;s
                split.
              </p>
              <PoolRatioBar
                pools={custodialPools}
                title="From CloudsForge balances"
                sub="Money people already had here, whichever currency they arrived with, counted in EMBER from the moment it was staked."
                emptyNote="Nobody has staked from a CloudsForge balance yet. Read that as an empty pot, not as even odds."
                note="Read from our own ledger as this page loaded, so there is no chain to be behind."
                tone="current"
              />
              <p className="fs-stakers">
                {custodial.stakerCount > 0
                  ? `${custodial.stakerCount} ${custodial.stakerCount === 1 ? 'account has' : 'accounts have'} staked this way.`
                  : 'No account has staked this way yet.'}
              </p>
            </>
          )}
          {/*
            BEFORE the ratio bar it explains, deliberately. Part of the two numbers below may be
            the platform's own money, and a reader told that after reading the odds has already
            formed a view from a figure whose composition they were not given. It stays a bordered
            block at body size with a heading of its own — see `components/houseseed.tsx` for why
            a badge would satisfy the letter of the disclosure and none of it.
          */}
          <HouseSeedNotice disclosure={houseSeed} />
          <PoolRatioBar
            pools={pools}
            title={custodialPools === null ? 'Pool split' : 'On chain, from wallets'}
            {...(custodialPools === null
              ? {}
              : {
                  sub: 'Stakes sent to the contract from people’s own addresses. Mirrored from the chain, so this one carries a reading time.',
                  emptyNote:
                    'No wallet has staked into the contract yet. Read that as an empty pot, not as even odds.',
                })}
            note={obs.text}
            tone={obs.tone}
          />
          <p className="fs-stakers">
            {pool.stakerCount > 0
              ? `${pool.stakerCount} ${pool.stakerCount === 1 ? 'address has' : 'addresses have'} staked.`
              : 'No address has staked yet.'}
          </p>
          <p className="fs-desk__note">
            The losing side&apos;s money is shared out among the winning side in proportion to what
            each person put in, so your return moves with the split until the market closes. Nobody
            here can hand you fixed odds.
          </p>
        </section>

        {/*
          THE RECEIPT, directly under the pool and above the forms. A custodial stake leaves no
          hash and no explorer entry, so this panel is the reader's only evidence it happened — and
          it is placed where somebody who has just staked is already looking.
        */}
        <YourCustodialStake marketId={market.id} refreshKey={staked} />

        {takesStakes(market.status) && (
          <>
            {/*
              THE CUSTODIAL PANEL IS FIRST, AND THAT ORDER IS THE FIX FOR A REAL DEFECT.

              A reader who has deposited coins with CloudsForge needs no wallet, no extension and
              no EMBER to bet — and for the whole life of this page they met a demand for a browser
              wallet first, with the path that already worked for them somewhere below it. The
              majority of people who can act on this page can act through the ledger, so the ledger
              goes on top.

              Still a separate section, a separate heading and a separate disclosure — never a
              second tab on the wallet panel. Two stake paths that look alike and fail oppositely
              is the confusion 25-wallet-clients.md §1 names as the most dangerous thing this
              estate can build; the ORDER changed, the separation did not.
            */}
            <CustodialStakePanel market={market} onStaked={onStaked} />
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
                and a block explorer even with every machine of ours switched off. It needs a
                browser wallet and EMBER of your own.
              </p>
              <StakePanel
                market={market}
                pools={pools}
                poolIsKnown={poolIsKnown}
                onStaked={onStaked}
              />
            </details>
          </>
        )}

        {/* Collecting is acting, so it belongs at the desk beside staking and not at the foot of
            the reading — a reader who came back to a resolved market came back for this. */}
        {(market.status === 'resolved' ||
          market.status === 'settled' ||
          market.status === 'void') && (
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
      </aside>
      </div>
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
