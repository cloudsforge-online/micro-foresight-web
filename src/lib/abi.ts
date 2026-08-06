/**
 * The smallest ABI codec that lets this page talk to `ForesightMarket` directly.
 *
 * ── Why a frontend encodes calldata at all ─────────────────────────────────────────────────────
 *
 * Because of the sentence in `foresight/src/contracts/ForesightMarket.sol`, which is the
 * load-bearing claim of the whole product:
 *
 *   > **THIS FUNCTION IS WHY THE MIRROR IS ALLOWED TO DIE.** It reads nothing but this contract's
 *   > own storage. If every server this platform owns is switched off, a winner with a wallet and
 *   > a block explorer can still be paid, and nobody has to ask anybody's permission.
 *
 * A frontend that can only reach `claim` by asking `micro-foresight` for the calldata has quietly
 * converted that promise into "…and nobody has to ask anybody's permission, except us". So this
 * app derives the calldata itself, and reads the numbers it shows beside the claim button from
 * the contract as well as from the mirror. When the two disagree, `claim.ts` believes the chain.
 *
 * It is also simply what the route table forces. `foresight/src/server.ts` is every route
 * the service has, and the only intent it mints is `POST /markets/:id/stake-intent`
 * (`server.ts`). There is no claim intent, and there is no read that proxies an `eth_call`.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Static head-only encoding: `address`, `uint8`, `uint256`. No dynamic types, no tuples, no
 * arrays, because this contract's surface needs none of them and a codec that handles cases
 * nobody calls is a codec whose untested branches are the ones a bug hides in.
 *
 * Every quantity is a `bigint`. Nothing here converts through `Number`: a `uint256` is routinely
 * past 2^53, and the digits that get rounded away are the least significant ones — which on a
 * payout is the difference between "you are owed 1.000000000000000001 EMBER" and a claim that
 * reverts because the number never existed.
 */
import { keccak256, toHex } from './keccak.ts'

/** 20 bytes of hex, with the `0x`. Case is not checked here; `isAddress` does EIP-55 separately. */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

export class AbiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AbiError'
  }
}

/**
 * The four-byte selector of a function signature.
 *
 * Derived, never memorised. `selector('claim()')` is `0x4e71d92d`, and the reason that is written
 * in a test rather than in this file is that a constant in the source is something a reader has
 * to trust, whereas a constant in a test beside the signature that produces it is something the
 * build checks on every run.
 */
export function selector(signature: string): string {
  return `0x${toHex(keccak256(new TextEncoder().encode(signature))).slice(0, 8)}`
}

/** A `uint256`/`uint8` word: 32 bytes, big-endian, unpadded hex. */
export function encodeUint(value: bigint): string {
  if (value < 0n) throw new AbiError('an unsigned word cannot be negative')
  if (value >= 1n << 256n) throw new AbiError('value does not fit in a 256-bit word')
  return value.toString(16).padStart(64, '0')
}

/** An `address` word: the 20 bytes, left-padded to 32. */
export function encodeAddress(address: string): string {
  if (!ADDRESS.test(address)) throw new AbiError(`not a 20-byte address: ${address}`)
  return address.slice(2).toLowerCase().padStart(64, '0')
}

export type AbiArg = { readonly type: 'uint256' | 'uint8'; readonly value: bigint } | { readonly type: 'address'; readonly value: string }

/**
 * Calldata for a call with only static arguments.
 *
 * The signature is passed whole rather than assembled from a name and a type list, so the string
 * that is hashed is the string a reader compares against the Solidity — the one place a selector
 * bug can hide is a signature that was rebuilt slightly differently from the one in the contract.
 */
export function encodeCall(signature: string, args: readonly AbiArg[] = []): string {
  const head = args
    .map((arg) => (arg.type === 'address' ? encodeAddress(arg.value) : encodeUint(arg.value)))
    .join('')
  return `${selector(signature)}${head}`
}

/**
 * Read the nth 32-byte word of a return value as an unsigned integer.
 *
 * Returns `null` rather than throwing for a short or malformed result. An `eth_call` against a
 * node that is syncing, an address that holds no code, or a chain the wallet has since switched
 * away from all answer `0x` — and `0x` decoded as `0n` is the exact failure this whole app is
 * written against: a confident zero where the truth is "not known". `null` reaches the UI as an
 * absent figure; `0n` would reach it as a balance.
 */
export function decodeUintAt(data: string, index = 0): bigint | null {
  if (typeof data !== 'string' || !data.startsWith('0x')) return null
  const body = data.slice(2)
  const start = index * 64
  if (body.length < start + 64) return null
  const word = body.slice(start, start + 64)
  if (!/^[0-9a-fA-F]{64}$/.test(word)) return null
  return BigInt(`0x${word}`)
}

