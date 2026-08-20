/**
 * The board. Every market Foresight is running, ordered by the thing a reader is deciding about.
 *
 * `GET /markets?status=&limit=` — `foresight/src/server.ts`. The status names are the seven at
 * `server.ts` and nothing else; a filter this page offered that the service did not know would be
 * a 400 rendered at a reader who cannot act on it.
 *
 * ── WHY THIS IS A BOARD AND NOT A GRID OF CARDS ────────────────────────────────────────────────
 *
 * It was a grid of cards, and the grid was the defect. Every card carried the same four-row
 * definition list — Closes, Resolved from, Fee on the losing pool, Outcome — inside the same
 * rounded raised panel at the same width. Two of those four rows are the SAME VALUE on every
 * market in the estate: `feeBps` is 200 on all of them, and `resolutionSourceKind` takes three
 * values across the whole table. So roughly sixty per cent of each card's ink was a constant,
 * repeated fifteen times down the page, and the reader's eye had nothing to catch on. The
 * complaint that produced this rewrite was, exactly, "continuous tiles of the same colour and
 * pattern" — which is a fair description of a layout that renders a constant fifteen times.
 *
 * The fix is not prettier cards. It is to lay the page out along the axis that actually varies.
 * For an open market that axis is TIME: the close times on this list span from days to eight
 * months out, and how long you have is the first thing that decides whether a question is worth
 * reading. So the rows are grouped by close horizon, the countdown is the largest thing in the
 * row, and it is set in the mono face so the column reads as a column of different numbers
 * rather than as fifteen paragraphs of the same shape.
 *
 * The grouping FOLLOWS THE FILTER, because the axis that varies changes with it (`groupingFor`):
 * among resolved markets every close time is in the past and the thing that differs is the
 * answer, so those group by outcome. Among closed ones what differs is how long resolution has
 * been outstanding. A structural device that encodes nothing is decoration, and this one is asked
 * to encode something in every view it appears in.
 *
 * ── The fee that used to be on every card ──────────────────────────────────────────────────────
 *
 * It is stated once, in the folded explainer at the top, and in full on each market's own page
 * where `GET /markets/:id` carries the pool it applies to. Stating a constant once is not hiding
 * it; stating it fifteen times is not disclosing it harder.
 *
 * The cards carried no pool and neither do the rows, for the reason they never did: `GET /markets`
 * returns `publicView(market)` and nothing else (`server.ts`), so a bar drawn here would be drawn
 * from a number the response did not contain. The odds are on the page that has them.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, Failed, Forbidden, Loading } from '../components/states.tsx'
import { MarketImage } from '../components/marketimage.tsx'
import { OUTCOME_NO, OUTCOME_YES } from '../lib/abi.ts'
import { listMarkets, type MarketStatus, type MarketView } from '../lib/foresight.ts'
import { instant, untilLabel, utcDateTime } from '../lib/format.ts'
import { phaseLabel, phaseOf, type MarketPhase } from '../lib/market.ts'
import { useResource } from '../lib/resource.ts'
import { marketPath, publicPath } from '../lib/routes.ts'

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

/**
 * A colour per category, and the slot they are drawn from is not arbitrary.
 *
 * `foresight/src/categories.ts` defines exactly three, at `CATEGORY_VERSION = 1`. Any two of
 * these tags can end up touching — two rows of the same group are adjacent, and the tags sit in a
 * column — so this is an ALL-PAIRS form in the token system's own vocabulary, not an adjacent
 * one. `tokens.css` is explicit about the difference: the eight-slot categorical order is safe
 * only for neighbours, and "no five-hue subset of the eight passes" an all-pairs check, which is
 * why it publishes a separate capped ramp. Three categories fit inside that cap of four, so they
 * take `--cf-viz-ap-1..3` rather than `--cf-viz-1..3`.
 *
 * A FOURTH CATEGORY IS THE INTERESTING CASE. `--cf-viz-ap-4` exists and is free, so adding one is
 * a one-line change here. A FIFTH is not: the ramp stops at four on purpose, and the token file
 * says what to do instead — fold to "Other", facet, or direct-label. Do not invent a hue.
 *
 * The tone is never the only channel. Every tag carries its own words beside the dot, so a reader
 * who cannot separate gold from violet loses nothing but a shortcut.
 */
