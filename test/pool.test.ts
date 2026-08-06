/**
 * The parimutuel arithmetic, against the contract it reproduces.
 *
 * The strong test here is CONSERVATION: for any pool and any set of winning stakes, the fee plus
 * every payout plus the residue equals the pool exactly, and the residue is strictly less than the
 * number of winners. That is the property `micro-foresight` proves against the executed committed
 * bytecode (docs/ecosystem/18-build-status.md), and it is the one a floating-point client
 * silently breaks — a `Number` version of these three lines passes a spot check and fails this.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { OUTCOME_NO, OUTCOME_YES } from '../src/lib/abi.ts'
import {
  BPS,
  distributable,
  feeAmount,
  oddsBps,
  poolsFrom,
  projectedMultipleBps,
  projectedPayout,
  projectedPayoutForNewStake,
  residue,
  sideOf,
  totalOf,
  type Pools,
} from '../src/lib/pool.ts'

const E = 1_000_000_000_000_000_000n

describe('poolsFrom', () => {
  it('reads the mirror’s wei strings into bigints', () => {
    const pools = poolsFrom({ yes: '1000', no: '3000' })
    assert.equal(pools.yes, 1000n)
    assert.equal(pools.no, 3000n)
  })

  it('turns an absent or malformed side into null, never into zero', () => {
    // A zero pool and an unreadable pool look identical in the numbers and mean opposite things.
    assert.equal(poolsFrom({ yes: '10' }).no, null)
    assert.equal(poolsFrom({ yes: '1.5', no: '2' }).yes, null)
    assert.equal(poolsFrom(null).yes, null)
    assert.equal(poolsFrom({ yes: 10 as unknown as string, no: '2' }).yes, null)
  })

  it('reads a genuine zero as zero', () => {
    // `mirror.ts` coalesces an absent SUM to '0' on its own side, so '0' really is empty.
    assert.equal(poolsFrom({ yes: '0', no: '0' }).yes, 0n)
  })
})

describe('totalOf and sideOf', () => {
  it('adds both sides', () => {
    assert.equal(totalOf({ yes: 3n, no: 4n }), 7n)
  })

  it('refuses a half-known total', () => {
    assert.equal(totalOf({ yes: 3n, no: null }), null)
    assert.equal(totalOf({ yes: null, no: 4n }), null)
  })

  it('picks the side by outcome, with 0 meaning YES', () => {
    const pools: Pools = { yes: 1n, no: 2n }
    assert.equal(sideOf(pools, OUTCOME_YES), 1n)
    assert.equal(sideOf(pools, OUTCOME_NO), 2n)
  })
})

describe('oddsBps — the pool ratio, and nothing else', () => {
  it('is the side over the total, in basis points', () => {
    // 3 : 1 → 7,500 bps on YES.
    assert.equal(oddsBps({ yes: 3n * E, no: 1n * E }, OUTCOME_YES), 7_500)
    assert.equal(oddsBps({ yes: 3n * E, no: 1n * E }, OUTCOME_NO), 2_500)
  })

  it('matches the contract’s expression exactly, including its flooring', () => {
    // `ForesightMarket.sol` — (pool[outcome] * BPS) / total, integer division.
    const pools = { yes: 1n, no: 2n }
    assert.equal(oddsBps(pools, OUTCOME_YES), Number((1n * BPS) / 3n))
    assert.equal(oddsBps(pools, OUTCOME_YES), 3_333)
  })

  it('is exact for pools far past 2^53', () => {
    const huge = 123_456_789n * E
    assert.equal(oddsBps({ yes: huge, no: huge }, OUTCOME_YES), 5_000)
  })

  it('is null — not zero — for an empty pool', () => {
    // The contract returns 0 because Solidity has no null. A UI that printed "0.0% chance" for a
    // market nobody has staked on would be asserting a consensus that does not exist.
    assert.equal(oddsBps({ yes: 0n, no: 0n }, OUTCOME_YES), null)
  })

  it('is null when a side could not be read', () => {
    assert.equal(oddsBps({ yes: 1n, no: null }, OUTCOME_YES), null)
  })
})

describe('feeAmount — off the LOSING pool only', () => {
  it('charges the losing side, never the winner’s principal', () => {
    // 100 on YES wins, 100 on NO loses, 500 bps. The fee is 5 — 5% of the LOSER.
    const pools = { yes: 100n, no: 100n }
    assert.equal(feeAmount(pools, OUTCOME_YES, 500), 5n)
    assert.equal(feeAmount(pools, OUTCOME_NO, 500), 5n)
  })

  it('means a winner always gets back at least their stake', () => {
    // The property `ForesightMarket.sol` exists to guarantee. A 99% favourite:
    const pools = { yes: 99n * E, no: 1n * E }
    const payout = projectedPayout({
      pools,
      stakedYes: 99n * E,
      stakedNo: 0n,
      winner: OUTCOME_YES,
      feeBps: 1_000, // the ceiling, MAX_FEE_BPS
    })
    assert.ok(payout !== null && payout >= 99n * E, 'a winner received less than they staked')
  })

  it('is zero on a void, always — refunds are whole', () => {
    assert.equal(feeAmount({ yes: 5n, no: 5n }, null, 1_000), 0n)
  })

  it('is null for an unreadable losing side or an impossible rate', () => {
    assert.equal(feeAmount({ yes: 1n, no: null }, OUTCOME_YES, 500), null)
    assert.equal(feeAmount({ yes: 1n, no: 1n }, OUTCOME_YES, 10_001), null)
    assert.equal(feeAmount({ yes: 1n, no: 1n }, OUTCOME_YES, -1), null)
    assert.equal(feeAmount({ yes: 1n, no: 1n }, OUTCOME_YES, 1.5), null)
  })
})

describe('distributable', () => {
  it('is everything staked, less the fee', () => {
    assert.equal(distributable({ yes: 100n, no: 100n }, OUTCOME_YES, 500), 195n)
  })

  it('is the whole pool on a void', () => {
    assert.equal(distributable({ yes: 100n, no: 100n }, null, 500), 200n)
  })
})

describe('projectedPayout', () => {
  it('is stake × distributable ÷ winning pool, floored', () => {
    // sol:409. 60 on YES of a 100 YES pool, 100 on NO, 0 fee → 60 * 200 / 100 = 120.
    assert.equal(
      projectedPayout({
        pools: { yes: 100n, no: 100n },
        stakedYes: 60n,
        stakedNo: 0n,
        winner: OUTCOME_YES,
        feeBps: 0,
      }),
      120n,
    )
  })

  it('multiplies BEFORE it divides', () => {
    // The order in sol:409. `backed * (distributable / winningPool)` would floor twice: with
    // backed=1, distributable=5, winningPool=3 that gives 1 * 1 = 1 rather than 5 / 3 = 1... so
    // pick a case where they visibly differ: backed=2, dist=5, pool=3 → 10/3 = 3, not 2*(5/3)=2.
    assert.equal(
      projectedPayout({
        pools: { yes: 3n, no: 2n },
        stakedYes: 2n,
        stakedNo: 0n,
        winner: OUTCOME_YES,
        feeBps: 0,
      }),
      3n,
    )
  })

  it('refunds everything, on both sides, for a void', () => {
    // sol:402-404. A staker who hedged gets both back.
    assert.equal(
      projectedPayout({
        pools: { yes: 10n, no: 10n },
        stakedYes: 3n,
        stakedNo: 4n,
        winner: null,
        feeBps: 1_000,
      }),
      7n,
    )
  })

  it('is zero — a real answer — for somebody who backed the losing side', () => {
    assert.equal(
      projectedPayout({
        pools: { yes: 10n, no: 10n },
        stakedYes: 0n,
        stakedNo: 5n,
        winner: OUTCOME_YES,
        feeBps: 0,
      }),
      0n,
    )
  })

  it('is null when the winning pool is empty, rather than dividing by zero', () => {
    assert.equal(
      projectedPayout({
        pools: { yes: 0n, no: 10n },
        stakedYes: 1n,
        stakedNo: 0n,
        winner: OUTCOME_YES,
        feeBps: 0,
      }),
      null,
    )
  })

  it('is null whenever an input is unknown', () => {
    assert.equal(
      projectedPayout({
        pools: { yes: null, no: 10n },
        stakedYes: 1n,
        stakedNo: 0n,
        winner: OUTCOME_YES,
        feeBps: 0,
      }),
      null,
    )
    assert.equal(
      projectedPayout({
        pools: { yes: 10n, no: 10n },
        stakedYes: null,
        stakedNo: 0n,
        winner: OUTCOME_YES,
        feeBps: 0,
      }),
      null,
    )
    // Void needs BOTH sides of the staker's own position.
    assert.equal(
      projectedPayout({ pools: { yes: 1n, no: 1n }, stakedYes: 1n, stakedNo: null, winner: null, feeBps: 0 }),
      null,
    )
  })
})

describe('projectedPayoutForNewStake — the figure the stake form shows', () => {
  it('adds the stake to the pool it would be paid from', () => {
    // 100 on each side, staking 100 more on YES. The YES pool becomes 200 of a 300 total, so the
    // new stake is half of the YES pool and takes half of 300 = 150.
    assert.equal(
      projectedPayoutForNewStake({
        pools: { yes: 100n, no: 100n },
        amount: 100n,
        outcome: OUTCOME_YES,
        feeBps: 0,
      }),
      150n,
    )
  })

  it('does NOT use the pre-stake ratio, which would overstate every projection', () => {
    // The naive figure — amount * total / side — is 100 * 200 / 100 = 200. The honest one is 150.
    const naive = (100n * 200n) / 100n
    const honest = projectedPayoutForNewStake({
      pools: { yes: 100n, no: 100n },
      amount: 100n,
      outcome: OUTCOME_YES,
      feeBps: 0,
    })
    assert.equal(naive, 200n)
    assert.equal(honest, 150n)
    assert.ok(honest !== null && honest < naive, 'the projection did not account for its own dilution')
  })

  it('overstates most where it matters most: a large stake into a thin pool', () => {
    const honest = projectedPayoutForNewStake({
      pools: { yes: 1n * E, no: 1_000n * E },
      amount: 1_000n * E,
      outcome: OUTCOME_YES,
      feeBps: 0,
    })
    const naive = (1_000n * E * (1_001n * E)) / (1n * E)
    assert.ok(honest !== null && honest * 400n < naive, 'the naive figure was not wildly larger')
  })

  it('leaves the losing pool — and therefore the fee — untouched', () => {
    // Staking on YES cannot change what the NO pool owes in fee.
    const withFee = projectedPayoutForNewStake({
      pools: { yes: 100n, no: 100n },
      amount: 100n,
      outcome: OUTCOME_YES,
      feeBps: 1_000,
    })
    // fee = 10% of the 100 NO pool = 10; distributable = 290; 100/200 of it = 145.
    assert.equal(withFee, 145n)
  })

  it('is null for a nil or negative amount, and for an unreadable pool', () => {
    assert.equal(
      projectedPayoutForNewStake({ pools: { yes: 1n, no: 1n }, amount: 0n, outcome: OUTCOME_YES, feeBps: 0 }),
      null,
    )
    assert.equal(
      projectedPayoutForNewStake({ pools: { yes: null, no: 1n }, amount: 1n, outcome: OUTCOME_YES, feeBps: 0 }),
      null,
    )
  })

  it('lets the first staker in an empty market see a projection', () => {
    // Nothing staked at all: the whole pool would be theirs, so the projection is their stake.
    assert.equal(
      projectedPayoutForNewStake({ pools: { yes: 0n, no: 0n }, amount: 7n, outcome: OUTCOME_YES, feeBps: 500 }),
      7n,
    )
  })
})

describe('projectedMultipleBps', () => {
  it('expresses the projection as a multiple of the stake', () => {
    assert.equal(projectedMultipleBps(150n, 100n), 15_000)
  })

  it('is null for a missing projection or a nil stake', () => {
    assert.equal(projectedMultipleBps(null, 100n), null)
    assert.equal(projectedMultipleBps(150n, 0n), null)
  })
})

describe('conservation — the property the whole product rests on', () => {
  /** Sum every winner's payout for a given pool and set of winning stakes. */
  function payouts(pools: Pools, stakes: readonly bigint[], winner: 0 | 1, feeBps: number): bigint[] {
    return stakes.map((staked) => {
      const value = projectedPayout({
        pools,
        stakedYes: winner === OUTCOME_YES ? staked : 0n,
        stakedNo: winner === OUTCOME_NO ? staked : 0n,
        winner,
        feeBps,
      })
      assert.ok(value !== null)
      return value
    })
  }

  const cases: ReadonlyArray<{ stakes: bigint[]; losing: bigint; feeBps: number }> = [
    { stakes: [1n, 1n, 1n], losing: 1n, feeBps: 0 },
    { stakes: [1n, 2n, 3n, 5n, 8n, 13n], losing: 7n, feeBps: 250 },
    { stakes: [E, 3n * E, 7n * E], losing: 11n * E, feeBps: 1_000 },
    { stakes: [1n], losing: 999_999_999n, feeBps: 999 },
    { stakes: [7n, 7n, 7n, 7n, 7n, 7n, 7n], losing: 100n, feeBps: 33 },
    { stakes: [123_456_789_012_345_678_901n, 2n], losing: 3n, feeBps: 500 },
  ]

  for (const [index, testCase] of cases.entries()) {
    it(`case ${index}: fee + payouts + residue == the pool, exactly`, () => {
      const winning = testCase.stakes.reduce((a, b) => a + b, 0n)
      const pools: Pools = { yes: winning, no: testCase.losing }
      const total = winning + testCase.losing

      const fee = feeAmount(pools, OUTCOME_YES, testCase.feeBps)
      assert.ok(fee !== null)
      const paid = payouts(pools, testCase.stakes, OUTCOME_YES, testCase.feeBps).reduce((a, b) => a + b, 0n)
      const left = residue({ pools, stakes: testCase.stakes, winner: OUTCOME_YES, feeBps: testCase.feeBps })
      assert.ok(left !== null)

      assert.equal(fee + paid + left, total, 'the arithmetic lost or invented wei')
    })

    it(`case ${index}: the residue is strictly less than the number of winners`, () => {
      const winning = testCase.stakes.reduce((a, b) => a + b, 0n)
      const pools: Pools = { yes: winning, no: testCase.losing }
      const left = residue({ pools, stakes: testCase.stakes, winner: OUTCOME_YES, feeBps: testCase.feeBps })
      assert.ok(left !== null)
      assert.ok(left >= 0n, 'the residue went negative — somebody was overpaid')
      // Floor division loses at most one wei per winner. Any more is a bug in the order of
      // operations, and it is the exact bug a float version produces.
      assert.ok(
        left < BigInt(testCase.stakes.length),
        `residue ${left} is not below ${testCase.stakes.length} winners`,
      )
    })
  }

  it('a void returns every wei to its staker, with no fee and no residue', () => {
    const stakes = [3n, 5n, 7n]
    const total = stakes.reduce((a, b) => a + b, 0n)
    const pools: Pools = { yes: total, no: 0n }
    const refunded = stakes
      .map((staked) => projectedPayout({ pools, stakedYes: staked, stakedNo: 0n, winner: null, feeBps: 1_000 }))
      .reduce((a, b) => (a ?? 0n) + (b ?? 0n), 0n)
    assert.equal(refunded, total)
    assert.equal(feeAmount(pools, null, 1_000), 0n)
  })

  it('a float implementation would fail this, which is why there is not one', () => {
    // Demonstrating the failure mode rather than asserting a truism: these two stakes differ by a
    // single wei, and Number cannot represent either.
    const a = 10_000_000_000_000_000_001n
    const b = 10_000_000_000_000_000_002n
    assert.equal(Number(a), Number(b), 'the doubles collapsed, as expected')
    const pools: Pools = { yes: a + b, no: 0n }
    const payoutA = projectedPayout({ pools, stakedYes: a, stakedNo: 0n, winner: OUTCOME_YES, feeBps: 0 })
    const payoutB = projectedPayout({ pools, stakedYes: b, stakedNo: 0n, winner: OUTCOME_YES, feeBps: 0 })
    assert.notEqual(payoutA, payoutB, 'bigint arithmetic collapsed two different stakes')
  })
})