/** A `bool` return: word 0, `1` for true. Null when the word is not there. */
export function decodeBoolAt(data: string, index = 0): boolean | null {
  const word = decodeUintAt(data, index)
  return word === null ? null : word !== 0n
}

/* ------------------------------------------------------------------ ForesightMarket */

/**
 * The calls this app makes, each beside the line of the contract it was read from.
 *
 * `foresight/src/contracts/ForesightMarket.sol`. The signatures are the whole of the coupling
 * between this bundle and that contract, so they are declared once, here, and every one of them
 * is a line somebody can go and check.
 */
export const MARKET_ABI = {
  /** `function claim() external` — sol:431. The only transaction this app ever asks a wallet for. */
  claim: 'claim()',
  /** `function payoutOf(address) public view returns (uint256)` — sol:405. */
  payoutOf: 'payoutOf(address)',
  /** `function stakeOf(address) external view returns (uint256 yes, uint256 no)` — sol:352. */
  stakeOf: 'stakeOf(address)',
  /** `mapping(address => bool) public claimed` — sol:129, so the getter is `claimed(address)`. */
  claimed: 'claimed(address)',
  /** `function claimableFrom() public view returns (uint64)` — sol:393. Unix seconds; 0 while open. */
  claimableFrom: 'claimableFrom()',
  /** `Status public status` — sol:114. The enum is Open=0, Resolved=1, Void=2 (sol:49-53). */
  status: 'status()',
  /** `uint256[2] public pool` — sol:120, so the getter takes the index. */
  pool: 'pool(uint256)',
  /** `uint8 public winningOutcome` — sol:117. Meaningless unless `status` is Resolved. */
  winningOutcome: 'winningOutcome()',
  /** `function feeAmount() public view returns (uint256)` — sol:381. Off the LOSING pool only. */
  feeAmount: 'feeAmount()',
} as const

/** `enum Status { Open, Resolved, Void }` — `ForesightMarket.sol`. */
export const CONTRACT_STATUS = { open: 0n, resolved: 1n, void: 2n } as const

/** `uint8 public constant OUTCOME_YES = 0` / `OUTCOME_NO = 1` — sol:59-60. */
export const OUTCOME_YES = 0
export const OUTCOME_NO = 1

/** Calldata for `claim()`. No arguments: the contract pays `msg.sender` and nobody else. */
export function claimCalldata(): string {
  return encodeCall(MARKET_ABI.claim)
}

/** Calldata for `payoutOf(staker)`. */
export function payoutOfCalldata(staker: string): string {
  return encodeCall(MARKET_ABI.payoutOf, [{ type: 'address', value: staker }])
}

/** Calldata for `stakeOf(staker)`. Two words back: yes at 0, no at 1. */
export function stakeOfCalldata(staker: string): string {
  return encodeCall(MARKET_ABI.stakeOf, [{ type: 'address', value: staker }])
}

/** Calldata for `claimed(staker)`. */
export function claimedCalldata(staker: string): string {
  return encodeCall(MARKET_ABI.claimed, [{ type: 'address', value: staker }])
}

/** Calldata for `pool(outcome)`. */
export function poolCalldata(outcome: number): string {
  if (outcome !== OUTCOME_YES && outcome !== OUTCOME_NO) {
    throw new AbiError(`outcome must be ${OUTCOME_YES} or ${OUTCOME_NO}`)
  }
  return encodeCall(MARKET_ABI.pool, [{ type: 'uint256', value: BigInt(outcome) }])
}

/**
 * EIP-55: is this a well-formed address, and if it carries case, is the checksum right?
 *
 * An EVM address has no checksum of its own — the only typo protection that exists is the mixed
 * case. An all-lower or all-upper address carries no checksum to check and is accepted, which is
 * what the service does too (`foresight/src/server.ts` tests `EVM_ADDRESS` and nothing
 * more). A MIXED-case address that fails the checksum is rejected here, because at that point the
 * user has pasted something that claims to be checksummed and is not.
 */
export function isAddress(value: string): boolean {
  if (!ADDRESS.test(value)) return false
  const body = value.slice(2)
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true
  return checksumAddress(`0x${body.toLowerCase()}`) === value
}

/** The EIP-55 mixed-case form of a lower-case address. */
export function checksumAddress(address: string): string {
  if (!ADDRESS.test(address)) throw new AbiError(`not a 20-byte address: ${address}`)
  const body = address.slice(2).toLowerCase()
  const digest = toHex(keccak256(new TextEncoder().encode(body)))
  let out = '0x'
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i] ?? ''
    // A digit has no case, so the nibble that decides it is only consulted for a letter.
    out += /[0-9]/.test(char) ? char : parseInt(digest[i] ?? '0', 16) >= 8 ? char.toUpperCase() : char
  }
  return out
}
