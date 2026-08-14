/**
 * Every request this app makes to `micro-foresight`, and the line of its route table that each
 * one was verified against.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * READ THIS BEFORE ADDING A CALL.
 *
 * This estate has shipped TWO defects of exactly one kind — a client written against a surface
 * somebody imagined rather than the one the service registers:
 *
 *   - `micro-wallet` called `POST /v1/quotes`; `micro-pricing` serves `/rates`.
 *   - `micro-market` called `POST /v1/decisions/market.listing`; `micro-policy` has NO `/v1`
 *     routes at all, takes the action in the body, and registers `market.listing.create`. That
 *     one returned 403 on *every* listing.
 *
 * Both were found by a human reading the other side's routes. So: `buildRoutes()` in
 * `foresight/src/server.ts` is the only place a route is declared, and every path below names that
 * file. It names the FILE and not a line in it — a line names a position in a file micro-foresight
 * owns and is free to edit, and nothing runs this suite when that service changes, so a line goes
 * stale silently and surfaces during a release. **There is no `/v1` prefix on anything in this
 * service.** `test/foresight.test.ts` asserts the REQUEST — path, method, query
 * and body — for every call in this file, because a test that stubs fetch and asserts the
 * response is a test that passes against a path that does not exist.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { api, type RequestOptions } from './api.ts'
import type { ImageRef } from './studio.ts'

/* ------------------------------------------------------------------ what the service sends */

/**
 * `MarketStatus` — `foresight/src/markets.ts`.
 *
 * All seven, including the three a public reader will rarely see: a market is `draft` until an
 * operator approves it and `approved` until it is deployed, and both are listable.
 */
export type MarketStatus = 'draft' | 'approved' | 'open' | 'closed' | 'resolved' | 'settled' | 'void'

/** Every status `?status=` accepts — `foresight/src/server.ts`. */
export const MARKET_STATUSES: readonly MarketStatus[] = [
  'draft',
  'approved',
  'open',
  'closed',
  'resolved',
  'settled',
  'void',
]

/**
 * `imageView` — `foresight/src/images.ts`.
 *
 * `bytesUrl` is ABSOLUTE, or `null` when the deployment has no `STUDIO_PUBLIC_URL`. It is never a
 * relative path, deliberately: a relative path in an `<img src>` would resolve against this app's
 * own origin and 404. A null means "this deployment cannot tell you where the bytes are", and the
 * only correct response to it is to render no image rather than a broken one.
 */
export interface MarketImageRef {
  readonly assetId: string
  /** `sha256:<64 lowercase hex>`. Recorded by the service, not verified by it — see below. */
  readonly checksum: string
  readonly bytesUrl: string | null
}

/**
 * One market, exactly as `publicView` emits it — `foresight/src/markets.ts`.
 *
 * Deliberately narrow on the service's side, and mirrored narrowly here. There is no lease owner,
 * no raw transaction, no custody audit id and no operator subject in it, and adding a field to
 * this interface that `publicView` does not return would produce `undefined` at runtime with no
 * type error at all.
 */
export interface MarketView {
  readonly id: string
  readonly status: MarketStatus
  readonly question: string
  readonly resolutionCriteria: string
  readonly category: string
  readonly categoryVersion: number
  /** The kind of source named AT OPEN, never chosen at resolve time. 19-new-products.md §2.3.5. */
  readonly resolutionSourceKind: string
  readonly resolutionSourceRef: string
  /** keccak256 of the canonical document. Recomputable from `document.canonical`; see `market.ts`. */
  readonly questionHash: string
  readonly closeTime: string
  readonly disputeWindowSeconds: number
  readonly feeBps: number
  readonly chain: string
  readonly network: string
  readonly contractAddress: string | null
  readonly outcome: number | null
  readonly voidReason: string | null
  /**
   * The header image, or `null` — `foresight/src/markets.ts`, `publicView`.
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * **PRESENTATIONAL. THE CHAIN KNOWS NOTHING ABOUT IT, AND NO UI MAY IMPLY OTHERWISE.**
   *
   * It arrives in the same object as `questionHash` and `contractAddress`, and its `checksum`
   * looks exactly like `questionHash` two fields away. It is not the same kind of thing.
   * `questionHash` is written into the deployed contract and this app RECOMPUTES it from the
   * canonical document (`lib/market.ts`, `checkDocument`). An image checksum is a value studio
   * measured and foresight recorded; foresight never re-measures it and neither does this app.
   *
   * So the image must never be rendered as evidence, never carry a tick, and never sit inside the
   * hash panel or beside the contract address. The words "verified", "attested", "on-chain" and
   * "anchored" are forbidden next to it. The false version of that claim would be undetectable —
   * Hearth has no Registry of Authorship contract at all — and a check that always passes teaches
   * a reader that the checks which CAN fail are decoration too.
   * ══════════════════════════════════════════════════════════════════════════════════════════
   */
  readonly image: MarketImageRef | null
  readonly openedAt: string | null
  readonly closedAt: string | null
  readonly resolvedAt: string | null
  readonly settledAt: string | null
  readonly voidedAt: string | null
}

