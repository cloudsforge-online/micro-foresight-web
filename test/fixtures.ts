/**
 * The responses the scenarios are run against.
 *
 * Every shape is one `src/lib/foresight.ts` declares, which was read out of `foresight/src/`. The
 * canonical document and its hash are built the way `foresight/src/questiondoc.ts:66-80` builds
 * them, so `checkDocument` sees a market whose hash really does match — a fixture with an
 * arbitrary hash would put the mismatch alert on every page and the scenarios would be asserting
 * the fixture rather than the product.
 */
import type {
  HouseSeedView,
  MarketDetail,
  MarketView,
  PoolView,
  Provenance,
} from '../src/lib/foresight.ts'
import { keccak256Utf8 } from '../src/lib/keccak.ts'

export const ONE_EMBER = 1_000_000_000_000_000_000n
export const HOUSE = '0x00112233445566778899aabbccddeeff00112233'
export const CONTRACT = '0x44556677889900aabbccddeeff00112233445566'
export const STAKER = '0x1111111111111111111111111111111111111111'
export const MARKET_ID = 'm-1'

const QUESTION = 'Will block 21,000,000 be reached by 2026-12-31?'
const CRITERIA = 'YES if the chain reports a block at height 21,000,000 or above.'

/** `canonicalDocument` — `foresight/src/questiondoc.ts:66-80`. */
function canonical(fields: readonly string[]): string {
  const field = (value: string): string => `${new TextEncoder().encode(value).length}:${value}`
  return ['cloudsforge.foresight.market/1', ...fields].map(field).join('')
}

export const DOC = canonical([
  QUESTION,
  CRITERIA,
  'protocol_network',
  '1',
  'chain_rpc',
  'https://rpc.hearth.example/',
  '1798761600',
  '86400',
  '500',
])

export function market(over: Partial<MarketView> = {}): MarketView {
  return {
    id: MARKET_ID,
    status: 'open',
    question: QUESTION,
    resolutionCriteria: CRITERIA,
    category: 'protocol_network',
    categoryVersion: 1,
    resolutionSourceKind: 'chain_rpc',
    resolutionSourceRef: 'https://rpc.hearth.example/',
    questionHash: keccak256Utf8(DOC),
    closeTime: '2099-09-01T00:00:00.000Z',
    disputeWindowSeconds: 86_400,
    feeBps: 500,
    chain: 'hearth',
    network: 'testnet',
    contractAddress: CONTRACT,
    outcome: null,
    voidReason: null,
    openedAt: '2026-08-01T00:00:00.000Z',
    closedAt: null,
    resolvedAt: null,
    settledAt: null,
    voidedAt: null,
    // No image by default. `image.test.ts` overrides it; every other suite proves the page is
    // unchanged without one, which is the state most markets are in.
    image: null,
    ...over,
  }
}

export function pool(over: Partial<PoolView> = {}): PoolView {
  return {
    yes: (5n * ONE_EMBER).toString(),
    no: (5n * ONE_EMBER).toString(),
    total: (10n * ONE_EMBER).toString(),
    yesBps: 5_000,
    noBps: 5_000,
    stakerCount: 4,
    asOf: '2026-08-02T00:00:00.000Z',
    lastBlock: 900,
    tipBlock: 901,
    behindBlocks: 1,
    stale: false,
    ...over,
  }
}

/** `houseSeedView` — `foresight/src/houseseed.ts:230-243`, field for field. */
export function seed(over: Partial<HouseSeedView> = {}): HouseSeedView {
  return {
    state: 'staked',
    houseAddress: HOUSE,
    amountPerOutcomeWei: ONE_EMBER.toString(),
    totalWei: (2n * ONE_EMBER).toString(),
    asset: 'EMBER',
    stakedAt: '2026-08-01T00:00:00.000Z',
    txHashYes: `0x${'aa'.repeat(32)}`,
    txHashNo: `0x${'bb'.repeat(32)}`,
    disclosure: 'CloudsForge seeded this pool with 2 EMBER so early odds exist.',
    ...over,
  }
}

export function provenance(over: Partial<Provenance> = {}): Provenance {
  return {
    origin: 'model',
    searchQuery: 'hearth block height milestone',
    sources: [
      {
        url: 'https://explorer.hearth.example/blocks',
        title: 'Hearth block explorer',
        retrievedAt: '2026-07-30T12:00:00.000Z',
      },
    ],
    modelId: 'claude-opus-4-6',
    promptSha256: `0x${'cd'.repeat(32)}`,
    proposedAt: '2026-07-30T12:05:00.000Z',
    ...over,
  }
}

export function detail(over: Partial<MarketDetail> = {}): MarketDetail {
  return {
    market: market(),
    pool: pool(),
    houseSeed: seed(),
    document: { canonical: DOC, hash: keccak256Utf8(DOC) },
    provenance: provenance(),
    ...over,
  }
}

/** The estate's error envelope — nested, as `errorReply()` builds it in every service. */
export function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } }
}

/** The two `cf.*` keys a signed-in browser holds. `src/lib/api.ts` reads exactly these. */
export const SIGNED_IN = {
  'cf.accessToken': 'access-token-stub',
  'cf.refreshToken': 'refresh-token-stub',
}

/** `GET /auth/me` as `identity/src/server.ts:895-902` returns it: the profile is nested. */
export const ME = {
  user: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', handle: 'staker', roles: ['customer'] },
  session: { id: 'session-1' },
  organisations: [],
}

/* ── a stand-in EIP-1193 wallet ─────────────────────────────────────────────────────────────── */

export interface FakeWallet {
  /** Every `request` the page made, in order: `{ method, params }`. */
  readonly calls: { method: string; params: unknown[] }[]
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

/**
 * A provider that records what the page handed it.
 *
 * This is the whole of BJ-FOR-10: the transaction the browser gives the wallet is the last thing
 * this application controls, and after `eth_sendTransaction` returns there is nothing anybody can
 * do about what was sent. So it is recorded verbatim and compared with what was on screen.
 */
export function fakeWallet(
  opts: { accounts?: readonly string[]; reject?: boolean; txHash?: string } = {},
): FakeWallet {
  const calls: { method: string; params: unknown[] }[] = []
  return {
    calls,
    async request(args) {
      calls.push({ method: args.method, params: args.params ?? [] })
      if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') {
        return opts.accounts ?? [STAKER]
      }
      if (args.method === 'eth_sendTransaction') {
        if (opts.reject) {
          // The shape MetaMask actually throws on a user rejection: EIP-1193 code 4001.
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        }
        return opts.txHash ?? `0x${'ee'.repeat(32)}`
      }
      if (args.method === 'eth_call') return '0x'
      return null
    },
  }
}
