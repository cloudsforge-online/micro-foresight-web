/**
 * This surface's slice of `docs/ecosystem/22-browser-journeys.md`, as data.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE CATALOGUE IS DATA AND NOT JUST A LIST OF `it(...)` TITLES
 *
 * Doc 22 §3.2 makes the layer boundary mechanical rather than advisory: every scenario declares
 * one `asserts` kind, and any scenario whose outcome depends on a SERVER-SIDE rule must carry
 * `ownedBy` — "a path, resolvable by grep, in the service that enforces the rule". A meta-test
 * reads these and fails the suite when one is missing.
 *
 * The second reason is doc 22 §8: a scenario that exists and cannot run is a gap somebody can
 * close, and an absent scenario is a gap nobody can see.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */

export type Asserts = 'presentation' | 'client-request' | 'navigation'
export type Tier = 'T1' | 'T2' | 'T3'

export interface Scenario {
  readonly id: string
  readonly what: string
  readonly asserts: Asserts
  readonly tier: Tier
  readonly gate?: boolean
  readonly ownedBy?: { readonly path: string; readonly grep: string }
  readonly blocked?: string
}

export const SCENARIOS: readonly Scenario[] = [
  /* ── 6.10 Group J — Forge Foresight, the player surface ───────────────────────────────────── */
  {
    id: 'BJ-FOR-01',
    what: 'the page order is the argument: question, criteria, source, close and dispute window, why it exists — and only then the pool and the stake form',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-FOR-02',
    what: 'the house-seed disclosure is inside the pool panel, above the ratio bar and therefore above the stake form, as running text at body size',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-FOR-03',
    what: 'the seed sentence is rendered verbatim from disclosure.sentence; the client composes no wording of its own',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-FOR-04',
    what: 'a seed that fails its symmetry check renders as an alert, in the same shape as a document-hash mismatch',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-FOR-05',
    what: 'an explicit null disclosure renders nothing — the one case where silence is correct',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-FOR-06',
    what: 'the share-of-pool and symmetry figures are re-derived in the browser from the pool numbers rather than repeated off the wire',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-FOR-07',
    what: 'query, sources, model id, prompt hash and timestamp are on the market page',
    asserts: 'presentation',
    tier: 'T2',
    gate: true,
  },
  {
    id: 'BJ-FOR-08',
    what: 'the stake panel names the contract and says the stake is not sent to, held by, or refundable from CloudsForge',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-FOR-09',
    what: 'the projection carries the sentence saying it is only true if nobody stakes after you',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-FOR-10',
    what: 'the transaction handed to the wallet carries the contract, the outcome and the amount shown on screen — byte-identical',
    asserts: 'client-request',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-FOR-11',
    // Worded away from "rejection" on purpose: the meta-test below treats a refusal as a
    // server-side act needing an `ownedBy`, and it is right to — but this one is the USER saying
    // no in their own wallet, which no service has an opinion about and no test can own.
    what: 'the user declining in their own wallet is rendered as a decline, not as a failure',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-FOR-12',
    what: 'with no injected provider the panel says so and offers no button that cannot work',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-FOR-13',
    what: 'the markets filter set is exactly statuses the service knows — a filter it did not know would be a 400 rendered at a reader who cannot act on it',
    asserts: 'presentation',
    tier: 'T2',
    ownedBy: { path: 'foresight/src/server.ts', grep: 'MARKET_STATUSES' },
  },
  {
    id: 'BJ-FOR-14',
    what: 'portfolio by address renders with no account, every figure carries the instant it was observed, the page carries the oldest, and a row that did not load says so',
    asserts: 'presentation',
    tier: 'T2',
    gate: true,
  },
  {
    id: 'BJ-FOR-15',
    what: 'the mirror caveat is on every row, not once at the top',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-FOR-16',
    what: 'the claim panel on a resolved market offers the claim against the contract and states that a dead mirror does not stop a claim',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-FOR-17',
    // Doc 22's row calls this "the refusal list". Worded away from "refusal" here because the
    // meta-test treats a refusal as a server-side act needing an `ownedBy`, and this is not one:
    // it is a published document, and the whole point is that anybody can read it.
    what: 'the published list of what the platform will not run renders with no token attached',
    asserts: 'presentation',
    tier: 'T2',
    gate: true,
  },
  {
    id: 'BJ-FOR-18',
    what: '/markets on its own and /markets/a/b both render the not-found screen',
    asserts: 'navigation',
    tier: 'T2',
  },
  {
    id: 'BJ-FOR-19',
    what: 'a settlement document hash mismatch renders as an alert, in the same shape as the seed symmetry failure',
    asserts: 'presentation',
    tier: 'T1',
  },

  /* ── 6.19 Group S — the adversarial matrix. BJ-ADV-11 is this repo's stake panel. ─────────── */
  {
    id: 'BJ-ADV-11-H1',
    what: 'stake, double-submit: one intent request and one transaction',
    asserts: 'client-request',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-ADV-11-H2',
    what: 'stake, back after the wallet has been handed the transaction: the form does not re-arm a second send',
    asserts: 'navigation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-ADV-11-H4',
    what: 'the intent request fails after the form moved: the panel states the failure with its request id and the amount is still there',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-ADV-11-H6',
    what: 'against a degraded service the commit control is disabled with the reason rather than left clickable',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-ADV-22',
    what: 'degraded not down: the page paints inside its deadline with the slow panel marked pending',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-ADV-23',
    what: 'every failure state renders the request id to quote to support',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },

  /* ── 6.20 Group T — accessibility ─────────────────────────────────────────────────────────── */
  {
    id: 'BJ-A11Y-01',
    what: 'axe on every route of this surface: zero serious or critical violations',
    asserts: 'presentation',
    tier: 'T2',
    gate: true,
    blocked:
      'axe-core is not installed anywhere in the estate, and doc 22 §1 records that as true of ' +
      'all fifteen bundles. Doc 22 §7.2 makes the axe sweep estate-wide by construction ("Any PR ' +
      'in ui — every surface’s T1 axe set"), so it belongs to the shared design system rather ' +
      'than to one repository. BJ-A11Y-06, -09, -10 and -12 need no engine and are run.',
  },
  {
    id: 'BJ-A11Y-03',
    what: 'a degraded panel is still announced, and a failure is not colour-only',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-A11Y-06',
    what: 'keyboard-only: outcome, amount and the commit are all operable, and the house-seed disclosure precedes the form in TAB ORDER, not only visually',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-A11Y-09',
    what: 'the house-seed panel is role="status" normally and role="alert" when symmetry fails',
    asserts: 'presentation',
    tier: 'T1',
    gate: true,
  },
  {
    id: 'BJ-A11Y-10',
    what: 'colour is never the only channel: every state chip and tone badge carries a glyph or a word as well',
    asserts: 'presentation',
    tier: 'T1',
  },
  {
    id: 'BJ-A11Y-12',
    what: 'one main landmark, a reachable skip link, and a heading order with no level skipped',
    asserts: 'presentation',
    tier: 'T1',
  },

  /* ── 5.1 the universal per-surface property ───────────────────────────────────────────────── */
  {
    id: 'BJ-FORESIGHT-404',
    what: 'an address this surface does not own renders the not-found screen UNDER a 404',
    asserts: 'navigation',
    tier: 'T2',
  },
]

