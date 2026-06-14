/**
 * プロジェクトバンドル入出力（独自JSONバンドルの export / import / schema）
 *
 * 【AI 自走手順】プロジェクトの中身をまるごと取り込み・編集・書き戻しする場合:
 *   1) project_bundle_schema  … バンドルの機械可読 JSON Schema を取得して形式を把握する。
 *   2) project_export         … 対象プロジェクトの現状を1つの JSON バンドルとして取得する。
 *   3) （バンドルJSONをローカルで編集する）
 *   4) project_import         … 既存プロジェクトへ書き戻す（mode で merge / replace を選ぶ）。
 *      もしくは project_import_as_new … 同じ組織配下に新規プロジェクトを作って取り込む（複製/テンプレ展開）。
 *
 * mode:
 *   merge   … 既存データを残したまま追加で取り込む（既定）。
 *   replace … プロジェクト内の対象データを全消ししてからバンドルで再構築する。
 *
 * バンドルは seed-demo.ts と同じ FK 依存順（構築順）でエンティティを並べており、
 * export 対象モデルと import 順序の基準になっている。
 */

import { z } from 'zod';
import { wrap } from '../lib/api.mjs';

const importModeSchema = z
  .enum(['merge', 'replace'])
  .describe(
    '取り込みモード。merge=既存データを残して追加（既定） / replace=対象データを全消ししてバンドルで再構築',
  );

const bundleSchema = z
  .record(z.any())
  .describe(
    'プロジェクトバンドルJSON（project_export で取得した形式。形式は project_bundle_schema を参照）',
  );

export function registerTools(server, call) {
  server.tool(
    'project_bundle_schema',
    'プロジェクトバンドルの機械可読 JSON Schema（draft-07）を取得する。' +
      'AI はまずこれでバンドルの形式（section とフィールド）を把握してから ' +
      'project_export → 編集 → project_import の順で書き戻すとよい。認証不要の公開エンドポイント。',
    {},
    wrap(() => call('GET', '/export-schema')),
  );

  server.tool(
    'project_export',
    'プロジェクト全体を1つの独自JSONバンドルとして取得する（view 権限）。' +
      'フェーズ/フロー/イシュー/GAP/DFD/データカタログ/タスク/リスク/KPI/導入状況などを ' +
      'seed-demo.ts と同じ FK 依存順で含む。取得したバンドルを編集して project_import で書き戻せる。',
    {
      projectId: z.string().describe('エクスポート対象プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/export`)),
  );

  server.tool(
    'project_import',
    '既存プロジェクトへバンドルを取り込む（edit 権限）。' +
      'mode=merge（既定）は既存データを残して追加、mode=replace は対象データを全消ししてから再構築する。' +
      'バンドルは project_export で取得・編集したものを渡す（形式は project_bundle_schema 参照）。' +
      '取り込んだ section ごとの件数サマリを返す。',
    {
      projectId: z.string().describe('取り込み先プロジェクトID'),
      bundle: bundleSchema,
      mode: importModeSchema.optional(),
    },
    wrap(({ projectId, bundle, mode }) =>
      call('POST', `/projects/${projectId}/import`, {
        body: mode === undefined ? { bundle } : { bundle, mode },
      }),
    ),
  );

  server.tool(
    'project_import_as_new',
    '組織配下に新規プロジェクトを作成し、バンドルを取り込む（組織メンバー／super-admin のみ）。' +
      'プロジェクトの複製やテンプレ展開に使う。name 省略時はバンドルの project.name を使い、' +
      'slug は衝突時に自動でサフィックス付与してリネームする。' +
      '作成したプロジェクト情報と取り込み件数サマリを返す。',
    {
      organizationId: z.string().describe('取り込み先組織ID（org_list で取得）'),
      bundle: bundleSchema,
      name: z
        .string()
        .optional()
        .describe('新規プロジェクト名（省略時はバンドルの project.name を使用）'),
      mode: importModeSchema
        .optional()
        .describe('取り込みモード（新規プロジェクトなので merge / replace は実質同じ）'),
    },
    wrap(({ organizationId, bundle, name, mode }) => {
      const body = { bundle };
      if (name !== undefined) body.name = name;
      if (mode !== undefined) body.mode = mode;
      return call('POST', `/organizations/${organizationId}/projects/import`, {
        body,
      });
    }),
  );
}
