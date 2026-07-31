/**
 * The connected address, as a hook.
 *
 * ── It does not prompt on mount, deliberately ─────────────────────────────────────────────────
 *
 * `eth_accounts` returns what the reader has ALREADY granted this origin and opens nothing;
 * `eth_requestAccounts` is the one that puts a dialogue in front of them. A page that prompts on
 * load is a page people dismiss before they have read anything, and every market on this site is
 * readable — sources, criteria, pool and all — without a wallet existing at all.
 *
 * So: silent on mount, prompt only from `connect()`, and `address: null` is a first-class state
 * that the pages render around rather than block on.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { currentAccounts, getProvider, isUserRejection, requestAccounts } from './wallet.ts'

export interface WalletState {
  /** The first granted account, lower-cased, or `null`. */
  readonly address: string | null
  /** False when there is no injected provider at all. */
  readonly available: boolean
  readonly connecting: boolean
  /** Set when a connection attempt failed for a reason that was not the user declining. */
  readonly error: string | null
  connect: () => void
}

export function useWalletAddress(): WalletState {
  const provider = useMemo(() => getProvider(), [])
  const [address, setAddress] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!provider) return
    let live = true
    void currentAccounts(provider).then((accounts) => {
      if (live) setAddress(accounts[0]?.toLowerCase() ?? null)
    })

    // A reader who switches account in their wallet is a different staker, and every figure on the
    // page belongs to the old one until this fires.
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0]
      setAddress(Array.isArray(accounts) ? ((accounts[0] as string | undefined)?.toLowerCase() ?? null) : null)
    }
    provider.on?.('accountsChanged', onAccounts)
    return () => {
      live = false
      provider.removeListener?.('accountsChanged', onAccounts)
    }
  }, [provider])

  const connect = useCallback(() => {
    if (!provider) return
    setConnecting(true)
    setError(null)
    void requestAccounts(provider)
      .then((accounts) => setAddress(accounts[0]?.toLowerCase() ?? null))
      .catch((err: unknown) => {
        // Declining is a decision, not a failure, and it gets no error banner.
        if (!isUserRejection(err)) {
          setError(err instanceof Error ? err.message : 'The wallet did not connect.')
        }
      })
      .finally(() => setConnecting(false))
  }, [provider])

  return { address, available: provider !== null, connecting, error, connect }
}