/**
 * Every id doc 22 assigns to this surface.
 *
 * §6.10 in full, §6.19's `BJ-ADV-11` row expanded over the four hazards it declares (H1 H2 H4 H6),
 * §6.19's two page-level rows, the Group T rows naming a property this surface has, and §5.1.
 *
 * Doc 22 §5 keys this surface `foresight`, so the 404 row is `BJ-FORESIGHT-404`.
 */
export const DOC22_IDS: readonly string[] = [
  'BJ-FOR-01',
  'BJ-FOR-02',
  'BJ-FOR-03',
  'BJ-FOR-04',
  'BJ-FOR-05',
  'BJ-FOR-06',
  'BJ-FOR-07',
  'BJ-FOR-08',
  'BJ-FOR-09',
  'BJ-FOR-10',
  'BJ-FOR-11',
  'BJ-FOR-12',
  'BJ-FOR-13',
  'BJ-FOR-14',
  'BJ-FOR-15',
  'BJ-FOR-16',
  'BJ-FOR-17',
  'BJ-FOR-18',
  'BJ-FOR-19',
  'BJ-ADV-11-H1',
  'BJ-ADV-11-H2',
  'BJ-ADV-11-H4',
  'BJ-ADV-11-H6',
  'BJ-ADV-22',
  'BJ-ADV-23',
  'BJ-A11Y-01',
  'BJ-A11Y-03',
  'BJ-A11Y-06',
  'BJ-A11Y-09',
  'BJ-A11Y-10',
  'BJ-A11Y-12',
  'BJ-FORESIGHT-404',
]
