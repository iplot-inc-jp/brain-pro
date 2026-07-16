import { describe, expect, it } from 'vitest'
import {
  ragSettingsDirty,
  validateRagSettingsDraft,
} from './rag-settings-state'

const active = { model: 'claude-sonnet-4-6', systemPrompt: '現在のプロンプト' }

describe('RAG settings form state', () => {
  it('モデルかプロンプトが変わったときだけdirtyになる', () => {
    expect(ragSettingsDirty(active, active)).toBe(false)
    expect(ragSettingsDirty(active, { ...active, model: 'claude-haiku-4-5' })).toBe(true)
    expect(ragSettingsDirty(active, { ...active, systemPrompt: '変更' })).toBe(true)
  })

  it('許可モデル・空文字・20000文字上限を検証する', () => {
    const allowed = ['claude-sonnet-4-6']
    expect(validateRagSettingsDraft(active, allowed)).toEqual({})
    expect(validateRagSettingsDraft({ ...active, model: 'unknown' }, allowed)).toHaveProperty('model')
    expect(validateRagSettingsDraft({ ...active, systemPrompt: '   ' }, allowed)).toHaveProperty('systemPrompt')
    expect(validateRagSettingsDraft({ ...active, systemPrompt: 'x'.repeat(20_001) }, allowed)).toHaveProperty('systemPrompt')
  })
})
