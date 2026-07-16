import { describe, expect, it } from 'vitest'
import { AREA_LABEL, formatPromptVersionLabel } from './llm-usage'

describe('LLM usage RAG presentation', () => {
  it('RAG領域を利用者向け名称で表示する', () => {
    expect(AREA_LABEL.RAG).toBe('RAG索引生成')
  })

  it('使用プロンプト版をモデルつきで表示する', () => {
    expect(formatPromptVersionLabel({
      id: 'pv7', version: 7, model: 'claude-haiku-4-5',
    })).toBe('プロンプト v7 · claude-haiku-4-5')
    expect(formatPromptVersionLabel(null)).toBeNull()
  })
})
