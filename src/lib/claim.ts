/**
 * The claim state machine, and the rule that the chain outranks the mirror.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS FOR
 *
 * `ForesightMarket.sol`:
 *
 *   > **THIS FUNCTION IS WHY THE MIRROR IS ALLOWED TO DIE.** It reads nothing but this contract's
 *   > own storage. If every server this platform owns is switched off, a winner with a wallet and
 *   > a block explorer can still be paid, and nobody has to ask anybody's permission.
 *
 * A claim page has to keep that true. Which means three obligations, and the third is the one
 * that is easy to get wrong:
 *
 *   1. **Never render a confident wrong number.** The mirror's `stale` flag
 *      (`foresight/src/mirror.ts`) is set when the indexer is a confirmation depth behind
 *      or has never run. A payout computed from a stale pool is a number that will not match what
 *      the contract sends, and a user who reads it will believe the difference was taken from
 *      them.
 *   2. **Say what cannot be confirmed, in those words.** Not a spinner, not a dash: a sentence
 *      naming the thing that did not answer.
 *   3. **STILL LET THEM CLAIM.** A page that hides the claim button because it could not verify
 *      the payout has made the mirror load-bearing for a function that does not read it. So
 *      `canAttempt` is true whenever a contract exists and the market has plausibly settled, and
 *      the worst case is a transaction the contract itself rejects — which costs gas and tells the
 *      truth, and is strictly better than a user being told to come back later by a page that
 *      does not know.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import {
  CONTRACT_STATUS,
  claimedCalldata,
  decodeBoolAt,
  decodeUintAt,
  payoutOfCalldata,
} from './abi.ts'
import type { MarketStatus } from './foresight.ts'
import { instant } from './format.ts'
import { ethCall, type Eip1193Provider } from './wallet.ts'
import { encodeCall, MARKET_ABI } from './abi.ts'

/**
 * What the contract itself says. Every field is nullable and `null` means "did not answer".
 *
 * Not "zero", not "false". `decodeUintAt` returns `null` for a short or absent result precisely so
 * that an `eth_call` to a node that is syncing cannot arrive here looking like a settled zero.
 */
export interface ChainFacts {
  /** `Status` — Open 0, Resolved 1, Void 2 (`ForesightMarket.sol`). */
  readonly status: bigint | null
  /** `claimed(address)` — once, per address, for ever (`sol:129`, `sol:448`). */
  readonly claimed: boolean | null
  /** `payoutOf(address)` in wei — floored, and zero once claimed (`sol:405-411`). */
  readonly payout: bigint | null
  /** `claimableFrom()` in unix seconds; 0 while the market is open (`sol:393-397`). */
  readonly claimableFrom: bigint | null
}

/** What the mirror says. Enough to reason about a market whose contract could not be reached. */
export interface MirrorFacts {
  readonly contractAddress: string | null
  readonly marketStatus: MarketStatus
  readonly resolvedAt: string | null
  readonly disputeWindowSeconds: number
  /** True when the mirror knows it is behind — `foresight/src/mirror.ts`. */
  readonly stale: boolean
  /** The mirror's own idea of what this address staked, in wei. Used only when the chain is silent. */
  readonly stakedYes: bigint | null
  readonly stakedNo: bigint | null
}

export type ClaimState =
  /** No contract was ever deployed. There is nothing on chain to claim from. */
  | 'no_contract'
  /** The market has not settled. `claim` reverts with `NotResolved` (`sol:440`). */
  | 'not_settled'
  /** Resolved, and the dispute window has not elapsed. `claim` reverts (`sol:441-443`). */
  | 'dispute_window'
  /** Owed something, and claimable now. */
  | 'claimable'
  /** Settled, and this address is owed nothing — they backed the losing side. */
  | 'nothing_owed'
  /** Already claimed. Once, per address, for ever. */
  | 'claimed'
  /** Settled, but what is owed could not be confirmed. The button is still live. */
  | 'unconfirmed'