/** `PoolView` — `foresight/src/mirror.ts`. Wei are strings; a JSON number cannot hold 1e18. */
export interface PoolView {
  readonly yes: string
  readonly no: string
  readonly total: string
  readonly yesBps: number | null
  readonly noBps: number | null
  readonly stakerCount: number
  /**
   * When the mirror last read the chain. `null` means it never has.
   *
   * `mirror.ts`: "Shown, always. A pool with no `asOf` is a pool a reader will assume is
   * live." Every figure derived from this object is rendered beside it.
   */
  readonly asOf: string | null
  readonly lastBlock: number | null
  readonly tipBlock: number | null
  readonly behindBlocks: number | null
  /** True once the mirror is a confirmation depth behind, OR has never run — `mirror.ts`. */
  readonly stale: boolean
}

/**
 * `CustodialPoolView` — the OTHER book on the same question, `foresight/src/custodialstakes.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **NEVER ADD THIS TO `pool`.** They are two parimutuel pools on one market and they settle
 * independently: money staked through a CloudsForge balance is paid out of the custodial losers'
 * money, and money staked from a wallet is paid out of the contract's. A sum of the two would
 * quote somebody odds computed from money they cannot win.
 *
 * It is on the wire because leaving it off was a defect with a name: a reader who staked 10 EMBER
 * from their balance watched this page keep saying `0` on both sides, because the only pool it
 * knew about was the one their stake had never entered.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export interface CustodialPoolView {
  readonly yes: string
  readonly no: string
  readonly total: string
  readonly yesBps: number | null
  readonly noBps: number | null
  readonly stakerCount: number
  /** The unit of every figure above — EMBER, and the service says so rather than this app assuming. */
  readonly asset: string
}

/** The body of `GET /markets/:id/custodial-position` — `foresight/src/server.ts`. */
export interface CustodialPositionResponse {
  readonly marketId: string
  /** Pool units. What a payout is counted in, whatever was brought to buy it. */
  readonly asset: string
  readonly yes: string
  readonly no: string
  /** The platform's own sentence about what a custodial position is. Rendered as sent. */
  readonly disclosure: string
}

/** One source the idea pipeline found — `foresight/src/ideas.ts`. */
export interface IdeaSource {
  readonly url: string
  readonly title: string
  /** When the pipeline retrieved it. "A source that has since changed is still evidence." */
  readonly retrievedAt: string
}

/**
 * Why this market exists — `foresight/src/server.ts`.
 *
 * §2.3.3 of 19-new-products.md is the reason it is on the wire at all: "sources are carried
 * through to the public market page, so a bettor can see *why* the market exists". `null` for a
 * market an operator wrote from scratch, which is a different fact from a market with no sources.
 */
export interface Provenance {
  readonly origin: 'model' | 'operator'
  readonly searchQuery: string | null
  readonly sources: readonly IdeaSource[]
  readonly modelId: string | null
  readonly promptSha256: string | null
  readonly proposedAt: string
}

