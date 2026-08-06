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
        <h1 className="fs-page__title">What we run, and what we refuse</h1>
        <p className="fs-page__lede">
          Market categories are an allowlist, not a filter — a question has to fall inside one of
          these to be opened at all, and the list is versioned in the repository rather than
          adjusted case by case. The refusals below are not a moderation policy that can be quietly
          relaxed; they are published here so they can be held against us.
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
              What can be a market
            </h2>
            <ul className="fs-rules">
              {catalogue.data.categories.map((category) => (
                <li key={category.id} className="fs-rule">
                  <h3 className="fs-rule__title">{category.title}</h3>
                  <p className="fs-rule__body">{category.description}</p>
                  <p className="fs-rule__sources">
                    Settles from:{' '}
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
              What cannot
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
