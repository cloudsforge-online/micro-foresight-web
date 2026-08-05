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
 * Both were found by a human reading the other side's routes. So: `foresight/src/server.ts` line
 * 353 to line 800 is the complete route table, `buildRoutes()` is the only place a route is
 * declared, and every path below carries the line it appears on. **There is no `/v1` prefix on
 * anything in this service.** `test/foresight.test.ts` asserts the REQUEST — path, method, query
 * and body — for every call in this file, because a test that stubs fetch and asserts the
 * response is a test that passes against a path that does not exist.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { api, type RequestOptions } from './api.ts'

/* ------------------------------------------------------------------ what the service sends */

/**
 * `MarketStatus` — `foresight/src/markets.ts:39`.
 *
 * All seven, including the three a public reader will rarely see: a market is `draft` until an
 * operator approves it and `approved` until it is deployed, and both are listable.
 */
export type MarketStatus = 'draft' | 'approved' | 'open' | 'closed' | 'resolved' | 'settled' | 'void'

/** Every status `?status=` accepts — `foresight/src/server.ts:846-850`. */
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
 * One market, exactly as `publicView` emits it — `foresight/src/markets.ts:614-639`.
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
  readonly openedAt: string | null
  readonly closedAt: string | null
  readonly resolvedAt: string | null
  readonly settledAt: string | null
  readonly voidedAt: string | null
}

/** `PoolView` — `foresight/src/mirror.ts:249-268`. Wei are strings; a JSON number cannot hold 1e18. */
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
   * `mirror.ts:259-262`: "Shown, always. A pool with no `asOf` is a pool a reader will assume is
   * live." Every figure derived from this object is rendered beside it.
   */
  readonly asOf: string | null
  readonly lastBlock: number | null
  readonly tipBlock: number | null
  readonly behindBlocks: number | null
  /** True once the mirror is a confirmation depth behind, OR has never run — `mirror.ts:311-313`. */
  readonly stale: boolean
}

/** One source the idea pipeline found — `foresight/src/ideas.ts:34-39`. */
export interface IdeaSource {
  readonly url: string
  readonly title: string
  /** When the pipeline retrieved it. "A source that has since changed is still evidence." */
  readonly retrievedAt: string
}

/**
 * Why this market exists — `foresight/src/server.ts:437-448`.
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
 * The house seed disclosure — `houseSeedView`, `foresight/src/houseseed.ts:230-243`, served on
 * the market page at `foresight/src/server.ts:477`.
 *
 * ── This is the field docs/ecosystem/21 §7.6 is about ──────────────────────────────────────────
 *
 * §7.6: "The foresight market page **renders** the house seed disclosure whenever a house stake
 * exists — asserted the way admin-web asserts its missing og card: presence with force." The
 * service already proves it SERVES it (`foresight/src/houseseed.test.ts:429`). Everything below
 * exists so this app proves it SHOWS it, which is a different claim and the one a bettor cares
 * about: an undisclosed house position makes the other four properties (symmetric, at-open-only,
 * trigger-enforced, capped) pointless, because they are all things the reader is being asked to
 * take on trust *because* the position is disclosed.
 *
 * `disclosure` is composed by the service, once, deliberately — houseseed.ts:213-218: "so
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

/** The body of `GET /markets/:id` — `foresight/src/server.ts:426-450`. */
export interface MarketDetail {
  readonly market: MarketView
  readonly pool: PoolView
  /**
   * `null` when no house seed exists for this market, and the service sends the explicit null
   * rather than omitting the key (`foresight/src/houseseed.test.ts:447-450`) — so "no seed" is
   * distinguishable from "field missing because the deploy is old". Both render as no
   * disclosure; only one of them would be a bug worth finding.
   */
  readonly houseSeed: HouseSeedView | null
  readonly document: { readonly canonical: string; readonly hash: string }
  readonly provenance: Provenance | null
}

/** The body of `GET /markets/:id/positions/:address` — `foresight/src/server.ts:459-472`. */
export interface PositionResponse {
  readonly marketId: string
  readonly address: string
  /** Wei staked on each side, as strings — `foresight/src/mirror.ts:320-334`. */
  readonly position: { readonly yes: string; readonly no: string }
  /** Repeated out of `pool` deliberately; see the comment at `server.ts:466-467`. */
  readonly asOf: string | null
  readonly stale: boolean
  readonly contractAddress: string | null
}

