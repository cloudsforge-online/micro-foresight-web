/**
 * Times, and the observation stamps that go beside every mirrored figure.
 *
 * Every function here returns `null` rather than a plausible-looking placeholder, because the
 * caller has to be able to tell "no observation" from "an observation at midnight" — and a
 * formatter that returns `'—'` has already made that impossible.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ageLabel,
  asOfStamp,
  durationLabel,
  fromUnixSeconds,
  instant,
  untilLabel,
  utcDateTime,
  utcTime,
} from '../src/lib/format.ts'

const NOW = new Date('2026-08-01T12:00:00.000Z')

describe('utcTime and utcDateTime', () => {
  it('render in UTC with a fixed locale, whatever the machine is set to', () => {
    // The same instant must read identically on a laptop, in CI and in a screenshot attached to a
    // bug report. A stamp in the viewer's zone makes two people disagree about when a market shuts.
    assert.equal(utcTime('2026-08-01T14:22:00.000Z'), '14:22')
    assert.equal(utcDateTime('2026-03-14T14:22:00.000Z'), '14 Mar 2026, 14:22 UTC')
  })

  it('use a 24-hour clock, so 13:00 is never 1:00', () => {
    assert.equal(utcTime('2026-08-01T13:00:00.000Z'), '13:00')
    assert.equal(utcTime('2026-08-01T00:30:00.000Z'), '00:30')
  })

  it('are null for anything unparseable, never a placeholder that looks like a time', () => {
    for (const bad of [null, undefined, '', 'yesterday', '2026-13-45']) {
      assert.equal(utcTime(bad), null, `${String(bad)} produced a time`)
      assert.equal(utcDateTime(bad), null, `${String(bad)} produced a date`)
    }
  })
})

describe('instant', () => {
  it('parses a valid ISO string and rejects everything else', () => {
    assert.equal(instant('2026-08-01T12:00:00.000Z')?.toISOString(), '2026-08-01T12:00:00.000Z')
    assert.equal(instant('nope'), null)
    assert.equal(instant(null), null)
  })
})

describe('asOfStamp', () => {
  it('is the phrase that goes beside a mirrored figure', () => {
    assert.equal(asOfStamp('2026-08-01T11:59:00.000Z'), 'as of 11:59 UTC')
  })

  it('is NULL when the mirror has never run', () => {
    // The caller renders "not yet observed" rather than a time, because a missing observation and
    // an old one are different facts and only one means the number above was ever true.
    assert.equal(asOfStamp(null), null)
  })
})

describe('ageLabel', () => {
  it('reads in seconds, minutes, hours and days', () => {
    assert.equal(ageLabel('2026-08-01T11:59:50.000Z', NOW), '10s ago')
    assert.equal(ageLabel('2026-08-01T11:30:00.000Z', NOW), '30 min ago')
    assert.equal(ageLabel('2026-08-01T02:00:00.000Z', NOW), '10h ago')
    assert.equal(ageLabel('2026-07-25T12:00:00.000Z', NOW), '7d ago')
  })

  it('says "just now" only for the last few seconds', () => {
    assert.equal(ageLabel('2026-08-01T11:59:59.000Z', NOW), 'just now')
    assert.equal(ageLabel('2026-08-01T11:59:54.000Z', NOW), '6s ago')
  })

  it('refuses a FUTURE instant rather than rendering a negative age', () => {
    // A future asOf is a clock disagreement between this browser and the indexer, and "in 3
    // minutes" beside a pool would be worse than nothing.
    assert.equal(ageLabel('2026-08-01T12:00:01.000Z', NOW), null)
  })

  it('is null for a missing instant', () => {
    assert.equal(ageLabel(null, NOW), null)
  })
})

describe('untilLabel', () => {
  it('counts down coarsely', () => {
    assert.equal(untilLabel('2026-08-01T12:30:00.000Z', NOW), '30 min')
    assert.equal(untilLabel('2026-08-01T15:30:00.000Z', NOW), '3h 30 min')
    assert.equal(untilLabel('2026-08-04T18:00:00.000Z', NOW), '3d 6h')
  })

  it('never shows zero, so a market about to close does not read as closed', () => {
    assert.equal(untilLabel('2026-08-01T12:00:30.000Z', NOW), '1 min')
  })

  it('is null once the instant has passed, including at the exact boundary', () => {
    assert.equal(untilLabel('2026-08-01T12:00:00.000Z', NOW), null)
    assert.equal(untilLabel('2026-08-01T11:59:59.000Z', NOW), null)
  })
})

describe('durationLabel — how a dispute window is written', () => {
  it('picks the unit that reads', () => {
    assert.equal(durationLabel(600), '10 minutes')
    assert.equal(durationLabel(3_600), '1 hour')
    assert.equal(durationLabel(7_200), '2 hours')
    assert.equal(durationLabel(86_400), '1 day')
    assert.equal(durationLabel(259_200), '3 days')
  })

  it('says "none" for a zero window rather than "0 minutes"', () => {
    // A market with no dispute window is a real configuration and worth stating plainly.
    assert.equal(durationLabel(0), 'none')
  })

  it('is null for a missing or impossible value', () => {
    assert.equal(durationLabel(null), null)
    assert.equal(durationLabel(-1), null)
    assert.equal(durationLabel(Number.NaN), null)
  })
})

describe('fromUnixSeconds', () => {
  it('converts a contract’s uint64 into an instant', () => {
    assert.equal(fromUnixSeconds(1_798_761_600n), '2027-01-01T00:00:00.000Z')
  })

  it('is null for zero, which is what the contract returns while a market is open', () => {
    // `claimableFrom()` is 0 until resolution — `ForesightMarket.sol:393-397`. Rendering that as
    // 1970 would be a date somebody might believe.
    assert.equal(fromUnixSeconds(0n), null)
    assert.equal(fromUnixSeconds(null), null)
  })

  it('refuses a value past what a Date can hold rather than showing "Invalid Date"', () => {
    assert.equal(fromUnixSeconds((1n << 63n) - 1n), null)
  })
})