const CATEGORY_TONE: Readonly<Record<string, string>> = {
  market_prices: 'var(--cf-viz-ap-1)',
  protocol_network: 'var(--cf-viz-ap-2)',
  scheduled_public_events: 'var(--cf-viz-ap-3)',
}

/** Unknown categories get the neutral rail rather than a hue invented at render time. */
function toneFor(category: string): string {
  return CATEGORY_TONE[category] ?? 'var(--cf-fg-mute)'
}

/** `scheduled_public_events` → `scheduled public events`. The service's spelling, made readable. */
function words(value: string): string {
  return value.replace(/_/g, ' ')
}

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

  /*
   * ONE `now` FOR THE WHOLE RENDER, and it is not a detail.
   *
   * The countdown, the group a row lands in, the phase word and the length of the elapsed stem are
   * four readings of the same clock. Taken separately — `new Date()` inside each row, as the old
   * card did — a market can be grouped under "closing today" by one call and labelled "closed" by
   * another a millisecond later, and the page contradicts itself in two places a reader can see at
   * once. Hoisting it makes the whole render one observation.
   */
  const now = useMemo(() => new Date(), [markets.data])

  /*
   * The hero is the market that closes SOONEST among those still open, and it is offered only when
   * the list being shown contains open markets. On the "Resolved" filter there is no next thing to
   * decide about, and promoting an arbitrary settled market to the top of the page would be a
   * device with nothing behind it.
   */
  const hero = useMemo(() => (markets.data ? soonest(markets.data.markets, now) : null), [markets.data, now])

  /*
   * AND IT IS THEN TAKEN OUT OF THE ROWS. Promoting a market and also listing it is the page saying
   * the same thing twice in the same screenful — the first cut did exactly that, and the group it
   * left behind read "Closing this week — 1" pointing at the market three inches above it. A
   * promotion has to cost the list its copy or it is not a promotion.
   */
  const grouping = groupingFor(status)
  const groups = useMemo(() => {
    if (!markets.data) return []
    const rest = hero ? markets.data.markets.filter((market) => market.id !== hero.id) : markets.data.markets
    return groupMarkets(rest, grouping, now)
  }, [markets.data, grouping, now, hero])

  return (
    <div className="fs-page fs-board">
      <header className="fs-board__head">
        {/*
          The mark, from `brand/assets/foresight`. It is the page's crest and nothing more —
          decorative, so it is hidden from the accessibility tree and the `<h1>` beside it carries
          the meaning. The strip above already says "Forge Foresight" in words; this does not
          repeat those words, it shows the drawing they belong to, and the drawing is the same
          diagram the rows use: a stem rising from a baseline to a node, and two branches leaving
          it — one taken, one not.
        */}
        <img
          className="fs-board__mark"
          src={publicPath('/mark-256.png')}
          alt=""
          aria-hidden="true"
          width="52"
          height="52"
        />
        <div className="fs-board__headtext">
          <h1 className="fs-board__title">Back your read on what happens next</h1>
          <p className="fs-board__lede">
            Take a side with the coin you already hold. Everyone&rsquo;s stake joins one pool, and a
            contract on Hearth splits it between whoever called it right.
          </p>
        </div>
      </header>

      {/*
        THE FOUR PRIMER TILES ARE GONE AND THIS IS WHAT REPLACED THEM.
        ──────────────────────────────────────────────────────────────────────────────────────────
        They were four raised panels of body copy — around 90 words each — sitting between the
        title and the first market, and a reader arriving to look at questions had to scroll past
        360 words of policy to reach one. The content was not wrong, and none of it is deleted:
        every claim below is the same claim, cut to a clause, and the folded panel keeps them one
        keystroke away for the reader who wants them.

        `<details>` rather than a link to a page: these four facts answer "how does this pay?",
        which is a question asked ONCE, on arrival, and never again. A route would make the answer
        a place you have to come back from. A fold answers it in situ and then gets out of the way.

        The tiles also carried the layout note about `fs-rules--primer` and its 1 → 2 → 4 column
        steps. That rule still exists in `styles.css` and is still used by the rules page; it is
        no longer used here, because there is no longer a four-item grid on this page to orphan.
      */}
      <details className="fs-primer">
        <summary className="fs-primer__summary">
          <span className="fs-primer__q">How a payout works</span>
          <span className="fs-primer__hint" aria-hidden="true">
            four things worth knowing
          </span>
        </summary>
        <dl className="fs-primer__body">
          <div>
            <dt>Bring the coin you already hold</dt>
            {/*
              NO COUNT HERE, and no roll-call either. Both were tried and both went wrong the same
              way. The roll-call named SOL and XRP, which `foresight`'s `stake_assets` registry has
              never held a row for, so a reader who arrived with either got `unknown_asset` from a
              page that had just invited them by name. The count said "Seven currencies", which was
              only reachable by counting SHARD — refused outright by `parseStakeAssetCode` via
              `isRetiredAsset`. Both were a set the SERVICE owns, restated by hand in a bundle
              nothing notifies when it changes. Pointing at the live list is the whole fix: the
              market page's `CustodialStakePanel` fetches `GET /stake-assets` and renders what came
              back, including the refusals and their reasons.
            */}
            <dd>
              Whatever a market page lists is accepted, and so is every token minted on the
              platform. You see the conversion before you commit.
            </dd>
          </div>
          <div>
            <dt>One pool, whatever you paid with</dt>
            <dd>
              Every stake converges into a single pool per market. Bitcoin and Litecoin have no
              contract that could hold a pot, so a per-currency pool would be a figure we held and
              promised to share out.
            </dd>
          </div>
          <div>
            <dt>The contract pays, not the company</dt>
            <dd>
              Claiming reads the contract&rsquo;s own storage. Switch off every server we run and a
              winner with a wallet still gets paid.
            </dd>
          </div>
          <div>
            <dt>Your return follows the crowd</dt>
            <dd>
              The winning side shares the losing side&rsquo;s stake in proportion to what each
              person put in, less 2% of the losing pool. Nobody quotes you fixed odds.
            </dd>
          </div>
        </dl>
      </details>

      {markets.state === 'ok' && hero && <Hero market={hero} now={now} />}

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
      {markets.state === 'ok' &&
        groups.map((group) => (
          <section className="fs-group" key={group.key} aria-labelledby={`group-${group.key}`}>
            <h2 className="fs-group__head" id={`group-${group.key}`}>
              <span className="fs-group__label">{group.label}</span>
              {/*
                The count is the reason the header earns its line. "Closing this month — 11" tells a
                reader how much of the page is theirs before they scroll it; a bare heading does
                not. It sits AGAINST the label rather than flushed to the far margin, where it read
                as a stray digit with nothing near enough to attach itself to.
              */}
              <span className="fs-group__count cf-num">{group.markets.length}</span>
              <span className="fs-group__rule" aria-hidden="true" />
            </h2>
            <ul className="fs-rows">
              {group.markets.map((market) => (
                <Row key={market.id} market={market} now={now} />
              ))}
            </ul>
          </section>
        ))}
    </div>
  )
}

