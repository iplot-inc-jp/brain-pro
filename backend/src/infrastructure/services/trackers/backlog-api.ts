/**
 * Backlog (Nulab) REST API v2 の薄ラッパ（課題取得 = pull 専用）。
 *
 * 認証は ?apiKey= のクエリ方式（GitHub/Jira の Authorization ヘッダとは異なる）。
 * host はテナント毎に異なる（{space}.backlog.com / .jp / 旧 backlogtool.com）ので接続設定で保持する。
 *
 * 参考: /Users/kazuyukijimbo/ipro-bot/src/integrations/backlog-api.ts（起票含むフル実装）。
 * 本ファイルは「移行/同期のための pull」に絞り、正規化済み NormalizedIssue[] を返す。
 */
import { assertSafeOutboundUrl } from '../url-safety';
import { fetchWithRetry } from './rate-limit';
import {
  ListIssuesOptions,
  NormalizedComment,
  NormalizedIssue,
  TrackerTestResult,
} from './types';

/** 課題取得の暴走防止（1 import あたりの上限）。 */
const DEFAULT_MAX_ISSUES = 5000;
/** 1 ページの件数（Backlog の上限は 100）。 */
const PAGE_COUNT = 100;
/** コメント取得の 1 課題あたり上限ページ。 */
const COMMENT_PAGE_COUNT = 100;

/** host を正規化（スキーム/末尾スラッシュ除去）。"https://x.backlog.com/" → "x.backlog.com"。 */
export function normalizeHost(raw: string): string {
  return (raw || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

/**
 * SSRF 対策: host を https URL に組み立てて assertSafeOutboundUrl で検証する。
 * 内部/メタデータ宛（169.254.169.254 / localhost 等）は UnsafeUrlError を投げる。
 * apiKey はクエリに付けず host のみで判定するため、エラーに秘匿情報は載らない。
 * 接続作成/更新時の事前検証と、各 fetch 直前の再検証（TOCTOU 緩和）の双方から呼ぶ。
 */
export async function assertBacklogHostSafe(host: string): Promise<void> {
  await assertSafeOutboundUrl(`https://${normalizeHost(host)}/`);
}

function buildUrl(
  host: string,
  apiKey: string,
  path: string,
  params?: Record<string, string | number | undefined | number[]>,
): string {
  const u = new URL(`https://${normalizeHost(host)}/api/v2${path}`);
  u.searchParams.set('apiKey', apiKey);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === '') continue;
      if (Array.isArray(v)) {
        // projectId[]=1 のような配列クエリ
        for (const item of v) u.searchParams.append(k, String(item));
      } else {
        u.searchParams.set(k, String(v));
      }
    }
  }
  return u.toString();
}

