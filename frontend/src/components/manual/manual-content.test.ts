import { describe, it, expect } from 'vitest'
import { MANUAL_ENTRIES, getManualEntry } from './manual-content'

const EXPECTED_KEYS = [
  // 共通マスタ
  'domains',
  'io-types',
  'systems',
  'constraints',
  'roles',
  'meetings',
  // 業務フロー / ASIS-TOBE
  'flows',
  'asis-tobe',
  'issue-trees',
  'gap-items',
  'dfd',
  'tasks',
  'tasks-gantt',
  'crud-matrix',
  'stakeholder-management',
  'risk-management',
  'catalog',
  'business-definition',
  'roadmap',
  'requirements',
  // PMBOK
  'charter',
  'history',
]

describe('MANUAL_ENTRIES', () => {
  it('対象機能のキーを全て持つ', () => {
    for (const key of EXPECTED_KEYS) {
      expect(MANUAL_ENTRIES[key], `missing entry: ${key}`).toBeDefined()
    }
  })

  it('各エントリは key/title/purpose/steps/Illustration を正しい型で持つ', () => {
    for (const [key, entry] of Object.entries(MANUAL_ENTRIES)) {
      expect(entry.key).toBe(key) // key フィールドはレジストリのキーと一致
      expect(typeof entry.title).toBe('string')
      expect(entry.title.length).toBeGreaterThan(0)
      expect(typeof entry.purpose).toBe('string')
      expect(entry.purpose.length).toBeGreaterThan(0)
      expect(typeof entry.Illustration).toBe('function')
    }
  })

  it('steps は 4〜8 個の具体的な手順', () => {
    for (const entry of Object.values(MANUAL_ENTRIES)) {
      expect(entry.steps.length).toBeGreaterThanOrEqual(4)
      expect(entry.steps.length).toBeLessThanOrEqual(8)
      for (const step of entry.steps) {
        expect(typeof step).toBe('string')
        expect(step.trim().length).toBeGreaterThan(0)
      }
    }
  })
})

describe('getManualEntry', () => {
  it('登録済みキーはエントリを返す', () => {
    expect(getManualEntry('flows')?.title).toBeTruthy()
  })

  it('未登録キーは undefined を返す', () => {
    expect(getManualEntry('does-not-exist')).toBeUndefined()
  })
})
