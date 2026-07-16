import { describe, expect, it } from 'vitest'
import { buildRagSearchRequest, countRagDocuments } from './rag-search-state'
import type { RagDocument } from './rag'

describe('buildRagSearchRequest', () => {
  it('空の検索語とALLフィルターをAPI条件から除外する', () => {
    expect(buildRagSearchRequest({
      query: '   ',
      featureType: 'ALL',
      scopeLevel: 'ALL',
    })).toEqual({ limit: 50 })
  })

  it('検索語をtrimし選択されたフィルターを残す', () => {
    expect(buildRagSearchRequest({
      query: '  受注 処理  ',
      featureType: 'BUSINESS_FLOW',
      scopeLevel: 'COMPONENT',
    })).toEqual({
      q: '受注 処理',
      featureType: 'BUSINESS_FLOW',
      scopeLevel: 'COMPONENT',
      limit: 50,
    })
  })
})

describe('countRagDocuments', () => {
  it('機能種別と粒度ごとの件数を集計する', () => {
    const documents = [
      { featureType: 'BUSINESS_FLOW', scopeLevel: 'OVERVIEW' },
      { featureType: 'BUSINESS_FLOW', scopeLevel: 'COMPONENT' },
      { featureType: 'TASK', scopeLevel: 'COMPONENT' },
    ] as RagDocument[]

    expect(countRagDocuments(documents)).toMatchObject({
      total: 3,
      overview: 1,
      component: 2,
      byFeature: { BUSINESS_FLOW: 2, TASK: 1 },
    })
  })
})
