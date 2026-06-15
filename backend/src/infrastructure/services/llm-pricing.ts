/**
 * Claude(Anthropic) モデルの概算単価（USD / 100万トークン=MTok）と概算コスト計算。
 *
 * 単価は「概算」（2026-06 時点・claude-api スキル / 公式ページ準拠）。最新の正確な値は
 * claude-api スキルや platform.claude.com/pricing で確認して更新すること。
 * 前方一致＋最長一致でモデルを引き、未知モデルは既定(Sonnet)にフォールバックする。
 */
export interface ModelPricing {
  /** 入力 USD / MTok。 */
  inputPerMTok: number;
  /** 出力 USD / MTok。 */
  outputPerMTok: number;
}

/** 既定（未知モデルのフォールバック）= Sonnet 4.6 相当。 */
const DEFAULT_PRICING: ModelPricing = { inputPerMTok: 3, outputPerMTok: 15 };

/** モデルID（前方一致）→ 単価。長いキー優先でマッチ。 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-fable': { inputPerMTok: 10, outputPerMTok: 50 },
  'claude-opus': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku': { inputPerMTok: 1, outputPerMTok: 5 },
};

/** モデルID から単価を引く（前方一致・最長一致優先・未知は既定）。 */
export function pricingFor(model: string): ModelPricing {
  const key = Object.keys(MODEL_PRICING)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? MODEL_PRICING[key] : DEFAULT_PRICING;
}

/**
 * 概算コスト（USD）。cache read は入力の 0.1 倍、cache creation は 1.25 倍で概算する
 * （Anthropic prompt caching の一般的な比率に近い概算。正確値は claude-api 参照）。
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadInputTokens = 0,
  cacheCreationInputTokens = 0,
): number {
  const p = pricingFor(model);
  const input = (inputTokens / 1_000_000) * p.inputPerMTok;
  const output = (outputTokens / 1_000_000) * p.outputPerMTok;
  const cacheRead = (cacheReadInputTokens / 1_000_000) * p.inputPerMTok * 0.1;
  const cacheCreate =
    (cacheCreationInputTokens / 1_000_000) * p.inputPerMTok * 1.25;
  return input + output + cacheRead + cacheCreate;
}
