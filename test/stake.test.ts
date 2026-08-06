/**
 * The stake gate and the stake flow.
 *
 * The gate is checked for the ORDER of its refusals as well as for each of them, because the point
 * of returning a blocker rather than a boolean is that the reader is told the first thing actually
 * in their way — and an order that criticises the amount before mentioning that the market closed
 * is an order that sends somebody to fix a number that will not help.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MarketView } from '../src/lib/foresight.ts'
import {
  IDLE_STAKE,
  blockerSentence,
  refusalSentence,
  stakeGate,
  stakeReducer,
  type StakeBlocker,
} from '../src/lib/stake.ts'

const NOW = new Date('2026-08-01T12:00:00.000Z')
const CONTRACT = '0x00112233445566778899aabbccddeeff00112233'

type GateMarket = Pick<MarketView, 'status' | 'closeTime' | 'contractAddress'>

const OPEN: GateMarket = {
  status: 'open',
  closeTime: '2026-09-01T00:00:00.000Z',
  contractAddress: CONTRACT,
}

function gate(over: Partial<Parameters<typeof stakeGate>[0]> = {}) {
  return stakeGate({
    market: OPEN,
    now: NOW,
    signedIn: true,
    hasWallet: true,
    amount: '1.5',
    ...over,
  })
}

describe('stakeGate — the happy path', () => {
  it('is ready, with the amount in wei', () => {
    const result = gate()
    assert.equal(result.ready, true)
    assert.equal(result.blocker, null)
    assert.equal(result.amountWei, 1_500_000_000_000_000_000n)
  })
})

describe('stakeGate — each refusal', () => {
  const cases: ReadonlyArray<[StakeBlocker, Parameters<typeof gate>[0]]> = [
    ['not_open', { market: { ...OPEN, status: 'closed' } }],
    ['no_contract', { market: { ...OPEN, contractAddress: null } }],
    ['closed', { market: { ...OPEN, closeTime: '2026-07-01T00:00:00.000Z' } }],
    ['signed_out', { signedIn: false }],
    ['no_wallet', { hasWallet: false }],
    ['no_amount', { amount: '   ' }],
    ['bad_amount', { amount: '0' }],
  ]

  for (const [blocker, over] of cases) {
    it(`reports ${blocker}`, () => {
      const result = gate(over)
      assert.equal(result.ready, false)
      assert.equal(result.blocker, blocker)
      assert.equal(result.amountWei, null)
    })

    it(`has a sentence for ${blocker} that names a remedy`, () => {
      assert.ok(blockerSentence(blocker, OPEN).length > 20)
    })
  }
})

describe('stakeGate — the order of the refusals', () => {
  it('says the market has closed before it criticises the amount', () => {
    // `server.ts` refuses a closed market before it looks at anything else, and so does
    // the contract. Telling somebody to fix their amount first wastes their time.
    const result = gate({ market: { ...OPEN, closeTime: '2026-07-01T00:00:00.000Z' }, amount: 'nonsense' })
    assert.equal(result.blocker, 'closed')
  })

  it('says the market is not open before it mentions a session', () => {
    const result = gate({ market: { ...OPEN, status: 'resolved' }, signedIn: false })
    assert.equal(result.blocker, 'not_open')
  })

  it('asks for a session before it asks for a wallet', () => {
    const result = gate({ signedIn: false, hasWallet: false })
    assert.equal(result.blocker, 'signed_out')
  })
})

describe('stakeGate — the amount', () => {
  it('accepts exactly what the service accepts', () => {
    assert.equal(gate({ amount: '0.000000000000000001' }).ready, true)
    assert.equal(gate({ amount: '99999999999999999999' }).ready, true)
  })

  it('refuses zero, a negative, an exponent, and nineteen decimal places', () => {
    for (const bad of ['0', '0.0', '-1', '1e18', `0.${'1'.repeat(19)}`, '1.', '.5']) {
      assert.equal(gate({ amount: bad }).blocker, 'bad_amount', `${bad} was accepted`)
    }
  })

  it('trims surrounding whitespace rather than refusing a pasted amount', () => {
    assert.equal(gate({ amount: '  1.5  ' }).amountWei, 1_500_000_000_000_000_000n)
  })

  it('refuses a market whose close time is exactly now', () => {
    // `server.ts` — `closeTime.getTime() <= now.getTime()`. The boundary is closed, not open.
    assert.equal(gate({ market: { ...OPEN, closeTime: NOW.toISOString() } }).blocker, 'closed')
  })
})

describe('stakeReducer', () => {
  it('starts idle with nothing in it', () => {
    assert.deepEqual(IDLE_STAKE, {
      phase: 'idle',
      intent: null,
      txHash: null,
      message: null,
      requestId: null,
    })
  })

  it('receiving an intent is NOT a stake — it waits for the wallet', () => {
    // The transition worth reading. Nothing has been signed at this point, and a UI that reported
    // success here would be reporting a stake that may never be sent.
    const next = stakeReducer(IDLE_STAKE, {
      type: 'intent',
      intent: { to: CONTRACT } as never,
    })
    assert.equal(next.phase, 'awaiting_wallet')
    assert.equal(next.txHash, null)
  })

  it('only a transaction hash reaches submitted', () => {
    const withIntent = stakeReducer(IDLE_STAKE, { type: 'intent', intent: { to: CONTRACT } as never })
    const sent = stakeReducer(withIntent, { type: 'sent', txHash: '0xabc' })
    assert.equal(sent.phase, 'submitted')
    assert.equal(sent.txHash, '0xabc')
  })

  it('a rejection KEEPS the intent, so a second attempt needs no second policy decision', () => {
    const withIntent = stakeReducer(IDLE_STAKE, { type: 'intent', intent: { to: CONTRACT } as never })
    const rejected = stakeReducer(withIntent, { type: 'rejected' })
    assert.equal(rejected.phase, 'idle_after_rejection')
    assert.notEqual(rejected.intent, null)
    assert.equal(rejected.message, null)
  })

  it('a refusal clears the intent — there is nothing to sign', () => {
    const withIntent = stakeReducer(IDLE_STAKE, { type: 'intent', intent: { to: CONTRACT } as never })
    const refused = stakeReducer(withIntent, { type: 'refused', message: 'no', requestId: 'req-1' })
    assert.equal(refused.phase, 'refused')
    assert.equal(refused.intent, null)
    assert.equal(refused.requestId, 'req-1')
  })

  it('a failure keeps whatever was there and adds the message', () => {
    const withIntent = stakeReducer(IDLE_STAKE, { type: 'intent', intent: { to: CONTRACT } as never })
    const failed = stakeReducer(withIntent, { type: 'failed', message: 'boom', requestId: null })
    assert.equal(failed.phase, 'failed')
    assert.notEqual(failed.intent, null)
    assert.equal(failed.message, 'boom')
  })

  it('requesting discards a previous outcome, so a stale hash cannot survive a retry', () => {
    const sent = stakeReducer(
      stakeReducer(IDLE_STAKE, { type: 'intent', intent: { to: CONTRACT } as never }),
      { type: 'sent', txHash: '0xabc' },
    )
    const again = stakeReducer(sent, { type: 'request' })
    assert.equal(again.phase, 'requesting')
    assert.equal(again.txHash, null)
    assert.equal(again.intent, null)
  })

  it('reset returns to the initial state exactly', () => {
    const messy = stakeReducer(IDLE_STAKE, { type: 'failed', message: 'x', requestId: 'y' })
    assert.deepEqual(stakeReducer(messy, { type: 'reset' }), IDLE_STAKE)
  })
})

describe('refusalSentence', () => {
  it('says policy could not be REACHED, and that nothing was sent', () => {
    // 503, fail-closed (`server.ts`). The distinction from a denial is the whole point.
    const sentence = refusalSentence('policy_unavailable', 'fallback')
    assert.match(sentence, /could not be reached/)
    assert.match(sentence, /nothing was sent/)
    assert.match(sentence, /shortly/)
  })

  it('says a denial is a refusal rather than a fault', () => {
    assert.match(refusalSentence('policy_denied', 'fallback'), /refused/)
  })

  it('distinguishes a market that is not open from one that closed under the reader', () => {
    assert.notEqual(refusalSentence('not_open', 'f'), refusalSentence('closed', 'f'))
    assert.match(refusalSentence('closed', 'f'), /while you were staking/)
  })

  it('falls back to the server’s own message for a code it does not know', () => {
    assert.equal(refusalSentence('something_new', 'the server said this'), 'the server said this')
    assert.equal(refusalSentence(undefined, 'the server said this'), 'the server said this')
  })
})
