/**
 * Keccak-256, checked three ways.
 *
 * The strong one is the second: `sha3_256` below is the SAME sponge with the NIST padding byte, so
 * comparing it against Node's own SHA3-256 exercises the permutation, the rate, the lane packing
 * and the absorb loop against an independent implementation (OpenSSL). That leaves exactly one
 * constant unverified — the domain byte — which is what the published vector pins.
 *
 * Without the cross-check, a hand-rolled hash is a function that agrees with itself.
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { describe, it } from 'node:test'
import { keccak256, keccak256Utf8, sha3_256, toHex, toHex0x } from '../src/lib/keccak.ts'

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('published vectors', () => {
  it('hashes the empty string to the value in every EVM spec', () => {
    assert.equal(
      toHex(keccak256(new Uint8Array(0))),
      'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    )
  })

  it('hashes "abc"', () => {
    assert.equal(
      toHex(keccak256(utf8('abc'))),
      '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
    )
  })

  it('produces the selector of a function signature', () => {
    // `transfer(address,uint256)` is the most published four bytes in Ethereum.
    assert.equal(toHex(keccak256(utf8('transfer(address,uint256)'))).slice(0, 8), 'a9059cbb')
  })
})

describe('the permutation, against OpenSSL', () => {
  it('agrees with node:crypto SHA3-256 across the rate boundary', () => {
    // The rate is 136 bytes. Every length from 0 to 200 covers the one-block case, the exact-fit
    // case where the padding byte and the 0x80 land on the same byte, and the multi-block case.
    for (let length = 0; length <= 200; length += 1) {
      const message = randomBytes(length)
      const ours = toHex(sha3_256(new Uint8Array(message)))
      const theirs = createHash('sha3-256').update(message).digest('hex')
      assert.equal(ours, theirs, `disagreed at length ${length}`)
    }
  })

  it('agrees on inputs far past one block', () => {
    for (const length of [1_000, 4_096, 10_007]) {
      const message = randomBytes(length)
      assert.equal(
        toHex(sha3_256(new Uint8Array(message))),
        createHash('sha3-256').update(message).digest('hex'),
        `disagreed at length ${length}`,
      )
    }
  })

  it('is NOT the same as SHA3-256, which is the whole reason this file exists', () => {
    // One byte of domain separation. Reaching for node's sha3-256 would produce plausible-looking
    // wrong answers: a wrong address that is still forty valid hex characters.
    const message = utf8('claim()')
    assert.notEqual(toHex(keccak256(message)), toHex(sha3_256(message)))
    assert.notEqual(toHex(keccak256(message)), createHash('sha3-256').update('claim()').digest('hex'))
  })
})

describe('hex helpers', () => {
  it('pads every byte to two characters', () => {
    assert.equal(toHex(new Uint8Array([0, 1, 15, 16, 255])), '00010f10ff')
  })

  it('prefixes with 0x on request', () => {
    assert.equal(toHex0x(new Uint8Array([0xde, 0xad])), '0xdead')
  })

  it('produces a 32-byte digest, always', () => {
    assert.equal(keccak256(utf8('anything')).length, 32)
    assert.equal(keccak256Utf8('anything').length, 66) // '0x' + 64
  })
})

describe('keccak256Utf8', () => {
  it('hashes the UTF-8 bytes, not the code units', () => {
    // A character outside the BMP is four UTF-8 bytes and two UTF-16 code units. Hashing the wrong
    // encoding of a market's canonical document would produce a mismatch on exactly the documents
    // that contain a non-ASCII character — which market questions routinely do.
    const emoji = '\u{1F525}'
    assert.equal(new TextEncoder().encode(emoji).length, 4)
    assert.equal(keccak256Utf8(emoji), toHex0x(keccak256(new Uint8Array([0xf0, 0x9f, 0x94, 0xa5]))))
  })

  it('is sensitive to a single-character edit, which is what makes it a check', () => {
    const before = keccak256Utf8('Will block 21,000,000 be reached by 2026-12-31?')
    const after = keccak256Utf8('Will block 21,000,000 be reached by 2027-12-31?')
    assert.notEqual(before, after)
  })
})
