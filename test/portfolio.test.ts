/**
 * Degradation, ordering and concurrency in the N+1 the service's route table forces.
 *
 * `hub-web` has seven tests for the same shape and they exist because the failure is invisible: a
 * page that renders ninety-nine of a hundred rows looks like a page with ninety-nine rows.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MarketView, PositionResponse } from '../src/lib/foresight.ts'
import {
  POSITION_CONCURRENCY,
  failedRow,
  hasStake,
  loadPositions,
  missingSentence,
  rowFrom,
  summarise,
  type PositionRow,
} from '../src/lib/portfolio.ts'

function market(id: string): MarketView {
  return {
    id,
    status: 'open',
    question: `Q ${id}`,
    resolutionCriteria: 'c',
    category: 'protocol_network',
    categoryVersion: 1,
    resolutionSourceKind: 'chain_rpc',
    resolutionSourceRef: 'ref',
    questionHash: '0x00',
    closeTime: '2026-09-01T00:00:00.000Z',
    disputeWindowSeconds: 86_400,
    feeBps: 500,
    chain: 'hearth',
    network: 'testnet',
    contractAddress: '0x00112233445566778899aabbccddeeff00112233',
    outcome: null,
    voidReason: null,
    openedAt: null,
    closedAt: null,
    resolvedAt: null,
    settledAt: null,
    voidedAt: null,
    // No image by default. `image.test.ts` overrides it; every other suite proves the page is
    // unchanged without one, which is the state most markets are in.
    image: null,
  }
}

function response(over: Partial<PositionResponse> = {}): PositionResponse {
  return {
    marketId: 'm',
    address: '0xabc',
    position: { yes: '5', no: '0' },
    asOf: '2026-08-01T12:00:00.000Z',
    stale: false,
    contractAddress: '0x00112233445566778899aabbccddeeff00112233',
    ...over,
  }
}

describe('rowFrom', () => {
  it('reads the wei strings into bigints', () => {
    const row = rowFrom(market('a'), response({ position: { yes: '5', no: '7' } }))
    assert.equal(row.stakedYes, 5n)
    assert.equal(row.stakedNo, 7n)
    assert.equal(row.error, null)
  })

  it('carries this row’s OWN asOf, not the page’s', () => {
    const row = rowFrom(market('a'), response({ asOf: '2026-08-01T09:00:00.000Z' }))
    assert.equal(row.asOf, '2026-08-01T09:00:00.000Z')
  })

  it('turns an unreadable amount into null, never into zero', () => {
    const row = rowFrom(market('a'), response({ position: { yes: 'x', no: '1' } }))
    assert.equal(row.stakedYes, null)
    assert.equal(row.stakedNo, 1n)
  })
})

describe('failedRow', () => {
  it('renders the market with no figures at all', () => {
    const row = failedRow(market('a'), 'it did not answer')
    assert.equal(row.stakedYes, null)
    assert.equal(row.stakedNo, null)
    assert.equal(row.asOf, null)
    assert.equal(row.error, 'it did not answer')
  })
})

describe('hasStake', () => {
  it('is true for a stake on either side', () => {
    assert.equal(hasStake(rowFrom(market('a'), response({ position: { yes: '1', no: '0' } }))), true)
    assert.equal(hasStake(rowFrom(market('a'), response({ position: { yes: '0', no: '1' } }))), true)
  })

  it('is false for a real zero', () => {
    assert.equal(hasStake(rowFrom(market('a'), response({ position: { yes: '0', no: '0' } }))), false)
  })

  it('is false for an unknown row — unknown is not "something"', () => {
    assert.equal(hasStake(failedRow(market('a'), 'x')), false)
  })
})

describe('loadPositions', () => {
  const markets = Array.from({ length: 20 }, (_, i) => market(`m-${i}`))

  it('returns one row per market, in the order the markets were given', async () => {
    // Responses arrive out of order on purpose: a portfolio that reshuffles as it loads is a
    // portfolio nobody can read while it is loading.
    const rows = await loadPositions(
      markets,
      async (m) => {
        const index = Number(m.id.split('-')[1])
        await new Promise((resolve) => setTimeout(resolve, (20 - index) % 7))
        return response({ marketId: m.id })
      },
      () => 'failed',
    )
    assert.equal(rows.length, markets.length)
    assert.deepEqual(
      rows.map((r) => r.market.id),
      markets.map((m) => m.id),
    )
  })

  it('isolates a failure to its own row', async () => {
    const rows = await loadPositions(
      markets,
      async (m) => {
        if (m.id === 'm-3') throw new Error('boom')
        return response({ marketId: m.id })
      },
      (_m, err) => (err instanceof Error ? err.message : 'x'),
    )
    assert.equal(rows.length, 20)
    const failed = rows.filter((r) => r.error !== null)
    assert.equal(failed.length, 1)
    assert.equal(failed[0]?.market.id, 'm-3')
    // And the other nineteen still carry their figures.
    assert.equal(rows.filter((r) => r.stakedYes === 5n).length, 19)
  })

  it('survives every single market failing', async () => {
    const rows = await loadPositions(
      markets,
      async () => {
        throw new Error('everything is down')
      },
      () => 'down',
    )
    assert.equal(rows.length, 20)
    assert.ok(rows.every((r) => r.error === 'down'))
  })

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0
    let peak = 0
    await loadPositions(
      markets,
      async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 1))
        inFlight -= 1
        return response()
      },
      () => 'x',
      4,
    )
    assert.ok(peak <= 4, `peak concurrency was ${peak}`)
    // …and it actually used the lanes rather than running one at a time, which would pass the
    // bound above for the wrong reason.
    assert.ok(peak > 1, 'the loader ran serially')
  })

  it('does not deadlock when there are fewer markets than lanes', async () => {
    const rows = await loadPositions([market('only')], async () => response(), () => 'x', 8)
    assert.equal(rows.length, 1)
  })

  it('returns nothing, and does not hang, for no markets at all', async () => {
    assert.deepEqual(await loadPositions([], async () => response(), () => 'x'), [])
  })

  it('defaults to six lanes', () => {
    assert.equal(POSITION_CONCURRENCY, 6)
  })
})

describe('summarise', () => {
  function rows(): PositionRow[] {
    return [
      rowFrom(market('a'), response({ position: { yes: '5', no: '0' }, asOf: '2026-08-01T12:00:00.000Z' })),
      rowFrom(market('b'), response({ position: { yes: '0', no: '0' }, asOf: '2026-08-01T09:00:00.000Z' })),
      rowFrom(market('c'), response({ position: { yes: '1', no: '0' }, asOf: '2026-08-01T11:00:00.000Z', stale: true })),
      failedRow(market('d'), 'no answer'),
    ]
  }

  it('counts held, empty, failed and stale separately', () => {
    const summary = summarise(rows())
    assert.equal(summary.held, 2)
    assert.equal(summary.empty, 1)
    assert.equal(summary.failed, 1)
    assert.equal(summary.stale, 1)
  })

  it('stamps the page with the OLDEST observation, not the newest', () => {
    // A page stamped with its newest observation claims a currency its oldest row does not have.
    assert.equal(summarise(rows()).oldestAsOf, '2026-08-01T09:00:00.000Z')
  })

  it('has no stamp at all when nothing has been observed', () => {
    const summary = summarise([rowFrom(market('a'), response({ asOf: null }))])
    assert.equal(summary.oldestAsOf, null)
  })

  it('does not let a failed row contribute a stamp it does not have', () => {
    assert.equal(summarise([failedRow(market('a'), 'x')]).oldestAsOf, null)
  })
})

describe('missingSentence', () => {
  it('is null when nothing is missing', () => {
    assert.equal(missingSentence({ held: 1, empty: 0, failed: 0, stale: 0, oldestAsOf: null }), null)
  })

  it('names the number of markets that did not answer', () => {
    const sentence = missingSentence({ held: 1, empty: 0, failed: 3, stale: 0, oldestAsOf: null })
    assert.match(sentence ?? '', /3 markets did not answer/)
  })

  it('says "market" for one and "markets" for several', () => {
    assert.match(missingSentence({ held: 0, empty: 0, failed: 1, stale: 0, oldestAsOf: null }) ?? '', /1 market did not/)
    assert.match(missingSentence({ held: 0, empty: 0, failed: 2, stale: 0, oldestAsOf: null }) ?? '', /2 markets did not/)
  })

  it('mentions staleness as its own fact', () => {
    const sentence = missingSentence({ held: 1, empty: 0, failed: 0, stale: 2, oldestAsOf: null })
    assert.match(sentence ?? '', /2 rows are from a mirror that is behind/)
  })

  it('always ends by saying the contracts hold the stakes regardless', () => {
    // The reassurance is the point: a degraded portfolio page is not a degraded position.
    const sentence = missingSentence({ held: 1, empty: 0, failed: 1, stale: 1, oldestAsOf: null })
    assert.match(sentence ?? '', /in the contracts either way/)
  })
})
