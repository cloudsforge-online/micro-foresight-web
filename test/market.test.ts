/**
 * The market view-model: the hash check, the observation sentence, and the phase.
 *
 * The hash check is the one that matters. `checkDocument` is what turns the canonical document on
 * the wire from something a reader is shown into something a reader can verify, so it is tested
 * against a real canonicalisation and against a tampered one — a check that only ever passes is
 * not a check.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MarketDetail, MarketView, PoolView } from '../src/lib/foresight.ts'
import { keccak256Utf8 } from '../src/lib/keccak.ts'
import { checkDocument, observation, outcomeLabel, phaseLabel, phaseOf, takesStakes } from '../src/lib/market.ts'

const NOW = new Date('2026-08-01T12:00:00.000Z')

/**
 * `canonicalDocument` — `foresight/src/questiondoc.ts:66-80`, length-prefixed and fixed-order.
 *
 * Reproduced here rather than imported so this test hashes bytes it built, not bytes the code
 * under test built. `DOCUMENT_VERSION` is `questiondoc.ts:52`.
 */
function canonical(fields: readonly string[]): string {
  const field = (value: string): string => `${new TextEncoder().encode(value).length}:${value}`
  return ['cloudsforge.foresight.market/1', ...fields].map(field).join('')
}

const DOC = canonical([
  'Will block 21,000,000 be reached by 2026-12-31?',
  'YES if the chain reports a block at height 21,000,000 or above with a timestamp on or before 2026-12-31T23:59:59Z.',
  'protocol_network',
  '1',
  'chain_rpc',
  'https://rpc.hearth.example/',
  '1798761600',
  '86400',
  '500',
])

function market(over: Partial<MarketView> = {}): MarketView {
  return {
    id: 'm-1',
    status: 'open',
    question: 'Will block 21,000,000 be reached by 2026-12-31?',
    resolutionCriteria: 'c',
    category: 'protocol_network',
    categoryVersion: 1,
    resolutionSourceKind: 'chain_rpc',
    resolutionSourceRef: 'https://rpc.hearth.example/',
    questionHash: keccak256Utf8(DOC),
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
    ...over,
  }
}

function detail(over: Partial<MarketDetail> = {}): Pick<MarketDetail, 'document' | 'market'> {
  return {
    market: market(),
    document: { canonical: DOC, hash: keccak256Utf8(DOC) },
    ...over,
  }
}

function pool(over: Partial<PoolView> = {}): PoolView {
  return {
    yes: '0',
    no: '0',
    total: '0',
    yesBps: null,
    noBps: null,
    stakerCount: 0,
    asOf: '2026-08-01T11:59:00.000Z',
    lastBlock: 100,
    tipBlock: 100,
    behindBlocks: 0,
    stale: false,
    ...over,
  }
}

describe('checkDocument', () => {
  it('recomputes the hash from the bytes it was shown', () => {
    const check = checkDocument(detail())
    assert.equal(check.recomputed, keccak256Utf8(DOC))
    assert.equal(check.matches, true)
  })

  it('CATCHES criteria edited after the market opened', () => {
    // The whole point. An operator who changed the criteria would produce a page whose document no
    // longer hashes to the number in a contract nobody can change.
    const tampered = DOC.replace('2026-12-31', '2027-12-31')
    const check = checkDocument({
      market: market(),
      document: { canonical: tampered, hash: keccak256Utf8(DOC) },
    })
    assert.equal(check.matches, false)
    assert.notEqual(check.recomputed, check.claimed)
  })

  it('catches a single changed character anywhere in the document', () => {
    for (const index of [0, 40, DOC.length - 1]) {
      const tampered = `${DOC.slice(0, index)}X${DOC.slice(index + 1)}`
      assert.equal(
        checkDocument({ market: market(), document: { canonical: tampered, hash: keccak256Utf8(DOC) } }).matches,
        false,
        `an edit at ${index} went unnoticed`,
      )
    }
  })

  it('also requires the market’s own questionHash to agree', () => {
    // `document.hash` and `market.questionHash` are two different fields of one response, and a
    // disagreement between THEM is as interesting as a disagreement with the recomputed value.
    const check = checkDocument({
      market: market({ questionHash: `0x${'0'.repeat(64)}` }),
      document: { canonical: DOC, hash: keccak256Utf8(DOC) },
    })
    assert.equal(check.matches, false)
  })

  it('is case-insensitive about hex, since a hash is a value not a string', () => {
    const check = checkDocument({
      market: market({ questionHash: keccak256Utf8(DOC).toUpperCase().replace('0X', '0x') }),
      document: { canonical: DOC, hash: keccak256Utf8(DOC).toUpperCase().replace('0X', '0x') },
    })
    assert.equal(check.matches, true)
  })
})

