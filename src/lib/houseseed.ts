/**
 * The house seed disclosure, reduced to what a market page must say — docs/ecosystem/21 §5, §7.6.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THE HOUSE IS A BETTOR IN THIS POOL, AND THE READER MUST NOT HAVE TO ASK.**
 *
 * When `micro-foresight` seeds a market, `engagement:foresight`'s money is staked from a
 * published platform address across BOTH outcomes at open (`foresight/src/houseseed.ts`). Four
 * properties make that defensible — symmetric by CHECK, plannable only before open, recorded
 * only in the opening transaction, capped in two schemas — and every one of them is a promise the
 * reader is asked to take on trust. They are worth taking on trust only because the position is
 * DISCLOSED. 21 §2 is blunt about the alternative: "invisible house positions — is refused
 * outright. It is the one form of this that costs nothing and it is fraud."
 *
 * So this module has one rule, and it is the reason it returns a value for every seeded market
 * rather than only for well-formed ones:
 *
 *   **A seed that exists always produces a disclosure.** No field on the wire may be shaped badly
 *   enough to make the page silently say nothing. A missing amount degrades to "not known"; a
 *   missing sentence degrades to one composed here; nothing degrades to absence.
 *
 * That is the opposite of the rule everywhere else in this app, where an unreadable figure is
 * rendered as unknown rather than guessed — and it is the same rule underneath. Absence is the
 * one thing that would be read as a claim: a market page with no disclosure asserts, to every
 * reader, that the platform has no position in it.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── What this checks rather than repeats ───────────────────────────────────────────────────────
 *
 * `disclosure` is the service's own sentence and is rendered verbatim (`houseseed.ts:213-218`
 * says why: one sentence written once, not improvised per client). But a sentence repeated is a
 * sentence taken on trust, which is exactly what `checkDocument` refuses to do with the question
 * hash. So the two numbers behind it are re-derived here:
 *
 *   * **Symmetry** — `totalWei` must be exactly twice `amountPerOutcomeWei`. Symmetric is what
 *     "the house expresses no opinion" MEANS (21 §5), and it is the one claim on this panel a
 *     browser can settle by itself. A seed that fails it is rendered as a warning, loudly, in
 *     the same shape as a document-hash mismatch.
 *   * **Share of the pool** — the house's wei over the pool's wei. This is the figure that tells
 *     a reader how much of the odds they are looking at is the platform's own money, and it
 *     exists nowhere on the wire because only the client has both halves.
 */
import { totalOf, type Pools } from './pool.ts'
import { formatEmber, fromWeiString } from './units.ts'
import type { HouseSeedView, MarketDetail } from './foresight.ts'

/** How the pool arithmetic below reports the house's share. `BPS` is `pool.ts`'s, restated. */
const BPS = 10_000n

export interface HouseSeedEvidence {
  /** The word, not the index: `outcome` is 0/1 on the wire and 0 is falsy. */
  readonly outcome: 'Yes' | 'No'
  readonly txHash: string
}

export interface HouseDisclosure {
  /**
   * `planned` is a market approved with a seed whose money is not in the pool yet, and it reads
   * differently on the page: a market cannot OPEN while its seed is planned (the service refuses
   * unless the mirror shows the exact symmetric position), so a reader seeing `planned` is
   * looking at a market that has not opened.
   */
  readonly state: 'planned' | 'staked'
  /** The platform's sentence, verbatim, or one composed here if the service sent none. */
  readonly sentence: string
  /** True when `sentence` came from the service rather than from the fallback below. */
  readonly fromService: boolean
  readonly perOutcomeWei: bigint | null
  readonly totalWei: bigint | null
  /**
   * Whether `totalWei === 2 × perOutcomeWei`, checked here.
   *
   * `null` when either amount is unreadable — the honest answer to "is it symmetric" with a
   * number missing is not `false`, which would accuse the platform on the strength of a parse.
   */
  readonly symmetric: boolean | null
  /**
   * The house's share of everything staked, in basis points, or `null` when either the pool or
   * the seed is unknown — and always `null` for a `planned` seed, whose money is not in the pool
   * by definition. Never inferred from one half.
   */
  readonly shareBps: number | null
  readonly houseAddress: string | null
  readonly stakedAt: string | null
  /** The on-chain proof, one per outcome, and only the hashes that are actually present. */
  readonly evidence: readonly HouseSeedEvidence[]
}

