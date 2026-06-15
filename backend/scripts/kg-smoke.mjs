/**
 * ナレッジグラフ取り込み Phase1 e2e スモーク。
 *
 * 何を検証するか:
 *   - settings get-or-create / PUT（課金ガード: AI/OCR OFF で素材だけ取り込む）
 *   - 複数アップロード（txt / xlsx / zip）→ /ingestion-uploads（Blob/ディスク保存）
 *   - バッチ作成 → inline 実行（ローカルは QStash 無 → enqueue が同期実行）
 *   - ZIP の自動展開（子 IngestionFile 生成 → 子も SUCCEEDED）
 *   - ファイルが全 SUCCEEDED / KnowledgeDocument 生成
 *   - 冪等性: 1ファイル retry → グラフ文書数が不変
 *   - （KG_AI=1 のとき）AI ON で 1ファイル → タグ/実体が付く
 *
 * 実行: backend/ で `node scripts/kg-smoke.mjs`（AI込みは `KG_AI=1 node scripts/kg-smoke.mjs`）
 * 前提: backend が :5021 で稼働、pg docker :5460、demo@iplot.local/password123。
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, '..');

// --- backend/.env を最小パースして process.env に流し込む（PrismaClient が DATABASE_URL を拾う） ---
try {
  const env = readFileSync(resolve(BACKEND_DIR, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch (e) {
  console.warn('!.env 読込失敗（DATABASE_URL が環境にある前提で続行）:', e.message);
}

const XLSX = require('xlsx');
const { zipSync, strToU8 } = require('fflate');
const { PrismaClient } = require('@prisma/client');

const API = process.env.KG_API || 'http://localhost:5021/api';
const prisma = new PrismaClient();

let PASS = 0, FAIL = 0;
const ok = (cond, msg) => { if (cond) { PASS++; console.log('  ✅', msg); } else { FAIL++; console.log('  ❌', msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API.replace(/\/api$/, '')}/api`, { method: 'GET' }); if (r.status) return true; } catch {}
    await sleep(1000);
  }
  throw new Error(`backend ${API} に到達できません`);
}

async function api(method, path, body, token) {
  const headers = { Authorization: token ? `Bearer ${token}` : undefined };
  let payload;
  if (body instanceof FormData) { payload = body; }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}

async function uploadFiles(projectId, token, items) {
  const fd = new FormData();
  for (const it of items) fd.append('files', new Blob([it.bytes], { type: it.mime }), it.filename);
  const res = await fetch(`${API}/projects/${projectId}/ingestion-uploads`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`upload → ${res.status}: ${JSON.stringify(json)}`);
  return json.uploads;
}

function makeXlsx() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['商品', '最小ロット', '仕入先'], ['段ボールA', 100, '山田製函'], ['テープB', 50, '佐藤包材']]);
  XLSX.utils.book_append_sheet(wb, ws, '商品マスタ');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
function makeZip() {
  return Buffer.from(zipSync({
    'memo.txt': strToU8('受注は営業部の田中が受け、在庫を確認してから出荷指示を出す。'),
    'list.csv': strToU8('項目,値\n受注番号,A-001\n担当,田中\n'),
    '__MACOSX/junk': strToU8('ignore me'),
  }));
}

async function pollTerminal(batchId, token, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const b = await api('GET', `/ingestion-batches/${batchId}`, undefined, token);
    const active = b.files.filter((f) => !['SUCCEEDED', 'FAILED', 'SKIPPED'].includes(f.status));
    if (active.length === 0) return b;
    await sleep(1500);
  }
  return api('GET', `/ingestion-batches/${batchId}`, undefined, token);
}

async function main() {
  console.log('=== KG 取り込み e2e スモーク ===\nAPI:', API);
  await waitHealthy();

  // 1) demo ユーザー（super-admin）＋ 任意プロジェクト（super-admin はメンバー判定をバイパス）
  const user = await prisma.user.findUnique({ where: { email: 'demo@iplot.local' } });
  if (!user) throw new Error('demo@iplot.local が見つかりません（seed 未投入？）');
  const project = await prisma.project.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!project) throw new Error('Project が1件もありません');
  console.log('project:', project.id, project.name);

  // 2) login
  const login = await api('POST', '/auth/login', { email: 'demo@iplot.local', password: 'password123' });
  const token = login.accessToken || login.access_token || login.token;
  ok(!!token, 'login → accessToken 取得');

  const pid = project.id;

  // 3) settings: get-or-create → AI/OCR OFF（コア機構をコスト0で検証）
  const s0 = await api('GET', `/projects/${pid}/knowledge/settings`, undefined, token);
  ok(typeof s0.aiExtractionEnabled === 'boolean', 'settings get-or-create');
  await api('PUT', `/projects/${pid}/knowledge/settings`, { aiExtractionEnabled: false, ocrEnabled: false, maxFilesPerBatch: 500 }, token);
  const s1 = await api('GET', `/projects/${pid}/knowledge/settings`, undefined, token);
  ok(s1.aiExtractionEnabled === false && s1.ocrEnabled === false, 'settings PUT 反映（AI/OCR OFF）');

  // 4) アップロード（txt / xlsx / zip）
  const uploads = await uploadFiles(pid, token, [
    { filename: 'gyomu.txt', mime: 'text/plain', bytes: Buffer.from('受注業務。担当は山田。受注システムで在庫確認し出荷する。', 'utf8') },
    { filename: 'master.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: makeXlsx() },
    { filename: 'bundle.zip', mime: 'application/zip', bytes: makeZip() },
  ]);
  ok(uploads.length === 3 && uploads.every((u) => u.blobUrl), `upload 3件（blobUrl 付与）`);

  // 5) バッチ作成（inline 実行される）
  const files = uploads.map((u) => ({ sourceType: 'UPLOAD', filename: u.filename, blobUrl: u.blobUrl, mimeType: u.mimeType, size: u.size }));
  const created = await api('POST', `/projects/${pid}/ingestion-batches`, { name: 'smoke', files }, token);
  ok(!!created.id && Array.isArray(created.files), `バッチ作成（${created.files?.length}ファイル）`);

  // 6) 全ファイル終端まで（inline でも保険でポーリング）
  const batch = await pollTerminal(created.id, token);
  const leaf = batch.files.filter((f) => !f.isArchive);
  const archives = batch.files.filter((f) => f.isArchive);
  const succeeded = batch.files.filter((f) => f.status === 'SUCCEEDED');
  const failed = batch.files.filter((f) => f.status === 'FAILED');
  console.log('  files:', batch.files.map((f) => `${f.filename}:${f.status}${f.isArchive ? '(zip)' : ''}`).join(', '));
  if (failed.length) console.log('  失敗詳細:', failed.map((f) => `${f.filename}=${f.error}`).join(' | '));
  ok(failed.length === 0, '失敗ファイル 0');
  ok(archives.length === 1 && archives[0].status === 'SUCCEEDED', 'ZIP が SUCCEEDED');
  // ZIP 展開の子（__MACOSX は除外されるので memo.txt + list.csv = 2件）
  const children = leaf.filter((f) => f.parentFileId);
  ok(children.length === 2, `ZIP 展開で子2件生成（__MACOSX 除外）: ${children.length}`);
  ok(children.every((f) => f.status === 'SUCCEEDED'), '子ファイルも SUCCEEDED');
  ok(succeeded.length === batch.files.length, `全 ${batch.files.length} ファイル SUCCEEDED`);

  // 7) グラフ: 文書ノードが生成されている（AI OFF なのでタグ/実体は無くてよい）
  const g1 = await api('GET', `/projects/${pid}/knowledge/graph`, undefined, token);
  const docCountBefore = g1.documents.length;
  ok(docCountBefore >= 4, `KnowledgeDocument 生成（${docCountBefore}件 ≥ 4: txt/xlsx/memo/list）`);

  // 8) 冪等性: 1ファイル retry → 文書数が増えない（ingestionFileId で upsert）
  const aLeaf = leaf.find((f) => f.status === 'SUCCEEDED');
  await api('POST', `/ingestion-files/${aLeaf.id}/retry`, {}, token);
  await pollTerminal(created.id, token);
  const g2 = await api('GET', `/projects/${pid}/knowledge/graph`, undefined, token);
  ok(g2.documents.length === docCountBefore, `retry 後も文書数不変（冪等）: ${docCountBefore} → ${g2.documents.length}`);

  // 8b) Phase3 Drive: ローカルは Google creds 無 → 503 degrade（フロントは未設定表示にフォールバック）
  const driveRes = await fetch(`${API}/projects/${pid}/drive/files`, { headers: { Authorization: `Bearer ${token}` } });
  ok(driveRes.status === 503, `Drive 未設定で 503 degrade: ${driveRes.status}`);

  // 8c) Phase4 ProjectBundle export に KG セクション（entities.knowledge）が含まれる（round-trip 基盤）
  const bundle = await api('GET', `/projects/${pid}/export`, undefined, token);
  const ents = bundle.entities || bundle;
  const kg = ents.knowledge;
  ok(Array.isArray(kg) && kg.length > 0, `bundle export に knowledge セクション含む（${Array.isArray(kg) ? kg.length + '件' : '無し'}）`);

  // 8d) セキュリティ: client 由来の不正 blobUrl（SSRF/LFI）はバッチ作成で拒否される
  let blockedSsrf = false;
  try {
    await api('POST', `/projects/${pid}/ingestion-batches`, { name: 'evil', files: [{ sourceType: 'UPLOAD', filename: 'p', blobUrl: 'file:///etc/passwd' }] }, token);
  } catch (e) {
    blockedSsrf = /400|不正|保存先/.test(e.message);
  }
  ok(blockedSsrf, '不正 blobUrl（file:///etc/passwd）をバッチ作成で拒否（SSRF/LFI 防御）');

  // 8e) 一覧編集API: 文書 PATCH(タイトル)→ DELETE（mention は Cascade で消える）
  const gNow = await api('GET', `/projects/${pid}/knowledge/graph`, undefined, token);
  if (gNow.documents.length > 0) {
    const doc = gNow.documents[0];
    const upd = await api('PATCH', `/knowledge-documents/${doc.id}`, { title: (doc.title || 'doc') + ' [edited]' }, token);
    ok(typeof upd.title === 'string' && upd.title.endsWith('[edited]'), '文書 PATCH（タイトル編集）');
    const del = await api('DELETE', `/knowledge-documents/${doc.id}`, undefined, token);
    ok(del.success === true, '文書 DELETE');
    const gAfter = await api('GET', `/projects/${pid}/knowledge/graph`, undefined, token);
    ok(gAfter.documents.length === gNow.documents.length - 1, `削除で文書数 -1（${gNow.documents.length}→${gAfter.documents.length}）`);
  } else { ok(true, '文書編集: 文書0のためスキップ'); }

  // 8f) 一覧編集API: 同 type の2ノードを統合 merge（high-degree でも timeout しない set-based）
  const gN = await api('GET', `/projects/${pid}/knowledge/graph`, undefined, token);
  const byType = {};
  for (const n of gN.nodes) (byType[n.type] = byType[n.type] || []).push(n);
  const pair = Object.values(byType).find((arr) => arr.length >= 2);
  if (pair) {
    const [a, b] = pair;
    const merged = await api('POST', `/knowledge-nodes/${b.id}/merge`, { targetNodeId: a.id }, token);
    ok(!!merged && merged.id === a.id, 'ノード統合 merge（target を返す）');
    const gM = await api('GET', `/projects/${pid}/knowledge/graph`, undefined, token);
    ok(!gM.nodes.find((n) => n.id === b.id), 'merge で source ノード消滅（mention/relation 付替え）');
  } else { ok(true, 'merge: 同typeの2ノードが無いためスキップ'); }

  // 9) （任意）AI ON で 1ファイル → タグ/実体が付く
  if (process.env.KG_AI === '1') {
    console.log('--- AI ON テスト（Claude 実呼び出し・少額課金）---');
    await api('PUT', `/projects/${pid}/knowledge/settings`, { aiExtractionEnabled: true, ocrEnabled: false }, token);
    const up = await uploadFiles(pid, token, [
      { filename: 'ai.txt', mime: 'text/plain', bytes: Buffer.from('株式会社グリーンファクトリーの田中部長は、受注管理システムを使って在庫を確認し、出荷指示を出す。', 'utf8') },
    ]);
    const b = await api('POST', `/projects/${pid}/ingestion-batches`, { name: 'smoke-ai', files: up.map((u) => ({ sourceType: 'UPLOAD', filename: u.filename, blobUrl: u.blobUrl, mimeType: u.mimeType, size: u.size })) }, token);
    const bd = await pollTerminal(b.id, token, 90000);
    const aiFailed = bd.files.filter((f) => f.status === 'FAILED');
    if (aiFailed.length) console.log('  AI 失敗:', aiFailed.map((f) => f.error).join(' | '));
    ok(aiFailed.length === 0, 'AI ファイル SUCCEEDED');
    const g3 = await api('GET', `/projects/${pid}/knowledge/graph`, undefined, token);
    ok(g3.nodes.length > 0, `タグ/実体ノード生成: ${g3.nodes.length}`);
    console.log('  nodes(sample):', g3.nodes.slice(0, 8).map((n) => `${n.label}[${n.type}]`).join(', '));
    console.log('  edges:', g3.edges.length);
  }

  console.log(`\n=== 結果: ${PASS} PASS / ${FAIL} FAIL ===`);
  await prisma.$disconnect();
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error('\n💥 スモーク中断:', e.message); await prisma.$disconnect().catch(() => {}); process.exit(1); });