async function bget<T>(
  host: string,
  apiKey: string,
  path: string,
  params?: Record<string, string | number | undefined | number[]>,
): Promise<T> {
  // SSRF 対策: fetch 直前に宛先ホストを再検証する（webhook と同じ運用）。
  // DNS リバインディング/TOCTOU を緩和し、内部/メタデータ宛は UnsafeUrlError で弾く。
  await assertBacklogHostSafe(host);
  const url = buildUrl(host, apiKey, path, params);
  // レート制限(429)/一時障害(503) は Retry-After を尊重して再試行する
  // （課題ページングの途中で import 全体が abort しないように）。
  const res = await fetchWithRetry(() =>
    fetch(url, {
      // SSRF 対策: リダイレクトは追従しない（リダイレクト型 SSRF の緩和）。
      redirect: 'manual',
    }),
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Backlog API ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// ===== Backlog の生レスポンス型（最小限） =====
interface BacklogProject {
  id: number;
  projectKey: string;
  name: string;
}

interface BacklogUser {
  id: number;
  name?: string;
}

interface BacklogIssueRaw {
  issueKey?: string;
  summary?: string;
  description?: string;
  status?: { name?: string };
  priority?: { name?: string };
  // Backlog の種別（例: "タスク" / "バグ" / "子課題" / "Story" 等。プロジェクト毎に定義可）。
  issueType?: { name?: string } | null;
  assignee?: BacklogUser | null;
  startDate?: string | null;
  dueDate?: string | null;
  estimatedHours?: number | null;
  actualHours?: number | null;
  parentIssueId?: number | null;
  id?: number;
}

interface BacklogCommentRaw {
  id?: number;
  content?: string | null;
  createdUser?: BacklogUser | null;
  created?: string | null;
}

/**
 * 接続テスト: プロジェクト一覧（または指定 projectKey の解決）を試し ok/エラーを返す。
 * 秘匿情報（apiKey）はエラーメッセージに含めない。
 */
export async function backlogTest(
  host: string,
  apiKey: string,
  projectKey?: string | null,
): Promise<TrackerTestResult> {
  try {
    if (projectKey) {
      const proj = await bget<BacklogProject>(
        host,
        apiKey,
        `/projects/${encodeURIComponent(projectKey)}`,
      );
      return {
        ok: true,
        detail: `プロジェクト「${proj.name}」(${proj.projectKey}) に接続できました`,
      };
    }
    const projects = await bget<BacklogProject[]>(host, apiKey, `/projects`);
    return {
      ok: true,
      detail: `${projects?.length ?? 0} 件のプロジェクトに接続できました`,
    };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
}

/** projectKey → projectId を解決（指定が無ければ null = スペース全体）。 */
async function resolveProjectId(
  host: string,
  apiKey: string,
  projectKey?: string | null,
): Promise<number | null> {
  if (!projectKey) return null;
  const proj = await bget<BacklogProject>(
    host,
    apiKey,
    `/projects/${encodeURIComponent(projectKey)}`,
  );
  if (!proj?.id) {
    throw new Error(
      `Backlog のプロジェクトキー「${projectKey}」が解決できません（権限/キーを確認）`,
    );
  }
  return proj.id;
}

/** 1 課題のコメントを取得して正規化（古い順）。 */
async function fetchComments(
  host: string,
  apiKey: string,
  issueKey: string,
): Promise<NormalizedComment[]> {
  // Backlog のコメントは新しい順がデフォルト。order=asc で古い順に取得し、
  // 最初の 1 ページ（最大 100 件）に絞る（移行の文脈では十分）。
  const rows = await bget<BacklogCommentRaw[]>(
    host,
    apiKey,
    `/issues/${encodeURIComponent(issueKey)}/comments`,
    { count: COMMENT_PAGE_COUNT, order: 'asc' },
  );
  return (rows ?? [])
    .filter((c) => (c.content ?? '').trim().length > 0)
    .map((c) => ({
      authorName: c.createdUser?.name ?? null,
      body: c.content ?? '',
      createdAt: c.created ?? null,
    }));
}

/**
 * 課題を全件取得して NormalizedIssue[] を返す（offset/count ページング）。
 *   - projectKey 指定時はそのプロジェクトに限定、無ければスペース全体。
 *   - updatedSince で差分取得（更新がそれ以降の課題のみ）。
 *   - parentExternalKey は parentIssueId（数値）を id→issueKey マップで後解決する。
 */
export async function backlogListIssues(
  host: string,
  apiKey: string,
  projectKey?: string | null,
  opts: ListIssuesOptions = {},
): Promise<NormalizedIssue[]> {
  const projectId = await resolveProjectId(host, apiKey, projectKey);
  const maxIssues = opts.maxIssues ?? DEFAULT_MAX_ISSUES;

  // id → issueKey マップ（parentIssueId を親課題キーへ解決するため）。
  const idToKey = new Map<number, string>();
  const raws: BacklogIssueRaw[] = [];

  let offset = 0;
  // 無限ループ防止: maxIssues に達するか、ページが空になるまで。
  while (raws.length < maxIssues) {
    const page = await bget<BacklogIssueRaw[]>(host, apiKey, `/issues`, {
      ...(projectId != null ? { 'projectId[]': [projectId] } : {}),
      count: PAGE_COUNT,
      offset,
      sort: 'updated',
      order: 'desc',
      updatedSince: backlogDate(opts.updatedSince),
    });
    if (!page || page.length === 0) break;
    for (const r of page) {
      if (r.issueKey && r.id != null) idToKey.set(r.id, r.issueKey);
      raws.push(r);
    }
    if (page.length < PAGE_COUNT) break; // 最終ページ
    offset += PAGE_COUNT;
  }

  const issues: NormalizedIssue[] = [];
  for (const r of raws.slice(0, maxIssues)) {
    if (!r.issueKey) continue;
    const parentExternalKey =
      r.parentIssueId != null ? (idToKey.get(r.parentIssueId) ?? null) : null;

    let comments: NormalizedComment[] | undefined;
    if (opts.includeComments) {
      try {
        comments = await fetchComments(host, apiKey, r.issueKey);
      } catch {
        // コメント取得失敗は課題本体の取込を止めない（best-effort）。
        comments = undefined;
      }
    }

    issues.push(normalizeBacklogIssue(r, parentExternalKey, comments));
  }
  return issues;
}

/**
 * 1 件の生 Backlog 課題を NormalizedIssue に畳む。
 * backlogListIssues / backlogGetIssue（webhook の単一取得）で共通利用する。
 * parentExternalKey は呼び出し側で解決済みのものを受け取る（list は id→key マップ、
 * single は親 1 件を追加 fetch して解決）。
 */
function normalizeBacklogIssue(
  r: BacklogIssueRaw,
  parentExternalKey: string | null,
  comments: NormalizedComment[] | undefined,
): NormalizedIssue {
  return {
    externalKey: r.issueKey ?? '',
    title: r.summary ?? '(no title)',
    description: r.description ?? null,
    status: r.status?.name ?? null,
    priority: r.priority?.name ?? null,
    assigneeName: r.assignee?.name ?? null,
    startDate: r.startDate ?? null,
    dueDate: r.dueDate ?? null,
    estimatedHours:
      typeof r.estimatedHours === 'number' ? r.estimatedHours : null,
    actualHours: typeof r.actualHours === 'number' ? r.actualHours : null,
    parentExternalKey,
    issueType: r.issueType?.name ?? null,
    // Backlog API は Epic Link / Story Points / Sprint の標準提供が無いため null。
    epicExternalKey: null,
    storyPoints: null,
    sprint: null,
    comments,
  };
}

/**
 * 単一課題を取得して NormalizedIssue を返す（webhook 受信時の 1 課題 import 用）。
 * GET /api/v2/issues/{idOrKey} で 1 件 fetch し、backlogListIssues と同じ正規化を施す。
 * 親（parentIssueId）がある場合は親 1 件を追加 fetch して issueKey を解決する。
 * 課題が存在しない（404）場合は null を返す（削除済み/権限外）。
 */
export async function backlogGetIssue(
  host: string,
  apiKey: string,
  issueKey: string,
  opts: { includeComments?: boolean } = {},
): Promise<NormalizedIssue | null> {
  let raw: BacklogIssueRaw;
  try {
    raw = await bget<BacklogIssueRaw>(
      host,
      apiKey,
      `/issues/${encodeURIComponent(issueKey)}`,
    );
  } catch (e) {
    // 404（存在しない/削除済み）は not_found 扱いで null。それ以外は呼び出し側に伝播。
    if (/Backlog API 404/.test((e as Error)?.message ?? '')) return null;
    throw e;
  }
  if (!raw?.issueKey) return null;

  // 親課題キーを解決（parentIssueId → issueKey は別 fetch が必要）。失敗時は親なし。
  let parentExternalKey: string | null = null;
  if (raw.parentIssueId != null) {
    try {
      const parent = await bget<BacklogIssueRaw>(
        host,
        apiKey,
        `/issues/${raw.parentIssueId}`,
      );
      parentExternalKey = parent?.issueKey ?? null;
    } catch {
      parentExternalKey = null;
    }
  }

  let comments: NormalizedComment[] | undefined;
  if (opts.includeComments) {
    try {
      comments = await fetchComments(host, apiKey, raw.issueKey);
    } catch {
      comments = undefined;
    }
  }
  return normalizeBacklogIssue(raw, parentExternalKey, comments);
}

/** updatedSince を Backlog 形式（YYYY-MM-DD）に丸める。ISO 日時もこの形に落とす。 */
function backlogDate(since?: string | null): string | undefined {
  if (!since) return undefined;
  const d = new Date(since);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}