/**
 * The house seed disclosure — `houseSeedView`, `foresight/src/houseseed.ts`, served on
 * the market page at `foresight/src/server.ts`.
 *
 * ── This is the field docs/ecosystem/21 §7.6 is about ──────────────────────────────────────────
 *
 * §7.6: "The foresight market page **renders** the house seed disclosure whenever a house stake
 * exists — asserted the way admin-web asserts its missing og card: presence with force." The
 * service already proves it SERVES it (`foresight/src/houseseed.test.ts`). Everything below
 * exists so this app proves it SHOWS it, which is a different claim and the one a bettor cares
 * about: an undisclosed house position makes the other four properties (symmetric, at-open-only,
 * trigger-enforced, capped) pointless, because they are all things the reader is being asked to
 * take on trust *because* the position is disclosed.
 *
 * `disclosure` is composed by the service, once, deliberately — houseseed.ts: "so
 * `foresight-web` renders a disclosure the platform wrote rather than one each client
 * improvises." It is rendered verbatim. The amounts beside it are here so the sentence can be
 * CHECKED rather than merely repeated; see `houseseed.ts` in this app.
 *
 * Every field is typed as it arrives on the wire — wei as decimal strings, never a JSON number —
 * and every one of them is parsed defensively, because a disclosure that fails to render because
 * one field was the wrong shape is precisely the failure §7.6 exists to prevent.
 */
export interface HouseSeedView {
  /** `planned` — approved with a seed, not yet in the pool. `staked` — the money is in. */
  readonly state: 'planned' | 'staked'
  readonly houseAddress: string
  /** Wei on EACH outcome. Symmetric by CHECK constraint on the service's side. */
  readonly amountPerOutcomeWei: string
  /** Both sides together — twice `amountPerOutcomeWei`, and this app verifies that. */
  readonly totalWei: string
  readonly asset: 'EMBER'
  readonly stakedAt: string | null
  readonly txHashYes: string | null
  readonly txHashNo: string | null
  /** The platform's own sentence. Rendered as sent — 21 §5 words it. */
  readonly disclosure: string
}

/** The body of `GET /markets/:id` — `foresight/src/server.ts`. */
export interface MarketDetail {
  readonly market: MarketView
  readonly pool: PoolView
  /**
   * The custodial book. Optional on this type only because a deploy of this app can outrun a
   * deploy of the service — an older service omits the key, and the page renders the one book it
   * was given rather than a zero it made up.
   */
  readonly custodialPool?: CustodialPoolView
  /**
   * `null` when no house seed exists for this market, and the service sends the explicit null
   * rather than omitting the key (`foresight/src/houseseed.test.ts`) — so "no seed" is
   * distinguishable from "field missing because the deploy is old". Both render as no
   * disclosure; only one of them would be a bug worth finding.
   */
  readonly houseSeed: HouseSeedView | null
  readonly document: { readonly canonical: string; readonly hash: string }
  readonly provenance: Provenance | null
}

/** The body of `GET /markets/:id/positions/:address` — `foresight/src/server.ts`. */
export interface PositionResponse {
  readonly marketId: string
  readonly address: string
  /** Wei staked on each side, as strings — `foresight/src/mirror.ts`. */
  readonly position: { readonly yes: string; readonly no: string }
  /** Repeated out of `pool` deliberately; see the comment at `server.ts`. */
  readonly asOf: string | null
  readonly stale: boolean
  readonly contractAddress: string | null
}

/** The body of `POST /markets/:id/stake-intent` — `foresight/src/server.ts`. */
export interface StakeIntent {
  readonly marketId: string
  readonly chain: string
  readonly network: string
  /** The contract. The wallet sends here; not one wei passes through the service. */
  readonly to: string
  /** `stake(uint8)` calldata, built by the service — `server.ts`. */
  readonly data: string
  readonly outcome: number
  readonly amount: string
  readonly asset: 'EMBER'
  readonly policy: {
    readonly decision: string
    readonly reasons: readonly string[]
    readonly decisionId: string | null
  }
  readonly closeTime: string
}