function labelFor(status: MarketStatus): string {
  return FILTERS.find((f) => f.status === status)?.label.toLowerCase() ?? status
}

/* ── the signature: the mark, drawn from the market's own numbers ─────────────────────────────── */

/**
 * How far through its life a market is: `0` at open, `1` at close.
 *
 * `null` — NOT `0` — when `openedAt` is missing, and the difference is the whole point. A market
 * with no open time is one whose elapsed span is unknown, and drawing an empty stem for it would
 * say "this only just opened", which is a claim the response did not make. The glyph renders the
 * unknown case as a stem that is dashed end to end: no assertion about where in its life it is.
 *
 * `openedAt` is on `publicView` (`foresight/src/markets.ts`) and is null for anything that has not
 * opened, which is every market this page never shows — but the null is handled rather than
 * assumed away, because `draft` and `approved` are reachable through the route and one day some
 * caller will pass them.
 */
function lifeProgress(market: MarketView, now: Date): number | null {
  const opened = instant(market.openedAt)
  const closes = instant(market.closeTime)
  if (opened === null || closes === null) return null
  const span = closes.getTime() - opened.getTime()
  if (span <= 0) return null
  const done = (now.getTime() - opened.getTime()) / span
  return Math.min(1, Math.max(0, done))
}

/**
 * The mark, laid on its side and fed real numbers. This is the one bold element on the page.
 *
 * `brand/assets/foresight/mark-1024x1024.png` is a stem rising off a bone baseline to a node,
 * where it splits into a solid branch and a dashed one. Read as a diagram rather than as a logo it
 * is already a picture of a prediction market: a shared past, a present, and two futures of which
 * exactly one will turn out to have been real. So the row draws it with the market's own numbers —
 * the baseline tick is the open, the stem is the elapsed fraction of the market's life, the node
 * is now, and the two branches are the outcomes.
 *
 *   * While a market is open BOTH branches are dashed. Neither has happened, and drawing one solid
 *     would be the page picking a side.
 *   * Once `outcome` is posted the taken branch goes solid in the category's colour and the other
 *     drops to a ghost. That is the mark's own grammar — solid means taken — used to say something
 *     the response actually contains.
 *   * With no `openedAt` the stem is dashed end to end and the node sits at the far right, which
 *     reads as "somewhere in its life, and now is now" rather than as a measurement.
 *
 * ── THE BRANCHES ARE NOT DRAWN ON AN OPEN ROW, AND THAT IS THE SAME RULE THE PAGE IS ABOUT ─────
 *
 * They were, in the first cut, and it was wrong for exactly the reason the card grid was wrong.
 * While a market is open both branches are identical — same angle, same dash, same grey — on every
 * row, so thirty rows carried thirty copies of one drawing while only the stem varied. A constant
 * repeated per item is the defect this layout exists to remove, and it does not stop being one
 * because it is a picture rather than a definition list. So a row draws the part that VARIES —
 * baseline, stem, node — and the branches appear at the moment they mean something: when the
 * outcome is known, and in the hero, where the glyph is large enough to be read as a diagram
 * rather than skimmed as texture.
 *
 * `aria-hidden`, and every fact in it is in words elsewhere in the same row: the countdown, the
 * phase and the outcome are all text. This draws what the row already says.
 */
