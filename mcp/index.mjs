#!/usr/bin/env node
/**
 * ai-data-flow MCP server
 *
 * ai-data-flow バックエンド（NestJS, /api 全292ルート）を APIキー認証で叩く MCP サーバ。
 * IPLoT 方法論パイプライン（Ph.0〜7 / ASIS・TOBEフロー / イシューツリー / GAP / DFD /
 * データカタログ / タスク / リスク / KPI / 導入状況）を curated ツールとして公開し、
 * curated 外の操作は list_capabilities + api_request でフォールバックできる。
 *
 * 環境変数:
 *   AIDATAFLOW_API_URL  バックエンドのベースURL（既定 http://localhost:5021）
 *   AIDATAFLOW_API_KEY  発行したAPIキー（sk_...）。必須。
 *
 * 起動: AIDATAFLOW_API_KEY=sk_... node index.mjs
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createApiClient } from './lib/api.mjs';
import { initOpenApi } from './lib/openapi.mjs';

import * as generic from './tools/generic.mjs';
import * as projects from './tools/projects.mjs';
import * as projectBundle from './tools/project_bundle.mjs';
import * as flows from './tools/flows.mjs';
import * as issuesGaps from './tools/issues_gaps.mjs';
import * as tobeRequirements from './tools/tobe_requirements.mjs';
import * as tasks from './tools/tasks.mjs';
import * as risksStakeholders from './tools/risks_stakeholders.mjs';
import * as masters from './tools/masters.mjs';
import * as dataObjectsDfd from './tools/data_objects_dfd.mjs';
import * as catalog from './tools/catalog.mjs';
import * as pm from './tools/pm.mjs';
import * as rbac from './tools/rbac.mjs';
import * as jobs from './tools/jobs.mjs';

const API_URL = (process.env.AIDATAFLOW_API_URL || 'http://localhost:5021').replace(/\/$/, '');
const API_KEY = process.env.AIDATAFLOW_API_KEY;

if (!API_KEY) {
  console.error(
    '[ai-data-flow-mcp] AIDATAFLOW_API_KEY is required (issue one via POST /api/api-keys).',
  );
  process.exit(1);
}

const call = createApiClient({ apiUrl: API_URL, apiKey: API_KEY });

const server = new McpServer({ name: 'ai-data-flow', version: '1.0.0' });

const modules = [
  generic,
  projects,
  projectBundle,
  flows,
  issuesGaps,
  tobeRequirements,
  tasks,
  risksStakeholders,
  masters,
  dataObjectsDfd,
  catalog,
  pm,
  rbac,
  jobs,
];

for (const mod of modules) {
  mod.registerTools(server, call);
}

// OpenAPI スペックを起動時に取得してキャッシュ（失敗してもサーバは起動する。
// その場合 list_capabilities がエラーメッセージを返すだけ）。
initOpenApi(API_URL);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[ai-data-flow-mcp] connected via stdio. API:', API_URL);
