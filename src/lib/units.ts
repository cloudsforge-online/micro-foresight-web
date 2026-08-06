/**
 * EMBER amounts, from the wire to the DOM, without ever going through a float.
 *
 * ── Money is a bigint end to end ───────────────────────────────────────────────────────────────
 *
 * The mirror serves wei as decimal STRINGS — `foresight/src/mirror.ts`: "Wei on YES and on
 * NO, as strings — a JSON number cannot carry 1e18 exactly." Parsing one with `Number()` loses the
 * bottom of an 18-decimal amount, which is exactly where a reconciliation drift shows up, and is
 * also the part a contract's integer division actually depends on. So a wei quantity is a
 * `bigint` from the moment it is read to the moment it is rendered, and the rendering is string
 * work: split the digits at the decimal point, group the head, cut the tail.
 *
 * ── Truncation, never rounding ─────────────────────────────────────────────────────────────────
 *
 * A fraction longer than the display precision is CUT. Rounding 0.9999 up to 1.00 shows a user a
 * balance they do not have, and a figure that reads higher than it is, is the one rounding error
 * nobody forgives. Cutting understates by less than the last displayed digit, which is the safe
 * direction — and the contract's own arithmetic floors too (`ForesightMarket.sol`), so
 * truncating agrees with it rather than drifting from it.
 *
 * ── A missing value is missing ─────────────────────────────────────────────────────────────────
 *
 * Every function here takes and returns `null` for absent input, and no caller may turn that into
 * `0`. This is `wallet/src/pricingclient.ts`'s rule: "an asset absent from it means 'no usable
 * price' rather than zero. A zero would be a valuation, and a valuation of zero is a lie about a
 * holding that exists."
 */

/** EMBER has eighteen decimals, as every EVM-native token does. */
export const EMBER_DECIMALS = 18

/** 10^18, as a bigint. Written as a literal rather than `10n ** 18n` so it is greppable. */
export const WEI_PER_EMBER = 1_000_000_000_000_000_000n

/**
 * The amount format `POST /markets/:id/stake-intent` will accept.
 *
 * This is `DECIMAL` from `foresight/src/server.ts`, character for character:
 *
 *     /^(?!0+(\.0+)?$)\d{1,20}(\.\d{1,18})?$/
 *
 * Copied rather than approximated, and pinned by `test/units.test.ts`, because the two failures
 * are opposite and both bad. A looser client sends an amount the service refuses with a 400 the
 * user cannot act on — after they have already opened their wallet. A tighter one refuses an
 * amount that would have been accepted, which is a product that quietly will not take somebody's
 * money. The negative lookahead is the "not zero" rule: staking nothing is not a stake.
 */
export const STAKE_AMOUNT = /^(?!0+(\.0+)?$)\d{1,20}(\.\d{1,18})?$/

/** True when this string is an amount `stake-intent` will accept. */
export function isStakeAmount(text: string): boolean {
  return STAKE_AMOUNT.test(text)
}

/**
 * A decimal EMBER string to wei.
 *
 * `null` for anything that is not a well-formed non-negative decimal with at most 18 fraction
 * digits. It does NOT apply `STAKE_AMOUNT` — zero is a legitimate quantity to convert (a pool
 * with nothing in it), it is just not a legitimate thing to stake, and conflating the two would
 * make this function refuse to render an empty pool.
 */
export function toWei(text: string | null | undefined): bigint | null {
  if (text === null || text === undefined) return null
  // `\d{1,18}` and not `\d{0,18}`: a trailing bare dot (`1.`) is a typo, not the number one, and
  // accepting it here would make this function disagree with `STAKE_AMOUNT` about the same string.
  const match = /^(\d+)(?:\.(\d{1,18}))?$/.exec(text.trim())
  if (!match) return null
  const whole = match[1] ?? '0'
  const fraction = (match[2] ?? '').padEnd(EMBER_DECIMALS, '0')
  return BigInt(whole) * WEI_PER_EMBER + BigInt(fraction || '0')
}