function Fork({
  progress,
  outcome,
  tone,
  size = 'sm',
}: {
  progress: number | null
  outcome: number | null
  tone: string
  size?: 'sm' | 'lg'
}) {
  const large = size === 'lg'
  const W = large ? 200 : 108
  const H = large ? 64 : 34
  const stroke = large ? 3 : 2
  const known = outcome === OUTCOME_YES || outcome === OUTCOME_NO
  const yesTaken = outcome === OUTCOME_YES
  const branches = large || known
  // With no branches to make room for, the stem takes the whole width — the varying thing gets all
  // the space there is.
  const nodeX = branches ? 10 + (W - 20) * 0.6 : W - 5
  const midY = H / 2
  const tipX = W - 4
  const at = progress === null ? nodeX : 10 + (nodeX - 10) * progress

  return (
    <svg
      className={`fs-fork fs-fork--${size}`}
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      aria-hidden="true"
      focusable="false"
    >
      {/* The baseline. Bone in the mark, and `--cf-fg-mute` is the token that carries bone here. */}
      <line
        x1="3"
        y1={midY - (large ? 12 : 7)}
        x2="3"
        y2={midY + (large ? 12 : 7)}
        stroke="var(--cf-fg-mute)"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      {/* The whole stem, always drawn, always faint: the track the elapsed part fills. */}
      <line x1="5" y1={midY} x2={nodeX} y2={midY} stroke="var(--cf-line-strong)" strokeWidth={stroke} strokeLinecap="round" />
      {progress !== null && (
        <line x1="5" y1={midY} x2={at} y2={midY} stroke={tone} strokeWidth={stroke} strokeLinecap="round" />
      )}
      {branches && (
        <>
          {/* YES leaves upward, NO downward — the same order they are written in everywhere else. */}
          <path
            d={`M ${nodeX} ${midY} Q ${(nodeX + tipX) / 2} ${midY} ${tipX} ${midY - (H / 2 - 6)}`}
            fill="none"
            stroke={known && yesTaken ? tone : 'var(--cf-fg-mute)'}
            strokeOpacity={known && !yesTaken ? 0.2 : 1}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={known && yesTaken ? undefined : `${stroke * 2} ${stroke * 2}`}
          />
          <path
            d={`M ${nodeX} ${midY} Q ${(nodeX + tipX) / 2} ${midY} ${tipX} ${midY + (H / 2 - 6)}`}
            fill="none"
            stroke={known && !yesTaken ? tone : 'var(--cf-fg-mute)'}
            strokeOpacity={known && yesTaken ? 0.2 : 1}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={known && !yesTaken ? undefined : `${stroke * 2} ${stroke * 2}`}
          />
        </>
      )}
      <circle cx={at} cy={midY} r={large ? 6.5 : 4.5} fill={tone} />
    </svg>
  )
}

