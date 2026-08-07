/**
 * The boot sequence. The order is not arbitrary.
 *
 *   1. Observability first, so an exception thrown by anything below is reported rather than lost.
 *      A crash during the first render is the single most valuable event this app can send.
 *   2. `bootstrapSession()` second, and AWAITED, so the SSO hand-off code in the URL fragment is
 *      redeemed before React mounts. It strips `#cf_code` from the address bar before the
 *      exchange goes over the wire — see the note in @cloudsforge/ui. Rendering first would show
 *      a signed-out shell to a user who has just signed in, and would leave the code on screen
 *      for the length of a network round trip.
 *   3. Render last.
 *
 * `.finally` rather than `.then`: a failed hand-off is a signed-out boot, not a broken app, and an
 * app that refuses to mount because an exchange failed leaves the reader with a blank page and no
 * sign-in button to press.
 *
 * Consent is primed between 1 and 2: see the note beside `initAnalytics()`.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@cloudsforge/ui/tokens.css'
import '@cloudsforge/ui/ui.css'
import './styles.css'
import { initAnalytics } from '@cloudsforge/ui/consent'
import { App } from './app.tsx'
import { bootstrapSession } from './lib/api.ts'
import { initObs } from './lib/obs.ts'

initObs()

/*
 * Consent Mode is primed with every category DENIED before anything else runs — two pushes onto a
 * plain array, no request, no cookie — and the analytics tag is loaded ONLY if this reader granted
 * consent on a previous visit. A first-time reader gets nothing until they press Accept.
 *
 * It goes here, second, rather than inside a component, because the denied default has to be in
 * place before any tag could conceivably arrive; a default installed after a script has begun
 * running is a race, and the losing branch of that race sets a cookie.
 *
 * Before `bootstrapSession()` for the same reason it is before the render: the hand-off is a
 * network round trip, and a window in which a tag could arrive with storage permitted by default
 * is a window this module exists to close.
 */
initAnalytics()

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

void bootstrapSession().finally(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
