import { describe, expect, it } from 'vitest'
import { newerVersion } from '../shared/version'

describe('update version comparison', () => {
  it('detects newer versions numerically', () => {
    expect(newerVersion('v1.0.3', '1.0.2')).toBe(true)
    expect(newerVersion('1.0.10', '1.0.9')).toBe(true)
    expect(newerVersion('2.0.0', '1.9.9')).toBe(true)
  })
  it('does not offer the same or older versions', () => {
    expect(newerVersion('v1.0.2', '1.0.2')).toBe(false)
    expect(newerVersion('1.0.1', '1.0.2')).toBe(false)
    expect(newerVersion('1.0.9', '1.0.10')).toBe(false)
  })
})