/** A wire field that should be a non-empty string, or `null`. Never `''`, never a number. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * The sentence to fall back on when the service sent none.
 *
 * Deliberately not a copy of the service's wording with the amount interpolated: if the amount is
 * also unreadable the fallback would be a sentence with a hole in it, and the FACT — the platform
 * holds a position here — is the part that must survive every degradation. So the amount is added
 * only when there is one.
 */
function composeSentence(state: 'planned' | 'staked', totalWei: bigint | null): string {
  const amount = formatEmber(totalWei)
  const verb = state === 'staked' ? 'seeded this pool with' : 'will seed this pool with'
  if (amount === null) {
    return state === 'staked'
      ? 'CloudsForge holds a position in this pool.'
      : 'CloudsForge is due to seed this pool before it opens.'
  }
  return `CloudsForge ${verb} ${amount} EMBER so early odds exist.`
}

/**
 * The house's share of the pool, in basis points.
 *
 * bigint throughout and floored, matching `oddsBps` — the narrowing to a JS number is exact
 * because the quotient is at most 10,000. A share over 100% is impossible on chain (the house's
 * stake is IN the pool it is divided by) and is therefore evidence of a mirror the client should
 * not do arithmetic on, so it reads as unknown rather than as a number nobody can act on.
 */
function shareOf(houseWei: bigint | null, pools: Pools): number | null {
  const pool = totalOf(pools)
  if (houseWei === null || pool === null || pool === 0n || houseWei < 0n) return null
  if (houseWei > pool) return null
  return Number((houseWei * BPS) / pool)
}

/**
 * The disclosure for one market, or `null` when there is no house seed at all.
 *
 * `null` is the ONLY case that renders nothing, and it means what the service means by it: no
 * house money was ever planned for this market. Everything else — a bad amount, a missing
 * sentence, an absent transaction hash — still discloses.
 */
export function houseDisclosureOf(
  detail: Pick<MarketDetail, 'houseSeed'>,
  pools: Pools,
): HouseDisclosure | null {
  const seed: HouseSeedView | null | undefined = detail.houseSeed
  if (seed === null || seed === undefined || typeof seed !== 'object') return null

  // Anything that is not the word 'planned' is treated as staked. The direction is deliberate: a
  // state this app does not recognise must not downgrade a real position into an intention.
  const state: 'planned' | 'staked' = seed.state === 'planned' ? 'planned' : 'staked'

  const perOutcomeWei = fromWeiString(seed.amountPerOutcomeWei)
  const totalWei = fromWeiString(seed.totalWei)
  const symmetric =
    perOutcomeWei === null || totalWei === null ? null : totalWei === perOutcomeWei * 2n

  const evidence: HouseSeedEvidence[] = []
  const yes = text(seed.txHashYes)
  const no = text(seed.txHashNo)
  if (yes !== null) evidence.push({ outcome: 'Yes', txHash: yes })
  if (no !== null) evidence.push({ outcome: 'No', txHash: no })

  const sentence = text(seed.disclosure)
  return {
    state,
    sentence: sentence ?? composeSentence(state, totalWei),
    fromService: sentence !== null,
    perOutcomeWei,
    totalWei,
    symmetric,
    // A planned seed is not in the pool, so it has no share of it. Computing one from the pool
    // the seed has not entered would overstate the platform's presence in a market it has not
    // yet touched — which is the same class of error as understating it, and is still a lie.
    shareBps: state === 'staked' ? shareOf(totalWei, pools) : null,
    houseAddress: text(seed.houseAddress),
    stakedAt: text(seed.stakedAt),
    evidence,
  }
}
