import { describe, expect, it } from 'vitest'
import { ragActionPresentation } from './rag-action-state'

describe('ragActionPresentation', () => {
  it('未生成・生成中・最新・要更新・失敗・未対応を短い表示へ変換する', () => {
    expect(ragActionPresentation({ supported: true, state: 'UNGENERATED' }).label).toBe('RAG用の概要を作る')
    expect(ragActionPresentation({ supported: true, state: 'RUNNING' }).label).toBe('RAG概要を作成中')
    expect(ragActionPresentation({ supported: true, state: 'FRESH' }).tone).toBe('fresh')
    expect(ragActionPresentation({ supported: true, state: 'STALE' }).label).toBe('RAG概要 要更新')
    expect(ragActionPresentation({ supported: true, state: 'FAILED' }).tone).toBe('error')
    expect(ragActionPresentation({ supported: false, state: 'UNGENERATED' }).label).toBe('RAG概要 未対応')
  })

  it('閲覧専用では生成ボタンを無効化する', () => {
    expect(ragActionPresentation({ supported: true, state: 'STALE', canEdit: false }).disabled).toBe(true)
    expect(ragActionPresentation({ supported: true, state: 'STALE', canEdit: true }).disabled).toBe(false)
  })
})