describe('observation', () => {
  it('distinguishes NEVER OBSERVED from empty, and says "not zero" in those words', () => {
    const obs = observation(pool({ asOf: null, stale: true }), NOW)
    assert.equal(obs.tone, 'never')
    assert.match(obs.text, /not known — not zero/)
  })

  it('warns when the mirror is behind, and says how far', () => {
    const obs = observation(pool({ stale: true, behindBlocks: 12 }), NOW)
    assert.equal(obs.tone, 'stale')
    assert.match(obs.text, /12 blocks behind the tip/)
    assert.match(obs.text, /may have moved/)
  })

  it('STILL prints the time when everything is current', () => {
    // Rule one. A figure with no observation time is a claim about now that is really a claim
    // about whenever the mirror last synced.
    const obs = observation(pool(), NOW)
    assert.equal(obs.tone, 'current')
    assert.match(obs.text, /as of 11:59 UTC/)
    assert.match(obs.text, /1 min ago/)
  })

  it('never returns an empty sentence, in any state', () => {
    for (const view of [pool(), pool({ stale: true }), pool({ asOf: null })]) {
      assert.ok(observation(view, NOW).text.length > 20)
    }
  })
})

describe('phaseOf', () => {
  it('maps the service’s statuses onto what a reader needs to know', () => {
    assert.equal(phaseOf(market({ status: 'draft' }), NOW), 'not_open')
    assert.equal(phaseOf(market({ status: 'approved' }), NOW), 'not_open')
    assert.equal(phaseOf(market({ status: 'closed' }), NOW), 'closed')
    assert.equal(phaseOf(market({ status: 'resolved' }), NOW), 'resolved')
    assert.equal(phaseOf(market({ status: 'settled' }), NOW), 'settled')
    assert.equal(phaseOf(market({ status: 'void' }), NOW), 'void')
  })

  it('says closing soon within the last hour', () => {
    assert.equal(phaseOf(market({ closeTime: '2026-08-01T12:30:00.000Z' }), NOW), 'closing_soon')
    assert.equal(phaseOf(market({ closeTime: '2026-08-01T13:30:00.000Z' }), NOW), 'open')
  })

  it('calls an open market whose close time has passed CLOSED', () => {
    // The mirror can lag the close; the contract will not take a stake either way
    // (`ForesightMarket.sol` refuses at `closeTime`), so the page must not offer one.
    assert.equal(phaseOf(market({ closeTime: '2026-08-01T11:00:00.000Z' }), NOW), 'closed')
  })

  it('falls back to open rather than guessing when the close time is unreadable', () => {
    assert.equal(phaseOf(market({ closeTime: 'not a date' }), NOW), 'open')
  })
})

describe('phaseLabel', () => {
  it('gives every phase a distinct word, so colour is never the only channel', () => {
    const phases = ['not_open', 'open', 'closing_soon', 'closed', 'resolved', 'settled', 'void'] as const
    const labels = phases.map(phaseLabel)
    assert.equal(new Set(labels).size, phases.length)
    assert.match(phaseLabel('void'), /refund/i)
  })
})

describe('outcomeLabel', () => {
  it('reads 0 as Yes — the falsy-zero trap', () => {
    // `market.outcome ? 'No' : 'Yes'` would call an UNRESOLVED market a Yes.
    assert.equal(outcomeLabel(0), 'Yes')
    assert.equal(outcomeLabel(1), 'No')
    assert.equal(outcomeLabel(null), null)
  })
})

describe('takesStakes', () => {
  it('is true only for open, which is what server.ts:498-501 enforces', () => {
    assert.equal(takesStakes('open'), true)
    for (const status of ['draft', 'approved', 'closed', 'resolved', 'settled', 'void'] as const) {
      assert.equal(takesStakes(status), false, `${status} was offered a stake form`)
    }
  })
})
