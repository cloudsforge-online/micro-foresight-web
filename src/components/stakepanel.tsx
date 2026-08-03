/**
 * The stake panel. Where the platform hands the transaction to the user and steps out of it.
 *
 * ── What this component must never imply ───────────────────────────────────────────────────────
 *
 * That the stake is being sent to, held by, or refundable from CloudsForge. It is not. The service
 * answers with an address and some calldata and then has no further part in it
 * (`foresight/src/server.ts:474-482`). So the panel names the contract, shows the amount, and says
 * in as many words where the money goes.
 *
 * ── And what it must never present ─────────────────────────────────────────────────────────────
 *
 * A guaranteed return. The projection below is computed with the stake already added to the pool
 * it would be paid from — `pool.projectedPayoutForNewStake` — which is the honest arithmetic, and
 * it is still only true if nobody stakes after you. The sentence saying so is not optional
 * decoration; it is the difference between a projection and a quote.
 */
import { useMemo, useReducer, useRef, useState } from 'react'
import { ApiError } from '../lib/api.ts'
import { OUTCOME_NO, OUTCOME_YES } from '../lib/abi.ts'
import { createStakeIntent, type MarketView } from '../lib/foresight.ts'
import { utcDateTime } from '../lib/format.ts'
import { projectedMultipleBps, projectedPayoutForNewStake, type Outcome, type Pools } from '../lib/pool.ts'
import {
  blockerSentence,
  IDLE_STAKE,
  refusalSentence,
  stakeGate,
  stakeReducer,
  type StakeFlow,
  type StakePhase,
} from '../lib/stake.ts'
import { formatBps, formatEmber, shortHex } from '../lib/units.ts'
import {
  buildStakeTransaction,
  getProvider,
  isUserRejection,
  requestAccounts,
  sendTransaction,
} from '../lib/wallet.ts'
import { useSession } from '../lib/auth.tsx'
import { amount } from './pool.tsx'

