/**
 * TWO EVENTS IN ONE TICK.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT CLASS, AND WHY IT IS WORST ON THIS SURFACE
 *
 * A guard written as component state cannot see a second event in the same tick. `flow.phase` and
 * `sending` are read out of the render closure that was current when the listener was attached, and
 * `setX(...)` only SCHEDULES a render — so a handler that runs twice before React commits reads the
 * same stale value both times and passes its own guard twice. `disabled={busy}` has exactly the
 * same hole from the other end: the attribute is not on the DOM node until the render commits, so
 * an event dispatched before that commit reaches a button the browser still considers live.
 *
 * `test/journeys.test.ts`'s BJ-ADV-11-H1 already covers the LATER press — click, `settle(0)`, click
 * — and it passed against both defects below, because a settle between the two presses is exactly
 * the render the state guard needs. The two presses here have nothing between them. That is a real
 * double-click on a real machine, and it is the case that was open.
 *
 * On this bundle the loss is not a duplicate row somebody can delete. `POST /markets/:id/stake-
 * intent` (`foresight/src/server.ts:533`) neither requires nor reads an `Idempotency-Key` —
 * `idempotencyKeyOf` (`server.ts:981`) has ONE call site in the whole service, the admin deploy
 * route at `server.ts:809` — so two presses are two independent policy evaluations. And behind that
 * is `eth_sendTransaction`, which has no server-side gate at all and nothing to undo it with: two
 * presses are two real on-chain stakes of the same amount, or two claim transactions of which the
 * second pays gas to revert. The client latch is the only defence that exists.
 *
 * ── Why every scenario is run twice ────────────────────────────────────────────────────────────
 *
 * `src/main.tsx` renders under `<StrictMode>`; this harness did not. StrictMode double-invokes
 * render and re-runs mount effects, and a latch held in a ref is precisely the kind of thing that
 * can behave differently under it — `micro-hub-web`'s mutation run found "a StrictMode ref never
 * exercised". A guard proven only in a mode the product does not run in is not proven, so
 * `mount({ strict })` exists and every proof below runs both ways.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { withScreen, type Routes, type Screen } from './dom.ts'
import * as fx from './fixtures.ts'
import { AuthProvider } from '../src/lib/auth.tsx'
import { ClaimPanel } from '../src/components/claimpanel.tsx'
import type { MirrorFacts } from '../src/lib/claim.ts'
import { MarketPage } from '../src/pages/market.tsx'

const ORIGIN = 'https://foresight.cloudsforge.online'

const page = (element: ReactElement, path: string): ReactElement =>
  h(MemoryRouter, { initialEntries: [path] }, h(AuthProvider, null, element) as ReactElement)

const marketRoutes = (over: Routes = {}): Routes => ({
  'GET /auth/me': { body: fx.ME },
  [`GET /markets/${fx.MARKET_ID}`]: { body: fx.detail() },
  ...over,
})

const intent = () => ({
  to: fx.CONTRACT,
  data: `0x${'11'.repeat(36)}`,
  chainId: 4242,
  decisionId: 'policy-decision-1',
})

/** The stake amount field: the one text input inside the stake panel. */
function amountField(s: Screen): Element {
  const field = s.document.querySelector('.fs-stake input[type="text"]')
  assert.ok(field, 'the stake panel has no amount field')
  return field
}

const sends = (wallet: fx.FakeWallet): number =>
  wallet.calls.filter((c) => c.method === 'eth_sendTransaction').length

/**
 * A wallet whose send stays pending, so the panel can be inspected WHILE the prompt is up.
 *
 * The call is recorded synchronously — `fakeWallet.request` pushes before its first `await` — and
 * only the answer is held back, which is what a wallet extension showing a confirmation dialog
 * actually does.
 */
function slowWallet(ms: number, opts: { reject?: boolean } = {}): fx.FakeWallet {
  const inner = fx.fakeWallet(opts)
  return {
    calls: inner.calls,
    async request(args) {
      const answer = inner.request(args)
      if (args.method === 'eth_sendTransaction') await new Promise((r) => setTimeout(r, ms))
      return answer
    },
  }
}

/**
 * A settled market whose dispute window closed long ago, so `canAttempt` is true.
 *
 * The date is deliberately far in the past rather than "yesterday": the panel computes against the
 * machine's own clock, and a fixture that is only just old enough is a test that goes red on a
 * badly-set laptop rather than on a defect.
 */
const SETTLED: MirrorFacts = {
  contractAddress: fx.CONTRACT,
  marketStatus: 'settled',
  resolvedAt: '2020-01-01T00:00:00.000Z',
  disputeWindowSeconds: 86_400,
  stale: false,
  stakedYes: null,
  stakedNo: null,
}

