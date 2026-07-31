/**
 * The claim state machine, driven both ways.
 *
 * The three obligations from `lib/claim.ts` are each asserted as a property rather than as a
 * single happy path, because each of them fails silently:
 *
 *   1. a payout is the contract's number or it is `null` — never the mirror's arithmetic;
 *   2. anything the contract did not confirm says so, in a sentence;
 *   3. the button stays live when the market has settled and the amount is unknown.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CONTRACT_STATUS } from '../src/lib/abi.ts'
import {
  claimSentence,
  claimVerdict,
  disputeWindowEnd,
  type ChainFacts,
  type MirrorFacts,
} from '../src/lib/claim.ts'

const CONTRACT = '0x00112233445566778899aabbccddeeff00112233'
const NOW = new Date('2026-08-01T12:00:00.000Z')

function mirror(over: Partial<MirrorFacts> = {}): MirrorFacts {
  return {
    contractAddress: CONTRACT,
    marketStatus: 'resolved',
    resolvedAt: '2026-07-31T12:00:00.000Z',
    disputeWindowSeconds: 86_400,
    stale: false,
    stakedYes: 5n,
    stakedNo: 0n,
    ...over,
  }
}

function chain(over: Partial<ChainFacts> = {}): ChainFacts {
  return {
    status: CONTRACT_STATUS.resolved,
    claimed: false,
    payout: 10n,
    // Resolved a day ago with a one-day window: claimable exactly now.
    claimableFrom: BigInt(Math.floor(new Date('2026-08-01T12:00:00.000Z').getTime() / 1000)),
    ...over,
  }
}

describe('no contract', () => {
  it('is terminal and certain — a market voided before deploy has nothing to claim from', () => {
    const verdict = claimVerdict({ mirror: mirror({ contractAddress: null }), chain: null, now: NOW })
    assert.equal(verdict.state, 'no_contract')
    assert.equal(verdict.canAttempt, false)
    assert.equal(verdict.confirmed, true)
    assert.equal(verdict.unconfirmedBecause, null)
    assert.equal(verdict.payout, null)
  })
})

describe('the contract answered', () => {
  it('says not settled while the contract is Open', () => {
    const verdict = claimVerdict({ mirror: mirror(), chain: chain({ status: CONTRACT_STATUS.open }), now: NOW })
    assert.equal(verdict.state, 'not_settled')
    assert.equal(verdict.canAttempt, false)
    assert.equal(verdict.confirmed, true)
  })

  it('holds the claim while the dispute window is open, and names when it ends', () => {
    const opensAt = Math.floor(NOW.getTime() / 1000) + 3_600
    const verdict = claimVerdict({ mirror: mirror(), chain: chain({ claimableFrom: BigInt(opensAt) }), now: NOW })
    assert.equal(verdict.state, 'dispute_window')
    assert.equal(verdict.canAttempt, false)
    assert.equal(verdict.claimableFrom, new Date(opensAt * 1000).toISOString())
    // The amount is still shown — knowing what is coming is the point of the window.
    assert.equal(verdict.payout, 10n)
  })

  it('opens the claim the moment the window closes, not a second later', () => {
    const boundary = Math.floor(NOW.getTime() / 1000)
    // `sol:441` reverts while `block.timestamp < resolvedAt + window`, so equality is claimable.
    const at = claimVerdict({ mirror: mirror(), chain: chain({ claimableFrom: BigInt(boundary) }), now: NOW })
    assert.equal(at.state, 'claimable')
    const before = claimVerdict({
      mirror: mirror(),
      chain: chain({ claimableFrom: BigInt(boundary + 1) }),
      now: NOW,
    })
    assert.equal(before.state, 'dispute_window')
  })

  it('is claimable with the contract’s own number', () => {
    const verdict = claimVerdict({ mirror: mirror(), chain: chain({ payout: 42n }), now: NOW })
    assert.equal(verdict.state, 'claimable')
    assert.equal(verdict.payout, 42n)
    assert.equal(verdict.confirmed, true)
    assert.equal(verdict.canAttempt, true)
  })

  it('says nothing owed — a real answer — for a losing stake', () => {
    const verdict = claimVerdict({ mirror: mirror(), chain: chain({ payout: 0n }), now: NOW })
    assert.equal(verdict.state, 'nothing_owed')
    assert.equal(verdict.payout, 0n)
    assert.equal(verdict.canAttempt, false)
  })

  it('reports a claimed address as CLAIMED, with no figure', () => {
    // `payoutOf` returns 0 once claimed (`sol:406`), and rendering that 0 would read as "you were
    // paid nothing" rather than "you were already paid".
    const verdict = claimVerdict({ mirror: mirror(), chain: chain({ claimed: true, payout: 0n }), now: NOW })
    assert.equal(verdict.state, 'claimed')
    assert.equal(verdict.payout, null)
    assert.equal(verdict.canAttempt, false)
  })

  it('claims are allowed on a void immediately, with no window', () => {
    const verdict = claimVerdict({
      mirror: mirror({ marketStatus: 'void' }),
      chain: chain({ status: CONTRACT_STATUS.void, claimableFrom: 0n, payout: 5n }),
      now: NOW,
    })
    assert.equal(verdict.state, 'claimable')
    assert.equal(verdict.claimableFrom, null)
    assert.equal(verdict.canAttempt, true)
  })

  it('KEEPS THE BUTTON LIVE when the status read succeeded and the payout read did not', () => {
    const verdict = claimVerdict({ mirror: mirror(), chain: chain({ payout: null }), now: NOW })
    assert.equal(verdict.state, 'unconfirmed')
    assert.equal(verdict.payout, null)
    assert.equal(verdict.confirmed, false)
    assert.equal(verdict.canAttempt, true)
    assert.match(verdict.unconfirmedBecause ?? '', /did not answer/)
  })
})

describe('the contract did not answer', () => {
  const reason = 'No wallet is connected, so the contract could not be read from this browser.'

  it('never computes a payout from the mirror', () => {
    // The mirror knows what was staked, not what is owed — the payout depends on the final pool
    // and on the fee. This is the confident-wrong-number the whole file exists to refuse.
    const verdict = claimVerdict({
      mirror: mirror({ stakedYes: 1_000n }),
      chain: null,
      now: NOW,
      chainUnavailableReason: reason,
    })
    assert.equal(verdict.payout, null)
    assert.equal(verdict.confirmed, false)
  })

  it('lets a settled market be claimed anyway, once the mirror’s window has passed', () => {
    const verdict = claimVerdict({ mirror: mirror(), chain: null, now: NOW, chainUnavailableReason: reason })
    assert.equal(verdict.state, 'unconfirmed')
    assert.equal(verdict.canAttempt, true)
    assert.equal(verdict.unconfirmedBecause, reason)
  })

  it('still holds the claim while the mirror’s own window is open', () => {
    const verdict = claimVerdict({
      mirror: mirror({ resolvedAt: '2026-08-01T11:00:00.000Z' }),
      chain: null,
      now: NOW,
      chainUnavailableReason: reason,
    })
    assert.equal(verdict.state, 'dispute_window')
    assert.equal(verdict.canAttempt, false)
    assert.equal(verdict.claimableFrom, '2026-08-02T11:00:00.000Z')
  })

  it('refuses to attempt a claim on a market the mirror thinks is open', () => {
    const verdict = claimVerdict({
      mirror: mirror({ marketStatus: 'open', resolvedAt: null }),
      chain: null,
      now: NOW,
      chainUnavailableReason: reason,
    })
    assert.equal(verdict.state, 'not_settled')
    assert.equal(verdict.canAttempt, false)
    // Even "it has not settled" is unconfirmed when it comes from a mirror that may be behind.
    assert.equal(verdict.confirmed, false)
  })

  it('says so twice over when the mirror is ALSO known to be behind', () => {
    const verdict = claimVerdict({
      mirror: mirror({ marketStatus: 'open', resolvedAt: null, stale: true }),
      chain: null,
      now: NOW,
      chainUnavailableReason: reason,
    })
    assert.match(verdict.unconfirmedBecause ?? '', /registry is also behind/)
  })

  it('treats a chain object whose status is null as no answer at all', () => {
    const verdict = claimVerdict({ mirror: mirror(), chain: chain({ status: null }), now: NOW })
    assert.equal(verdict.confirmed, false)
    assert.ok(verdict.unconfirmedBecause !== null)
  })

  it('always produces a reason when it is not confirmed', () => {
    // The property, rather than one case: nothing may reach the UI unconfirmed and silent.
    for (const status of ['open', 'closed', 'resolved', 'settled', 'void'] as const) {
      const verdict = claimVerdict({
        mirror: mirror({ marketStatus: status }),
        chain: null,
        now: NOW,
      })
      if (!verdict.confirmed) {
        assert.ok(verdict.unconfirmedBecause !== null, `${status} was unconfirmed and said nothing`)
      }
    }
  })
})

describe('disputeWindowEnd', () => {
  it('is resolvedAt plus the window', () => {
    const end = disputeWindowEnd({
      resolvedAt: '2026-08-01T00:00:00.000Z',
      disputeWindowSeconds: 3_600,
      marketStatus: 'resolved',
    })
    assert.equal(end?.toISOString(), '2026-08-01T01:00:00.000Z')
  })

  it('is null on a void — a void is claimable at once', () => {
    assert.equal(
      disputeWindowEnd({ resolvedAt: '2026-08-01T00:00:00.000Z', disputeWindowSeconds: 3_600, marketStatus: 'void' }),
      null,
    )
  })

  it('is null without a resolution time or with a nonsensical window', () => {
    assert.equal(disputeWindowEnd({ resolvedAt: null, disputeWindowSeconds: 10, marketStatus: 'resolved' }), null)
    assert.equal(
      disputeWindowEnd({ resolvedAt: '2026-08-01T00:00:00.000Z', disputeWindowSeconds: -1, marketStatus: 'resolved' }),
      null,
    )
  })
})

describe('claimSentence', () => {
  it('says something different for every state', () => {
    const states = [
      'no_contract',
      'not_settled',
      'dispute_window',
      'claimable',
      'nothing_owed',
      'claimed',
      'unconfirmed',
    ] as const
    const sentences = states.map((state) =>
      claimSentence({
        state,
        payout: null,
        confirmed: true,
        claimableFrom: null,
        canAttempt: false,
        unconfirmedBecause: null,
      }),
    )
    assert.equal(new Set(sentences).size, states.length, 'two states read the same')
    for (const sentence of sentences) assert.ok(sentence.length > 20)
  })

  it('tells an unconfirmed reader they can still claim', () => {
    const sentence = claimSentence({
      state: 'unconfirmed',
      payout: null,
      confirmed: false,
      claimableFrom: null,
      canAttempt: true,
      unconfirmedBecause: 'x',
    })
    assert.match(sentence, /still claim/)
    assert.match(sentence, /contract decides/)
  })
})
