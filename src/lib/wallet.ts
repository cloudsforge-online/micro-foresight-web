/**
 * The wallet hand-off. Everything this app knows about a browser wallet lives here.
 *
 * ── The platform does not custody a stake, and this file is where that is true ─────────────────
 *
 * `micro-foresight` has no key and holds no stake. `POST /markets/:id/stake-intent` answers with a
 * contract address, `stake(uint8)` calldata and a policy verdict, and then stops — "not one wei
 * passes through here" (`foresight/src/server.ts:474`). The user's wallet builds, signs and sends.
 * So the UI's job at this seam is to be *transparent*: show the address the money is going to,
 * show the amount, and hand both to the wallet unchanged. There is no step in which this app is
 * holding anything, and no copy anywhere in it may imply otherwise.
 *
 * ── Why the transaction builder is a pure function ─────────────────────────────────────────────
 *
 * `buildStakeTransaction` and `buildClaimTransaction` take data and return an object. They touch
 * no provider, so `test/wallet.test.ts` asserts the exact `to`, `data`, `value` and `from` that
 * would have been signed — which is the assertion that matters. A test that stubs a provider and
 * checks the promise resolves proves the plumbing and not the payload, and the payload is the part
 * that moves money to an address.
 */
import { claimCalldata } from './abi.ts'
import { toQuantity } from './units.ts'
import type { StakeIntent } from './foresight.ts'

/** EIP-1193, narrowed to the four methods this app calls. */
export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>
  on?(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}

export class WalletError extends Error {
  /** EIP-1193 error codes. 4001 is "user rejected", which is not a failure and is not reported. */
  readonly code: number | undefined
  constructor(message: string, code?: number) {
    super(message)
    this.name = 'WalletError'
    this.code = code
  }
}

/** EIP-1193 §5: the user rejected the request. A decision, not an error to report or retry. */
export const USER_REJECTED = 4001

/** True when this failure was the user saying no. */
export function isUserRejection(err: unknown): boolean {
  return err instanceof WalletError && err.code === USER_REJECTED
}

/**
 * The injected provider, or `null`.
 *
 * `null` is a first-class answer, not an error: a reader with no wallet can still browse every
 * market, read every source and see every pool. They cannot stake, and the page says so at the
 * point where staking would have happened rather than by refusing to render.
 */
export function getProvider(): Eip1193Provider | null {
  if (typeof window === 'undefined') return null
  const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum
  return injected && typeof injected.request === 'function' ? injected : null
}

/** A transaction as `eth_sendTransaction` takes it — every field `0x`-prefixed hex or an address. */
export interface TransactionRequest {
  readonly from: string
  readonly to: string
  readonly data: string
  /** Wei, as a minimal hex quantity. Present even when zero, so the field is never ambiguous. */
  readonly value: string
}

/**
 * The stake transaction, from the service's intent and the amount in wei.
 *
 * ── The service deliberately does not compute `value`, and this is why ─────────────────────────
 *
 * `server.ts:530-533`: "The wallet sets `value` to the amount in wei; the service deliberately
 * does not compute that, because the wallet is what knows the user's balance and what will
 * actually be sent." So the conversion from the decimal string the user typed to wei happens
 * here, in `units.toWei`, and this function refuses rather than guesses if the two disagree.
 *
 * `to` and `data` are taken from the intent VERBATIM. Rebuilding the calldata locally would be a
 * second opinion about which outcome the user picked, and the two opinions would be indexed by
 * the same policy decision id.
 */
export function buildStakeTransaction(opts: {
  readonly intent: StakeIntent
  readonly amountWei: bigint
  readonly from: string
}): TransactionRequest {
  const { intent, amountWei, from } = opts
  if (amountWei <= 0n) throw new WalletError('a stake must be more than zero')
  if (!intent.to) throw new WalletError('the intent carries no contract address')
  if (!intent.data.startsWith('0x')) throw new WalletError('the intent carries no calldata')
  return { from, to: intent.to, data: intent.data, value: toQuantity(amountWei) }
}

/**
 * The claim transaction. No arguments, no value: the contract pays `msg.sender`.
 *
 * Built from `abi.claimCalldata()` rather than from anything the service said, because there is
 * nothing the service says — and because a claim that depended on a service response would undo
 * `ForesightMarket.sol:436-441`.
 */
export function buildClaimTransaction(opts: {
  readonly contractAddress: string
  readonly from: string
}): TransactionRequest {
  if (!opts.contractAddress) throw new WalletError('this market has no contract to claim from')
  return { from: opts.from, to: opts.contractAddress, data: claimCalldata(), value: '0x0' }
}

/* ------------------------------------------------------------------ the provider calls */

/** Normalise whatever a wallet threw into a `WalletError` with its code, if it had one. */
function walletError(err: unknown, fallback: string): WalletError {
  if (err instanceof WalletError) return err
  const shaped = err as { code?: unknown; message?: unknown }
  const code = typeof shaped?.code === 'number' ? shaped.code : undefined
  const message = typeof shaped?.message === 'string' && shaped.message ? shaped.message : fallback
  return new WalletError(message, code)
}

/** Ask for accounts. Opens the wallet's own prompt; the user may say no, and that is not an error. */
export async function requestAccounts(provider: Eip1193Provider): Promise<readonly string[]> {
  try {
    const result = await provider.request({ method: 'eth_requestAccounts' })
    return Array.isArray(result) ? result.filter((a): a is string => typeof a === 'string') : []
  } catch (err) {
    throw walletError(err, 'the wallet did not return an account')
  }
}

/** The accounts already granted, without prompting. Empty is the normal answer for a cold page. */
export async function currentAccounts(provider: Eip1193Provider): Promise<readonly string[]> {
  try {
    const result = await provider.request({ method: 'eth_accounts' })
    return Array.isArray(result) ? result.filter((a): a is string => typeof a === 'string') : []
  } catch {
    // A wallet that will not answer `eth_accounts` is a wallet this page treats as absent. It is
    // not worth a failure state: nothing has been attempted yet.
    return []
  }
}

/** Send a transaction. Returns the hash the chain will know it by. */
export async function sendTransaction(
  provider: Eip1193Provider,
  tx: TransactionRequest,
): Promise<string> {
  try {
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [tx] })
    if (typeof hash !== 'string' || !hash.startsWith('0x')) {
      throw new WalletError('the wallet did not return a transaction hash')
    }
    return hash
  } catch (err) {
    throw walletError(err, 'the transaction was not sent')
  }
}

/**
 * A read straight off the chain, through the user's own provider.
 *
 * This is the degradation path that makes the claim page honest. When the mirror is stale or down
 * the service's numbers are old, but the contract is not — and the user already has a connection
 * to a node in the form of their wallet. `eth_call` costs nothing and asks nobody's permission.
 *
 * Returns `null` on any failure, and `null` means "could not confirm". It must never become `0n`:
 * a node that is syncing, a wallet on the wrong chain, and a contract that genuinely owes nothing
 * all answer differently, and only the last of them is a zero.
 */
export async function ethCall(
  provider: Eip1193Provider,
  to: string,
  data: string,
): Promise<string | null> {
  try {
    const result = await provider.request({ method: 'eth_call', params: [{ to, data }, 'latest'] })
    return typeof result === 'string' && result.startsWith('0x') ? result : null
  } catch {
    return null
  }
}