/* ── the hero ─────────────────────────────────────────────────────────────────────────────────── */

/**
 * The market that closes soonest, given a whole band of its own.
 *
 * It is a promotion of one row rather than a different kind of object: same countdown, same fork,
 * same tag, all larger. A hero built from different fields would be a second design to maintain
 * and would teach a reader that the board's own vocabulary is not the important one.
 */
function Hero({ market, now }: { market: MarketView; now: Date }) {
  const phase = phaseOf(market, now)
  const closesIn = untilLabel(market.closeTime, now)
  const tone = toneFor(market.category)

  return (
    <Link className="fs-hero" to={marketPath(market.id)} style={{ '--fs-tone': tone } as React.CSSProperties}>
      {/*
        `GET /markets` DOES carry the image — `publicView` composes it per response — so unlike the
        pool this is not a figure the list route omits. Nothing is rendered when there is no image
        and nothing when `bytesUrl` is null; a placeholder frame would be a picture the market does
        not have. The hero's grid collapses to one column when the `<img>` is absent, so a market
        without one is not a band with a hole in it.
      */}
      <MarketImage image={market.image} question={market.question} className="fs-hero__image" />
      <div className="fs-hero__body">
        <p className="fs-hero__eyebrow">
          <span className="fs-tag__dot" style={{ background: tone }} aria-hidden="true" />
          Next to close
        </p>
        <h2 className="fs-hero__question">{market.question}</h2>
        <div className="fs-hero__clock">
          <Fork progress={lifeProgress(market, now)} outcome={market.outcome} tone={tone} size="lg" />
          <span className="fs-hero__until cf-num">{closesIn ?? phaseLabel(phase)}</span>
          {closesIn !== null && <span className="fs-hero__untilnote">left to take a side</span>}
        </div>
        <p className="fs-hero__foot">
          {utcDateTime(market.closeTime) ?? 'no close time'} · settled from {words(market.resolutionSourceKind)}
        </p>
      </div>
    </Link>
  )
}

