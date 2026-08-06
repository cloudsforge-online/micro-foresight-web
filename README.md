# micro-foresight-web

[![ci](https://github.com/cloudsforge-online/micro-foresight-web/actions/workflows/ci.yml/badge.svg)](https://github.com/cloudsforge-online/micro-foresight-web/actions/workflows/ci.yml)
![licence](https://img.shields.io/badge/licence-MIT-97CA00)
![node](https://img.shields.io/badge/node-%3E%3D22-5FA04E?logo=node.js&logoColor=white)
![typescript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![module](https://img.shields.io/badge/module-ESM-F7DF1E?logo=javascript&logoColor=black)
![tests](https://img.shields.io/badge/tests-in--process%20DOM-6E56CF)

The public frontend for **Forge Foresight** — the prediction market native to Hearth. Browse
markets, read why each one exists and what will settle it, stake from your own wallet, watch a
portfolio of positions, and claim from the contract.

Design authority: [`docs/ecosystem/19-new-products.md` §2](../docs/ecosystem/19-new-products.md).
Upstream: [`micro-foresight`](../foresight) — 153 tests, and the source of every route this app
calls.

---

## 1. The one thing to understand

**This site never holds a stake, and nothing in it may imply otherwise.**

`micro-foresight` has no key and holds no money. `POST /markets/:id/stake-intent` answers with a
contract address, `stake(uint8)` calldata and a policy verdict, and then stops — `server.ts`:
*"not one wei passes through here… This service could be switched off between this response and the
send, and the stake would still work."* The user's wallet builds, signs and sends the transaction
straight to the market's contract.

The same is true in the other direction. `ForesightMarket.sol`:

> **THIS FUNCTION IS WHY THE MIRROR IS ALLOWED TO DIE.** It reads nothing but this contract's own
> storage. If every server this platform owns is switched off, a winner with a wallet and a block
> explorer can still be paid, and nobody has to ask anybody's permission.

So this bundle builds `claim()` calldata itself (`src/lib/abi.ts`, from a keccak in
`src/lib/keccak.ts`) and reads the contract through the reader's own wallet with `eth_call`. A
frontend that could only reach `claim` by asking the service for the calldata would have quietly
rewritten that promise into *"…and nobody has to ask anybody's permission, except us."*

---

## 2. The routes it calls, and the line each was verified against

`foresight/src/server.ts` lines 353–800 are the complete route table; `buildRoutes()` is the only
place a route is declared. **There is no `/v1` prefix on anything in this service.**

| Call | Route | Verified at | Auth |
| --- | --- | --- | --- |
| `listMarkets` | `GET /markets?status=&limit=` | `server.ts` | none |
| `getMarket` | `GET /markets/:id` | `server.ts` | none |
| `getPosition` | `GET /markets/:id/positions/:address` | `server.ts` | none |
| `createStakeIntent` | `POST /markets/:id/stake-intent` | `server.ts` | bearer |
| `getCategories` | `GET /categories` | `server.ts` | none |

Supporting citations used by the client: `parseStatus` `server.ts`, `parseLimit`
`server.ts`, `requireDecimal` `server.ts`, the refusal codes `server.ts`,
`publicView` `markets.ts`, `PoolView` `mirror.ts`, `Idea` `ideas.ts`,
`CategorySpec` `categories.ts`.

`test/foresight.test.ts` asserts the **request** — path, method, query and body — for every one of
them. That is deliberate, and it is the gap that let two defects ship in this estate: `micro-wallet`
called `/v1/quotes` at a service serving `/rates`, and `micro-market` called
`/v1/decisions/market.listing` at a policy service with no `/v1` routes at all, which 403'd every
listing. Both suites were green, because a stub answers whatever it is told to answer no matter what
path it was asked for.

---

## 3. Pages

| Address | What it is |
| --- | --- |
| `/` | Every market, filtered by the statuses the route actually accepts |
| `/markets/<id>` | One market: criteria, resolution source, close time, dispute window, **the idea's cited sources**, the pool ratio, stake, claim |
| `/portfolio` · `/portfolio/<address>` | One address's positions, each stamped with its own observation time |
| `/rules` | The category allowlist and the published refusals |

Unknown addresses answer **404** and render the app shell inside it — `error_page 404 /index.html`,
never `try_files $uri /index.html`. See the header of `nginx.conf`.

### The market page is ordered like a contract

Question → criteria → the source named *at open* → close time → dispute window → fee → **why this
market exists** → the pool → the stake form. Putting the stake button above the terms would be a
signature line above a contract.

The **question hash is recomputed in your browser** from the canonical bytes the page was served
(`src/lib/market.ts`). `server.ts` puts the document on the wire precisely so a reader need
not take the platform's word that the criteria have not been edited since the market opened — and a
page that merely prints the hash the server sent, beside the document the server sent, has verified
nothing.

---

## 4. Odds

**Odds are the pool ratio.** Not a price, not a probability the platform asserts, and **never a
return.** `ForesightMarket.sol` says so and this UI repeats it beside every figure.

The arithmetic in `src/lib/pool.ts` reproduces the contract's three money operations in the same
order and the same integer division:

```
fee           = losingPool * feeBps / 10_000      ForesightMarket.sol
distributable = total - fee                       ForesightMarket.sol
payout        = backed * distributable / winPool  ForesightMarket.sol
```

Order is load-bearing: `backed * (distributable / winPool)` floors twice and loses a wei per staker
per operation. `test/pool.test.ts` proves the conservation property over six pools — **fee + every
payout + residue == the pool, exactly**, with the residue strictly below the number of winners.

The **fee comes off the losing pool only**, which is why a winner always gets back at least their
stake, and why refunds on a void are whole.

The stake form's projection **adds the stake to the pool it would be paid from** before dividing.
The naive figure (`amount × total ÷ side`) overstates every projection and overstates a large stake
into a thin pool enormously — which is exactly the case where somebody is relying on the number.

### The chart

A two-class part-to-whole, so it is a horizontal stacked bar and not a pie or a gauge. Colours are
`--cf-viz-2` (teal) and `--cf-viz-3` (gold) — adjacent slots of the design system's validated
categorical ramp, taken in order, never invented. Re-validated against this app's ground (`#12100f`):
worst-adjacent ΔE **13.7 protan / 19.8 tritan / 17.3 normal**, both above 3:1 contrast.

They are *categorical* rather than status colours on purpose: Yes and No are identities, and
green-for-yes would say the platform thinks one outcome is the good one. Four channels carry the
split — hue, a direct label on each mark, a text key with the pool sizes, and a 45° hatch on **No**
that survives `forced-colors` and a monochrome print.

---

## 5. Rules this bundle keeps

1. **Every figure carries its observation time.** The pools and positions are a *mirror* of chain
   state fed by `micro-indexer`. A number with no `asOf` is a claim about now that is really a claim
   about whenever the mirror last synced. `src/lib/format.ts`, `src/lib/market.ts`.
2. **Never invent a number.** Missing data is missing, not zero. `null` never becomes `0`, anywhere:
   an unreadable pool renders as *"not known"*, an `eth_call` that answered `0x` decodes to `null`,
   and a position row that failed shows no figure at all.
3. **Degradation, not blank pages.** One market's position failing costs one row, not the page
   (`src/lib/portfolio.ts`); a mirror that is behind is *named* rather than hidden; a claim whose
   amount cannot be confirmed says so **and keeps the button live**.
4. **No build-time configuration.** Hosts resolve at runtime through `cloudsforgeHosts()`. There is
   no `.env`, no `define`, no `envPrefix`, and a test that fails if any of them appear.
5. **Honest 404** — `error_page 404 /index.html`, never `try_files $uri /index.html`.
6. **Money is bigint end to end.** No float goes near an amount; CI greps for `parseFloat` and
   `toFixed`.
7. **Accessible.** Real contrast on `#12100f`, keyboard navigable, never colour alone for a
   win/loss or market state, `prefers-reduced-motion` respected, wide tables scroll inside their own
   container so the page body never scrolls sideways.

---

## 6. Two defects found in `micro-ui`, reported not fixed

`micro-ui` is single-owner. Both are pinned by `test/registry.test.ts`, which **fails the day either
is corrected**, so this repository's workarounds delete themselves rather than outliving their
reason.

1. **`tokens.css` reads `[data-product='foresight']`** — missing the `cf-` prefix that all
   twelve other product selectors in that file carry, and that `tokens.css` documents as *the*
   attribute. The rule carrying Foresight's accent (`#1e89c7`) therefore matches nothing and the
   page falls back to the company ember. (`tokens.css` already documents this exact failure
   happening once before, with `data-cf-product="admin"`.)
   *Workaround here:* `index.html` carries both spellings. No brand value is copied into this repo.

2. **`surfaces.ts` gives `foresight` `devPort: 4011`** — which is also `beacon`'s, and which is not
   the port the service listens on (`micro-foresight/.env.example` — `PORT=4021`). So
   `cloudsforgeHosts().foresight` resolves a local stack to Beacon, and every request under
   `pnpm dev` would go to the wrong service.
   *Workaround here:* `src/lib/hosts.ts` overrides the **port only**, on a **local host only**. The
   subdomain is correct and comes from the registry untouched, so production and previews resolve
   normally.

Nothing was found wrong in `micro-foresight` itself. Two things about its shape are worth recording
for whoever extends it:

- **There is no route for one address's positions across markets**, so a portfolio is an N+1:
  `/markets` once, then `/markets/:id/positions/:address` per market. `src/lib/portfolio.ts` bounds
  it to six in flight and degrades per market.
- **There is no claim intent.** `stake-intent` is the only intent the service mints, which is
  consistent with the mirror being allowed to die — and is why this bundle carries a keccak and an
  ABI encoder.

---

## 7. Development

```sh
pnpm install          # the sibling ../ui must be installed first: pnpm --dir ../ui install
pnpm dev              # http://localhost:5182
pnpm typecheck
pnpm test             # node:test, no DOM
pnpm build
```

`micro-foresight` is expected on `http://localhost:4021` under `pnpm dev`.

### Docker

```sh
docker build -t foresight-web --build-context uipkg=../ui .
docker run --rm -p 55480:8080 foresight-web
```

The image is `nginx-unprivileged`: no Node, no toolchain, no source, no secret, no environment. It
is built once and the same tag is promoted, because the hosts it talks to are resolved in the
browser from the address the page was served on.

### Testing

`node:test` only — no Vitest, no React Testing Library, no jsdom. jsdom is a second browser
implementation to keep current and it disagrees with real ones exactly where it matters; a test that
renders a component in it proves the component renders in jsdom. What is tested is the layer that
decides things: request shapes, bigint arithmetic, the claim and stake state machines, degradation
branches, `asOf` formatting, and the three descriptions of this app's routes checked against each
other.

| Suite | What it holds |
| --- | --- |
| `foresight.test.ts` | the outgoing **request** for every route, and that none of them is versioned |
| `pool.test.ts` | parimutuel arithmetic, and conservation over six pools |
| `units.test.ts` | the stake-amount regex against the service's own, in both directions |
| `abi.test.ts` | selectors, calldata cross-checked against `foresight/src/evm.ts`, EIP-55 |
| `keccak.test.ts` | published vectors, and the permutation against Node's SHA3-256 |
| `claim.test.ts` | the claim state machine, chain-answered and chain-silent |
| `stake.test.ts` | the gate, its refusal ORDER, and the flow reducer |
| `portfolio.test.ts` | concurrency, per-row failure isolation, the oldest-observation stamp |
| `market.test.ts` | the question-hash check against a tampered document |
| `routes.test.ts` | `routes.ts` ↔ `app.tsx` ↔ `nginx.conf` |
| `hosts.test.ts` | runtime host resolution in every environment |
| `registry.test.ts` | the two `micro-ui` defects, pinned to self-delete |
| `format.test.ts` | UTC stamps, ages, durations |
| `wallet.test.ts` | exactly what would have been signed |
| `no-build-time-config.test.ts` | that no `VITE_`, `import.meta.env` or `.env` exists |

---

## Provenance

The code in this repository was written by **Claude Opus 5** and **Claude Fable 5**, assets
generated with **FLUX 2 Pro**, under human direction and review.
