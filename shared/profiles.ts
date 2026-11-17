import type { HardwareProfile, ModelRoles } from './types'

export interface ProfilePreset {
  label: string
  description: string
  numCtx: number
  temperature: number
  roles: ModelRoles
  suggested: string[]
}

/** The model set chosen for this installation: one model per kind of work. */
export const STUDIO_MODELS: ModelRoles = {
  general: 'qwen3:8b', // conversation
  coder: 'qwen2.5-coder:7b', // code
  reasoning: 'qwen3:8b', // algorithms, maths, step-by-step (thinking mode; finished 2/3 graded DSA problems vs 0/3 for deepseek-r1:8b)
  vision: 'qwen2.5vl:7b', // screenshots and images
  embedding: 'nomic-embed-text' // knowledge library / syllabus retrieval
}

const STUDIO_SUGGESTED = ['qwen3:8b', 'qwen2.5-coder:7b', 'qwen2.5-coder:14b', 'qwen3:30b-a3b-thinking-2507-q4_K_M', 'deepseek-r1:8b', 'qwen2.5vl:7b', 'nomic-embed-text']

/** MoE reasoning model: 30B parameters, ~3B active per token, so it stays usable when split between GPU and RAM. */
export const REASONING_30B = 'qwen3:30b-a3b-thinking-2507-q4_K_M'

/** Approximate download sizes (GB) shown in the setup wizard. */
export const MODEL_SIZES_GB: Record<string, number> = {
  'qwen3:8b': 5.2,
  'qwen3:14b': 9.3,
  'qwen2.5-coder:7b': 4.7,
  'qwen2.5-coder:14b': 9.0,
  'deepseek-r1:8b': 5.2,
  'deepseek-r1:14b': 9.0,
  'qwen2.5vl:7b': 6.0,
  'qwen2.5vl:3b': 3.2,
  'nomic-embed-text': 0.27,
  'qwen3:30b-a3b-thinking-2507-q4_K_M': 18.6,
  'gpt-oss:20b': 13.8
}

/** Bump when presets change so saved settings are migrated once. */
export const PRESET_VERSION = 4

export const PROFILE_PRESETS: Record<HardwareProfile, ProfilePreset> = {
  lite: {
    label: 'Lite (6 GB)',
    description:
      '6 GB VRAM + 24 GB RAM. Same models with the fast 7B coder; the 8B and vision models keep a few layers in system RAM. Pick qwen2.5-coder:14b in Settings for better code at ~7–9 tok/s. 6K context.',
    numCtx: 6144,
    temperature: 0.4,
    roles: STUDIO_MODELS,
    suggested: STUDIO_SUGGESTED
  },
  balanced: {
    label: 'Balanced (8 GB)',
    description:
      '8 GB VRAM + 32 GB RAM. 8B models run fully on the GPU; the 14B code model is split between GPU and RAM (~14 tok/s) for stronger DSA code. 8K context.',
    numCtx: 8192,
    temperature: 0.4,
    // Code quality matters most for exams: the 14B coder runs ~57% on the GPU and the rest in system RAM.
    roles: { ...STUDIO_MODELS, coder: 'qwen2.5-coder:14b', reasoning: REASONING_30B },
    suggested: STUDIO_SUGGESTED
  },
  deep: {
    label: 'Deep (12 GB+)',
    description: '12 GB+ VRAM and 32 GB+ RAM. 14B models with CPU/GPU offload. Slower, uses much more memory.',
    numCtx: 16384,
    temperature: 0.4,
    roles: {
      general: 'qwen3:14b',
      coder: 'qwen2.5-coder:14b',
      reasoning: REASONING_30B,
      vision: 'qwen2.5vl:7b',
      embedding: 'nomic-embed-text'
    },
    suggested: ['qwen3:14b', 'qwen2.5-coder:14b', REASONING_30B, 'qwen2.5vl:7b', 'nomic-embed-text']
  }
}

/**
 * The 30B MoE reasoning model needs ~20 GB of RAM+VRAM (weights mostly in system RAM), so it is only
 * used on machines with at least 30 GB of RAM; smaller machines use qwen3:8b for reasoning instead.
 */
export const MIN_RAM_GB_FOR_30B = 30
export function adjustRolesForMemory(roles: ModelRoles, totalRamGB: number): ModelRoles {
  if (roles.reasoning === REASONING_30B && totalRamGB < MIN_RAM_GB_FOR_30B) return { ...roles, reasoning: 'qwen3:8b' }
  return roles
}
