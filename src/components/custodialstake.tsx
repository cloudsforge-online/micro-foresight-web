/**
 * Staking with money the reader already had — BTC, ETH, or whatever the platform has turned on.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **THIS PANEL AND `StakePanel` ARE TWO PRODUCTS THAT LOOK ALIKE AND FAIL OPPOSITELY.**
 *
 * `25-wallet-clients.md` §1 argues that the most dangerous thing this estate can do is let a
 * reader confuse the custodial wallet with the self-custody one, and this is that problem in its
 * purest form: two stake buttons on one page.
 *
 *   * A **wallet stake** is the reader's, in the contract. It can be claimed with a wallet and a
 *     block explorer even if every server CloudsForge owns is switched off.
 *   * A **custodial stake** is a ledger entry. The pool share goes on chain from the platform's
 *     own published address and the reader's share of it is recorded. It cannot be claimed
 *     without the platform.
 *
 * So the difference is stated in the platform's own words — `disclosure`, composed once by the
 * service — and this panel is visually and textually separate rather than a second tab on the
 * first. It never sums the two, never puts them adjacent without labels, and never shares a colour
 * with the wallet path.
 *
 * ── AND THE CONVERSION IS SHOWN BEFORE, NEVER AFTER ───────────────────────────────────────────
 *
 * The pool is EMBER because the pool is one integer in the contract's own storage. So a BTC stake
 * is converted, at a quoted rate, at the moment it is taken. The quote line, the rate line and the
 * service's sentence are all shown BEFORE the button is live — a conversion a reader learns about
 * afterwards is a conversion they did not agree to.
 *
 * **What a winner is paid in is EMBER, and this panel says so rather than implying otherwise.**
 * There is no BTC figure anywhere after the quote, because there is no exchange rate the platform
 * has undertaken to hold between now and settlement.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../lib/api.ts'
import {
  createCustodialStake,
  getStakeAssets,
  getStakeBalances,
  requestStakeQuote,
  type MarketView,
} from '../lib/foresight.ts'
import {
  conversionLine,
  fromSmallestUnits,
  isAmountFor,
  parseStakeAssets,
  parseStakeBalances,
  rateLine,
  stakeRefusalSentence,
  toSmallestUnits,
  type StakeAssetView,
  type StakeAssetsView,
  type StakeBalancesView,
  type StakeQuoteView,
} from '../lib/stakeassets.ts'
import { hosts } from '../lib/hosts.ts'
import { useSession } from '../lib/auth.tsx'

type Phase = 'idle' | 'quoting' | 'quoted' | 'staking' | 'staked' | 'failed'

/** The service's shape, read defensively — an unreadable field is absent, never a default. */
function parseQuote(body: unknown): StakeQuoteView | null {
  if (typeof body !== 'object' || body === null) return null
  const row = body as Record<string, unknown>
  const text = (key: string): string | null =>
    typeof row[key] === 'string' && (row[key] as string).length > 0 ? (row[key] as string) : null
  const stakeAsset = text('stakeAsset')
  const poolAsset = text('poolAsset')
  const stakeAmount = text('stakeAmount')
  const poolAmount = text('poolAmount')
  const stakeRateUsdScaled = text('stakeRateUsdScaled')
  const poolRateUsdScaled = text('poolRateUsdScaled')
  const disclosure = text('disclosure')
  if (
    stakeAsset === null ||
    poolAsset === null ||
    stakeAmount === null ||
    poolAmount === null ||
    // BOTH legs. A quote that carried only one is a number the reader cannot check, and rendering
    // it anyway would be the platform showing arithmetic it declined to show the inputs for.
    stakeRateUsdScaled === null ||
    poolRateUsdScaled === null ||
    disclosure === null
  ) {
    return null
  }
  return {
    stakeAsset,
    stakeAssetName: text('stakeAssetName') ?? stakeAsset,
    stakeDecimals: typeof row['stakeDecimals'] === 'number' ? row['stakeDecimals'] : 0,
    stakeAmount,
    stakeAmountFormatted: text('stakeAmountFormatted') ?? stakeAmount,
    poolAsset,
    poolAmount,
    poolAmountFormatted: text('poolAmountFormatted') ?? poolAmount,
    stakeRateUsdScaled,
    poolRateUsdScaled,
    disclosure,
  }
}

