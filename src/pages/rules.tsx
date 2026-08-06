/**
 * What this platform will run a market on, and what it refuses.
 *
 * `GET /categories` — `foresight/src/server.ts`. It is unauthenticated, and `server.ts`
 * gives the reason in one line: **"A refusal list behind a token is a refusal list nobody can hold
 * the platform to."** This page is the other half of that sentence. A refusal list that exists on
 * an endpoint nobody opens is the same thing as one behind a token.
 */
import { useCallback } from 'react'
import { Failed, Forbidden, Loading } from '../components/states.tsx'
import { getCategories } from '../lib/foresight.ts'
import { useResource } from '../lib/resource.ts'

export function RulesPage() {
  const load = useCallback((signal: AbortSignal) => getCategories(signal), [])
  const catalogue = useResource(
    load,
    (data) => data.categories.length + data.refusals.length,
    'The category list could not be loaded.',
  )

  return (
    <div className="fs-page">
      <header className="fs-page__head">
        <h1 className="fs-page__title">The questions we will take, and the ones we won&apos;t</h1>
        <p className="fs-page__lede">
          A question has to belong to one of the categories below before it can go live. This is a
          short list of what is permitted rather than a long list of what is blocked, it is
          versioned alongside the code, and it changes by release instead of by exception. The
          bottom half is what we turn down. It is published so you can hold us to it.
        </p>
      </header>

      {catalogue.state === 'loading' && <Loading label="Loading the category list" />}
      {catalogue.state === 'failed' && catalogue.error && (
        <Failed notice={catalogue.error} onRetry={catalogue.reload} title="The list did not load" />
      )}
      {catalogue.state === 'forbidden' && <Forbidden notice={catalogue.error ?? undefined} />}
      {catalogue.data && (
        <>
          <p className="fs-version cf-num">Allowlist version {catalogue.data.version}</p>

          <section aria-labelledby="allowed-heading">
            <h2 className="fs-section__title" id="allowed-heading">
              Fair game
            </h2>
            <ul className="fs-rules">
              {catalogue.data.categories.map((category) => (
                <li key={category.id} className="fs-rule">
                  <h3 className="fs-rule__title">{category.title}</h3>
                  <p className="fs-rule__body">{category.description}</p>
                  <p className="fs-rule__sources">
                    Decided by:{' '}
                    {category.sourceKinds.map((kind) => (
                      <span key={kind} className="fs-chip">
                        {kind.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="refused-heading">
            <h2 className="fs-section__title" id="refused-heading">
              Off the table
            </h2>
            <ul className="fs-rules fs-rules--refusals">
              {catalogue.data.refusals.map((refusal) => (
                <li key={refusal.id} className="fs-rule fs-rule--refusal">
                  <h3 className="fs-rule__title">
                    <span className="fs-rule__icon" aria-hidden="true">
                      ⊘
                    </span>
                    {refusal.id.replace(/_/g, ' ')}
                  </h3>
                  <p className="fs-rule__body">{refusal.reason}</p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