for (const strict of [false, true] as const) {
  const mode = strict ? 'under StrictMode, as src/main.tsx renders it' : 'without StrictMode'

  describe(`two events in one tick — ${mode}`, () => {
    it('stake: two presses with no render between them ask for one intent and send one transaction', async () => {
      const wallet = fx.fakeWallet()
      await withScreen(
        page(h(MarketPage), `/markets/${fx.MARKET_ID}`),
        {
          url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
          storage: fx.SIGNED_IN,
          routes: marketRoutes({
            [`POST /markets/${fx.MARKET_ID}/stake-intent`]: {
              status: 201,
              body: intent(),
              delayMs: 10,
            },
          }),
          windowExtras: { ethereum: wallet },
          strict,
        },
        async (s) => {
          await s.settle(20)
          await s.type(amountField(s), '1.5')
          const button = s.byRole('button', /stake on yes/i)

          // NOTHING between the two. No settle, no await, no render — the second event is
          // delivered inside the same tick as the first, which is what a double-click on a
          // trackpad is.
          s.clickNoFlush(button)
          s.clickNoFlush(button)
          await s.settle(60)

          // The transaction is asserted FIRST because it is the irreversible half. A duplicate
          // intent is a duplicate policy row; a duplicate transaction is somebody's money.
          assert.equal(
            sends(wallet),
            1,
            'one double-click handed the wallet TWO stake transactions. There is no server-side ' +
              'gate behind eth_sendTransaction and nothing to undo it with: the staker pays twice ' +
              'and gets no refund path.',
          )
          assert.equal(
            s.api.matching(`POST /markets/${fx.MARKET_ID}/stake-intent`).length,
            1,
            'one double-click produced two policy evaluations for one intent. The route reads no ' +
              'Idempotency-Key (foresight/src/server.ts:533), so the service cannot tell them apart.',
          )
        },
      )
    })

    it('claim: two presses with no render between them send one claim transaction', async () => {
      const wallet = fx.fakeWallet()
      await withScreen(
        h(ClaimPanel, { mirror: SETTLED, address: fx.STAKER }),
        {
          url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
          routes: {},
          windowExtras: { ethereum: wallet },
          strict,
        },
        async (s) => {
          await s.settle(20)
          const button = s.byRole('button', /^claim$/i)

          s.clickNoFlush(button)
          s.clickNoFlush(button)
          await s.settle(60)

          assert.equal(
            sends(wallet),
            1,
            'one double-click sent TWO claim transactions. The contract pays each address once, ' +
              'so the second is gas spent to buy a revert.',
          )
        },
      )
    })

    /* ── the visible affordance, which the latch does not replace ─────────────────────────── */

    it('claim: the control goes dead while its own transaction is at the wallet, and stays dead after', async () => {
      const wallet = slowWallet(40)
      await withScreen(
        h(ClaimPanel, { mirror: SETTLED, address: fx.STAKER }),
        { url: `${ORIGIN}/markets/${fx.MARKET_ID}`, routes: {}, windowExtras: { ethereum: wallet }, strict },
        async (s) => {
          await s.settle(20)
          s.clickNoFlush(s.byRole('button', /^claim$/i))
          await s.settle(5)
          assert.ok(
            s.byRole('button', /waiting for your wallet/i).hasAttribute('disabled'),
            'the claim control stayed live while its own transaction was at the wallet. The ref ' +
              'latch would still refuse the second send, but a live-looking button that does ' +
              'nothing is how a user concludes the first press did not register.',
          )
          await s.settle(80)
          assert.ok(
            s.byRole('button', /claim sent/i).hasAttribute('disabled'),
            'the claim control re-armed after the transaction was sent',
          )
          assert.equal(sends(wallet), 1)
        },
      )
    })

    /* ── and the release, which is the other half of the latch ────────────────────────────── */

    it('stake: declining in the wallet releases the latch, so the same amount can be sent again', async () => {
      // The rejection path returns from inside the `try`. A latch released at the END of the try
      // rather than in a `finally` is never released here, and the panel is dead for the rest of
      // the session: the user declined once and can never stake on this market again without a
      // reload. That is a worse failure than the double-send, because it is silent.
      const wallet = fx.fakeWallet({ reject: true })
      await withScreen(
        page(h(MarketPage), `/markets/${fx.MARKET_ID}`),
        {
          url: `${ORIGIN}/markets/${fx.MARKET_ID}`,
          storage: fx.SIGNED_IN,
          routes: marketRoutes({
            [`POST /markets/${fx.MARKET_ID}/stake-intent`]: { status: 201, body: intent() },
          }),
          windowExtras: { ethereum: wallet },
          strict,
        },
        async (s) => {
          await s.settle(20)
          await s.type(amountField(s), '1.5')
          await s.click(s.byRole('button', /stake on yes/i))
          await s.settle(30)
          assert.match(s.text(), /you declined in your wallet/i, 'the decline was not rendered')

          await s.click(s.byRole('button', /stake on yes/i))
          await s.settle(30)
          assert.equal(
            s.api.matching(`POST /markets/${fx.MARKET_ID}/stake-intent`).length,
            2,
            'the second attempt never left the browser — the latch was taken and not released on ' +
              'the decline path',
          )
          assert.equal(sends(wallet), 2, 'the wallet was never asked a second time')
        },
      )
    })

    it('claim: a declined claim releases the latch, so it can be attempted again', async () => {
      const wallet = fx.fakeWallet({ reject: true })
      await withScreen(
        h(ClaimPanel, { mirror: SETTLED, address: fx.STAKER }),
        { url: `${ORIGIN}/markets/${fx.MARKET_ID}`, routes: {}, windowExtras: { ethereum: wallet }, strict },
        async (s) => {
          await s.settle(20)
          await s.click(s.byRole('button', /^claim$/i))
          await s.settle(20)
          await s.click(s.byRole('button', /^claim$/i))
          await s.settle(20)
          assert.equal(
            sends(wallet),
            2,
            'a user who declined once could never claim again — the latch was taken and not ' +
              'released on the decline path. The money is theirs and the page will not ask for it.',
          )
        },
      )
    })
  })
}
