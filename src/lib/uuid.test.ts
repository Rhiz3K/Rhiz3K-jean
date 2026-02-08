import { describe, expect, it } from 'vitest'
import { generateUuid } from './uuid'

describe('generateUuid', () => {
  it('returns an RFC 4122 v4 UUID', () => {
    const id = generateUuid()

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it('returns unique IDs across calls', () => {
    const first = generateUuid()
    const second = generateUuid()

    expect(first).not.toBe(second)
  })
})
