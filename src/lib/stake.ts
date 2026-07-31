/**
 * The stake flow: what has to be true before a wallet is asked, and what each refusal means.
 *
 * ── The shape of the hand-off ──────────────────────────────────────────────────────────────────
 *
 *   1. The reader picks a side and types an amount.
 *   2. This app asks `POST /markets/:id/stake-intent` (`foresight/src/server.ts:483`) for the
 *      contract address, the calldata and a POLICY VERDICT.
 *   3. The wallet is shown the transaction and the user signs it. The stake goes wallet →
 *      contract, and `micro-foresight` is not in the path — `server.ts:474-482`: "This service
 *      could be switched off between this response and the send, and the stake would still work."
 *
 * Nothing in this file, and nothing in the copy it produces, may suggest the platform is holding
 * the stake at any point. It never is.
 *
 * ── Why the gate is computed rather than inferred from a disabled button ──────────────────────
 *
 * There are six separate reasons a stake cannot proceed and they have six different remedies:
 * sign in, connect a wallet, wait for the market to open, the market has closed, fix the amount,
 * or policy said no. A disabled button with no sentence collapses all six into "it does not
 * work". `stakeGate` returns the reason so the UI can print it.
 */
import type { MarketView, StakeIntent } from './foresight.ts'
import { instant } from './format.ts'
import { isStakeAmount, toWei } from './units.ts'

export type StakeBlocker =
  | 'not_open'
  | 'closed'
  | 'no_contract'
  | 'signed_out'
  | 'no_wallet'
  | 'no_amount'
  | 'bad_amount'

export interface StakeGate {
  /** True when every precondition this app can check is met. Policy is checked by the service. */
  readonly ready: boolean
  readonly blocker: StakeBlocker | null
  /** The amount in wei, when it parsed. `null` whenever `blocker` is set for the amount. */
  readonly amountWei: bigint | null
}

/**
 * Can this reader stake, right now, this much?
 *
 * The order of the checks is the order a reader encounters them, so the sentence shown is about
 * the first thing that is actually in their way: a market that has closed is worth saying before
 * the amount is criticised, and being signed out is worth saying before either.
 */
export function stakeGate(opts: {
  readonly market: Pick<MarketView, 'status' | 'closeTime' | 'contractAddress'>
  readonly now: Date
  readonly signedIn: boolean
  readonly hasWallet: boolean
  readonly amount: string
}): StakeGate {
  const { market, now, signedIn, hasWallet, amount } = opts
  const none = { ready: false, amountWei: null } as const

  // `server.ts:498-501` refuses anything that is not `open` with a contract, and 409s it. Saying
  // so here saves a round trip and, more to the point, saves showing a stake form on a market
  // that cannot take one.
  if (market.status !== 'open') return { ...none, blocker: 'not_open' }
  if (!market.contractAddress) return { ...none, blocker: 'no_contract' }

  // `server.ts:502-508`: the contract would refuse it anyway, and "saying so here saves the user a
  // failed transaction and the gas that goes with it".
  const closes = instant(market.closeTime)
  if (closes !== null && closes.getTime() <= now.getTime()) return { ...none, blocker: 'closed' }

  if (!signedIn) return { ...none, blocker: 'signed_out' }
  if (!hasWallet) return { ...none, blocker: 'no_wallet' }

  const trimmed = amount.trim()
  if (trimmed.length === 0) return { ...none, blocker: 'no_amount' }
  // The service's own `DECIMAL`, mirrored in units.ts. A client that is looser sends an amount the
  // service 400s after the user has already committed to the flow.
  if (!isStakeAmount(trimmed)) return { ...none, blocker: 'bad_amount' }

  const amountWei = toWei(trimmed)
  if (amountWei === null || amountWei <= 0n) return { ...none, blocker: 'bad_amount' }

  return { ready: true, blocker: null, amountWei }
}