export function CustodialStakePanel({
  market,
  onStaked,
}: {
  market: MarketView
  onStaked: () => void
}) {
  const { status } = useSession()
  const signedIn = status === 'signedIn'
  const [registry, setRegistry] = useState<StakeAssetsView | null>(null)
  const [assetCode, setAssetCode] = useState<string>('')
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [quote, setQuote] = useState<StakeQuoteView | null>(null)
  const [outcome, setOutcome] = useState<0 | 1>(0)
  const [message, setMessage] = useState<string | null>(null)
  const [balances, setBalances] = useState<StakeBalancesView | null>(null)
  /** Bumped after a stake: the money has moved, so the figure on screen is stale. */
  const [reloadBalances, setReloadBalances] = useState(0)

  /**
   * The key is minted ONCE per attempt and reused for every retry of that attempt.
   *
   * A key regenerated per request would look identical and protect nothing — the failure it exists
   * for is a retry after a lost response, which is the one that takes a stranger's money twice.
   * It is cleared only when the stake succeeds or the reader changes what they are staking.
   */
  const idempotencyKey = useRef<string>('')

  useEffect(() => {
    let live = true
    void getStakeAssets()
      .then((body) => {
        if (!live) return
        const parsed = parseStakeAssets(body)
        setRegistry(parsed)
        const first = parsed?.assets.find((asset) => asset.enabled)
        if (first) setAssetCode(first.assetCode)
      })
      .catch(() => {
        // A registry this app cannot read is a panel that does not appear. It is NOT a panel with
        // a guessed list of assets in it.
        if (live) setRegistry(null)
      })
    return () => {
      live = false
    }
  }, [])

  /**
   * What the reader can actually spend, asked for only once they are signed in.
   *
   * Separate from the registry on purpose. The registry is public and decides whether this panel
   * exists at all; the balances are this reader's and decide nothing — a balance that could not be
   * read leaves the form working on a typed amount. Merging the two calls would have made a
   * signed-out visitor's missing balance look like a missing registry and take the panel away.
   */
  useEffect(() => {
    if (!signedIn) {
      setBalances(null)
      return
    }
    let live = true
    void getStakeBalances()
      .then((body) => {
        if (live) setBalances(parseStakeBalances(body))
      })
      .catch(() => {
        // No figure rather than a wrong one. The panel says so in words below.
        if (live) setBalances(null)
      })
    return () => {
      live = false
    }
  }, [signedIn, reloadBalances])

  const asset: StakeAssetView | null = useMemo(
    () => registry?.assets.find((a) => a.assetCode === assetCode) ?? null,
    [registry, assetCode],
  )

  /** This reader's spendable amount of the selected asset, in smallest units. */
  const held = useMemo(() => {
    const row = balances?.assets.find((a) => a.assetCode === assetCode)
    return row?.available ?? null
  }, [balances, assetCode])

  const smallestUnits = useMemo(
    () => (asset === null ? null : toSmallestUnits(input, asset.decimals)),
    [asset, input],
  )
  const amountOk = asset !== null && isAmountFor(input, asset.decimals) && smallestUnits !== null
  /**
   * More than they hold, checked here so they find out before the quote rather than after it.
   *
   * Only ever true against a balance we actually read: an unknown balance blocks nothing. The
   * service refuses an overdraft regardless — this is the sentence, not the enforcement.
   */
  const overdrawn =
    held !== null && smallestUnits !== null && amountOk && smallestUnits > BigInt(held)
  /** Every readable balance is zero — an account with nothing in it, which is its own sentence. */
  const holdsNothing =
    balances !== null &&
    !balances.degraded &&
    balances.assets.every((a) => a.available === null || a.available === '0')

  if (registry === null || !registry.custodialStakingAvailable) return null
  const enabled = registry.assets.filter((a) => a.enabled)
  const blocked = registry.assets.filter((a) => !a.enabled)
  if (enabled.length === 0) return null

  const reset = (): void => {
    setPhase('idle')
    setQuote(null)
    setMessage(null)
    idempotencyKey.current = ''
  }

  const onQuote = async (): Promise<void> => {
    if (!amountOk || smallestUnits === null || asset === null) return
    setPhase('quoting')
    setMessage(null)
    try {
      const body = await requestStakeQuote(market.id, {
        asset: asset.assetCode,
        amount: smallestUnits.toString(),
      })
      const parsed = parseQuote(body)
      if (!parsed) {
        setPhase('failed')
        setMessage('The quote could not be read, so nothing was staked.')
        return
      }
      setQuote(parsed)
      setPhase('quoted')
      // A new quote is a new attempt, so it gets a new key.
      idempotencyKey.current = `${market.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    } catch (err) {
      setPhase('failed')
      setMessage(
        stakeRefusalSentence(
          err instanceof ApiError ? err.code : undefined,
          err instanceof ApiError ? err.message : undefined,
          'The quote could not be obtained.',
        ),
      )
    }
  }

  const onStake = async (): Promise<void> => {
    if (quote === null || asset === null || smallestUnits === null) return
    setPhase('staking')
    setMessage(null)
    try {
      await createCustodialStake(
        market.id,
        { asset: asset.assetCode, amount: smallestUnits.toString(), outcome },
        idempotencyKey.current,
      )
      setPhase('staked')
      idempotencyKey.current = ''
      setReloadBalances((n) => n + 1)
      onStaked()
    } catch (err) {
      setPhase('failed')
      setMessage(
        stakeRefusalSentence(
          err instanceof ApiError ? err.code : undefined,
          err instanceof ApiError ? err.message : undefined,
          'The stake was not taken.',
        ),
      )
    }
  }

  return (
    <section className="fs-panel fs-panel--custodial" aria-labelledby="custodial-stake-heading">
      <p className="fs-panel__eyebrow">Your CloudsForge balance</p>
      <h2 className="fs-panel__title" id="custodial-stake-heading">
        Take a side with money you already hold here
      </h2>
      <p className="fs-panel__lede">
        No wallet, no extension. Pick a coin, and we show you what it turns into before anything
        moves. Everything after that — your position, the odds, anything you collect — is counted in{' '}
        {registry.poolAsset}.
      </p>

      {/* The platform's own sentence about what a custodial stake is and is not. Composed by the
          service so every client shows the same one — never rewritten here, and never behind a
          click: it is the difference between this panel and the one below it. */}
      <p className="fs-note fs-note--warn">{registry.disclosure}</p>

      {!signedIn ? (
        <p className="fs-note">
          Sign in and whatever you have deposited with CloudsForge can be staked from right here.
        </p>
      ) : (
        <>
          {/*
            THE SIGNATURE OF THIS PANEL: the reader's own coins, as the thing they choose from.

            A `<select>` of asset names asked somebody to remember what they had deposited before
            they could bet with it. These are the same rows with the balance on them, so choosing
            what to pay with and seeing whether you can are one glance rather than two screens.
            An amount we could not read prints as an em dash and the row still selects — an
            unreadable balance is not a reason to refuse a stake somebody typed.
          */}
          <ul className="fs-holdings" aria-label="What you hold">
            {enabled.map((option) => {
              const row = balances?.assets.find((a) => a.assetCode === option.assetCode)
              const amount =
                row?.available == null ? null : fromSmallestUnits(row.available, option.decimals)
              const on = option.assetCode === assetCode
              return (
                <li key={option.assetCode}>
                  <button
                    type="button"
                    className={`fs-holding${on ? ' fs-holding--on' : ''}`}
                    aria-pressed={on}
                    onClick={() => {
                      setAssetCode(option.assetCode)
                      reset()
                    }}
                  >
                    <span className="fs-holding__code">{option.displayName}</span>
                    <span className="fs-holding__amount cf-num">{amount ?? '—'}</span>
                  </button>
                </li>
              )
            })}
          </ul>

          {balances === null || balances.degraded ? (
            <p className="fs-note" role="status">
              We could not read your balances just now, so no figure is shown against a coin. Typing
              an amount still works — what you hold is checked when the stake is taken.
            </p>
          ) : holdsNothing ? (
            <p className="fs-note" role="status">
              There is nothing in your account to stake yet.{' '}
              {/* `hosts().wallet` and not an `account.` address: that row is a service that serves
                  no HTML (`@cloudsforge/ui` surfaces.ts says so in as many words), and the wallet
                  row already carries the `/wallet` base path. */}
              <a href={hosts().wallet}>Deposit a coin</a> and it will appear here.
            </p>
          ) : null}

          <label className="fs-field">
            <span className="fs-field__label">Amount</span>
            <span className="fs-field__row">
              <input
                className="fs-field__input cf-num"
                // `inputMode` rather than `type="number"`: a number input hands back a float, and
                // a float near an 8- or 18-decimal amount is how the bottom of it disappears.
                inputMode="decimal"
                value={input}
                placeholder="0.0"
                onChange={(event) => {
                  setInput(event.target.value)
                  reset()
                }}
              />
              <span className="fs-field__unit">{asset?.displayName ?? ''}</span>
            </span>
          </label>
          {/* Only against a balance we read, and only when there is something in it. What it
              fills in round-trips through `isAmountFor`, so the validator cannot refuse it. */}
          {held !== null && held !== '0' && asset !== null && (
            <button
              type="button"
              className="fs-holding__all"
              onClick={() => {
                const all = fromSmallestUnits(held, asset.decimals)
                if (all !== null) {
                  setInput(all)
                  reset()
                }
              }}
            >
              Stake all {fromSmallestUnits(held, asset.decimals)} {asset.displayName}
            </button>
          )}
          {input.trim().length > 0 && !amountOk && asset !== null && (
            <p className="fs-note fs-note--warn">
              More than zero, and no finer than {asset.decimals} decimal places. {asset.displayName}{' '}
              does not divide any further than that.
            </p>
          )}
          {overdrawn && asset !== null && held !== null && (
            <p className="fs-note fs-note--warn" role="alert">
              That is more than the {fromSmallestUnits(held, asset.decimals)} {asset.displayName} in
              your account.
            </p>
          )}

          <fieldset className="fs-outcomes">
            <legend>Outcome</legend>
            <label>
              <input
                type="radio"
                name="custodial-outcome"
                checked={outcome === 0}
                onChange={() => {
                  setOutcome(0)
                  reset()
                }}
              />{' '}
              Yes
            </label>
            <label>
              <input
                type="radio"
                name="custodial-outcome"
                checked={outcome === 1}
                onChange={() => {
                  setOutcome(1)
                  reset()
                }}
              />{' '}
              No
            </label>
          </fieldset>

          {phase !== 'quoted' && phase !== 'staking' && phase !== 'staked' && (
            <button
              type="button"
              className="cf-btn cf-btn--ember"
              disabled={!amountOk || overdrawn || phase === 'quoting'}
              onClick={() => void onQuote()}
            >
              {phase === 'quoting' ? 'Working out the rate…' : 'What does that come to?'}
            </button>
          )}

          {quote !== null && (
            <div className="fs-quote">
              {/* BOTH UNITS AND THE RATE, BEFORE THE BUTTON IS LIVE. */}
              {conversionLine(quote) !== null && (
                <p className="cf-num fs-quote__line">{conversionLine(quote)}</p>
              )}
              {/* `cf-num` on this line as well as the one above it: the rate is the figure a
                  reader checks the conversion against, and two lines of numerals that do not line
                  up are two lines nobody compares. */}
              {rateLine(quote) !== null && (
                <p className="cf-num fs-quote__rate">{rateLine(quote)}</p>
              )}
              <p className="fs-note">{quote.disclosure}</p>
              {(phase === 'quoted' || phase === 'staking') && (
                <button type="button" disabled={phase === 'staking'} onClick={() => void onStake()}>
                  {phase === 'staking'
                    ? 'Placing it…'
                    : `Put ${quote.poolAmountFormatted} ${quote.poolAsset} on ${outcome === 0 ? 'Yes' : 'No'}`}
                </button>
              )}
            </div>
          )}

          {phase === 'staked' && (
            <p className="fs-note fs-note--ok">
              That is placed. From here your position, the odds and anything you collect are
              counted in {registry.poolAsset}.
            </p>
          )}
          {phase === 'failed' && message !== null && (
            <p className="fs-note fs-note--warn" role="alert">
              {message}
            </p>
          )}
        </>
      )}

      {blocked.length > 0 && (
        <details className="fs-blocked">
          <summary>Currencies we are not accepting, and why</summary>
          <ul>
            {blocked.map((option) => (
              <li key={option.assetCode}>
                {/* The reason, in full. "Not yet, and here is what is missing" is a different
                    answer from silence, and a reader holding that coin is owed the difference. */}
                <strong>{option.displayName}</strong> — {option.blockedReason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