export function StakePanel({
  market,
  pools,
  poolIsKnown,
  onStaked,
}: {
  market: MarketView
  pools: Pools
  /** False when the mirror could not be read. The projection is suppressed rather than guessed. */
  poolIsKnown: boolean
  onStaked: () => void
}) {
  const { status, signIn } = useSession()
  const [outcome, setOutcome] = useState<Outcome>(OUTCOME_YES)
  const [input, setInput] = useState('')
  const [flow, dispatch] = useReducer(stakeReducer, IDLE_STAKE)

  /**
   * The latch. A ref, not state, and that distinction is the whole of this guard.
   *
   * `flow.phase` and the button's `disabled` are both read out of a render that has not happened
   * yet at the moment a second click arrives. `dispatch({ type: 'request' })` SCHEDULES a render;
   * it does not change `flow` in the closure the listener is holding, and the `disabled` attribute
   * is not on the DOM node until the render commits. So two clicks delivered in ONE tick — a
   * double-click on a trackpad — both read `phase === 'idle'` off a live-looking button and both
   * run the body below to completion. That is two `createStakeIntent` calls against a route that
   * reads no Idempotency-Key (`foresight/src/server.ts:533`; `idempotencyKeyOf` at `server.ts:981`
   * has one call site, the admin deploy route at `server.ts:809`), and then TWO
   * `eth_sendTransaction` calls: two real stakes, of the same money, with no server-side gate
   * behind them and nothing to undo them with.
   *
   * A ref is mutated synchronously, so it is already true when the second event arrives. It is
   * taken before the first `await` and released in a `finally` — an early `return` inside the try
   * must release it too, or a refused intent would leave the panel permanently unable to retry.
   *
   * The state and the `disabled` attribute stay exactly as they were: they are the visible
   * affordance, and this is the correctness guarantee. Neither substitutes for the other.
   */
  const inFlight = useRef(false)

  const provider = useMemo(() => getProvider(), [])
  const now = useMemo(() => new Date(), [])
  const gate = stakeGate({
    market,
    now,
    signedIn: status === 'signedIn',
    hasWallet: provider !== null,
    amount: input,
  })

  const projection =
    gate.amountWei !== null && poolIsKnown
      ? projectedPayoutForNewStake({
          pools,
          amount: gate.amountWei,
          outcome,
          feeBps: market.feeBps,
        })
      : null
  const multiple = projectedMultipleBps(projection, gate.amountWei ?? 0n)

  async function submit(): Promise<void> {
    if (inFlight.current) return
    if (!gate.ready || gate.amountWei === null || provider === null) return
    inFlight.current = true
    dispatch({ type: 'request' })
    try {
      // The service is asked for the intent EVERY time, never cached: the policy verdict inside it
      // is evaluated per request against limits and velocity that move.
      const intent = await createStakeIntent(market.id, { amount: input.trim(), outcome })
      dispatch({ type: 'intent', intent })

      const [from] = await requestAccounts(provider)
      if (!from) {
        dispatch({ type: 'failed', message: 'The wallet returned no account.', requestId: null })
        return
      }
      const tx = buildStakeTransaction({ intent, amountWei: gate.amountWei, from })
      const hash = await sendTransaction(provider, tx)
      dispatch({ type: 'sent', txHash: hash })
      onStaked()
    } catch (err) {
      if (isUserRejection(err)) {
        dispatch({ type: 'rejected' })
        return
      }
      if (err instanceof ApiError) {
        const sentence = refusalSentence(err.code, err.message)
        const reasons =
          err.code === 'policy_denied' && err.message ? ` ${err.message}` : ''
        dispatch({
          // 4xx and 503 from the intent route are refusals, not faults in this bundle.
          type: err.status >= 400 && err.status < 600 ? 'refused' : 'failed',
          message: `${sentence}${reasons}`,
          requestId: err.requestId ?? null,
        })
        return
      }
      dispatch({
        type: 'failed',
        message: err instanceof Error ? err.message : 'The stake could not be sent.',
        requestId: null,
      })
    } finally {
      // `finally`, not the end of the try: every branch above returns early, and a latch released
      // on only the happy path is a panel that refuses the retry it just told the user to make.
      inFlight.current = false
    }
  }

  return (
    <section className="fs-panel fs-stake" aria-labelledby="stake-heading">
      <h2 className="fs-panel__title" id="stake-heading">
        Stake
      </h2>

      <p className="fs-stake__where">
        Your wallet sends EMBER straight to this market's contract. <strong>This site never holds
        it</strong>, cannot move it, and cannot refund it — the contract pays the winners, and it
        pays them whether or not this site is running.
      </p>

      <fieldset className="fs-sides" disabled={!isEditable(flow.phase)}>
        <legend className="fs-sides__legend">Which way</legend>
        {([OUTCOME_YES, OUTCOME_NO] as const).map((side) => (
          <label key={side} className={`fs-side fs-side--${side === OUTCOME_YES ? 'yes' : 'no'}${outcome === side ? ' is-picked' : ''}`}>
            <input
              type="radio"
              name="outcome"
              value={side}
              checked={outcome === side}
              onChange={() => setOutcome(side)}
            />
            <span className="fs-side__label">{side === OUTCOME_YES ? 'Yes' : 'No'}</span>
          </label>
        ))}
      </fieldset>

      <label className="fs-field">
        <span className="fs-field__label">Amount</span>
        <span className="fs-field__row">
          <input
            className="fs-field__input cf-num"
            type="text"
            inputMode="decimal"
            value={input}
            disabled={!isEditable(flow.phase)}
            onChange={(event) => setInput(event.target.value)}
            placeholder="0.0"
            aria-describedby="stake-help"
            // A decimal string, never a number input: `<input type="number">` hands back a float,
            // and a float near an 18-decimal amount is how the bottom of it disappears.
          />
          <span className="fs-field__unit">EMBER</span>
        </span>
        <span className="fs-field__help" id="stake-help">
          A positive amount with at most 18 decimal places — the same rule the service applies
          (server.ts:187), checked here so a refusal happens before your wallet opens.
        </span>
      </label>

      {gate.blocker !== null && input.trim().length > 0 && gate.blocker === 'bad_amount' && (
        <p className="fs-note fs-note--warn" role="alert">
          {blockerSentence(gate.blocker, market)}
        </p>
      )}

      {/* The projection. Suppressed entirely when the pool is unknown — a projection from a pool
          that could not be read is a number from nowhere. */}
      {gate.amountWei !== null && (
        <div className="fs-projection">
          {projection === null ? (
            <p className="fs-note">
              {poolIsKnown
                ? 'Nothing is staked on that side yet, so there is no ratio to project from. Your stake would be the first.'
                : 'The pool could not be read, so there is nothing to project a payout from. You can still stake; the contract decides the payout either way.'}
            </p>
          ) : (
            <>
              <p className="fs-projection__figure cf-num">
                {formatEmber(projection)} <span className="fs-unit">EMBER</span>
                {multiple === null ? null : (
                  <span className="fs-projection__multiple"> · {formatBps(multiple)} of your stake</span>
                )}
              </p>
              <p className="fs-projection__caveat">
                What this stake would come back as <em>if the market settled on this pool</em> — your
                stake included, since it joins the pool it is paid from. It is not a quote. Anybody
                may stake after you, and the pool at settlement is the one that pays.
              </p>
            </>
          )}
        </div>
      )}

      {gate.blocker !== null && gate.blocker !== 'bad_amount' && gate.blocker !== 'no_amount' && (
        <p className="fs-note fs-note--warn" role="status">
          {blockerSentence(gate.blocker, market)}
          {gate.blocker === 'signed_out' && (
            <>
              {' '}
              <button type="button" className="cf-btn" onClick={() => signIn()}>
                Sign in
              </button>
            </>
          )}
        </p>
      )}

      <button
        type="button"
        className="cf-btn cf-btn--ember fs-stake__go"
        // `!isEditable(flow.phase)` rather than the two in-flight phases spelled out, because
        // `submitted` belongs in the same set and was missing from it. The fields are frozen once
        // a transaction has gone to the wallet — `isEditable` excludes `submitted` — but the
        // COMMIT stayed live, so the panel sat in a state where the amount could not be changed
        // and the button would happily send that same amount again. On this surface a second
        // press is a second on-chain transaction with no server-side gate behind it and nothing
        // to undo it with. One list, one rule; found by BJ-ADV-11-H2 of
        // docs/ecosystem/22-browser-journeys.md.
        disabled={!gate.ready || !isEditable(flow.phase)}
        onClick={() => void submit()}
      >
        {flow.phase === 'requesting'
          ? 'Checking with policy…'
          : flow.phase === 'awaiting_wallet'
            ? 'Waiting for your wallet…'
            : `Stake on ${outcome === OUTCOME_YES ? 'Yes' : 'No'}`}
      </button>

      <StakeOutcome flow={flow} market={market} />
    </section>
  )
}

