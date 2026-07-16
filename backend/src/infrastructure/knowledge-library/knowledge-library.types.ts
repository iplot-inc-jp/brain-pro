import { KnowledgeLibraryItemType } from '@prisma/client';

export interface KnowledgeLibrarySourceFile {
  label: string;
  url: string;
  filename: string | null;
  mimeType: string | null;
}

export interface KnowledgeLibraryResultItem {
  itemType: KnowledgeLibraryItemType;
  itemId: string;
  title: string;
  excerpt: string;
  occurredAt: Date;
  sourcePageUrl: string;
  sourceFiles: KnowledgeLibrarySourceFile[];
  folderIds: string[];
  score: number;
}

export interface KnowledgeLibrarySearchInput {
  q?: string;
  itemTypes?: KnowledgeLibraryItemType[];
  folderId?: string;
  unclassified?: boolean;
  limit?: number;
}

export interface KnowledgeLibrarySearchWarning {
  source: KnowledgeLibraryItemType | 'ACTIVITY';
  message: string;
}

export interface KnowledgeLibrarySearchResult {
  items: KnowledgeLibraryResultItem[];
  warnings: KnowledgeLibrarySearchWarning[];
  totals: Record<KnowledgeLibraryItemType | 'all', number>;
}

