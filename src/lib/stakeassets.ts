/**
 * Staking with something other than EMBER: the assets, the units, and the sentence.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THE POOL IS EMBER. THE ACCOUNT IS NOT. THE CONVERSION HAPPENS AT THE STAKE AND IS SHOWN.**
 *
 * A market's pool is one `uint256` of wei in the contract's own storage
 * (`foresight/src/contracts/ForesightMarket.sol`), so there is nowhere to put an asset code
 * and a mixed pool is not a feature that has not been built — it is inexpressible. What the
 * service adds is a door: a bettor holding BTC has their stake converted at a quoted, recorded
 * rate, and everything downstream is EMBER.
 *
 * This file's whole job is to make sure a reader is never surprised by that. Three rules, and
 * every one of them is a test in `test/stakeassets.test.ts`:
 *
 *   1. **BOTH UNITS AND BOTH RATES ARE SHOWN BEFORE THE STAKE, NEVER AFTER.** A conversion the
 *      user reads about afterwards is a conversion they did not agree to.
 *   2. **NOTHING AFTER THE STAKE IS DENOMINATED IN THE ASSET THEY BROUGHT.** The position, the
 *      odds, the projected payout and the settled payout are EMBER. Showing "you won 0.02 BTC" on
 *      an EMBER position would promise an exchange rate the platform has not undertaken to hold —
 *      and it would promise it to every winner at once, in the same direction.
 *   3. **AND NOT THE OPPOSITE MISTAKE EITHER.** A reader who deposited BTC must be told, in words,
 *      that staking ends their BTC exposure — and that a void returns the BTC they staked rather
 *      than what it is worth on the day. The service composes those sentences; this file renders
 *      them and never writes its own.
 *
 * ── DECIMALS ARE PER ASSET AND THE OLD PARSER ASSUMED EIGHTEEN ────────────────────────────────
 *
 * `units.ts` converts a typed amount to wei at EMBER's 18 places, which is right for EMBER and
 * wrong by a factor of 10¹⁰ for Bitcoin: "0.01" typed against BTC is 1,000,000 satoshis, not
 * 10,000,000,000,000,000 of them. `toSmallestUnits` below takes the decimals from the registry the
 * service serves, and `isAmountFor` refuses more fraction digits than the asset has — because a
 * client that silently truncated the eleventh digit of a satoshi amount would be quietly staking a
 * different number from the one on the screen.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** One row of the service's registry — `GET /stake-assets`. */
export interface StakeAssetView {
  readonly assetCode: string
  readonly displayName: string
  readonly decimals: number
  readonly enabled: boolean
  /** Why it is off, when it is off. Rendered, never swallowed. */
  readonly blockedReason: string | null
}

export interface StakeAssetsView {
  readonly poolAsset: string
  readonly custodialStakingAvailable: boolean
  /** The platform's sentence about custodial versus wallet staking. Composed by the service. */
  readonly disclosure: string
  readonly assets: readonly StakeAssetView[]
}

/**
 * One row of `GET /me/stake-balances`: a registry row with what the reader actually holds on it.
 *
 * `available` is SMALLEST UNITS as a decimal string, and `null` when the ledger could not be read.
 * Those are two different answers and the panel says two different things about them: a zero is a
 * fact about the account, a null is a fact about the estate. Neither is ever rendered as the other.
 *
 * The figure is the `available` purpose alone. Coins in `escrow` are already committed to a market
 * and counting them as spendable would invite somebody to stake the same money twice.
 */
export interface StakeBalanceView extends StakeAssetView {
  readonly available: string | null
}

export interface StakeBalancesView {
  readonly poolAsset: string
  /** True when the ledger was unreachable. Every `available` is null and no figure is invented. */
  readonly degraded: boolean
  readonly assets: readonly StakeBalanceView[]
}

/**
 * What `POST /markets/:id/stake-quote` answers with.
 *
 * Both rate legs are here because the cross rate is their quotient: a screen that showed only the
 * quotient would give a reader a number they could not check against a published board.
 */
export interface StakeQuoteView {
  readonly stakeAsset: string
  readonly stakeAssetName: string
  readonly stakeDecimals: number
  readonly stakeAmount: string
  readonly stakeAmountFormatted: string
  readonly poolAsset: string
  readonly poolAmount: string
  readonly poolAmountFormatted: string
  readonly stakeRateUsdScaled: string
  readonly poolRateUsdScaled: string
  readonly disclosure: string
}

