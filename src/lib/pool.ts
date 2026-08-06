/**
 * Parimutuel arithmetic, in bigint, matching the contract line for line.
 *
 * ── The one thing this file must never do ──────────────────────────────────────────────────────
 *
 * **Present odds as a return.** In a parimutuel market there is no price and no counterparty: the
 * pool is divided among the winners *at settlement*, so a payout computed now is a payout under
 * the pool as it stands now, and the pool moves every time anybody stakes — including when you
 * do. `ForesightMarket.sol` says it about `oddsBps`:
 *
 *   > Not a price and not a probability the platform is asserting — it is arithmetic on two
 *   > numbers anybody can read off the chain, which is exactly what parimutuel odds are.
 *
 * Every function below that produces a payout is named `projected…` and returns a value the UI is
 * obliged to render with the pool that produced it and the sentence that the final pool decides.
 *
 * ── Why it is duplicated from Solidity rather than read from the service ───────────────────────
 *
 * `poolOf` (`foresight/src/mirror.ts`) already returns `yesBps`/`noBps`, and this app shows
 * them. But the *payout* projection has no route at all, and computing it in floating point — the
 * obvious client-side shortcut — would disagree with the contract in the last few wei of every
 * figure, which is precisely the region where "did I get paid what the page said" gets asked. So
 * the three operations that decide money are reproduced here in the same order, with the same
 * integer division, against the same lines:
 *
 *   fee          = losingPool * feeBps / 10_000            ForesightMarket.sol
 *   distributable = total - fee                            ForesightMarket.sol
 *   payout       = backed * distributable / winningPool    ForesightMarket.sol
 *
 * ORDER IS LOAD-BEARING. `backed * distributable / winningPool` is not
 * `backed * (distributable / winningPool)`: the second floors twice and loses up to one wei per
 * staker per operation. `test/pool.test.ts` proves the sum of every payout plus the fee plus the
 * residue equals the pool exactly, which is the property the service proves against the executed
 * bytecode (docs/ecosystem/18-build-status.md).
 *
 * ── The fee comes off the LOSING pool ──────────────────────────────────────────────────────────
 *
 * Not off the top. `ForesightMarket.sol` explains why, and the consequence is a promise
 * this UI is allowed to make: **a winner always gets back at least what they staked**, because
 * the fee is charged against other people's losses and never against their principal. Getting
 * this wrong in the client would show a favourite's backer a projected payout below their stake,
 * which reads as a bug to every one of them and is one.
 */
import { OUTCOME_NO, OUTCOME_YES } from './abi.ts'
import { fromWeiString } from './units.ts'

/** `uint16 internal constant BPS = 10_000` — `ForesightMarket.sol`. */
export const BPS = 10_000n

export type Outcome = 0 | 1

/**
 * The two pools, in wei, however they were obtained.
 *
 * Both fields are nullable because both sources can fail to answer: the mirror can be down and an
 * `eth_call` can return `0x`. A pool with one side missing is not a pool with one side empty, and
 * the odds of it are `null` rather than 100%.
 */
export interface Pools {
  readonly yes: bigint | null
  readonly no: bigint | null
}

/** Read the mirror's `pool` object into bigints. Absent or malformed fields become `null`. */
export function poolsFrom(view: { yes?: unknown; no?: unknown } | null | undefined): Pools {
  return {
    yes: fromWeiString(typeof view?.yes === 'string' ? view.yes : null),
    no: fromWeiString(typeof view?.no === 'string' ? view.no : null),
  }
}

/** Everything staked. `null` if either side is unknown — a half-known total is not a total. */
export function totalOf(pools: Pools): bigint | null {
  if (pools.yes === null || pools.no === null) return null
  return pools.yes + pools.no
}

/** One side of the pool, or `null` when that side is unknown. */
export function sideOf(pools: Pools, outcome: Outcome): bigint | null {
  return outcome === OUTCOME_YES ? pools.yes : pools.no
}

/**
 * The pool ratio in basis points — the odds, and the whole of them.
 *
 * `Number((side * 10_000n) / total)` is exact for any pool: the division happens in bigint and
 * the result is at most 10,000, so the narrowing to a JS number cannot lose a digit. This is the
 * same expression as `foresight/src/mirror.ts` and `ForesightMarket.sol`.
 *
 * `null` when nothing is staked, matching the mirror rather than the contract. The contract
 * returns 0 because Solidity has no null; a UI that rendered "0.0% chance" for a market nobody
 * has staked on yet would be asserting a consensus that does not exist.
 */
export function oddsBps(pools: Pools, outcome: Outcome): number | null {
  const total = totalOf(pools)
  const side = sideOf(pools, outcome)
  if (total === null || side === null || total === 0n) return null
  return Number((side * BPS) / total)
}

/**
 * The settlement fee, off the losing pool only — `ForesightMarket.sol`.
 *
 * Zero on a void, always: "refunds are whole", 19-new-products.md §2.5. Callers pass
 * `winner: null` for a void.
 */
export function feeAmount(pools: Pools, winner: Outcome | null, feeBps: number): bigint | null {
  if (winner === null) return 0n
  const losing = sideOf(pools, winner === OUTCOME_YES ? OUTCOME_NO : OUTCOME_YES)
  if (losing === null) return null
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) return null
  return (losing * BigInt(feeBps)) / BPS
}