/** `CategorySpec` — `foresight/src/categories.ts`. */
export interface CategorySpec {
  readonly id: string
  readonly title: string
  readonly description: string
  /**
   * The kinds of source that can settle a question here, in order of preference.
   *
   * Not decoration: a market's `resolutionSourceKind` must be one of these and it is checked.
   * `categories.ts` — "A category whose questions cannot be settled from a source the
   * operator would cite in public is a category this platform does not run."
   */
  readonly sourceKinds: readonly string[]
}

/**
 * The body of `GET /categories` — `foresight/src/server.ts`.
 *
 * `refusals` carries an `id` and a `reason` and no title — `categories.ts`.
 */
export interface CategoryCatalogue {
  readonly version: number
  readonly categories: readonly CategorySpec[]
  readonly refusals: readonly { readonly id: string; readonly reason: string }[]
}

/* ------------------------------------------------------------------ the calls */

/**
 * `GET /markets` — **`foresight/src/server.ts`**.
 *
 * `status` is optional and validated against the seven names at `server.ts`; `limit`
 * defaults to 50 server-side and must be a whole number in 1..200 (`server.ts`). Both are
 * checked here as well, so a bad value is a bug caught in a test rather than a 400 rendered at a
 * reader who cannot act on it.
 *
 * `async` so that a refusal is a REJECTED PROMISE rather than a synchronous throw. `useResource`
 * calls its loader inside an effect and catches on the promise; a throw from the call itself would
 * escape that catch and take the render down instead of showing the failed state.
 *
 * Unauthenticated: the route calls neither `authenticate` nor `requireAdmin`.
 */
export async function listMarkets(
  opts: { status?: MarketStatus | undefined; limit?: number | undefined; signal?: AbortSignal } = {},
): Promise<{ markets: readonly MarketView[] }> {
  const query: Record<string, string | number> = {}
  if (opts.status !== undefined) {
    if (!MARKET_STATUSES.includes(opts.status)) throw new RangeError(`unknown market status: ${opts.status}`)
    query['status'] = opts.status
  }
  if (opts.limit !== undefined) {
    if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 200) {
      throw new RangeError('limit must be a whole number between 1 and 200')
    }
    query['limit'] = opts.limit
  }
  return await api<{ markets: readonly MarketView[] }>('/markets', {
    // No token. Browsing is public, and sending one would make an anonymous read look
    // authenticated in the service's logs.
    auth: false,
    query,
    ...signalOf(opts.signal),
  })
}

/**
 * `GET /markets/:id` — **`foresight/src/server.ts`**.
 *
 * Returns the market, the pool, the canonical document with its hash, the house seed disclosure
 * and the provenance. This is the only route that carries the cited sources or the house seed,
 * and it is unauthenticated.
 */
export function getMarket(id: string, signal?: AbortSignal): Promise<MarketDetail> {
  return api<MarketDetail>(`/markets/${encodeURIComponent(id)}`, { auth: false, ...signalOf(signal) })
}

/**
 * `GET /markets/:id/positions/:address` — **`foresight/src/server.ts`**.
 *
 * Public, and keyed by ADDRESS rather than by session: a position belongs to whoever holds the
 * key, and the mirror is a copy of public chain state. The service checks the address against
 * `EVM_ADDRESS` (`server.ts`) and answers 400 otherwise.
 *
 * ── This is an N+1, and it is the service's shape, not a choice ────────────────────────────────
 *
 * There is no route that lists one address's positions across markets. `buildRoutes()` has
 * `/markets`, `/markets/:id` and this, and nothing else public. So the portfolio page lists
 * markets once and asks per market — see `positionsFor` in `portfolio.ts`, which bounds the
 * concurrency and degrades per market rather than as a whole.
 */
export function getPosition(
  marketId: string,
  address: string,
  signal?: AbortSignal,
): Promise<PositionResponse> {
  return api<PositionResponse>(
    `/markets/${encodeURIComponent(marketId)}/positions/${encodeURIComponent(address)}`,
    { auth: false, ...signalOf(signal) },
  )
}

/**
 * `GET /markets/:id/custodial-position` — what THIS reader has on this market, staked from their
 * CloudsForge balance.
 *
 * Authenticated and keyed by session rather than by address, because a custodial position has no
 * address: it is a ledger entry against the signed-in subject (`foresight/src/custodialstakes.ts`).
 * That is the whole difference between this and `getPosition`, and it is why both exist.
 */