export interface ClaimVerdict {
  readonly state: ClaimState
  /** Wei owed, or `null` when it could not be established. NEVER 0n as a stand-in for unknown. */
  readonly payout: bigint | null
  /** True only when the CONTRACT answered. A verdict from the mirror alone is never confirmed. */
  readonly confirmed: boolean
  /** ISO instant the first claim becomes possible, when that is known. */
  readonly claimableFrom: string | null
  /** Whether the claim button is live. See obligation 3 in the header. */
  readonly canAttempt: boolean
  /**
   * What could not be checked, in a sentence, or `null` when everything could.
   *
   * Rendered verbatim. This is the difference between a page that is honest about its limits and
   * a page that is quiet about them.
   */
  readonly unconfirmedBecause: string | null
}

/**
 * Decide the claim state.
 *
 * ── The precedence, which is the whole design ─────────────────────────────────────────────────
 *
 * The chain is consulted first for every fact it can supply, and the mirror is consulted only for
 * facts the chain did not answer. They are never blended: a payout is either the contract's number
 * or it is `null`, because a payout computed half from a live pool and half from a stale one is a
 * number that came from nowhere.
 */
export function claimVerdict(opts: {
  readonly mirror: MirrorFacts
  readonly chain: ChainFacts | null
  readonly now: Date
  /** Why the chain was not consulted, when it was not — "no wallet is connected", say. */
  readonly chainUnavailableReason?: string | null
}): ClaimVerdict {
  const { mirror, chain, now } = opts
  const reason = opts.chainUnavailableReason ?? null

  if (!mirror.contractAddress) {
    // A market voided before deployment (`server.ts`) or still a draft. There is no
    // contract, so there is nothing to claim and nothing to be uncertain about.
    return {
      state: 'no_contract',
      payout: null,
      confirmed: true,
      claimableFrom: null,
      canAttempt: false,
      unconfirmedBecause: null,
    }
  }

  const chainStatus = chain?.status ?? null
  const settledOnChain =
    chainStatus === CONTRACT_STATUS.resolved || chainStatus === CONTRACT_STATUS.void
  // The mirror's own view, used only where the chain was silent. `settled` is the status the
  // service sets after the fee report lands, so both it and `resolved` mean the outcome is posted.
  const settledInMirror =
    mirror.marketStatus === 'resolved' ||
    mirror.marketStatus === 'settled' ||
    mirror.marketStatus === 'void'

  /* ---- the chain answered ------------------------------------------------ */

  if (chain !== null && chainStatus !== null) {
    if (!settledOnChain) {
      return {
        state: 'not_settled',
        payout: null,
        confirmed: true,
        claimableFrom: null,
        canAttempt: false,
        unconfirmedBecause: null,
      }
    }

    const claimableFrom = unixToIso(chain.claimableFrom)
    const windowOpen =
      chain.claimableFrom !== null &&
      chain.claimableFrom > 0n &&
      now.getTime() < Number(chain.claimableFrom) * 1000

    if (chain.claimed === true) {
      return {
        state: 'claimed',
        // Not `chain.payout`: `payoutOf` returns 0 for a claimed address (`sol:406`), and 0 here
        // would read as "you were paid nothing" rather than "you were already paid".
        payout: null,
        confirmed: true,
        claimableFrom,
        canAttempt: false,
        unconfirmedBecause: null,
      }
    }

    if (windowOpen) {
      return {
        state: 'dispute_window',
        payout: chain.payout,
        confirmed: chain.payout !== null,
        claimableFrom,
        canAttempt: false,
        unconfirmedBecause:
          chain.payout === null ? 'The contract did not answer what this address is owed.' : null,
      }
    }

    if (chain.payout === null) {
      // Settled, claimable, and the payout read failed on its own. The button stays live.
      return {
        state: 'unconfirmed',
        payout: null,
        confirmed: false,
        claimableFrom,
        canAttempt: true,
        unconfirmedBecause: 'The contract did not answer what this address is owed.',
      }
    }

    return {
      state: chain.payout > 0n ? 'claimable' : 'nothing_owed',
      payout: chain.payout,
      confirmed: true,
      claimableFrom,
      canAttempt: chain.payout > 0n,
      unconfirmedBecause: null,
    }
  }

  /* ---- the chain did not answer; fall back to the mirror, and say so ------ */

  const because =
    reason ??
    'The contract could not be read from this browser, so the amount below could not be confirmed.'

  if (!settledInMirror) {
    return {
      state: 'not_settled',
      payout: null,
      // The mirror is not the contract. Even "this market has not settled" is unconfirmed when it
      // comes from a mirror that may be behind the resolution transaction.
      confirmed: false,
      claimableFrom: null,
      // A market the mirror thinks is still open may have resolved since. There is nothing to be
      // gained from a transaction that will revert, and nothing lost by refusing it: if the mirror
      // is wrong the reader can reload, and the contract is reachable from any explorer.
      canAttempt: false,
      unconfirmedBecause: mirror.stale
        ? `${because} The market registry is also behind, so its status may not be current either.`
        : because,
    }
  }

  const windowEnds = disputeWindowEnd(mirror)
  const windowOpen = windowEnds !== null && now.getTime() < windowEnds.getTime()

  return {
    state: windowOpen ? 'dispute_window' : 'unconfirmed',
    // DELIBERATELY NULL. The mirror knows what was staked, not what is owed — the payout depends
    // on the final pool and on the fee, and computing it from a mirror that may be behind is the
    // "confident wrong number" this file exists to refuse.
    payout: null,
    confirmed: false,
    claimableFrom: windowEnds === null ? null : windowEnds.toISOString(),
    canAttempt: !windowOpen,
    unconfirmedBecause: because,
  }
}

