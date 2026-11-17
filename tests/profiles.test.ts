import { describe, expect, it } from 'vitest'
import { PROFILE_PRESETS, REASONING_30B, adjustRolesForMemory } from '../shared/profiles'

describe('memory-aware reasoning model', () => {
  it('keeps the 30B model on a 32 GB machine', () => {
    expect(adjustRolesForMemory(PROFILE_PRESETS.balanced.roles, 31.4).reasoning).toBe(REASONING_30B)
  })
  it('falls back to qwen3:8b on a 24 GB machine', () => {
    expect(adjustRolesForMemory(PROFILE_PRESETS.balanced.roles, 23.8).reasoning).toBe('qwen3:8b')
  })
  it('Lite uses qwen3:8b for reasoning', () => {
    expect(PROFILE_PRESETS.lite.roles.reasoning).toBe('qwen3:8b')
  })
})
