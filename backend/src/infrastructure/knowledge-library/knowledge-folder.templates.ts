export interface KnowledgeFolderTemplateTreeNode {
  name: string;
  children?: KnowledgeFolderTemplateTreeNode[];
}

export interface BuiltInKnowledgeFolderTemplate {
  id: string;
  name: string;
  description: string;
  nodes: KnowledgeFolderTemplateTreeNode[];
}

export const BUILT_IN_KNOWLEDGE_FOLDER_TEMPLATES: readonly BuiltInKnowledgeFolderTemplate[] = [
  {
    id: 'builtin:project-standard',
    name: 'プロジェクト標準',
    description: '背景・要件・設計・会議・成果物を一通り整理します。',
    nodes: [
      { name: '01_背景・目的' },
      { name: '02_要件', children: [{ name: '業務要件' }, { name: 'システム要件' }] },
      { name: '03_設計' },
      { name: '04_会議・チャット' },
      { name: '05_成果物' },
    ],
  },
  {
    id: 'builtin:discovery',
    name: '現状分析・構想策定',
    description: '調査材料から課題、仮説、意思決定までを整理します。',
    nodes: [
      { name: '調査資料' },
      { name: '現状・課題' },
      { name: '仮説・論点' },
      { name: '意思決定' },
    ],
  },
  {
    id: 'builtin:delivery',
    name: '開発・デリバリー',
    description: '仕様、実装、テスト、リリース情報を整理します。',
    nodes: [
      { name: '仕様' },
      { name: '実装' },
      { name: 'テスト' },
      { name: 'リリース' },
    ],
  },
] as const;
