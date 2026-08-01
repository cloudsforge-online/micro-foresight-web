/**
 * The registry is the single source of the accent and the host, and this app corrects neither.
 *
 * It briefly corrected both. `micro-ui` shipped Foresight's accent selector as
 * `[data-product='foresight']`, missing the `cf-` prefix every other product carries, so the rule
 * matched nothing and the page fell back to the company ember; and it gave Foresight `devPort:
 * 4011`, which is Beacon's, so a local stack resolved this app's API to the monitoring service.
 *
 * `micro-ui` is single-owner, so this repository reported both rather than editing them, and
 * carried two workarounds pinned to the WRONG answers — a duplicate `data-product` attribute in
 * index.html and a local port override in hosts.ts — so that these tests would go red the day the
 * upstream was fixed. It was, both are gone, and what remains asserts that they stay gone.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SURFACES } from '@cloudsforge/ui/surfaces'

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')

test('the registry spells the accent selector correctly, so this app carries no second attribute', () => {
  const html = read('index.html')
  assert.match(html, /data-cf-product="foresight"/, 'the documented attribute must be set')
  assert.doesNotMatch(
    html,
    /\sdata-product="/,
    'the unprefixed attribute was a workaround for a selector micro-ui has since fixed',
  )
})

test('the registry gives foresight its own port, so this app overrides nothing', () => {
  const foresight = SURFACES.find((s) => s.key === 'foresight')
  assert.ok(foresight, 'foresight must be in the registry')
  assert.equal(foresight.devPort, 4021, "foresight binds 4021; 4011 is beacon's")
  const beacon = SURFACES.find((s) => s.key === 'beacon')
  assert.notEqual(foresight.devPort, beacon?.devPort, 'two services must not share a dev port')
  assert.doesNotMatch(
    read('src/lib/hosts.ts'),
    /LOCAL_SERVICE_PORT/,
    'the local port override was a workaround for a registry entry that is now correct',
  )
})