/** The sentence each blocker renders as, and the remedy it implies. One place, seven screens. */
export function blockerSentence(blocker: StakeBlocker, market: Pick<MarketView, 'status'>): string {
  switch (blocker) {
    case 'not_open':
      return `This market is ${market.status}. Only an open market takes stakes.`
    case 'closed':
      return 'This market has reached its close time. The contract will not accept a stake now.'
    case 'no_contract':
      return 'This market has no contract yet, so there is nowhere for a stake to go.'
    case 'signed_out':
      return 'Sign in to stake. Browsing needs no account; staking is checked against your account by policy.'
    case 'no_wallet':
      return 'Connect a wallet. The stake goes from your wallet straight to the contract — this site never holds it.'
    case 'no_amount':
      return 'Enter an amount to stake.'
    case 'bad_amount':
      return 'An amount is a positive number with at most 18 decimal places.'
  }
}

/* ------------------------------------------------------------------ the flow */

export type StakePhase =
  /** Nothing has been attempted. */
  | 'idle'
  /** Asking the service for the intent, and the policy verdict inside it. */
  | 'requesting'
  /** Policy or the market state refused. Terminal until the reader changes something. */
  | 'refused'
  /** The intent is in hand and the wallet has been asked to sign. */
  | 'awaiting_wallet'
  /** The wallet returned a hash. The stake is on its way to the contract, not to us. */
  | 'submitted'
  /** The reader declined in their wallet. Not an error; the form is simply back where it was. */
  | 'idle_after_rejection'
  /** Something failed. The message says what. */
  | 'failed'

export interface StakeFlow {
  readonly phase: StakePhase
  readonly intent: StakeIntent | null
  readonly txHash: string | null
  readonly message: string | null
  /** The request id of a failed call, which is what support needs quoted. */
  readonly requestId: string | null
}

export const IDLE_STAKE: StakeFlow = {
  phase: 'idle',
  intent: null,
  txHash: null,
  message: null,
  requestId: null,
}

export type StakeEvent =
  | { readonly type: 'request' }
  | { readonly type: 'intent'; readonly intent: StakeIntent }
  | { readonly type: 'refused'; readonly message: string; readonly requestId: string | null }
  | { readonly type: 'sent'; readonly txHash: string }
  | { readonly type: 'rejected' }
  | { readonly type: 'failed'; readonly message: string; readonly requestId: string | null }
  | { readonly type: 'reset' }

/**
 * The flow as a reducer, so the transitions can be tested without a browser or a wallet.
 *
 * The transition worth reading is `intent` → `awaiting_wallet`: receiving an intent does NOT mean
 * the stake happened. It means the service answered with an address and some calldata, and the
 * only thing that can make a stake real is the user's signature. A UI that showed success here
 * would be reporting a stake that may never be sent.
 */
export function stakeReducer(state: StakeFlow, event: StakeEvent): StakeFlow {
  switch (event.type) {
    case 'request':
      return { ...IDLE_STAKE, phase: 'requesting' }
    case 'intent':
      return { ...IDLE_STAKE, phase: 'awaiting_wallet', intent: event.intent }
    case 'refused':
      return { ...IDLE_STAKE, phase: 'refused', message: event.message, requestId: event.requestId }
    case 'sent':
      return { ...state, phase: 'submitted', txHash: event.txHash, message: null }
    case 'rejected':
      // The intent is KEPT. A user who declines and changes their mind should not have to make the
      // service issue a second policy decision for the same stake.
      return { ...state, phase: 'idle_after_rejection', message: null }
    case 'failed':
      return { ...state, phase: 'failed', message: event.message, requestId: event.requestId }
    case 'reset':
      return IDLE_STAKE
  }
}

/**
 * How a stake-intent refusal reads.
 *
 * The three codes are `server.ts:517-528` and they are genuinely different situations:
 *
 *   `policy_unavailable` (503) — the gate is FAIL CLOSED. Policy could not be reached, so no
 *       intent was issued. This is temporary and the honest instruction is "shortly", not a retry
 *       loop that hammers a service that is already struggling.
 *   `policy_denied` (403) — understood and refused, with reasons. Retrying will not help.
 *   `not_open` / `closed` (409) — the market moved under the reader.
 */
export function refusalSentence(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'policy_unavailable':
      return 'Staking is paused because the policy service could not be reached. No intent was issued and nothing was sent. Try again shortly.'
    case 'policy_denied':
      return 'Policy refused this stake.'
    case 'not_open':
      return 'This market is no longer open.'
    case 'closed':
      return 'This market reached its close time while you were staking.'
    default:
      return fallback
  }
}