/** Everything a client may safely turn into an unknown shape. `null` means "not this". */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Read the registry, refusing anything malformed rather than defaulting it.
 *
 * **A missing `decimals` is not eighteen.** `units.ts`'s header states the rule this follows:
 * "a valuation of zero is a lie about a holding that exists", and a guessed decimals is the same
 * shape of lie about a scale. A row this cannot read is dropped, not repaired.
 */
export function parseStakeAssets(body: unknown): StakeAssetsView | null {
  const root = asRecord(body)
  if (!root) return null
  const poolAsset = asString(root['poolAsset'])
  const disclosure = asString(root['disclosure'])
  const raw = root['assets']
  if (poolAsset === null || disclosure === null || !Array.isArray(raw)) return null

  const assets: StakeAssetView[] = []
  for (const item of raw) {
    const row = parseAssetRow(item)
    if (row !== null) assets.push(row)
  }
  return {
    poolAsset,
    custodialStakingAvailable: root['custodialStakingAvailable'] === true,
    disclosure,
    assets,
  }
}

/** One registry row, or `null` for a row this cannot read. Never a repaired one. */
function parseAssetRow(item: unknown): StakeAssetView | null {
  const row = asRecord(item)
  if (!row) return null
  const assetCode = asString(row['assetCode'])
  const displayName = asString(row['displayName'])
  const decimals = row['decimals']
  // Integer, in range, PRESENT. Not `?? 18`.
  if (
    assetCode === null ||
    displayName === null ||
    typeof decimals !== 'number' ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36
  ) {
    return null
  }
  return {
    assetCode,
    displayName,
    decimals,
    enabled: row['enabled'] === true,
    blockedReason: asString(row['blockedReason']),
  }
}

/**
 * Read `GET /me/stake-balances`.
 *
 * **An unreadable amount is `null`, never `'0'`.** `units.ts` states the rule this follows — "a
 * valuation of zero is a lie about a holding that exists" — and here the lie has a specific cost:
 * a reader shown a zero they do not have stops trying to bet, and a reader shown a zero they DO
 * have concludes their deposit was lost. So the only figures this returns are figures the service
 * sent, as digit strings, unconverted.
 */
export function parseStakeBalances(body: unknown): StakeBalancesView | null {
  const root = asRecord(body)
  if (!root) return null
  const poolAsset = asString(root['poolAsset'])
  const raw = root['assets']
  if (poolAsset === null || !Array.isArray(raw)) return null

  const assets: StakeBalanceView[] = []
  for (const item of raw) {
    const base = parseAssetRow(item)
    if (base === null) continue
    const row = asRecord(item)
    const available = row === null ? null : asString(row['available'])
    assets.push({ ...base, available: available !== null && /^\d+$/.test(available) ? available : null })
  }
  return { poolAsset, degraded: root['degraded'] === true, assets }
}

/**
 * The amount format for a given asset: positive, and no more fraction digits than the asset has.
 *
 * `units.ts`'s `STAKE_AMOUNT` is this rule with 18 hard-coded, and it stays there for the EMBER
 * wallet path it was written for. This is the same rule made a function of the asset, because
 * "0.000000001 BTC" is not a small stake — it is a tenth of a satoshi, which does not exist.
 */
export function isAmountFor(text: string, decimals: number): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  if (decimals === 0) return /^(?!0+$)\d{1,30}$/.test(trimmed)
  const pattern = new RegExp(`^(?!0+(\\.0+)?$)\\d{1,30}(\\.\\d{1,${decimals}})?$`)
  return pattern.test(trimmed)
}

/**
 * A typed decimal amount to smallest units, at the asset's own scale.
 *
 * `null` for anything malformed — never `0n`, which is the estate's recurring defect
 * (`BigInt('') === 0n`) and here would mean sending a stake of nothing and being told so by a 400
 * after the user had already committed to the flow.
 */
export function toSmallestUnits(text: string | null | undefined, decimals: number): bigint | null {
  if (text === null || text === undefined) return null
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null
  const pattern = decimals === 0 ? /^(\d+)$/ : new RegExp(`^(\\d+)(?:\\.(\\d{1,${decimals}}))?$`)
  const match = pattern.exec(text.trim())
  if (!match) return null
  const whole = match[1] ?? '0'
  // `padEnd` and not `slice`: the pattern has already refused a longer fraction, so there is
  // nothing to truncate here. Truncating instead would stake a different number from the one typed.
  const fraction = decimals === 0 ? '' : (match[2] ?? '').padEnd(decimals, '0')
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction === '' ? '0' : fraction)
}

