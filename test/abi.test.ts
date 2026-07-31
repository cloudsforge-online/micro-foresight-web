/**
 * The ABI codec, and the four bytes that reach a contract holding other people's money.
 *
 * The selectors are DERIVED from the signatures at runtime, so what is asserted here is that each
 * signature is the one in `ForesightMarket.sol` and that it produces the published four bytes. A
 * constant in the source would be something a reader has to trust; a constant in a test beside the
 * signature that produces it is something the build checks on every run.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AbiError,
  CONTRACT_STATUS,
  MARKET_ABI,
  OUTCOME_NO,
  OUTCOME_YES,
  checksumAddress,
  claimCalldata,
  claimedCalldata,
  decodeBoolAt,
  decodeUintAt,
  encodeAddress,
  encodeCall,
  encodeUint,
  isAddress,
  payoutOfCalldata,
  poolCalldata,
  selector,
  stakeOfCalldata,
} from '../src/lib/abi.ts'

const ADDR = '0x00112233445566778899aabbccddeeff00112233'

describe('selector', () => {
  it('derives claim() as 0x4e71d92d', () => {
    // The published selector of the function this app sends. `ForesightMarket.sol:431`.
    assert.equal(selector('claim()'), '0x4e71d92d')
  })

  it('derives the other reads this app makes', () => {
    assert.equal(selector('payoutOf(address)'), '0x6da61d1e')
    assert.equal(selector('stakeOf(address)'), '0x42623360')
    assert.equal(selector('claimed(address)'), '0xc884ef83')
    assert.equal(selector('claimableFrom()'), '0x1c6487ba')
    assert.equal(selector('status()'), '0x200d2ed2')
    assert.equal(selector('pool(uint256)'), '0xfe313112')
  })

  it('agrees with micro-foresight’s OWN encoder, byte for byte', () => {
    // ══════════════════════════════════════════════════════════════════════════════════════════
    // The cross-check that matters. `foresight/src/evm.ts` has a `callData` of its own — it is
    // what `POST /markets/:id/stake-intent` uses to build the calldata it hands a wallet
    // (`server.ts:533`). These two literals are the output of THAT function, run against the
    // service's own source:
    //
    //     callData('stake(uint8)', [{ type: 'uint8', value: 1n }])
    //       → 0x604f2177…0001
    //     callData('claim()', [])
    //       → 0x4e71d92d
    //
    // Two implementations of one encoding in one estate is a difference that presents as a claim
    // that reverts, or worse, as a stake on the outcome the user did not pick.
    // ══════════════════════════════════════════════════════════════════════════════════════════
    assert.equal(
      encodeCall('stake(uint8)', [{ type: 'uint8', value: 1n }]),
      '0x604f21770000000000000000000000000000000000000000000000000000000000000001',
    )
    assert.equal(encodeCall('claim()'), '0x4e71d92d')
  })

  it('is four bytes and nothing more', () => {
    assert.equal(selector('claim()').length, 10)
    assert.match(selector('claim()'), /^0x[0-9a-f]{8}$/)
  })

  it('separates two signatures that differ only in argument type', () => {
    assert.notEqual(selector('stake(uint8)'), selector('stake(uint256)'))
  })
})

describe('the signatures are the contract’s', () => {
  it('names each function exactly as ForesightMarket.sol declares it', () => {
    assert.equal(MARKET_ABI.claim, 'claim()') //                        sol:431
    assert.equal(MARKET_ABI.payoutOf, 'payoutOf(address)') //           sol:405
    assert.equal(MARKET_ABI.stakeOf, 'stakeOf(address)') //             sol:352
    assert.equal(MARKET_ABI.claimed, 'claimed(address)') //             sol:129, public mapping
    assert.equal(MARKET_ABI.claimableFrom, 'claimableFrom()') //        sol:393
    assert.equal(MARKET_ABI.status, 'status()') //                      sol:114, public enum
    assert.equal(MARKET_ABI.pool, 'pool(uint256)') //                   sol:120, public array
    assert.equal(MARKET_ABI.winningOutcome, 'winningOutcome()') //      sol:117
    assert.equal(MARKET_ABI.feeAmount, 'feeAmount()') //                sol:381
  })

  it('carries the Status enum in the contract’s order', () => {
    // sol:49-53 — Open, Resolved, Void. Getting this order wrong would tell a reader a resolved
    // market was still open.
    assert.equal(CONTRACT_STATUS.open, 0n)
    assert.equal(CONTRACT_STATUS.resolved, 1n)
    assert.equal(CONTRACT_STATUS.void, 2n)
  })

  it('carries the outcome constants in the contract’s order', () => {
    // sol:59-60. YES is 0, and 0 is falsy — the trap this constant exists to keep out of the UI.
    assert.equal(OUTCOME_YES, 0)
    assert.equal(OUTCOME_NO, 1)
  })
})

describe('encodeUint', () => {
  it('produces a 32-byte big-endian word', () => {
    assert.equal(encodeUint(1n), '0'.repeat(63) + '1')
    assert.equal(encodeUint(0n), '0'.repeat(64))
  })

  it('handles the top of the range', () => {
    assert.equal(encodeUint((1n << 256n) - 1n), 'f'.repeat(64))
  })

  it('refuses a negative or oversized value rather than truncating it', () => {
    assert.throws(() => encodeUint(-1n), AbiError)
    assert.throws(() => encodeUint(1n << 256n), AbiError)
  })
})

describe('encodeAddress', () => {
  it('left-pads the 20 bytes to a word and lower-cases them', () => {
    assert.equal(encodeAddress(ADDR), '0'.repeat(24) + '00112233445566778899aabbccddeeff00112233')
    assert.equal(encodeAddress(ADDR).length, 64)
  })

  it('accepts a checksummed address and normalises it', () => {
    const mixed = checksumAddress(ADDR)
    assert.equal(encodeAddress(mixed), encodeAddress(ADDR))
  })

  it('refuses anything that is not twenty bytes', () => {
    assert.throws(() => encodeAddress('0x00'), AbiError)
    assert.throws(() => encodeAddress('00112233445566778899aabbccddeeff00112233'), AbiError)
    assert.throws(() => encodeAddress(`${ADDR}00`), AbiError)
  })
})

describe('encodeCall', () => {
  it('is the selector followed by one word per static argument', () => {
    const data = encodeCall('payoutOf(address)', [{ type: 'address', value: ADDR }])
    assert.equal(data, `0x6da61d1e${'0'.repeat(24)}00112233445566778899aabbccddeeff00112233`)
    assert.equal(data.length, 10 + 64)
  })

  it('is the bare selector for a no-argument call', () => {
    assert.equal(encodeCall('claim()'), '0x4e71d92d')
  })

  it('encodes several arguments in order', () => {
    const data = encodeCall('x(uint256,address)', [
      { type: 'uint256', value: 5n },
      { type: 'address', value: ADDR },
    ])
    assert.equal(data.slice(10, 74), encodeUint(5n))
    assert.equal(data.slice(74), encodeAddress(ADDR))
  })
})

describe('the calldata builders', () => {
  it('claim() takes no arguments — the contract pays msg.sender and nobody else', () => {
    assert.equal(claimCalldata(), '0x4e71d92d')
  })

  it('payoutOf, stakeOf and claimed all take the staker', () => {
    for (const build of [payoutOfCalldata, stakeOfCalldata, claimedCalldata]) {
      assert.equal(build(ADDR).slice(10), encodeAddress(ADDR))
    }
  })

  it('pool() takes the outcome index and refuses anything else', () => {
    assert.equal(poolCalldata(OUTCOME_YES).slice(10), encodeUint(0n))
    assert.equal(poolCalldata(OUTCOME_NO).slice(10), encodeUint(1n))
    assert.throws(() => poolCalldata(2), AbiError)
    assert.throws(() => poolCalldata(-1), AbiError)
  })
})

describe('decodeUintAt', () => {
  it('reads word 0 of a return value', () => {
    assert.equal(decodeUintAt(`0x${encodeUint(42n)}`), 42n)
  })

  it('reads a later word', () => {
    const data = `0x${encodeUint(7n)}${encodeUint(9n)}`
    assert.equal(decodeUintAt(data, 0), 7n)
    assert.equal(decodeUintAt(data, 1), 9n)
  })

  it('reads a value far past 2^53 exactly', () => {
    const huge = (1n << 200n) + 12_345n
    assert.equal(decodeUintAt(`0x${encodeUint(huge)}`), huge)
  })

  it('answers NULL, never 0n, for a short or absent result', () => {
    // `0x` is what an eth_call returns for a node that is syncing, an address with no code, and a
    // wallet on the wrong chain. Decoding it as 0n is the confident-wrong-number failure.
    assert.equal(decodeUintAt('0x'), null)
    assert.equal(decodeUintAt(''), null)
    assert.equal(decodeUintAt('0x1234'), null)
    assert.equal(decodeUintAt(undefined as unknown as string), null)
    assert.equal(decodeUintAt(`0x${'z'.repeat(64)}`), null)
  })

  it('answers null for a word index past the end', () => {
    assert.equal(decodeUintAt(`0x${encodeUint(1n)}`, 1), null)
  })
})

describe('decodeBoolAt', () => {
  it('reads 1 as true and 0 as false', () => {
    assert.equal(decodeBoolAt(`0x${encodeUint(1n)}`), true)
    assert.equal(decodeBoolAt(`0x${encodeUint(0n)}`), false)
  })

  it('is null when the word is not there — "unknown" is not "not claimed"', () => {
    assert.equal(decodeBoolAt('0x'), null)
  })
})

describe('EIP-55', () => {
  it('checksums the vectors from the EIP', () => {
    assert.equal(
      checksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'),
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    )
    assert.equal(
      checksumAddress('0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359'),
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    )
    assert.equal(
      checksumAddress('0xdbf03b407c01e7cd3cbea99509d93f8dddc8c6fb'),
      '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
    )
    assert.equal(
      checksumAddress('0xd1220a0cf47c7b9be7a2e6ba89f429762e7b9adb'),
      // Note the trailing lower-case `b`. This vector is written with an upper-case B in a great
      // many blog posts, and it is wrong there — the EIP's own table has `aDb`.
      '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
    )
  })

  it('accepts an all-lower or all-upper address, which carries no checksum to check', () => {
    assert.equal(isAddress(ADDR), true)
    assert.equal(isAddress(`0x${ADDR.slice(2).toUpperCase()}`), true)
  })

  it('accepts a correctly checksummed address', () => {
    assert.equal(isAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'), true)
  })

  it('REFUSES a mixed-case address whose checksum is wrong', () => {
    // At this point the user has pasted something that claims to be checksummed and is not, which
    // on a page about money is a typo worth catching.
    assert.equal(isAddress('0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'), false)
  })

  it('refuses anything that is not twenty bytes of hex', () => {
    assert.equal(isAddress('0x123'), false)
    assert.equal(isAddress('not an address'), false)
    assert.equal(isAddress(''), false)
    assert.equal(isAddress(`0x${'g'.repeat(40)}`), false)
  })
})
