/**
 * EMBER amounts, and the regex this app shares with the service.
 *
 * The first suite is the important one. `STAKE_AMOUNT` is a copy of `DECIMAL` from
 * `foresight/src/server.ts`, and a copy that has drifted is worse than no copy: too loose and
 * the user's wallet opens for an amount the service will 400; too tight and the product quietly
 * refuses money somebody wanted to stake. So it is checked in BOTH directions against the source
 * regex, written out here character for character.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EMBER_DECIMALS,
  STAKE_AMOUNT,
  WEI_PER_EMBER,
  formatBps,
  formatEmber,
  fromWeiString,
  groupDigits,
  isStakeAmount,
  shortHex,
  toExactEmber,
  toQuantity,
  toWei,
} from '../src/lib/units.ts'

/** `DECIMAL` — `foresight/src/server.ts`, transcribed. */
const SERVICE_DECIMAL = /^(?!0+(\.0+)?$)\d{1,20}(\.\d{1,18})?$/

describe('STAKE_AMOUNT agrees with the service’s DECIMAL', () => {
  it('is the same pattern, character for character', () => {
    assert.equal(STAKE_AMOUNT.source, SERVICE_DECIMAL.source)
  })

  const cases = [
    '1',
    '0.1',
    '1.5',
    '0.000000000000000001',
    '99999999999999999999',
    '1.123456789012345678',
    // and the refusals
    '0',
    '0.0',
    '00',
    '-1',
    '1.',
    '.5',
    '1e18',
    '',
    ' 1',
    '1 ',
    '1.1234567890123456789',
    '999999999999999999999',
    'abc',
    '1,5',
    '+1',
    'Infinity',
    'NaN',
  ]

  it('agrees with the service on every one of them, in BOTH directions', () => {
    // Both directions, on every case, in one test with a per-case message: a one-sided check would
    // pass a regex that accepted everything, and a per-case `it()` would only say which row failed
    // in the title rather than in the message.
    for (const candidate of cases) {
      assert.equal(
        isStakeAmount(candidate),
        SERVICE_DECIMAL.test(candidate),
        `this app and the service disagree about ${JSON.stringify(candidate)}`,
      )
    }
  })

  it('refuses zero in every spelling, because staking nothing is not a stake', () => {
    for (const zero of ['0', '00', '0.0', '0.000', '000.00']) {
      assert.equal(isStakeAmount(zero), false, `${zero} was accepted`)
    }
  })

  it('accepts eighteen decimal places and refuses nineteen', () => {
    assert.equal(isStakeAmount(`0.${'1'.repeat(18)}`), true)
    assert.equal(isStakeAmount(`0.${'1'.repeat(19)}`), false)
  })
})

describe('toWei', () => {
  it('scales by 10^18', () => {
    assert.equal(WEI_PER_EMBER, 10n ** BigInt(EMBER_DECIMALS))
    assert.equal(toWei('1'), WEI_PER_EMBER)
    assert.equal(toWei('1.5'), 1_500_000_000_000_000_000n)
    assert.equal(toWei('0.000000000000000001'), 1n)
  })

  it('keeps every digit of a value far past 2^53', () => {
    // The whole reason this is not `Number(text) * 1e18`.
    assert.equal(toWei('9007199254.740993'), 9_007_199_254_740_993_000_000_000_000n)
    assert.equal(toWei('1.000000000000000001'), 1_000_000_000_000_000_001n)
  })

  it('pads a short fraction rather than misreading it', () => {
    assert.equal(toWei('0.1'), 100_000_000_000_000_000n)
  })

  it('converts a legitimate zero, which is not the same question as staking one', () => {
    assert.equal(toWei('0'), 0n)
  })

  it('is null for anything malformed', () => {
    for (const bad of ['', '-1', '1.', '.5', '1e18', 'abc', '1,5', null, undefined, `0.${'1'.repeat(19)}`]) {
      assert.equal(toWei(bad), null, `${String(bad)} parsed`)
    }
  })
})

describe('fromWeiString', () => {
  it('reads the mirror’s digit strings', () => {
    assert.equal(fromWeiString('0'), 0n)
    assert.equal(fromWeiString('1000000000000000000'), WEI_PER_EMBER)
  })

  it('is null — never 0n — for anything that is not bare digits', () => {
    for (const bad of ['', ' ', '1.5', '-1', '0x10', 'null', null, undefined, 5 as unknown as string]) {
      assert.equal(fromWeiString(bad), null, `${String(bad)} parsed`)
    }
  })
})