export function getCustodialPosition(
  marketId: string,
  signal?: AbortSignal,
): Promise<CustodialPositionResponse> {
  return api<CustodialPositionResponse>(
    `/markets/${encodeURIComponent(marketId)}/custodial-position`,
    { auth: true, ...signalOf(signal) },
  )
}

/**
 * `POST /markets/:id/stake-intent` — **`foresight/src/server.ts`**.
 *
 * ── The one authenticated call in this bundle, and it moves no money ───────────────────────────
 *
 * It answers with the contract address, the `stake(uint8)` calldata and the policy verdict. The
 * WALLET builds, signs and sends. `server.ts`: "This service could be switched off between
 * this response and the send, and the stake would still work."
 *
 * `amount` is a decimal STRING and the service refuses a JSON number outright
 * (`server.ts`); the shape it must match is mirrored in `units.ts` as `STAKE_AMOUNT`.
 * `outcome` is an integer 0 or 1 (`server.ts`).
 *
 * Three refusals this call can produce, all of which the UI renders as themselves:
 *   409 `not_open` / `closed` — the market is not taking stakes (`server.ts`).
 *   503 `policy_unavailable` — policy could not be reached, and the gate is FAIL CLOSED
 *       (`server.ts`). Not a retry-in-a-loop; a "try shortly".
 *   403 `policy_denied` — refused, with reasons (`server.ts`).
 */
export function createStakeIntent(
  marketId: string,
  body: { readonly amount: string; readonly outcome: 0 | 1 },
  signal?: AbortSignal,
): Promise<StakeIntent> {
  return api<StakeIntent>(`/markets/${encodeURIComponent(marketId)}/stake-intent`, {
    method: 'POST',
    // The only call that sends a bearer token. The service authenticates before it does anything
    // else (`server.ts`), and policy is evaluated against the subject on that token.
    auth: true,
    body: { amount: body.amount, outcome: body.outcome },
    ...signalOf(signal),
  })
}

/**
 * `GET /stake-assets` — what a bettor may bring.
 *
 * **Unauthenticated, and it lists the DISABLED assets too, with the reason.** A user who arrived
 * holding Litecoin is owed "not yet, and here is what is missing" rather than a list that silently
 * omits their coin — the same argument `getCategories` makes about a refusal list behind a token.
 */
export function getStakeAssets(signal?: AbortSignal): Promise<unknown> {
  return api<unknown>('/stake-assets', { auth: false, ...signalOf(signal) })
}

/**
 * `GET /me/stake-balances` — the same registry, with what this reader can actually spend on it.
 *
 * Authenticated, so it is asked only once somebody is signed in. It answers `degraded: true` with
 * every amount null when the ledger is unreachable, rather than a 503: the stake form still works
 * on a typed amount, and taking the whole panel away because a balance could not be read would
 * refuse a path that is not broken.
 */
export function getStakeBalances(signal?: AbortSignal): Promise<unknown> {
  return api<unknown>('/me/stake-balances', { auth: true, ...signalOf(signal) })
}

/**
 * `POST /markets/:id/stake-quote` — price a stake without taking it.
 *
 * The amount is SMALLEST UNITS as a decimal string, never a JSON number and never a display
 * decimal: the asset's decimals are the service's to apply and a client that sent "0.01" would be
 * asking the service to guess whether it meant satoshis or wei. `stakeassets.ts`'s
 * `toSmallestUnits` is what turns what the reader typed into this.
 *
 * The answer is not durable. A held quote would be a free option written by the platform — the
 * reader waits for the rate to move their way and then spends it — so the rate that binds is the
 * one read when the stake is taken, and it is the one written on the row.
 */
export function requestStakeQuote(
  marketId: string,
  body: { readonly asset: string; readonly amount: string },
  signal?: AbortSignal,
): Promise<unknown> {
  return api<unknown>(`/markets/${encodeURIComponent(marketId)}/stake-quote`, {
    method: 'POST',
    auth: true,
    body: { asset: body.asset, amount: body.amount },
    ...signalOf(signal),
  })
}