/* ── one row ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * One market. The whole row is the link — there is no "See what settles this →" line any more,
 * because a link inside a row that is itself a link is two targets for one destination, and the
 * old card had exactly that: an `<a>` on the question and a second `<a>` at the bottom.
 */
function Row({ market, now }: { market: MarketView; now: Date }) {
  const phase = phaseOf(market, now)
  const closesIn = untilLabel(market.closeTime, now)
  const tone = toneFor(market.category)
  const outcome = market.outcome === OUTCOME_YES ? 'Yes' : market.outcome === OUTCOME_NO ? 'No' : null

  return (
    <li className="fs-row" style={{ '--fs-tone': tone } as React.CSSProperties}>
      <Link className="fs-row__link" to={marketPath(market.id)}>
        {/*
          The countdown is the largest thing in the row and it is set in the mono face on purpose:
          down a group of six rows this becomes a column of six different figures, which is the one
          thing the old grid of cards never had. When there is nothing to count down to it holds
          the outcome or the phase instead, so the slot is never empty and never a dash.

          THERE IS NO "to close" UNDER IT. There was, on every row, and it was the card grid's
          defect wearing a smaller font: a label identical on thirty rows, printed at a fixed pitch,
          teaching a reader to skip a column. The group heading above already says "Closing this
          month", and `6d 3h` set in mono under a heading that says closing is not ambiguous. The
          note survives only where the big figure is NOT a countdown — there it says which kind of
          thing the words above it are, which differs from row to row.
        */}
        <span className="fs-row__clock">
          <span className="fs-row__until cf-num">{closesIn ?? outcome ?? phaseLabel(phase)}</span>
          {closesIn === null && <span className="fs-row__unitnote">{phaseWord(phase, outcome)}</span>}
        </span>

        <Fork progress={lifeProgress(market, now)} outcome={market.outcome} tone={tone} />

        <span className="fs-row__main">
          <span className="fs-row__question">{market.question}</span>
          <span className="fs-row__meta">
            <span className="fs-tag">
              <span className="fs-tag__dot" style={{ background: tone }} aria-hidden="true" />
              {words(market.category)}
            </span>
            <span className="fs-row__sep" aria-hidden="true">
              /
            </span>
            <span>from {words(market.resolutionSourceKind)}</span>
          </span>
        </span>

        <span className="fs-row__go" aria-hidden="true">
          →
        </span>
      </Link>
    </li>
  )
}

/** The small line under the big figure when the big figure is not a countdown. */
function phaseWord(phase: MarketPhase, outcome: string | null): string {
  if (outcome !== null) return phase === 'settled' ? 'settled' : 'resolved'
  return phaseLabel(phase).toLowerCase()
}

/* ── grouping: the axis that varies, per filter ───────────────────────────────────────────────── */

type Grouping = 'horizon' | 'sinceClose' | 'outcome' | 'phase' | 'none'

interface Group {
  readonly key: string
  readonly label: string
  readonly markets: readonly MarketView[]
}

/**
 * Which axis to cut the list along.
 *
 * The filter has already fixed one field, so grouping by that field again would produce a single
 * group with a heading that repeats the button the reader just pressed. What is left is the axis
 * that still moves inside the selection, and it is different for each one.
 */
function groupingFor(status: MarketStatus | null): Grouping {
  switch (status) {
    case 'open':
      return 'horizon'
    case 'closed':
      return 'sinceClose'
    case 'resolved':
    case 'settled':
      return 'outcome'
    case 'void':
      return 'none'
    default:
      return 'phase'
  }
}

const DAY = 86_400_000

/** The buckets, in the order they are shown. Empty ones are dropped rather than rendered as zero. */
const ORDER: Readonly<Record<Grouping, readonly string[]>> = {
  horizon: ['today', 'week', 'month', 'quarter', 'later', 'past'],
  sinceClose: ['just', 'week', 'earlier', 'unknown'],
  outcome: ['yes', 'no', 'none'],
  phase: ['closing_soon', 'open', 'closed', 'resolved', 'settled', 'void', 'not_open'],
  none: ['all'],
}