describe('formatEmber', () => {
  it('renders wei as EMBER with six decimals by default', () => {
    assert.equal(formatEmber(1_500_000_000_000_000_000n), '1.5')
    assert.equal(formatEmber(WEI_PER_EMBER), '1')
  })

  it('groups the integer half in threes', () => {
    assert.equal(formatEmber(1_234_567n * WEI_PER_EMBER), '1,234,567')
  })

  it('TRUNCATES rather than rounds', () => {
    // 0.9999999 EMBER. Rounding would print 1 and show a balance the holder does not have.
    assert.equal(formatEmber(999_999_900_000_000_000n), '0.999999')
    assert.equal(formatEmber(1_999_999_999_999_999_999n, { maxDecimals: 2 }), '1.99')
  })

  it('pads to minDecimals when asked, and trims otherwise', () => {
    assert.equal(formatEmber(1_500_000_000_000_000_000n, { minDecimals: 4 }), '1.5000')
    assert.equal(formatEmber(1_000_000_000_000_000_000n), '1')
  })

  it('is null for absent input, and no caller may turn that into 0', () => {
    assert.equal(formatEmber(null), null)
    assert.equal(formatEmber(undefined), null)
    assert.equal(formatEmber(-1n), null)
  })

  it('renders a genuine zero as 0', () => {
    assert.equal(formatEmber(0n), '0')
  })
})

describe('toExactEmber — the figure beside a claim button', () => {
  it('keeps every digit', () => {
    assert.equal(toExactEmber(1_000_000_000_000_000_001n), '1.000000000000000001')
  })

  it('drops trailing zeroes but not significant ones', () => {
    assert.equal(toExactEmber(1_500_000_000_000_000_000n), '1.5')
    assert.equal(toExactEmber(WEI_PER_EMBER), '1')
    assert.equal(toExactEmber(1n), '0.000000000000000001')
  })

  it('differs from the display form exactly where precision was cut', () => {
    const wei = 1_234_567_890_123_456_789n
    assert.equal(formatEmber(wei), '1.234567')
    assert.equal(toExactEmber(wei), '1.234567890123456789')
  })

  it('is null for absent input', () => {
    assert.equal(toExactEmber(null), null)
  })
})

describe('toQuantity', () => {
  it('is minimal 0x hex, which is what eth_sendTransaction wants', () => {
    assert.equal(toQuantity(0n), '0x0')
    assert.equal(toQuantity(255n), '0xff')
    assert.equal(toQuantity(WEI_PER_EMBER), '0xde0b6b3a7640000')
  })

  it('refuses a negative value rather than emitting nonsense', () => {
    assert.throws(() => toQuantity(-1n), RangeError)
  })
})

describe('groupDigits', () => {
  it('groups from the right and never leads with a separator', () => {
    assert.equal(groupDigits('1'), '1')
    assert.equal(groupDigits('123'), '123')
    assert.equal(groupDigits('1234'), '1,234')
    assert.equal(groupDigits('1234567'), '1,234,567')
  })
})

describe('formatBps', () => {
  it('renders basis points to one decimal place', () => {
    assert.equal(formatBps(6_234), '62.3%')
    assert.equal(formatBps(10_000), '100.0%')
    assert.equal(formatBps(0), '0.0%')
    assert.equal(formatBps(50), '0.5%')
  })

  it('is null for absent input — a share of nothing is not 0%', () => {
    assert.equal(formatBps(null), null)
    assert.equal(formatBps(undefined), null)
    assert.equal(formatBps(Number.NaN), null)
  })
})

describe('shortHex', () => {
  it('keeps both ends, so two different values cannot look identical', () => {
    const a = '0x00112233445566778899aabbccddeeff00112233'
    const b = '0x00112233445566778899aabbccddeeff00119999'
    assert.notEqual(shortHex(a), shortHex(b))
  })

  it('leaves a short value alone', () => {
    assert.equal(shortHex('0x1234'), '0x1234')
  })

  it('is null for nothing', () => {
    assert.equal(shortHex(null), null)
    assert.equal(shortHex(''), null)
  })
})
