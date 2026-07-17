import {
  Brain,
  DatabaseZap,
  FileStack,
  FolderTree,
  Landmark,
  LibraryBig,
  ListTodo,
  MessageSquareText,
  Settings,
  type LucideIcon,
} from 'lucide-react'

export type ProjectNavigationChild = { name: string; tab: string }

export type ProjectNavigationItem = {
  name: string
  href: string
  icon: LucideIcon
  children?: ProjectNavigationChild[]
}

export type ProjectNavigationGroup = {
  label: string
  items: ProjectNavigationItem[]
}

export function buildKnowledgeNavigation(projectId: string): {
  background: ProjectNavigationGroup
  knowledge: ProjectNavigationGroup
} {
  const base = `/dashboard/projects/${encodeURIComponent(projectId)}`
  return {
    background: {
      label: '背景・目的',
      items: [
        { name: '背景・目的', href: `${base}/background`, icon: Landmark },
      ],
    },
    knowledge: {
      label: 'ナレッジ',
      items: [
        { name: 'チャット履歴', href: `${base}/knowledge/chat-history`, icon: MessageSquareText },
        { name: 'リソース履歴', href: `${base}/knowledge/resource-history`, icon: LibraryBig },
        { name: 'フォルダ', href: `${base}/knowledge/folders`, icon: FolderTree },
        { name: 'ナレッジ取り込み', href: `${base}/knowledge/ingestion`, icon: FileStack },
        { name: 'ナレッジグラフ', href: `${base}/knowledge/graph`, icon: Brain },
        {
          name: 'ナレッジ一覧編集',
          href: `${base}/knowledge/list`,
          icon: ListTodo,
          children: [
            { name: 'ノード', tab: 'nodes' },
            { name: '文書', tab: 'documents' },
            { name: '関係', tab: 'relations' },
          ],
        },
        { name: 'RAG索引', href: `${base}/rag`, icon: DatabaseZap },
        { name: 'ナレッジ設定', href: `${base}/knowledge/settings`, icon: Settings },
      ],
    },
  }
}
