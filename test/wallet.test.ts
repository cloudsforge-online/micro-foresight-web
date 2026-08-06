/**
 * What gets signed.
 *
 * The transaction builders are pure, so what is asserted here is the exact `to`, `data`, `value`
 * and `from` a wallet would have been handed. A test that stubbed a provider and checked the
 * promise resolves would prove the plumbing; the payload is the part that moves money to an
 * address.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { removeWindow } from './browser-stubs.ts'
import { claimCalldata } from '../src/lib/abi.ts'
import type { StakeIntent } from '../src/lib/foresight.ts'
import {
  USER_REJECTED,
  WalletError,
  buildClaimTransaction,
  buildStakeTransaction,
  currentAccounts,
  ethCall,
  getProvider,
  isUserRejection,
  requestAccounts,
  sendTransaction,
  type Eip1193Provider,
} from '../src/lib/wallet.ts'

const CONTRACT = '0x00112233445566778899aabbccddeeff00112233'
const FROM = '0xaabbccddeeff00112233445566778899aabbccdd'

/** What `POST /markets/:id/stake-intent` answers with — `foresight/src/server.ts`. */
const INTENT: StakeIntent = {
  marketId: 'm-1',
  chain: 'hearth',
  network: 'testnet',
  to: CONTRACT,
  data: '0x604f21770000000000000000000000000000000000000000000000000000000000000001',
  outcome: 1,
  amount: '1.5',
  asset: 'EMBER',
  policy: { decision: 'allow', reasons: [], decisionId: 'dec-1' },
  closeTime: '2026-09-01T00:00:00.000Z',
}

/** A provider that records what it was asked and answers from a script. */
function provider(answers: Record<string, unknown | (() => never)>): {
  provider: Eip1193Provider
  calls: { method: string; params: readonly unknown[] | undefined }[]
} {
  const calls: { method: string; params: readonly unknown[] | undefined }[] = []
  return {
    calls,
    provider: {
      async request(args) {
        calls.push({ method: args.method, params: args.params })
        const answer = answers[args.method]
        if (typeof answer === 'function') return (answer as () => never)()
        return answer
      },
    },
  }
}

afterEach(() => {
  removeWindow()
})

describe('buildStakeTransaction', () => {
  it('takes `to` and `data` from the intent VERBATIM', () => {
    // Rebuilding the calldata locally would be a second opinion about which outcome the user
    // picked, and both opinions would be indexed by the same policy decision id.
    const tx = buildStakeTransaction({ intent: INTENT, amountWei: 1_500_000_000_000_000_000n, from: FROM })
    assert.equal(tx.to, INTENT.to)
    assert.equal(tx.data, INTENT.data)
  })

  it('sets `value` in wei, which the service deliberately does not compute', () => {
    // `server.ts` — "the wallet is what knows the user's balance and what will actually be
    // sent". 1.5 EMBER is 0x14d1120d7b160000 wei.
    const tx = buildStakeTransaction({ intent: INTENT, amountWei: 1_500_000_000_000_000_000n, from: FROM })
    assert.equal(tx.value, '0x14d1120d7b160000')
    assert.equal(BigInt(tx.value), 1_500_000_000_000_000_000n)
  })

  it('sends from the account the wallet gave, and nowhere else', () => {
    assert.equal(buildStakeTransaction({ intent: INTENT, amountWei: 1n, from: FROM }).from, FROM)
  })

  it('refuses a nil stake rather than sending a zero-value transaction', () => {
    assert.throws(() => buildStakeTransaction({ intent: INTENT, amountWei: 0n, from: FROM }), WalletError)
    assert.throws(() => buildStakeTransaction({ intent: INTENT, amountWei: -1n, from: FROM }), WalletError)
  })

  it('refuses an intent with no address or no calldata', () => {
    assert.throws(
      () => buildStakeTransaction({ intent: { ...INTENT, to: '' }, amountWei: 1n, from: FROM }),
      WalletError,
    )
    assert.throws(
      () => buildStakeTransaction({ intent: { ...INTENT, data: 'nonsense' }, amountWei: 1n, from: FROM }),
      WalletError,
    )
  })

  it('has exactly four fields — nothing extra reaches a signing prompt', () => {
    const tx = buildStakeTransaction({ intent: INTENT, amountWei: 1n, from: FROM })
    assert.deepEqual(Object.keys(tx).sort(), ['data', 'from', 'to', 'value'])
  })
})

