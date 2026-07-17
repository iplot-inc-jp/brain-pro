import { describe, expect, it } from 'vitest'
import {
  promptSettingsDirty,
  validatePromptSettingsDraft,
} from './prompt-settings-state'

const active = { model: 'claude-sonnet-4-6', systemPrompt: '現在のプロンプト' }

describe('prompt settings form state', () => {
  it('モデルかプロンプトが変わったときだけdirtyになる', () => {
    expect(promptSettingsDirty(active, active)).toBe(false)
    expect(promptSettingsDirty(active, { ...active, model: 'claude-haiku-4-5' })).toBe(true)
    expect(promptSettingsDirty(active, { ...active, systemPrompt: '変更' })).toBe(true)
  })

  it('許可モデル・空文字・文字数上限を検証する', () => {
    const allowed = ['claude-sonnet-4-6']
    expect(validatePromptSettingsDraft(active, allowed)).toEqual({})
    expect(validatePromptSettingsDraft({ ...active, model: 'unknown' }, allowed)).toHaveProperty('model')
    expect(validatePromptSettingsDraft({ ...active, systemPrompt: '   ' }, allowed)).toHaveProperty('systemPrompt')
    expect(validatePromptSettingsDraft({ ...active, systemPrompt: 'x'.repeat(20_001) }, allowed)).toHaveProperty('systemPrompt')
    expect(validatePromptSettingsDraft({ ...active, systemPrompt: 'x'.repeat(101) }, allowed, 100)).toHaveProperty('systemPrompt')
  })

  it('環境変数由来の現行モデルは許可リスト外でも維持できる', () => {
    const allowed = ['claude-sonnet-4-6']
    const envModel = { ...active, model: 'claude-custom-model' }
    expect(validatePromptSettingsDraft(envModel, allowed, 20_000, 'claude-custom-model')).toEqual({})
    expect(validatePromptSettingsDraft(envModel, allowed, 20_000, 'claude-sonnet-4-6')).toHaveProperty('model')
  })
})
