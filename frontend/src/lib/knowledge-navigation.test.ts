import { describe, expect, it } from 'vitest'

import { buildKnowledgeNavigation } from './knowledge-navigation'

describe('buildKnowledgeNavigation', () => {
  it('keeps Background and Purpose standalone and creates a dedicated Knowledge group', () => {
    const navigation = buildKnowledgeNavigation('project-1')

    expect(navigation.background.label).toBe('背景・目的')
    expect(navigation.background.items.map((item) => item.name)).toEqual(['背景・目的'])
    expect(navigation.knowledge.label).toBe('ナレッジ')
    expect(navigation.knowledge.items.map((item) => item.name)).toEqual([
      'チャット履歴',
      'リソース履歴',
      'ナレッジ取り込み',
      'ナレッジグラフ',
      'ナレッジ一覧編集',
      'RAG索引',
      'ナレッジ設定',
    ])
  })

  it('scopes every navigation target to the selected project', () => {
    const navigation = buildKnowledgeNavigation('project/with space')
    const items = [...navigation.background.items, ...navigation.knowledge.items]

    expect(items.every((item) => item.href.startsWith(
      '/dashboard/projects/project%2Fwith%20space/',
    ))).toBe(true)
    expect(navigation.knowledge.items.find((item) => item.name === 'ナレッジ一覧編集')?.children)
      .toEqual([
        { name: 'ノード', tab: 'nodes' },
        { name: '文書', tab: 'documents' },
        { name: '関係', tab: 'relations' },
      ])
  })
})
