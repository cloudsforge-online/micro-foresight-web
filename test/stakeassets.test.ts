/**
 * Staking in something other than EMBER, from the client's side.
 *
 * The one that matters most: **a typed amount is parsed at the ASSET's decimals, not at EMBER's.**
 * "0.01" against Bitcoin is 1,000,000 satoshis; the same string through `units.ts`'s `toWei` is
 * 10,000,000,000,000,000 — ten billion times more, and a number the user never typed.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  conversionLine,
  isAmountFor,
  parseStakeAssets,
  rateLine,
  stakeRefusalSentence,
  toSmallestUnits,
  type StakeQuoteView,
} from '../src/lib/stakeassets.ts'
import { toWei } from '../src/lib/units.ts'

const QUOTE: StakeQuoteView = {
  stakeAsset: 'BTC',
  stakeAssetName: 'Bitcoin',
  stakeDecimals: 8,
  stakeAmount: '1000000',
  stakeAmountFormatted: '0.01',
  poolAsset: 'EMBER',
  poolAmount: '2400000000000000000000',
  poolAmountFormatted: '2400',
  stakeRateUsdScaled: '60000000000',
  poolRateUsdScaled: '250000',
  disclosure: 'Staking converts 0.01 Bitcoin to 2400 EMBER…',
}

test('a typed amount is parsed at the asset’s own decimals, not at EMBER’s', () => {
  // MUTATION: route the custodial amount through `toWei` → this reddens by a factor of 10^10, and
  // the reader stakes ten billion times what they typed.
  assert.equal(toSmallestUnits('0.01', 8), 1_000_000n)
  assert.equal(toSmallestUnits('0.01', 18), 10_000_000_000_000_000n)
  assert.equal(toSmallestUnits('0.01', 6), 10_000n)
  assert.notEqual(toSmallestUnits('0.01', 8), toWei('0.01'))
  assert.equal(toWei('0.01')! / toSmallestUnits('0.01', 8)!, 10n ** 10n)
})

test('a fraction finer than the asset is refused, never truncated', () => {
  // A tenth of a satoshi does not exist. Truncating it would stake a different number from the one
  // on the screen. MUTATION: `slice(0, decimals)` instead of refusing → this reddens.
  assert.equal(isAmountFor('0.00000001', 8), true)
  assert.equal(isAmountFor('0.000000001', 8), false)
  assert.equal(toSmallestUnits('0.000000001', 8), null)
  assert.equal(isAmountFor('0.000001', 6), true)
  assert.equal(isAmountFor('0.0000001', 6), false)
})

test('zero, blank and malformed are null — never 0n', () => {
  // `BigInt('') === 0n` is the estate's recurring defect. A zero here would send a stake of
  // nothing and be refused by the service after the reader had committed to the flow.
  assert.equal(BigInt(''), 0n)
  assert.equal(isAmountFor('0', 8), false)
  assert.equal(isAmountFor('0.00', 8), false)
  assert.equal(isAmountFor('', 8), false)
  assert.equal(isAmountFor('-1', 8), false)
  assert.equal(isAmountFor('1e6', 8), false)
  assert.equal(toSmallestUnits('', 8), null)
  assert.equal(toSmallestUnits('1.', 8), null)
  assert.equal(toSmallestUnits('abc', 8), null)
})

test('a zero-decimal asset takes whole units and nothing finer', () => {
  assert.equal(isAmountFor('250', 0), true)
  assert.equal(isAmountFor('250.5', 0), false)
  assert.equal(toSmallestUnits('250', 0), 250n)
})

test('a registry row without readable decimals is DROPPED, not defaulted to eighteen', () => {
  // ══════════════════════════════════════════════════════════════════════════════════════════
  // MUTATION: `decimals: typeof d === 'number' ? d : 18` → the malformed row is kept at EMBER's
  // scale and every stake in it is off by a power of ten. A guessed scale is the same shape of
  // lie as a guessed price, and `units.ts`'s header already refuses the latter.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  const parsed = parseStakeAssets({
    poolAsset: 'EMBER',
    custodialStakingAvailable: true,
    disclosure: 'A custodial stake is held for you…',
    assets: [
      { assetCode: 'BTC', displayName: 'Bitcoin', decimals: 8, enabled: true, blockedReason: null },
      { assetCode: 'MYSTERY', displayName: 'Mystery', enabled: true, blockedReason: null },
      { assetCode: 'ALSO', displayName: 'Also', decimals: '8', enabled: true, blockedReason: null },
      { assetCode: 'HUGE', displayName: 'Huge', decimals: 99, enabled: true, blockedReason: null },
    ],
  })
  assert.ok(parsed)
  assert.deepEqual(
    parsed.assets.map((a) => a.assetCode),
    ['BTC'],
  )
})

test('a disabled asset keeps its reason, so "not yet" is distinguishable from "never"', () => {
  const parsed = parseStakeAssets({
    poolAsset: 'EMBER',
    custodialStakingAvailable: true,
    disclosure: 'x',
    assets: [
      {
        assetCode: 'LTC',
        displayName: 'Litecoin',
        decimals: 8,
        enabled: false,
        blockedReason: 'micro-pricing publishes no LTC rate',
      },
    ],
  })
  assert.equal(parsed?.assets[0]?.enabled, false)
  assert.match(parsed?.assets[0]?.blockedReason ?? '', /pricing/)
  // And the refusal sentence carries it through rather than replacing it with a generic one.
  assert.match(
    stakeRefusalSentence('asset_disabled', 'micro-pricing publishes no LTC rate', 'no'),
    /pricing/,
  )
})

test('a body missing the pool asset or the disclosure is not a registry', () => {
  assert.equal(parseStakeAssets(null), null)
  assert.equal(parseStakeAssets({ assets: [] }), null)
  assert.equal(parseStakeAssets({ poolAsset: 'EMBER', assets: [] }), null)
  assert.equal(parseStakeAssets({ poolAsset: 'EMBER', disclosure: 'x' }), null)
})

test('the conversion line shows both units, in the service’s own numbers', () => {
  // MUTATION: re-compute the pool amount in this app from the two rates → two numbers that can
  // disagree by a wei, which is worse than one number. The line is built from what was served.
  assert.equal(conversionLine(QUOTE), '0.01 Bitcoin → 2400 EMBER')
  // Staking the pool asset is not a conversion and must not be described as one.
  assert.equal(conversionLine({ ...QUOTE, stakeAsset: 'EMBER' }), null)
})

test('the rate is rendered from both legs in bigint, and is null when either is unreadable', () => {
  // $60,000 per BTC over $0.25 per EMBER is 240,000 EMBER to the Bitcoin.
  assert.equal(rateLine(QUOTE), '1 Bitcoin = 240000 EMBER')
  // MUTATION: default an unreadable leg to RATE_SCALE, or to 1 → this reddens. A rate line that
  // silently became "1" is the most expensive default in this app.
  assert.equal(rateLine({ ...QUOTE, poolRateUsdScaled: '' }), null)
  assert.equal(rateLine({ ...QUOTE, poolRateUsdScaled: '0' }), null)
  assert.equal(rateLine({ ...QUOTE, stakeRateUsdScaled: 'x' }), null)
  // A fractional result is truncated, not rounded up — `units.ts`'s rule and the contract's.
  assert.equal(
    rateLine({ ...QUOTE, stakeRateUsdScaled: '1000000', poolRateUsdScaled: '3000000' }),
    '1 Bitcoin = 0.333333 EMBER',
  )
})

test('each refusal reads as its own situation with its own remedy', () => {
  // `stake.ts` makes this argument for the wallet path: six blockers with six remedies collapse
  // into "it does not work" if they share a sentence.
  const sentences = new Set(
    ['asset_disabled', 'rate_unavailable', 'custodial_staking_unconfigured', 'ledger_unavailable',
     'policy_unavailable', 'policy_denied'].map((code) =>
      stakeRefusalSentence(code, undefined, 'fallback'),
    ),
  )
  assert.equal(sentences.size, 6, 'no two refusals may share a sentence')
  // The one that must never read like a failure: the money is safe and the retry is safe.
  assert.match(stakeRefusalSentence('ledger_unavailable', undefined, 'x'), /not be taken twice/)
  // And the one that must never read like a permanent refusal.
  assert.match(stakeRefusalSentence('rate_unavailable', undefined, 'x'), /nothing was taken/)
})