describe('buildClaimTransaction', () => {
  it('is claim() with no value, built from the ABI rather than from a service response', () => {
    // There is no claim intent to ask for. `ForesightMarket.sol` is why that must stay true.
    const tx = buildClaimTransaction({ contractAddress: CONTRACT, from: FROM })
    assert.equal(tx.to, CONTRACT)
    assert.equal(tx.data, claimCalldata())
    assert.equal(tx.data, '0x4e71d92d')
    assert.equal(tx.value, '0x0')
    assert.equal(tx.from, FROM)
  })

  it('refuses a market with no contract', () => {
    assert.throws(() => buildClaimTransaction({ contractAddress: '', from: FROM }), WalletError)
  })
})

describe('getProvider', () => {
  it('is null with no window at all', () => {
    assert.equal(getProvider(), null)
  })

  it('is null when the injected object is not an EIP-1193 provider', () => {
    ;(globalThis as { window?: unknown }).window = { ethereum: { notRequest: true } }
    assert.equal(getProvider(), null)
    delete (globalThis as { window?: unknown }).window
  })

  it('finds a real one', () => {
    const { provider: injected } = provider({})
    ;(globalThis as { window?: unknown }).window = { ethereum: injected }
    assert.equal(getProvider(), injected)
    delete (globalThis as { window?: unknown }).window
  })
})

describe('requestAccounts', () => {
  it('asks for eth_requestAccounts — the one call that prompts', () => {
    const p = provider({ eth_requestAccounts: [FROM] })
    return requestAccounts(p.provider).then((accounts) => {
      assert.deepEqual(p.calls, [{ method: 'eth_requestAccounts', params: undefined }])
      assert.deepEqual(accounts, [FROM])
    })
  })

  it('filters anything that is not a string out of the answer', async () => {
    const p = provider({ eth_requestAccounts: [FROM, null, 42] })
    assert.deepEqual(await requestAccounts(p.provider), [FROM])
  })

  it('carries the wallet’s error code through, so a rejection can be told from a fault', async () => {
    const p = provider({
      eth_requestAccounts: () => {
        throw Object.assign(new Error('User rejected the request.'), { code: USER_REJECTED })
      },
    })
    await assert.rejects(
      () => requestAccounts(p.provider),
      (err: unknown) => {
        assert.ok(isUserRejection(err))
        assert.equal((err as WalletError).code, 4001)
        return true
      },
    )
  })

  it('does not mistake an ordinary failure for a rejection', async () => {
    const p = provider({
      eth_requestAccounts: () => {
        throw new Error('the wallet is locked')
      },
    })
    await assert.rejects(
      () => requestAccounts(p.provider),
      (err: unknown) => {
        assert.equal(isUserRejection(err), false)
        return true
      },
    )
  })
})

describe('currentAccounts', () => {
  it('uses eth_accounts, which prompts nobody', () => {
    // A page that prompts on load is a page people dismiss before reading anything.
    const p = provider({ eth_accounts: [FROM] })
    return currentAccounts(p.provider).then(() => {
      assert.equal(p.calls[0]?.method, 'eth_accounts')
    })
  })

  it('is empty rather than a failure when the wallet will not answer', async () => {
    const p = provider({
      eth_accounts: () => {
        throw new Error('nope')
      },
    })
    assert.deepEqual(await currentAccounts(p.provider), [])
  })
})

describe('sendTransaction', () => {
  it('passes the transaction as the single parameter and returns the hash', async () => {
    const p = provider({ eth_sendTransaction: '0xdeadbeef' })
    const tx = buildClaimTransaction({ contractAddress: CONTRACT, from: FROM })
    assert.equal(await sendTransaction(p.provider, tx), '0xdeadbeef')
    assert.equal(p.calls[0]?.method, 'eth_sendTransaction')
    assert.deepEqual(p.calls[0]?.params, [tx])
  })

  it('refuses an answer that is not a hash rather than reporting a stake that never happened', async () => {
    const p = provider({ eth_sendTransaction: { ok: true } })
    await assert.rejects(() => sendTransaction(p.provider, buildClaimTransaction({ contractAddress: CONTRACT, from: FROM })), WalletError)
  })
})

describe('ethCall', () => {
  it('calls at `latest` and returns the raw hex', async () => {
    const p = provider({ eth_call: `0x${'0'.repeat(63)}1` })
    const result = await ethCall(p.provider, CONTRACT, '0x4e71d92d')
    assert.equal(result, `0x${'0'.repeat(63)}1`)
    assert.deepEqual(p.calls[0]?.params, [{ to: CONTRACT, data: '0x4e71d92d' }, 'latest'])
  })

  it('is NULL on any failure — "could not confirm", never a zero', async () => {
    const p = provider({
      eth_call: () => {
        throw new Error('node is syncing')
      },
    })
    assert.equal(await ethCall(p.provider, CONTRACT, '0x'), null)
  })

  it('is null for an answer that is not hex', async () => {
    const p = provider({ eth_call: { result: 0 } })
    assert.equal(await ethCall(p.provider, CONTRACT, '0x'), null)
  })
})
