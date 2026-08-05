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
  requestStakeQuote,
  type MarketView,
} from '../lib/foresight.ts'
import {
  conversionLine,
  isAmountFor,
  parseStakeAssets,
  rateLine,
  stakeRefusalSentence,
  toSmallestUnits,
  type StakeAssetView,
  type StakeAssetsView,
  type StakeQuoteView,
} from '../lib/stakeassets.ts'
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

  const asset: StakeAssetView | null = useMemo(
    () => registry?.assets.find((a) => a.assetCode === assetCode) ?? null,
    [registry, assetCode],
  )

  const smallestUnits = useMemo(
    () => (asset === null ? null : toSmallestUnits(input, asset.decimals)),
    [asset, input],
  )
  const amountOk = asset !== null && isAmountFor(input, asset.decimals) && smallestUnits !== null

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
      <h2 id="custodial-stake-heading">Stake with a balance you already hold</h2>

      {/* The platform's own sentence about what a custodial stake is and is not. Composed by the
          service so every client shows the same one — never rewritten here. */}
      <p className="fs-note fs-note--warning">{registry.disclosure}</p>

      {!signedIn ? (
        <p className="fs-note">Sign in to stake from a balance you hold with CloudsForge.</p>
      ) : (
        <>
          <label className="fs-field">
            <span className="fs-field__label">Asset</span>
            <select
              className="fs-field__input"
              value={assetCode}
              onChange={(event) => {
                setAssetCode(event.target.value)
                reset()
              }}
            >
              {enabled.map((option) => (
                <option key={option.assetCode} value={option.assetCode}>
                  {option.displayName}
                </option>
              ))}
            </select>
          </label>

          <label className="fs-field">
            <span className="fs-field__label">Amount</span>
            <input
              className="fs-field__input"
              // `inputMode` rather than `type="number"`: a number input hands back a float, and a
              // float near an 8- or 18-decimal amount is how the bottom of it disappears.
              inputMode="decimal"
              value={input}
              onChange={(event) => {
                setInput(event.target.value)
                reset()
              }}
            />
            <span className="fs-field__unit">{asset?.displayName ?? ''}</span>
          </label>
          {input.trim().length > 0 && !amountOk && asset !== null && (
            <p className="fs-note fs-note--warning">
              A positive amount with at most {asset.decimals} decimal places — {asset.displayName}{' '}
              has no smaller unit than that.
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
            <button type="button" disabled={!amountOk || phase === 'quoting'} onClick={() => void onQuote()}>
              {phase === 'quoting' ? 'Pricing…' : 'Show me the conversion'}
            </button>
          )}

          {quote !== null && (
            <div className="fs-quote">
              {/* BOTH UNITS AND THE RATE, BEFORE THE BUTTON IS LIVE. */}
              {conversionLine(quote) !== null && (
                <p className="cf-num fs-quote__line">{conversionLine(quote)}</p>
              )}
              {rateLine(quote) !== null && <p className="fs-quote__rate">{rateLine(quote)}</p>}
              <p className="fs-note">{quote.disclosure}</p>
              {(phase === 'quoted' || phase === 'staking') && (
                <button type="button" disabled={phase === 'staking'} onClick={() => void onStake()}>
                  {phase === 'staking'
                    ? 'Staking…'
                    : `Stake ${quote.poolAmountFormatted} ${quote.poolAsset}`}
                </button>
              )}
            </div>
          )}

          {phase === 'staked' && (
            <p className="fs-note fs-note--ok">
              Your stake is recorded. Your position, the odds and anything you win are all in{' '}
              {registry.poolAsset}.
            </p>
          )}
          {phase === 'failed' && message !== null && (
            <p className="fs-note fs-note--warning" role="alert">
              {message}
            </p>
          )}
        </>
      )}

      {blocked.length > 0 && (
        <details className="fs-blocked">
          <summary>Assets this platform cannot take yet</summary>
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