/**
 * `POST /markets/:id/stakes` — take a custodial stake.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE CALL IN THIS APP THAT MOVES MONEY, AND IT MOVES IT IN THE LEDGER RATHER THAN ON CHAIN.
 *
 * Every other stake path here hands a transaction to a wallet and steps out. This one cannot: a
 * bettor holding BTC has no EMBER key, and custody does not sign for a user
 * (`custody/src/gates.ts`). So their stake is a ledger entry and their share of the platform's
 * on-chain position is recorded rather than held by them.
 *
 * **The `Idempotency-Key` is required and must be STABLE across retries.** The failure it exists
 * for is a retry after a lost response, which is the one that takes a stranger's money twice, and
 * a key regenerated per attempt provides none of the protection.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
export function createCustodialStake(
  marketId: string,
  body: { readonly asset: string; readonly amount: string; readonly outcome: 0 | 1 },
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<unknown> {
  return api<unknown>(`/markets/${encodeURIComponent(marketId)}/stakes`, {
    method: 'POST',
    auth: true,
    idempotencyKey,
    body: { asset: body.asset, amount: body.amount, outcome: body.outcome },
    ...signalOf(signal),
  })
}

/**
 * `GET /categories` — **`foresight/src/server.ts`**.
 *
 * What the platform will run a market on and what it refuses, with the version of the list.
 * `server.ts` says why it is unauthenticated: "A refusal list behind a token is a refusal
 * list nobody can hold the platform to." So it is published, on a page anybody can open.
 */
export function getCategories(signal?: AbortSignal): Promise<CategoryCatalogue> {
  return api<CategoryCatalogue>('/categories', { auth: false, ...signalOf(signal) })
}

/**
 * `PUT /markets/:id/image` — **`foresight/src/server.ts`, the header-image section of
 * `buildRoutes()`.**
 *
 * ── Both halves, always ────────────────────────────────────────────────────────────────────────
 *
 * The body is the whole reference studio answered with. Sending only `assetId` is the mistake the
 * service refuses with `bad_checksum` and the schema refuses with `markets_image_is_whole`
 * (`foresight/src/migrations.ts`, version 11) — half a reference is a claim nothing backs.
 * `ImageRef` has no shape for half of one, which is why the reference is passed as one value
 * rather than as two arguments.
 *
 * ── Operator-only, because a market here has no other owner ────────────────────────────────────
 *
 * Every mutating market route in that service is `requireAdmin`: markets are created by operators
 * and approved by an `operator:<id>` subject. A signed-in reader who is not an operator gets 403,
 * which is what "you cannot change somebody else's image" means in a service with no per-market
 * owner column. Nothing in this app should offer the control to anybody else.
 */
export function setMarketImage(id: string, image: ImageRef, signal?: AbortSignal): Promise<{ market: MarketView }> {
  return api<{ market: MarketView }>(`/markets/${encodeURIComponent(id)}/image`, {
    method: 'PUT',
    auth: true,
    body: { assetId: image.assetId, checksum: image.checksum },
    ...signalOf(signal),
  })
}

/**
 * `DELETE /markets/:id/image` — remove the header image.
 *
 * Available in every status, `settled` included, and that is the service's decision rather than an
 * oversight: a settled market's page is permanent and public, so an image on it that turns out to
 * be unlawful must be removable. Nothing about the payout can move — the image is in no hash.
 */
export function clearMarketImage(id: string, signal?: AbortSignal): Promise<{ market: MarketView }> {
  return api<{ market: MarketView }>(`/markets/${encodeURIComponent(id)}/image`, {
    method: 'DELETE',
    auth: true,
    ...signalOf(signal),
  })
}

/**
 * Spread an optional `signal` without producing an explicit `undefined`.
 *
 * `exactOptionalPropertyTypes` makes `{ signal: undefined }` a different type from `{}`, and the
 * first one is not assignable to an optional field. This is the whole reason for the helper.
 */
function signalOf(signal: AbortSignal | undefined): Pick<RequestOptions, 'signal'> {
  return signal ? { signal } : {}
}