/**
 * A wei string from the service, as a bigint.
 *
 * The mirror's sums are `numeric(78,0)::text`, so a well-formed answer is bare digits. Anything
 * else — `null`, `''`, a float that got through, a JSON number that lost its tail — is `null`, not
 * `0n`. `foresight/src/mirror.ts` already coalesces an absent SUM to `'0'` on its side,
 * so a genuine zero pool arrives as `'0'` and is distinguishable here from a value that never came.
 */
export function fromWeiString(value: string | null | undefined): bigint | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  return BigInt(trimmed)
}

/** Group an integer digit string in threes: `12345678` → `12,345,678`. Pure string work. */
export function groupDigits(digits: string): string {
  let out = ''
  for (let i = 0; i < digits.length; i += 1) {
    const fromRight = digits.length - i
    if (i > 0 && fromRight % 3 === 0) out += ','
    out += digits[i]
  }
  return out
}

export interface AmountOptions {
  /** Fraction digits shown. Longer fractions are CUT. Default 6. */
  readonly maxDecimals?: number | undefined
  /** Pad the fraction out to this length. Default 0, which also trims trailing zeroes. */
  readonly minDecimals?: number | undefined
}

/**
 * Wei as a readable EMBER figure. `1500000000000000000n` → `1.5`.
 *
 * Six fraction digits by default: EMBER has eighteen and a table column showing all of them is a
 * column nobody can scan, while six is finer than any stake a person types. The full-precision
 * form is available from `toExactEmber` for the one place it belongs — beside the claim button,
 * where the number is the one the contract is about to send.
 */
export function formatEmber(wei: bigint | null | undefined, options: AmountOptions = {}): string | null {
  if (wei === null || wei === undefined) return null
  if (wei < 0n) return null
  const max = options.maxDecimals ?? 6
  const min = options.minDecimals ?? 0

  const whole = wei / WEI_PER_EMBER
  const fraction = (wei % WEI_PER_EMBER).toString().padStart(EMBER_DECIMALS, '0')

  let shown = fraction.slice(0, max)
  while (shown.length > min && shown.endsWith('0')) shown = shown.slice(0, -1)
  while (shown.length < min) shown += '0'

  const grouped = groupDigits(whole.toString())
  return shown.length > 0 ? `${grouped}.${shown}` : grouped
}

/**
 * Every digit, no grouping, no cut. The exact quantity, for the line that says what will move.
 *
 * A truncated figure beside a claim button is a figure a user will compare against the one their
 * wallet shows and find different. This is the one place precision beats scannability.
 */
export function toExactEmber(wei: bigint | null | undefined): string | null {
  if (wei === null || wei === undefined || wei < 0n) return null
  const whole = wei / WEI_PER_EMBER
  const fraction = (wei % WEI_PER_EMBER).toString().padStart(EMBER_DECIMALS, '0').replace(/0+$/, '')
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString()
}

/** `0x`-prefixed minimal hex, which is what an EIP-1193 `value` field must be. */
export function toQuantity(value: bigint): string {
  if (value < 0n) throw new RangeError('a quantity cannot be negative')
  return `0x${value.toString(16)}`
}

/**
 * Basis points as a percentage string, in integer arithmetic. `6234` → `62.3%`.
 *
 * `null` in, `null` out — `poolOf` answers `yesBps: null` for a pool with nothing in it
 * (`foresight/src/mirror.ts`), because a share of nothing is not 0%, it is undefined. A UI
 * that printed `0.0%` there would be asserting that nobody thinks this will happen, when what is
 * true is that nobody has staked at all.
 */
export function formatBps(bps: number | null | undefined): string | null {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return null
  const whole = Math.trunc(bps / 100)
  const tenths = Math.trunc(Math.abs(bps % 100) / 10)
  return `${whole}.${tenths}%`
}

/**
 * An address or a hash, shortened for a list.
 *
 * Both ends are kept: the head identifies the value and the tail is what a user actually compares
 * against the one on their device. A truncation that keeps only the head lets two different
 * addresses look identical, which on a page about money is how somebody signs the wrong thing.
 */
export function shortHex(text: string | null | undefined, head = 10, tail = 6): string | null {
  if (!text) return null
  if (text.length <= head + tail + 1) return text
  return `${text.slice(0, head)}…${text.slice(-tail)}`
}