/**
 * When the dispute window ends, from the mirror's fields.
 *
 * `resolvedAt + disputeWindowSeconds`, the same expression as `ForesightMarket.sol`. `null` on
 * a void — a void is claimable immediately (`sol:394`) — and on a market with no resolution time.
 */
export function disputeWindowEnd(mirror: Pick<MirrorFacts, 'resolvedAt' | 'disputeWindowSeconds' | 'marketStatus'>): Date | null {
  if (mirror.marketStatus === 'void') return null
  const at = instant(mirror.resolvedAt)
  if (at === null) return null
  if (!Number.isFinite(mirror.disputeWindowSeconds) || mirror.disputeWindowSeconds < 0) return null
  return new Date(at.getTime() + mirror.disputeWindowSeconds * 1000)
}

function unixToIso(seconds: bigint | null): string | null {
  if (seconds === null || seconds <= 0n) return null
  const ms = seconds * 1000n
  if (ms > 8_640_000_000_000_000n) return null
  return new Date(Number(ms)).toISOString()
}

/**
 * Read the four facts off the contract, through the user's own provider.
 *
 * Sequential rather than `Promise.all`, because some injected providers serialise requests anyway
 * and a burst of four is how a wallet decides a page is misbehaving. Any one of them may answer
 * `null`; a partial answer is more useful than none, and `claimVerdict` is written to take one.
 */
export async function readChainFacts(
  provider: Eip1193Provider,
  contractAddress: string,
  address: string,
): Promise<ChainFacts> {
  const status = decodeUintAt(
    (await ethCall(provider, contractAddress, encodeCall(MARKET_ABI.status))) ?? '',
  )
  const claimed = decodeBoolAt(
    (await ethCall(provider, contractAddress, claimedCalldata(address))) ?? '',
  )
  const payout = decodeUintAt(
    (await ethCall(provider, contractAddress, payoutOfCalldata(address))) ?? '',
  )
  const claimableFrom = decodeUintAt(
    (await ethCall(provider, contractAddress, encodeCall(MARKET_ABI.claimableFrom))) ?? '',
  )
  return { status, claimed, payout, claimableFrom }
}

/** The sentence a claim state renders as. One place, so seven screens cannot disagree. */
export function claimSentence(verdict: ClaimVerdict): string {
  switch (verdict.state) {
    case 'no_contract':
      return 'This market never reached the chain, so there is nothing to claim from.'
    case 'not_settled':
      return 'This market has not settled yet. Nothing is claimable until the outcome is posted.'
    case 'dispute_window':
      return 'The outcome is posted and the dispute window is still open. Claims open when it ends.'
    case 'claimable':
      return 'This is claimable now. The contract pays it directly to your address.'
    case 'nothing_owed':
      return 'This address is owed nothing from this market.'
    case 'claimed':
      return 'Already claimed. The contract pays each address once.'
    case 'unconfirmed':
      return 'This market has settled. What you are owed could not be confirmed from here — you can still claim, and the contract decides the amount.'
  }
}
