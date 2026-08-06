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
    const row = asRecord(item)
    if (!row) continue
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
      continue
    }
    const enabled = row['enabled'] === true
    const blockedReason = asString(row['blockedReason'])
    assets.push({ assetCode, displayName, decimals, enabled, blockedReason })
  }
  return {
    poolAsset,
    custodialStakingAvailable: root['custodialStakingAvailable'] === true,
    disclosure,
    assets,
  }
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
      return message ?? 'This platform does not accept stakes in that asset yet.'
    case 'rate_unavailable':
      return 'The rate for that asset could not be read, so nothing was staked and nothing was taken. Staking in an asset the platform cannot price is refused rather than guessed. Try again shortly.'
    case 'custodial_staking_unconfigured':
      return 'This deployment takes wallet stakes only. Connect a wallet to stake in EMBER.'
    case 'ledger_unavailable':
      return 'Your stake was recorded but the balance service did not confirm it. Retry the same stake — it will not be taken twice.'
    case 'policy_unavailable':
      return 'Staking is paused because the policy service could not be reached. Nothing was staked. Try again shortly.'
    case 'policy_denied':
      return 'Policy refused this stake.'
    default:
      return message ?? fallback
  }
}