/** The pot the winners divide: everything staked, less the fee — `ForesightMarket.sol`. */
export function distributable(pools: Pools, winner: Outcome | null, feeBps: number): bigint | null {
  const total = totalOf(pools)
  const fee = feeAmount(pools, winner, feeBps)
  if (total === null || fee === null) return null
  return total - fee
}

/**
 * What a staker is owed if the market settles on `winner` with exactly these pools.
 *
 * On a void (`winner === null`) it is everything they put in, on both sides, exactly —
 * `ForesightMarket.sol`.
 *
 * `null` — not `0n` — whenever an input is unknown. A zero here is a sentence ("you are owed
 * nothing") and it must only be said when it is true.
 */
export function projectedPayout(opts: {
  readonly pools: Pools
  readonly stakedYes: bigint | null
  readonly stakedNo: bigint | null
  readonly winner: Outcome | null
  readonly feeBps: number
}): bigint | null {
  const { pools, stakedYes, stakedNo, winner, feeBps } = opts

  if (winner === null) {
    if (stakedYes === null || stakedNo === null) return null
    return stakedYes + stakedNo
  }

  const backed = winner === OUTCOME_YES ? stakedYes : stakedNo
  const winningPool = sideOf(pools, winner)
  const pot = distributable(pools, winner, feeBps)
  if (backed === null || winningPool === null || pot === null) return null
  if (backed === 0n) return 0n
  // `oracleAct` voids rather than resolves a market with an empty winning pool
  // (`ForesightMarket.sol`), so on chain this division is never by zero. Here it can be,
  // because the caller may be projecting an outcome nobody has backed — and the honest answer to
  // "what would I get if I had staked on a side nobody staked on" is not a number.
  if (winningPool === 0n) return null
  return (backed * pot) / winningPool
}

/**
 * What a NEW stake would be worth if its side won and nothing else were ever staked.
 *
 * This is the figure a stake form must show, and it is not `amount * total / side`: the stake
 * joins the pool it is paid out of, so the correct projection adds it to both the winning side
 * and the total before dividing. Showing the pre-stake ratio instead overstates every projection,
 * and overstates a large stake into a thin pool enormously — which is exactly the case where a
 * user is relying on the number.
 *
 * The losing pool is unchanged by a stake on the winning side, so the fee is unchanged too.
 *
 * It is still a projection, and the caller must say so: anybody may stake after you, and the
 * final pool is the one that pays.
 */
export function projectedPayoutForNewStake(opts: {
  readonly pools: Pools
  readonly amount: bigint
  readonly outcome: Outcome
  readonly feeBps: number
}): bigint | null {
  const { pools, amount, outcome, feeBps } = opts
  if (amount <= 0n) return null
  const side = sideOf(pools, outcome)
  const total = totalOf(pools)
  if (side === null || total === null) return null

  const after: Pools =
    outcome === OUTCOME_YES
      ? { yes: (pools.yes ?? 0n) + amount, no: pools.no }
      : { yes: pools.yes, no: (pools.no ?? 0n) + amount }

  return projectedPayout({
    pools: after,
    stakedYes: outcome === OUTCOME_YES ? amount : 0n,
    stakedNo: outcome === OUTCOME_NO ? amount : 0n,
    winner: outcome,
    feeBps,
  })
}

/**
 * The projection as a multiple of the stake, in basis points. 2.5× is `25_000`.
 *
 * Integer arithmetic, and it is deliberately NOT called "odds" or "return": it is what this stake
 * would come back as under this pool, and the word the UI puts beside it says exactly that.
 */
export function projectedMultipleBps(payout: bigint | null, stake: bigint): number | null {
  if (payout === null || stake <= 0n) return null
  return Number((payout * BPS) / stake)
}

/**
 * The residue: what the contract would still hold once every winner had claimed.
 *
 * Floor division leaves at most one wei per winner behind (`ForesightMarket.sol`), and
 * `sweepDust` is the only thing that may ever move it. It exists here so `test/pool.test.ts` can
 * assert the conservation property — fee + every payout + residue == the pool, exactly, and the
 * residue strictly below the number of winners — which is the arithmetic claim the whole product
 * rests on.
 *
 * Resolved markets only. A void has no residue by construction: every staker is refunded their
 * own stake with no division and no fee, so the sum is the pool and nothing is left over.
 */
export function residue(opts: {
  readonly pools: Pools
  /** Every stake on the WINNING side, one per staker. */
  readonly stakes: readonly bigint[]
  readonly winner: Outcome
  readonly feeBps: number
}): bigint | null {
  const { pools, stakes, winner, feeBps } = opts
  const total = totalOf(pools)
  const fee = feeAmount(pools, winner, feeBps)
  if (total === null || fee === null) return null

  let paid = 0n
  for (const staked of stakes) {
    const payout = projectedPayout({
      pools,
      stakedYes: winner === OUTCOME_YES ? staked : 0n,
      stakedNo: winner === OUTCOME_NO ? staked : 0n,
      winner,
      feeBps,
    })
    if (payout === null) return null
    paid += payout
  }
  return total - fee - paid
}
