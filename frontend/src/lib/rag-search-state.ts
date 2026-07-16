import {
  RAG_FEATURE_TYPES,
  type RagDocument,
  type RagFeatureType,
  type RagScopeLevel,
  type RagSearchInput,
} from './rag'

export type RagFeatureFilter = RagFeatureType | 'ALL'
export type RagScopeFilter = RagScopeLevel | 'ALL'

export function buildRagSearchRequest(input: {
  query: string
  featureType: RagFeatureFilter
  scopeLevel: RagScopeFilter
}): RagSearchInput {
  const query = input.query.trim()
  return {
    ...(query ? { q: query } : {}),
    ...(input.featureType !== 'ALL' ? { featureType: input.featureType } : {}),
    ...(input.scopeLevel !== 'ALL' ? { scopeLevel: input.scopeLevel } : {}),
    limit: 50,
  }
}

export function countRagDocuments(documents: RagDocument[]): {
  total: number
  overview: number
  component: number
  byFeature: Record<RagFeatureType, number>
} {
  const byFeature = Object.fromEntries(
    RAG_FEATURE_TYPES.map((featureType) => [featureType, 0]),
  ) as Record<RagFeatureType, number>

  let overview = 0
  let component = 0
  for (const document of documents) {
    byFeature[document.featureType] += 1
    if (document.scopeLevel === 'OVERVIEW') overview += 1
    else component += 1
  }

  return { total: documents.length, overview, component, byFeature }
}