const LABELS: Readonly<Record<string, string>> = {
  today: 'Closing within a day',
  week: 'Closing this week',
  month: 'Closing this month',
  quarter: 'Closing within three months',
  later: 'Further out',
  past: 'Past their close time',
  just: 'Closed within a day',
  earlier: 'Closed earlier',
  yes: 'Answered yes',
  no: 'Answered no',
  none: 'No outcome posted',
  all: 'Refunding',
}

function bucketOf(market: MarketView, grouping: Grouping, now: Date): string {
  switch (grouping) {
    case 'horizon': {
      const closes = instant(market.closeTime)
      if (closes === null) return 'later'
      const left = closes.getTime() - now.getTime()
      if (left <= 0) return 'past'
      if (left < DAY) return 'today'
      if (left < 7 * DAY) return 'week'
      if (left < 31 * DAY) return 'month'
      // A single "further out" bucket held nineteen of thirty-one markets on the live estate, which
      // is a heading standing over a list long enough to need one of its own. Three months is the
      // cut because it is where the estate's own close times cluster, not because it is a round
      // number: the season-long sports questions land inside it and the year-end ones outside.
      if (left < 93 * DAY) return 'quarter'
      return 'later'
    }
    case 'sinceClose': {
      const closes = instant(market.closeTime)
      if (closes === null) return 'unknown'
      const since = now.getTime() - closes.getTime()
      if (since < DAY) return 'just'
      if (since < 7 * DAY) return 'week'
      return 'earlier'
    }
    case 'outcome':
      // `0` is YES and is falsy. `market.outcome ? 'no' : 'yes'` would file every unresolved
      // market under YES, which is a wrong answer that renders confidently — see `outcomeLabel`.
      return market.outcome === OUTCOME_YES ? 'yes' : market.outcome === OUTCOME_NO ? 'no' : 'none'
    case 'phase':
      return phaseOf(market, now)
    case 'none':
      return 'all'
  }
}

/**
 * The list, cut into groups and sorted inside them.
 *
 * Within a group the order is by close time — soonest first while looking forward, most recent
 * first while looking back — so a group is never an arbitrary sequence. The service returns rows
 * in its own order and this page does not depend on it.
 */
function groupMarkets(markets: readonly MarketView[], grouping: Grouping, now: Date): Group[] {
  const backwards = grouping === 'sinceClose' || grouping === 'outcome'
  const buckets = new Map<string, MarketView[]>()
  for (const market of markets) {
    const key = bucketOf(market, grouping, now)
    const list = buckets.get(key)
    if (list) list.push(market)
    else buckets.set(key, [market])
  }
  const keys = [...ORDER[grouping], ...[...buckets.keys()].filter((k) => !ORDER[grouping].includes(k))]
  const out: Group[] = []
  for (const key of keys) {
    const list = buckets.get(key)
    if (!list || list.length === 0) continue
    list.sort((a, b) => {
      const at = instant(a.closeTime)?.getTime() ?? 0
      const bt = instant(b.closeTime)?.getTime() ?? 0
      return backwards ? bt - at : at - bt
    })
    out.push({
      key,
      label: LABELS[key] ?? (grouping === 'phase' ? phaseLabel(key as MarketPhase) : words(key)),
      markets: list,
    })
  }
  return out
}

/** The open market closing soonest, or `null` when none of the listed markets is still open. */
function soonest(markets: readonly MarketView[], now: Date): MarketView | null {
  let best: MarketView | null = null
  let bestAt = Number.POSITIVE_INFINITY
  for (const market of markets) {
    if (market.status !== 'open') continue
    const closes = instant(market.closeTime)
    if (closes === null) continue
    const at = closes.getTime()
    if (at <= now.getTime()) continue
    if (at < bestAt) {
      best = market
      bestAt = at
    }
  }
  return best
}
