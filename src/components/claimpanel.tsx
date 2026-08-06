/**
 * Claim. The panel that has to work when nothing else does.
 *
 * It reads the contract through the reader's own wallet (`eth_call` costs nothing and asks nobody)
 * and falls back to the mirror only for facts the contract did not supply — see `lib/claim.ts` for
 * the precedence and why the two are never blended. When neither can confirm what is owed, the
 * panel says exactly that and the button stays live: hiding it would make a service this function
 * does not read into a dependency of it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  claimSentence,
  claimVerdict,
  readChainFacts,
  type ChainFacts,
  type ClaimVerdict,
  type MirrorFacts,
} from '../lib/claim.ts'
import { utcDateTime } from '../lib/format.ts'
import { formatEmber, shortHex, toExactEmber } from '../lib/units.ts'
import {
  buildClaimTransaction,
  getProvider,
  isUserRejection,
  requestAccounts,
  sendTransaction,
} from '../lib/wallet.ts'

type Sending = 'idle' | 'sending' | 'sent' | 'failed'

export function ClaimPanel({ mirror, address }: { mirror: MirrorFacts; address: string | null }) {
  const provider = useMemo(() => getProvider(), [])
  const [chain, setChain] = useState<ChainFacts | null>(null)
  const [reading, setReading] = useState(false)
  const [sending, setSending] = useState<Sending>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  /**
   * The latch, for the same reason as `components/stakepanel.tsx` — see the note there.
   *
   * `sending` is state. `setSending('sending')` schedules a render; it does not change the
   * `sending` the click listener is holding, and `disabled={... sending === 'sending' ...}` is not
   * on the DOM node until that render commits. Two clicks in one tick therefore both pass, and
   * both reach `sendTransaction`. The contract pays each address once (`ForesightMarket.sol`),
   * so the second transaction is gas spent to buy a revert — and the user is shown a failure for a
   * claim that in fact succeeded.
   */
  const inFlight = useRef(false)

  const contract = mirror.contractAddress

  const read = useCallback(async () => {
    if (!provider || !contract || !address) return
    setReading(true)
    try {
      setChain(await readChainFacts(provider, contract, address))
    } finally {
      setReading(false)
    }
  }, [provider, contract, address])

  useEffect(() => {
    void read()
  }, [read])

  const verdict: ClaimVerdict = claimVerdict({
    mirror,
    chain,
    now: new Date(),
    chainUnavailableReason:
      provider === null
        ? 'No wallet is connected, so the contract could not be read from this browser.'
        : address === null
          ? 'No address is selected, so there is nothing to look up on the contract.'
          : null,
  })

  async function claim(): Promise<void> {
    if (inFlight.current) return
    if (!provider || !contract) return
    inFlight.current = true
    setFailure(null)
    setSending('sending')
    try {
      const [from] = address ? [address] : await requestAccounts(provider)
      if (!from) {
        setSending('failed')
        setFailure('The wallet returned no account.')
        return
      }
      const hash = await sendTransaction(provider, buildClaimTransaction({ contractAddress: contract, from }))
      setTxHash(hash)
      setSending('sent')
      // Re-read: `claimed(address)` flips in the same transaction, so the panel can tell the truth
      // as soon as it lands rather than waiting for a mirror that may be minutes behind.
      void read()
    } catch (err) {
      if (isUserRejection(err)) {
        setSending('idle')
        return
      }
      setSending('failed')
      setFailure(err instanceof Error ? err.message : 'The claim could not be sent.')
    } finally {
      // Released on every path, including the early return above: a user whose wallet returned no
      // account must be able to press again once they have picked one.
      inFlight.current = false
    }
  }

  return (
    <section className="fs-panel fs-claim" aria-labelledby="claim-heading">
      <h2 className="fs-panel__title" id="claim-heading">
        Claim
      </h2>

      <p className={`fs-claim__state fs-claim__state--${verdict.state}`} role="status">
        <span className="fs-claim__icon" aria-hidden="true">
          {iconFor(verdict.state)}
        </span>
        {claimSentence(verdict)}
      </p>

      {/* The amount, or its absence — never a zero standing in for an unknown. */}
      {verdict.payout !== null && (
        <p className="fs-claim__figure cf-num">
          {formatEmber(verdict.payout)} <span className="fs-unit">EMBER</span>
          <span className="fs-claim__exact">exactly {toExactEmber(verdict.payout)}</span>
        </p>
      )}

      {verdict.unconfirmedBecause !== null && (
        <p className="fs-note fs-note--warn" role="alert">
          <span className="fs-note__icon" aria-hidden="true">
            ▲
          </span>
          {verdict.unconfirmedBecause}{' '}
          {verdict.canAttempt
            ? 'You can still claim — the contract works out the amount itself and pays it to your address.'
            : ''}
        </p>
      )}

      {verdict.claimableFrom !== null && (
        <p className="fs-claim__when">
          Claims open <span className="cf-num">{utcDateTime(verdict.claimableFrom)}</span>, when the
          dispute window closes. Until then a wrong resolution can still be voided and the money has
          not moved.
        </p>
      )}

      {contract && (
        <p className="fs-claim__contract">
          Contract <code className="cf-num" title={contract}>{shortHex(contract)}</code>. It pays
          each address once, and it will pay you from any client that can send a transaction —
          this page is a convenience, not the route.
        </p>
      )}

      <div className="fs-claim__actions">
        <button
          type="button"
          className="cf-btn cf-btn--ember"
          disabled={!verdict.canAttempt || provider === null || sending === 'sending' || sending === 'sent'}
          onClick={() => void claim()}
        >
          {sending === 'sending' ? 'Waiting for your wallet…' : sending === 'sent' ? 'Claim sent' : 'Claim'}
        </button>
        {provider !== null && contract !== null && address !== null && (
          <button type="button" className="cf-btn" disabled={reading} onClick={() => void read()}>
            {reading ? 'Reading the contract…' : 'Re-read the contract'}
          </button>
        )}
      </div>

      {provider === null && (
        <p className="fs-note" role="status">
          Connect a wallet to claim. The contract is public — any wallet or block explorer can call
          <code className="cf-num"> claim()</code> on it.
        </p>
      )}

      {sending === 'sent' && txHash && (
        <p className="fs-note fs-note--ok" role="status">
          <span className="fs-note__icon" aria-hidden="true">
            ◆
          </span>
          Claim sent. Transaction <code className="cf-num">{shortHex(txHash)}</code>.
        </p>
      )}
      {sending === 'failed' && failure && (
        <p className="fs-note fs-note--fail" role="alert">
          <span className="fs-note__icon" aria-hidden="true">
            ■
          </span>
          {failure}
        </p>
      )}
    </section>
  )
}

/** An icon per state, so the state is never carried by colour alone. */
function iconFor(state: ClaimVerdict['state']): string {
  switch (state) {
    case 'claimable':
      return '◆'
    case 'claimed':
      return '✓'
    case 'dispute_window':
      return '◷'
    case 'nothing_owed':
      return '◇'
    case 'unconfirmed':
      return '▲'
    case 'not_settled':
    case 'no_contract':
      return '·'
  }
}
