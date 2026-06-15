import { aggregateBatchStatus } from './batch-status';

describe('aggregateBatchStatus', () => {
  it('全完了→SUCCEEDED / 一部失敗→PARTIAL / 全失敗→FAILED / 実行中→RUNNING / 未着手→PENDING', () => {
    expect(aggregateBatchStatus(['SUCCEEDED', 'SUCCEEDED'])).toBe('SUCCEEDED');
    expect(aggregateBatchStatus(['SUCCEEDED', 'FAILED'])).toBe('PARTIAL');
    expect(aggregateBatchStatus(['FAILED', 'FAILED'])).toBe('FAILED');
    expect(aggregateBatchStatus(['EXTRACTING', 'PENDING'])).toBe('RUNNING');
    expect(aggregateBatchStatus(['PENDING', 'PENDING'])).toBe('PENDING');
    expect(aggregateBatchStatus([])).toBe('PENDING');
  });

  it('進行中がアーカイブ EXPANDING のみ→EXPANDING / 通常処理が走れば RUNNING', () => {
    // 展開中のみ（他は未着手/完了）→ EXPANDING
    expect(aggregateBatchStatus(['EXPANDING', 'PENDING'])).toBe('EXPANDING');
    expect(aggregateBatchStatus(['EXPANDING', 'SUCCEEDED'])).toBe('EXPANDING');
    // 通常処理（EXTRACTING 等）が同時に走っていれば RUNNING を優先
    expect(aggregateBatchStatus(['EXPANDING', 'EXTRACTING'])).toBe('RUNNING');
    expect(aggregateBatchStatus(['EXPANDING', 'FETCHING'])).toBe('RUNNING');
  });
});
