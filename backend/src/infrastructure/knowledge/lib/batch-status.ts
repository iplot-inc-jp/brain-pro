export type FileStatus =
  | 'PENDING'
  | 'FETCHING'
  | 'EXPANDING'
  | 'PREPROCESSING'
  | 'EXTRACTING'
  | 'MERGING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED';

export type BatchStatus =
  | 'PENDING'
  | 'EXPANDING'
  | 'RUNNING'
  | 'PARTIAL'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

// 通常パイプラインの進行中ステップ（EXPANDING はアーカイブ展開専用なので除外）。
const ACTIVE: FileStatus[] = [
  'FETCHING',
  'PREPROCESSING',
  'EXTRACTING',
  'MERGING',
];
const DONE: FileStatus[] = ['SUCCEEDED', 'SKIPPED'];

export function aggregateBatchStatus(files: FileStatus[]): BatchStatus {
  if (!files.length) return 'PENDING';
  // 通常処理が走っていれば RUNNING（EXPANDING より優先）。
  if (files.some((s) => ACTIVE.includes(s))) return 'RUNNING';
  // 進行中がアーカイブ EXPANDING のみ（通常 ACTIVE なし）なら EXPANDING を返す。
  if (files.some((s) => s === 'EXPANDING')) return 'EXPANDING';
  const allSettled = files.every((s) => DONE.includes(s) || s === 'FAILED');
  if (allSettled) {
    if (files.every((s) => DONE.includes(s))) return 'SUCCEEDED';
    if (files.every((s) => s === 'FAILED')) return 'FAILED';
    return 'PARTIAL';
  }
  if (files.every((s) => s === 'PENDING')) return 'PENDING';
  return 'RUNNING';
}
