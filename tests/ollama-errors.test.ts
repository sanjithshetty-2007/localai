import { describe, expect, it } from 'vitest'
import { isRunnerCrash } from '../electron/services/ollama'

describe('Ollama runner crash detection', () => {
  it('recognises the CUDA crash users saw', () => {
    expect(isRunnerCrash('llama-server process has terminated: exit status 0xc0000409: The system detected an overrun of a stack-based buffer in this application.: CUDA error: shared object initialization failed')).toBe(true)
    expect(isRunnerCrash('llama runner process has terminated: exit status 2')).toBe(true)
  })
  it('ignores ordinary errors', () => {
    expect(isRunnerCrash('model "foo" not found, try pulling it first')).toBe(false)
    expect(isRunnerCrash('context canceled')).toBe(false)
  })
})