/**
 * Smallest units back to something a person reads, at the asset's own scale.
 *
 * The inverse of `toSmallestUnits`, and it round-trips: what this prints can be typed back into
 * the amount field and `isAmountFor` accepts it. That matters because the panel offers a "stake it
 * all" control, and a control that filled the field with a number the validator then refused would
 * be the panel arguing with itself.
 *
 * Trailing zeros of the fraction are cut and a whole amount prints with no point at all — 8 places
 * of satoshi on every balance is noise, not precision. Nothing is rounded: every digit that
 * survives is the digit the service sent.
 */
export function fromSmallestUnits(value: string, decimals: number): string | null {
  if (!/^\d+$/.test(value)) return null
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null
  if (decimals === 0) return BigInt(value).toString()
  const units = BigInt(value)
  const scale = 10n ** BigInt(decimals)
  const whole = (units / scale).toString()
  const fraction = (units % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction.length > 0 ? `${whole}.${fraction}` : whole
}

/**
 * The line a reader sees above the stake button.
 *
 * Deliberately a plain string built from the service's own numbers, not a re-computation. This app
 * does not divide one rate by the other to check the service's arithmetic and then show its own
 * answer — two numbers that disagree by a wei would be far worse than one number.
 */
export function conversionLine(quote: StakeQuoteView): string | null {
  if (quote.stakeAsset === quote.poolAsset) return null
  return `${quote.stakeAmountFormatted} ${quote.stakeAssetName} → ${quote.poolAmountFormatted} ${quote.poolAsset}`
}

/**
 * The rate, rendered from the two scaled integers, for the reader who wants to check it.
 *
 * `RATE_SCALE` is 10⁶ (`contracts/packages/chain/src/index.ts`), and both legs are USD per whole
 * unit at that scale. The division is done in bigint at a fixed extra precision and then cut —
 * never in floating point, and never rounded up, which is `units.ts`'s rule for the same reason.
 *
 * `null` rather than a guess when either leg is unreadable. A rate line that silently became "1"
 * would be the most expensive default in this app.
 */
export function rateLine(quote: StakeQuoteView): string | null {
  if (quote.stakeAsset === quote.poolAsset) return null
  if (!/^\d+$/.test(quote.stakeRateUsdScaled) || !/^\d+$/.test(quote.poolRateUsdScaled)) return null
  const stake = BigInt(quote.stakeRateUsdScaled)
  const pool = BigInt(quote.poolRateUsdScaled)
  if (stake <= 0n || pool <= 0n) return null
  // Six extra places, truncated. Enough to show a cheap pool asset against an expensive stake one.
  const scaled = (stake * 1_000_000n) / pool
  const whole = scaled / 1_000_000n
  const fraction = (scaled % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  const value = fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`
  return `1 ${quote.stakeAssetName} = ${value} ${quote.poolAsset}`
}

/**
 * How a custodial-stake refusal reads.
 *
 * Each of these is a different situation with a different remedy, and collapsing them into "it did
 * not work" is what `stake.ts`'s `blockerSentence` exists to prevent on the wallet path. The codes
 * are `foresight/src/server.ts`'s.
 */
export function stakeRefusalSentence(
  code: string | undefined,
  message: string | undefined,
  fallback: string,
): string {
  switch (code) {
    case 'asset_disabled':
      // The service's own reason names what is missing and which repository it is missing from.
      // Replacing it with a generic sentence would leave a reader unable to tell "never" from
      // "not yet".
      return message ?? 'That currency is not one we can take at the moment.'
    case 'rate_unavailable':
      return 'We could not get a price for that currency, so nothing was taken and nothing was placed. Rather than guess a rate and convert your money on it, we stop. Try again shortly.'
    case 'custodial_staking_unconfigured':
      return 'This deployment only handles bets sent straight from a wallet. Connect one and pay in EMBER.'
    case 'ledger_unavailable':
      return 'The bet went in, but the service that tracks your balance did not confirm it back. Send the same one again — it will not be taken twice.'
    case 'policy_unavailable':
      return 'We have stopped taking bets for a moment: the service that approves them is unreachable. Your money is untouched. Come back shortly.'
    case 'policy_denied':
      return 'Our checks turned this one down.'
    default:
      return message ?? fallback
  }
}
