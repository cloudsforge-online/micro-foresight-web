/**
 * Session state for the tree.
 *
 * ── THERE IS NO `ProtectedRoute` HERE, AND THAT IS THE POINT ───────────────────────────────────
 *
 * Forge Foresight is a PUBLIC surface. Every market, its resolution criteria, its cited sources,
 * its pool and its odds are readable with no session, because a market's resolution criteria are
 * a contract with strangers and a contract nobody can read before signing in is not one. Only two
 * things need a token — `POST /markets/:id/stake-intent`, which is policy-gated per subject, and
 * the portfolio's "my positions" convenience — and both ask for it at the point of use, where the
 * reader can see what they are being asked for and why.
 *
 * Gating the routes would also be a lie about where the boundary is. The service verifies the
 * token on the request itself; a route wrapper only decides whether a reader is sent to sign in
 * or shown a screen made of failures, and for a public catalogue the answer is neither.
 *
 * `test/routes.test.ts` asserts that no route in this app is wrapped, so a gate cannot be added
 * to a browse page by habit.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AccountState } from '@cloudsforge/ui'
import { AUTH_EXPIRED_EVENT, clearTokens, hasSession, nimbus, signIn, signOut } from './api.ts'

/**
 * What identity answers at `/auth/me`.
 *
 * The profile is **nested under `user`** — the body is
 * `{ user, session, organisations }` (`identity/src/server.ts:891-903`), and `user` is built by
 * `toPublicUser` (`identity/src/users.ts:52-63`). This interface used to declare `handle` and
 * `roles` at the TOP level, where identity has never put them: `roles` was therefore always
 * `undefined`, `isAdmin` was always false, and the switcher hid admin, lantern and beacon from
 * every signed-in operator. Nothing failed — the menu was simply, silently, short.
 *
 * Only the nested shape is accepted. Tolerating the flat one as a fallback would encode a
 * response identity does not send, and the next reader would not be able to tell which is real.
 */
interface Me {
  user?: {
    id?: string | null
    handle?: string | null
    roles?: readonly string[] | null
  } | null
}

export type SessionStatus = 'loading' | 'anonymous' | 'signedIn'

export interface Session {
  status: SessionStatus
  account: AccountState
  signIn: (returnTo?: string) => void
  signOut: () => void
}

const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const value = useContext(SessionContext)
  // Throwing beats returning a signed-out default: a component rendered outside the provider
  // would otherwise show an anonymous UI to a signed-in user and nobody would ever see why.
  if (!value) throw new Error('useSession must be used inside <AuthProvider>')
  return value
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>(() => (hasSession() ? 'loading' : 'anonymous'))
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    if (!hasSession()) return
    let live = true
    // The identity call is the one request that is allowed to fail quietly: an unreachable Nimbus
    // must not sign anyone out — that is the cascade the estate's readiness rules exist to avoid.
    nimbus<Me>('/auth/me')
      .then((profile) => {
        if (!live) return
        setMe(profile)
        setStatus('signedIn')
      })
      .catch(() => {
        if (!live) return
        setStatus(hasSession() ? 'signedIn' : 'anonymous')
      })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const onExpired = () => {
      clearTokens()
      setMe(null)
      setStatus('anonymous')
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [])

  const doSignOut = useCallback(() => {
    setMe(null)
    setStatus('anonymous')
    signOut()
  }, [])

  const value = useMemo<Session>(
    () => ({
      status,
      account: {
        signedIn: status === 'signedIn',
        handle: me?.user?.handle ?? null,
        roles: me?.user?.roles ?? null,
      },
      signIn,
      signOut: doSignOut,
    }),
    [status, me, doSignOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
