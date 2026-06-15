// 名寄せキー算出はドメイン値オブジェクトを単一の真実とする（KnowledgeNode の改名再計算と共有）。
// 非文字列入力（null/undefined/数値等）は空文字を返す頑健化も VO 側に集約済み。
export { normalizeLabel } from '../../../domain/value-objects/normalize-label.vo';