/** The body of `POST /markets/:id/stake-intent` — `foresight/src/server.ts:524-543`. */
export interface StakeIntent {
  readonly marketId: string
  readonly chain: string
  readonly network: string
  /** The contract. The wallet sends here; not one wei passes through the service. */
  readonly to: string
  /** `stake(uint8)` calldata, built by the service — `server.ts:533`. */
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

/** `CategorySpec` — `foresight/src/categories.ts:36-49`. */
export interface CategorySpec {
  readonly id: string
  readonly title: string
  readonly description: string
  /**
   * The kinds of source that can settle a question here, in order of preference.
   *
   * Not decoration: a market's `resolutionSourceKind` must be one of these and it is checked.
   * `categories.ts:41-47` — "A category whose questions cannot be settled from a source the
   * operator would cite in public is a category this platform does not run."
   */
  readonly sourceKinds: readonly string[]
}

/**
 * The body of `GET /categories` — `foresight/src/server.ts:391-399`.
 *
 * `refusals` carries an `id` and a `reason` and no title — `categories.ts:114`.
 */
export interface CategoryCatalogue {
  readonly version: number
  readonly categories: readonly CategorySpec[]
  readonly refusals: readonly { readonly id: string; readonly reason: string }[]
}

/* ------------------------------------------------------------------ the calls */

/**
 * `GET /markets` — **`foresight/src/server.ts:402`**.
 *
 * `status` is optional and validated against the seven names at `server.ts:846-850`; `limit`
 * defaults to 50 server-side and must be a whole number in 1..200 (`server.ts:852-859`). Both are
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
 * `GET /markets/:id` — **`foresight/src/server.ts:417`**.
 *
 * Returns the market, the pool, the canonical document with its hash, the house seed disclosure
 * and the provenance. This is the only route that carries the cited sources or the house seed,
 * and it is unauthenticated.
 */
export function getMarket(id: string, signal?: AbortSignal): Promise<MarketDetail> {
  return api<MarketDetail>(`/markets/${encodeURIComponent(id)}`, { auth: false, ...signalOf(signal) })
}

/**
 * `GET /markets/:id/positions/:address` — **`foresight/src/server.ts:448`**.
 *
 * Public, and keyed by ADDRESS rather than by session: a position belongs to whoever holds the
 * key, and the mirror is a copy of public chain state. The service checks the address against
 * `EVM_ADDRESS` (`server.ts:451-452`) and answers 400 otherwise.
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
 * `POST /markets/:id/stake-intent` — **`foresight/src/server.ts:483`**.
 *
 * ── The one authenticated call in this bundle, and it moves no money ───────────────────────────
 *
 * It answers with the contract address, the `stake(uint8)` calldata and the policy verdict. The
 * WALLET builds, signs and sends. `server.ts:474-482`: "This service could be switched off between
 * this response and the send, and the stake would still work."
 *
 * `amount` is a decimal STRING and the service refuses a JSON number outright
 * (`server.ts:892-897`); the shape it must match is mirrored in `units.ts` as `STAKE_AMOUNT`.
 * `outcome` is an integer 0 or 1 (`server.ts:489`).
 *
 * Three refusals this call can produce, all of which the UI renders as themselves:
 *   409 `not_open` / `closed` — the market is not taking stakes (`server.ts:498-508`).
 *   503 `policy_unavailable` — policy could not be reached, and the gate is FAIL CLOSED
 *       (`server.ts:517-525`). Not a retry-in-a-loop; a "try shortly".
 *   403 `policy_denied` — refused, with reasons (`server.ts:526-528`).
 */
export function createStakeIntent(
  marketId: string,
  body: { readonly amount: string; readonly outcome: 0 | 1 },
  signal?: AbortSignal,
): Promise<StakeIntent> {
  return api<StakeIntent>(`/markets/${encodeURIComponent(marketId)}/stake-intent`, {
    method: 'POST',
    // The only call that sends a bearer token. The service authenticates before it does anything
    // else (`server.ts:484`), and policy is evaluated against the subject on that token.
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
 * (`custody/src/gates.ts:65`). So their stake is a ledger entry and their share of the platform's
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
 * `GET /categories` — **`foresight/src/server.ts:391`**.
 *
 * What the platform will run a market on and what it refuses, with the version of the list.
 * `server.ts:386-390` says why it is unauthenticated: "A refusal list behind a token is a refusal
 * list nobody can hold the platform to." So it is published, on a page anybody can open.
 */
export function getCategories(signal?: AbortSignal): Promise<CategoryCatalogue> {
  return api<CategoryCatalogue>('/categories', { auth: false, ...signalOf(signal) })
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