/** The form is frozen while a request or a wallet prompt is in flight, and after it succeeded. */
function isEditable(phase: StakePhase): boolean {
  return phase !== 'requesting' && phase !== 'awaiting_wallet' && phase !== 'submitted'
}

function StakeOutcome({ flow, market }: { flow: StakeFlow; market: MarketView }) {
  if (flow.phase === 'refused') {
    return (
      <p className="fs-note fs-note--warn" role="alert">
        <span className="fs-note__icon" aria-hidden="true">
          ⊘
        </span>
        {flow.message}
        {flow.requestId && (
          <>
            {' '}
            <span className="fs-note__meta">
              Quote this to support: <code className="cf-num">{flow.requestId}</code>
            </span>
          </>
        )}
      </p>
    )
  }

  if (flow.phase === 'failed') {
    return (
      <p className="fs-note fs-note--fail" role="alert">
        <span className="fs-note__icon" aria-hidden="true">
          ■
        </span>
        {flow.message}
        {flow.requestId && (
          <>
            {' '}
            <span className="fs-note__meta">
              Quote this to support: <code className="cf-num">{flow.requestId}</code>
            </span>
          </>
        )}
      </p>
    )
  }

  if (flow.phase === 'idle_after_rejection') {
    return (
      <p className="fs-note" role="status">
        You declined in your wallet. Nothing was sent, and the policy check above still stands if
        you want to try again.
      </p>
    )
  }

  if (flow.phase === 'awaiting_wallet' && flow.intent) {
    return (
      <dl className="fs-handoff">
        <div>
          <dt>Going to</dt>
          <dd className="cf-num" title={flow.intent.to}>
            {shortHex(flow.intent.to)}
          </dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd className="cf-num">{flow.intent.amount} EMBER</dd>
        </div>
        <div>
          <dt>Closes</dt>
          <dd className="cf-num">{utcDateTime(flow.intent.closeTime)}</dd>
        </div>
        <div>
          <dt>Policy</dt>
          <dd>
            {flow.intent.policy.decision}
            {flow.intent.policy.decisionId && (
              <span className="cf-num"> · {shortHex(flow.intent.policy.decisionId, 8, 4)}</span>
            )}
          </dd>
        </div>
      </dl>
    )
  }

  if (flow.phase === 'submitted' && flow.txHash) {
    return (
      <p className="fs-note fs-note--ok" role="status">
        <span className="fs-note__icon" aria-hidden="true">
          ◆
        </span>
        Sent to the contract. Transaction <code className="cf-num">{shortHex(flow.txHash)}</code>.
        The pool figures on this page come from a mirror of the chain and will not move until it
        catches up — your stake is in the contract regardless.
        {market.contractAddress && (
          <>
            {' '}
            <span className="fs-note__meta">
              Contract <code className="cf-num">{shortHex(market.contractAddress)}</code>
            </span>
          </>
        )}
      </p>
    )
  }

  return null
}

/** Re-exported so the market page can show the same figure format. */
export { amount }
