/**
 * ナレッジノードの名寄せキー（normalizedLabel）を算出する純関数。
 *
 * 全角英数記号/空白→半角（NFKC）→ 小文字化 → 連続空白の圧縮 → 前後 trim。
 * 文書横断のノードマージ（@@unique([projectId, type, normalizedLabel])）の一意キーに使う。
 *
 * ドメイン層に置くことで、KnowledgeNode エンティティ（改名時の再計算）と
 * 抽出パイプライン（merge-plan）の双方が同一ロジックを共有する（infra 側は本実装を再エクスポート）。
 *
 * 非文字列入力（null/undefined/数値等）は空文字を返す（頑健化）。
 */
export function normalizeLabel(input: string): string {
  if (typeof input !== 'string') return '';
  if (!input) return '';
  return input
    .normalize('NFKC') // 全角英数記号/空白→半角
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
