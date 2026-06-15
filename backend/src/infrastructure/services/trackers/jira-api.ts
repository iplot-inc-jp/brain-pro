/**
 * Atlassian Jira Cloud REST API v3 の薄ラッパ（課題取得 = pull 専用）。
 *
 * 認証は Basic（email:apiToken を base64）。host はサイト URL（例 https://xxx.atlassian.net）。
 * 課題は GET /rest/api/3/search を JQL + startAt/maxResults でページングして全件取得する。
 * description/comment は ADF（Atlassian Document Format, JSON）なのでプレーンテキストに畳む。
 *
 * Backlog は ipro-bot に参考実装があるが Jira は無いため新規実装。
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
/** 1 ページの件数（Jira の上限は通常 100）。 */
const PAGE_SIZE = 100;
/** コメント取得の 1 課題あたり上限。 */
const COMMENT_MAX = 100;

/**
 * アジャイル拡張のカスタムフィールド（代表値）。
 * インスタンス毎に customfield 番号が異なるため、Jira Cloud の典型的な既定値を best-effort で走査する。
 *   - Epic Link: customfield_10014（"team-managed" は parent で表現されるため parent も後段で見る）。
 *     インスタンス差を吸収するため 10008 等の代表代替番号も列挙する。
 *   - Story Points: customfield_10016（company-managed）/ 10026 / 10004 / 10002（テンプレ差）。
 *     "Story point estimate"（team-managed）の 10016 とは別番号のことがあるため複数走査。
 *   - Sprint: customfield_10020 / 10010 / 10018（active/最後の sprint name を抽出）。
 */
const EPIC_LINK_FIELDS = ['customfield_10014', 'customfield_10008'];
const STORY_POINTS_FIELDS = [
  'customfield_10016',
  'customfield_10026',
  'customfield_10004',
  'customfield_10002',
];
const SPRINT_FIELDS = [
  'customfield_10020',
  'customfield_10010',
  'customfield_10018',
];
const AGILE_CUSTOM_FIELDS = [
  ...EPIC_LINK_FIELDS,
  ...STORY_POINTS_FIELDS,
  ...SPRINT_FIELDS,
];

/** siteUrl を正規化（末尾スラッシュ除去）。スキームは保持（https 前提）。 */
export function normalizeSiteUrl(raw: string): string {
  let s = (raw || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) {
    // スキーム省略時は https を補う（Jira Cloud は https）。
    s = `https://${s}`;
  }
  return s;
}

/**
 * SSRF 対策: siteUrl を assertSafeOutboundUrl で検証する。
 * 内部/メタデータ宛（169.254.169.254 / localhost 等）は UnsafeUrlError を投げる。
 * Authorization ヘッダはここでは付かないため、エラーに秘匿情報は載らない。
 * 接続作成/更新時の事前検証と、各 fetch 直前の再検証（TOCTOU 緩和）の双方から呼ぶ。
 */
export async function assertJiraSiteUrlSafe(siteUrl: string): Promise<void> {
  await assertSafeOutboundUrl(normalizeSiteUrl(siteUrl));
}

function authHeader(email: string, apiToken: string): string {
  const token = Buffer.from(`${email}:${apiToken}`).toString('base64');
  return `Basic ${token}`;
}

async function jget<T>(
  siteUrl: string,
  email: string,
  apiToken: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const u = new URL(`${normalizeSiteUrl(siteUrl)}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') u.searchParams.set(k, String(v));
    }
  }
  // SSRF 対策: fetch 直前に宛先ホストを再検証する（webhook と同じ運用）。
  await assertJiraSiteUrlSafe(siteUrl);
  // レート制限(429)/一時障害(503) は Retry-After を尊重して再試行する。
  const res = await fetchWithRetry(() =>
    fetch(u.toString(), {
      headers: {
        authorization: authHeader(email, apiToken),
        accept: 'application/json',
      },
      redirect: 'manual',
    }),
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira API ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/**
 * POST で JSON body を送る（拡張 JQL 検索 /rest/api/3/search/jql 用）。
 * 旧 GET /search は 410 で撤去されたため、課題検索はこちらを使う。
 * 長い JQL でも URL 長制限に当たらないよう body 送信にする。
 */
async function jpost<T>(
  siteUrl: string,
  email: string,
  apiToken: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  // SSRF 対策: fetch 直前に宛先ホストを再検証する（webhook と同じ運用）。
  await assertJiraSiteUrlSafe(siteUrl);
  const requestUrl = `${normalizeSiteUrl(siteUrl)}${path}`;
  const payload = JSON.stringify(body);
  // レート制限(429)/一時障害(503) は Retry-After を尊重して再試行する。
  const res = await fetchWithRetry(() =>
    fetch(requestUrl, {
      method: 'POST',
      headers: {
        authorization: authHeader(email, apiToken),
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: payload,
      redirect: 'manual',
    }),
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira API ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// ===== Jira の生レスポンス型（最小限） =====
interface JiraUser {
  displayName?: string;
}

interface JiraTimeTracking {
  originalEstimateSeconds?: number;
  timeSpentSeconds?: number;
}

interface JiraIssueFields {
  summary?: string;
  description?: unknown; // ADF or null
  status?: { name?: string };
  priority?: { name?: string } | null;
  assignee?: JiraUser | null;
  duedate?: string | null;
  // Jira の開始日はカスタムフィールド差があるため、標準で取れる範囲のみ扱う。
  parent?: { key?: string } | null;
  issuetype?: { name?: string } | null;
  timetracking?: JiraTimeTracking | null;
  created?: string | null;
  updated?: string | null;
  // Epic Link / Story Points / Sprint はインスタンス毎に customfield 番号が異なるため、
  // 代表 customfield を best-effort で走査する（取れなければ null）。任意キーを許容。
  [customField: string]: unknown;
}

interface JiraIssueRaw {
  key?: string;
  fields?: JiraIssueFields;
}

/**
 * 拡張 JQL 検索 /rest/api/3/search/jql のレスポンス。
 * 旧 /search と異なり total は無く、ページングは nextPageToken（カーソル）で行う。
 * isLast が true、または nextPageToken が無ければ最終ページ。
 */
interface JiraSearchResponse {
  issues?: JiraIssueRaw[];
  nextPageToken?: string | null;
  isLast?: boolean;
}

interface JiraCommentRaw {
  author?: JiraUser | null;
  body?: unknown; // ADF
  created?: string | null;
}

interface JiraCommentResponse {
  comments?: JiraCommentRaw[];
}

/**
 * ADF（Atlassian Document Format）/ プレーン文字列をプレーンテキストへ畳む。
 * ノードを再帰的に辿り text を連結、paragraph/heading 境界で改行を入れる。
 * 文字列がそのまま来た場合はそのまま返す（古い API 形式の保険）。
 */
export function adfToText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node !== 'object') return String(node);

  const n = node as {
    type?: string;
    text?: string;
    content?: unknown[];
  };

  let out = '';
  if (typeof n.text === 'string') out += n.text;
  if (Array.isArray(n.content)) {
    for (const child of n.content) out += adfToText(child);
  }
  // ブロック境界で改行（段落/見出し/リスト項目）。
  if (
    n.type === 'paragraph' ||
    n.type === 'heading' ||
    n.type === 'listItem' ||
    n.type === 'blockquote'
  ) {
    out += '\n';
  }
  return out;
}

function cleanText(node: unknown): string | null {
  const t = adfToText(node).replace(/\n{3,}/g, '\n\n').trim();
  return t.length > 0 ? t : null;
}

/**
 * 接続テスト: 自分の情報（/myself）を取得して ok/エラーを返す。
 * projectKey 指定時はそのプロジェクトの存在も軽く確認する。
 */
export async function jiraTest(
  siteUrl: string,
  email: string,
  apiToken: string,
  projectKey?: string | null,
): Promise<TrackerTestResult> {
  try {
    const me = await jget<{ displayName?: string; emailAddress?: string }>(
      siteUrl,
      email,
      apiToken,
      '/rest/api/3/myself',
    );
    if (projectKey) {
      const proj = await jget<{ key?: string; name?: string }>(
        siteUrl,
        email,
        apiToken,
        `/rest/api/3/project/${encodeURIComponent(projectKey)}`,
      );
      return {
        ok: true,
        detail: `${me.displayName ?? me.emailAddress ?? 'ユーザー'} としてプロジェクト「${proj.name ?? proj.key}」に接続できました`,
      };
    }
    return {
      ok: true,
      detail: `${me.displayName ?? me.emailAddress ?? 'ユーザー'} として接続できました`,
    };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
}

/**
 * Jira の projectKey として妥当な形か。先頭は英字、以降は英数字/アンダースコアのみ。
 * これに合致しないものは JQL に載せない（JQL インジェクション残余の排除）。
 */
function isValidProjectKey(key: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(key);
}

/** JQL を組み立てる（projectKey と updatedSince を考慮）。 */
function buildJql(
  projectKey?: string | null,
  updatedSince?: string | null,
): string {
  const clauses: string[] = [];
  if (projectKey) {
    const pk = projectKey.trim();
    // 不正な projectKey はインジェクションを避けるため JQL に載せない（例外にはしない）。
    if (isValidProjectKey(pk)) {
      clauses.push(`project = "${pk}"`);
    }
  }
  if (updatedSince) {
    const d = new Date(updatedSince);
    if (!Number.isNaN(d.getTime())) {
      // Jira JQL の日時形式 "yyyy/MM/dd HH:mm"。
      const fmt = jiraJqlDate(d);
      clauses.push(`updated >= "${fmt}"`);
    }
  }
  const where = clauses.length > 0 ? clauses.join(' AND ') : '';
  // 安定したページングのため order by を付与。
  return `${where}${where ? ' ' : ''}ORDER BY updated DESC`.trim();
}

function jiraJqlDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 1 課題のコメントを取得して正規化（古い順）。 */
async function fetchComments(
  siteUrl: string,
  email: string,
  apiToken: string,
  issueKey: string,
): Promise<NormalizedComment[]> {
  const resp = await jget<JiraCommentResponse>(
    siteUrl,
    email,
    apiToken,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
    { maxResults: COMMENT_MAX, orderBy: 'created' },
  );
  return (resp.comments ?? [])
    .map((c) => ({
      authorName: c.author?.displayName ?? null,
      body: cleanText(c.body) ?? '',
      createdAt: c.created ?? null,
    }))
    .filter((c) => c.body.trim().length > 0);
}

/**
 * 課題を全件取得して NormalizedIssue[] を返す（startAt/maxResults ページング）。
 *   - projectKey 指定時はそのプロジェクトに限定。
 *   - updatedSince で差分取得（JQL `updated >=`）。
 *   - timetracking から originalEstimate/timeSpent を時間に換算。
 *   - parent.key を parentExternalKey に写す（subtask の親）。
 */
export async function jiraListIssues(
  siteUrl: string,
  email: string,
  apiToken: string,
  projectKey?: string | null,
  opts: ListIssuesOptions = {},
): Promise<NormalizedIssue[]> {
  const jql = buildJql(projectKey, opts.updatedSince);
  const maxIssues = opts.maxIssues ?? DEFAULT_MAX_ISSUES;
  const fields = [
    'summary',
    'description',
    'status',
    'priority',
    'assignee',
    'duedate',
    'parent',
    'issuetype',
    'timetracking',
    'created',
    'updated',
    // アジャイル拡張のカスタムフィールド（インスタンス毎に番号差があるため代表値を取得）。
    // Epic Link: 代表 customfield_10014。Story Points: 10016 / 10026。Sprint: 10020。
    ...AGILE_CUSTOM_FIELDS,
  ];

  // 拡張 JQL 検索 /rest/api/3/search/jql を使う（旧 GET /search は 410 で撤去）。
  // ページングは nextPageToken（カーソル）。total が無いので「次トークンが無い/isLast/空ページ」で終端。
  const raws: JiraIssueRaw[] = [];
  let nextPageToken: string | null | undefined = undefined;
  // 無限ループ防止: maxIssues 上限 + 反復回数の安全弁
  // （新エンドポイントは nextPageToken が尽きないバグ報告があるため、ページ数も上限で縛る）。
  const maxPages = Math.ceil(maxIssues / PAGE_SIZE) + 1;
  let pages = 0;
  const seenTokens = new Set<string>();
  while (raws.length < maxIssues && pages < maxPages) {
    const body: Record<string, unknown> = {
      jql,
      maxResults: PAGE_SIZE,
      fields,
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const resp = await jpost<JiraSearchResponse>(
      siteUrl,
      email,
      apiToken,
      '/rest/api/3/search/jql',
      body,
    );
    pages++;
    const page = resp.issues ?? [];
    if (page.length === 0) break;
    raws.push(...page);
    if (resp.isLast === true) break;
    const token: string | null = resp.nextPageToken ?? null;
    // 次トークンが無い、または同じトークンが再び来た（報告のあるループバグ）なら終端。
    if (!token || seenTokens.has(token)) break;
    seenTokens.add(token);
    nextPageToken = token;
  }

  const issues: NormalizedIssue[] = [];
  for (const r of raws.slice(0, maxIssues)) {
    if (!r.key) continue;
    let comments: NormalizedComment[] | undefined;
    if (opts.includeComments) {
      try {
        comments = await fetchComments(siteUrl, email, apiToken, r.key);
      } catch {
        comments = undefined;
      }
    }
    issues.push(normalizeJiraIssue(r, comments));
  }
  return issues;
}

/**
 * 1 件の生 Jira 課題（key + fields）を NormalizedIssue に畳む。
 * jiraListIssues / jiraGetIssue（webhook の単一取得）で共通利用する。
 *   - timetracking から originalEstimate/timeSpent を時間に換算。
 *   - parent.key を parentExternalKey に写す（subtask の親）。team-managed は Epic を
 *     parent で表すため、Epic Link と一致する parent は二重リンク回避で外す。
 */
function normalizeJiraIssue(
  r: JiraIssueRaw,
  comments: NormalizedComment[] | undefined,
): NormalizedIssue {
  const f = r.fields ?? {};
  const est = f.timetracking?.originalEstimateSeconds;
  const spent = f.timetracking?.timeSpentSeconds;

  const epicExternalKey = extractEpicExternalKey(f);
  let parentExternalKey = f.parent?.key ?? null;
  // team-managed では Epic を parent で表すため、parent.key が Epic Link として既に
  // 採られている場合は parentExternalKey 側を外す（同一 Epic を parentId/epicId 両方に
  // 二重リンクしない）。parent は Epic Link としてのみ扱う。
  if (
    parentExternalKey &&
    epicExternalKey &&
    parentExternalKey === epicExternalKey
  ) {
    parentExternalKey = null;
  }

  return {
    externalKey: r.key ?? '',
    title: f.summary ?? '(no title)',
    description: cleanText(f.description),
    status: f.status?.name ?? null,
    priority: f.priority?.name ?? null,
    assigneeName: f.assignee?.displayName ?? null,
    // Jira 標準には開始日が無いため null（カスタムフィールド差があるため扱わない）。
    startDate: null,
    dueDate: f.duedate ?? null,
    estimatedHours: typeof est === 'number' ? roundHours(est / 3600) : null,
    actualHours: typeof spent === 'number' ? roundHours(spent / 3600) : null,
    parentExternalKey,
    issueType: f.issuetype?.name ?? null,
    epicExternalKey,
    storyPoints: extractStoryPoints(f),
    sprint: extractSprint(f),
    comments,
  };
}

/**
 * 単一課題を取得して NormalizedIssue を返す（webhook 受信時の 1 課題 import 用）。
 * GET /rest/api/3/issue/{key} で 1 件 fetch し、jiraListIssues と同じ正規化を施す。
 * 課題が存在しない（404）場合は null を返す（削除済み/権限外）。
 */
export async function jiraGetIssue(
  siteUrl: string,
  email: string,
  apiToken: string,
  issueKey: string,
  opts: { includeComments?: boolean } = {},
): Promise<NormalizedIssue | null> {
  const fields = [
    'summary',
    'description',
    'status',
    'priority',
    'assignee',
    'duedate',
    'parent',
    'issuetype',
    'timetracking',
    'created',
    'updated',
    ...AGILE_CUSTOM_FIELDS,
  ];
  let raw: JiraIssueRaw;
  try {
    raw = await jget<JiraIssueRaw>(
      siteUrl,
      email,
      apiToken,
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
      { fields: fields.join(',') },
    );
  } catch (e) {
    // 404（存在しない/削除済み）は not_found 扱いで null。それ以外は呼び出し側に伝播。
    if (/Jira API 404/.test((e as Error)?.message ?? '')) return null;
    throw e;
  }
  if (!raw?.key) return null;

  let comments: NormalizedComment[] | undefined;
  if (opts.includeComments) {
    try {
      comments = await fetchComments(siteUrl, email, apiToken, raw.key);
    } catch {
      comments = undefined;
    }
  }
  return normalizeJiraIssue(raw, comments);
}

/** 秒→時間換算の丸め（小数 2 桁）。 */
function roundHours(h: number): number {
  return Math.round(h * 100) / 100;
}

/**
 * Epic Link の外部キーを best-effort で抽出する。
 *   - 代表 customfield（Epic Link）が文字列なら、それを Epic キー（例 "ABC-1"）とみなす。
 *   - team-managed プロジェクトは Epic を parent で表すため、Epic 直下に位置する種別
 *     （Story/Task/Bug）の課題に限り parent.key を Epic とみなす。
 *
 * 注意: Sub-task の parent は Story/Task であって Epic ではないため除外する。種別が不明
 * （issuetype 無し）な場合も誤判定（parent を Epic に誤分類して parentId と二重リンク）を
 * 避けるため Epic とはみなさない。
 * 検出できなければ null。
 */
export function extractEpicExternalKey(f: JiraIssueFields): string | null {
  for (const key of EPIC_LINK_FIELDS) {
    const v = f[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // team-managed: Epic は parent で表現される。Epic 直下に来る種別のみ parent を Epic とみなす。
  const parentKey = f.parent?.key;
  if (parentKey) {
    const t = (f.issuetype?.name ?? '').toLowerCase();
    // Story / Task / Bug（および「ストーリー」等の日本語）だけを対象にする。
    // Sub-task・Epic・種別不明は対象外（Sub-task の親は Story、Epic に親 Epic は無い）。
    const parentIsEpicCandidate =
      /(story|ストーリー|bug|バグ|不具合|障害)/.test(t) ||
      // "task"/"タスク" は含むが "sub-task"/"サブタスク" は除外する。
      (/(task|タスク)/.test(t) && !/(sub[-\s]?task|subtask|子課題|サブタスク)/.test(t));
    if (parentIsEpicCandidate) return parentKey;
  }
  return null;
}

/**
 * Story Points を best-effort で抽出する。代表 customfield を順に走査し、最初の有限な数値を採用。
 * 型揺れ（数値 / 文字列 / {value} {name} オブジェクト / 配列）でも例外を出さず、
 * 数値化できなければ次の候補へ。検出できなければ null。
 */
export function extractStoryPoints(f: JiraIssueFields): number | null {
  for (const key of STORY_POINTS_FIELDS) {
    const num = coerceStoryPoints(f[key]);
    if (num !== null) return num;
  }
  return null;
}

/** 任意の値から Story Points 数値を best-effort で取り出す（配列/オブジェクトも辿る）。 */
function coerceStoryPoints(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return null;
    const num = Number(t);
    return Number.isFinite(num) ? num : null;
  }
  if (Array.isArray(v)) {
    // 配列で来た場合は最初に数値化できた要素を採用（非数値や入れ子で例外を出さない）。
    for (const item of v) {
      const num = coerceStoryPoints(item);
      if (num !== null) return num;
    }
    return null;
  }
  if (typeof v === 'object') {
    // {value: 3} / {name: "3"} 形式（select 系カスタムフィールド）から数値抽出。
    const obj = v as { value?: unknown; name?: unknown };
    const fromValue = coerceStoryPoints(obj.value);
    if (fromValue !== null) return fromValue;
    return coerceStoryPoints(obj.name);
  }
  return null;
}

/**
 * Sprint 名を best-effort で抽出する。
 * customfield_10020 は通常 sprint オブジェクトの配列（[{name, state}, ...]）。
 *   - state==='active' の sprint を優先し、無ければ配列の最後（最新）の name を返す。
 *   - 古い API では "...,name=Sprint 1,..." の文字列表現で来ることがあるため name= も拾う。
 * 検出できなければ null。
 */
export function extractSprint(f: JiraIssueFields): string | null {
  for (const key of SPRINT_FIELDS) {
    const v = f[key];
    if (v == null) continue;
    if (Array.isArray(v)) {
      const names: string[] = [];
      let activeName: string | null = null;
      for (const item of v) {
        const name = sprintName(item);
        if (!name) continue;
        names.push(name);
        const state =
          item && typeof item === 'object'
            ? (item as { state?: unknown }).state
            : undefined;
        if (typeof state === 'string' && state.toLowerCase() === 'active') {
          activeName = name;
        }
      }
      if (activeName) return activeName;
      if (names.length > 0) return names[names.length - 1];
    } else {
      const name = sprintName(v);
      if (name) return name;
    }
  }
  return null;
}

/** 1 件分の sprint 表現（オブジェクト / 文字列）から name を取り出す。 */
function sprintName(item: unknown): string | null {
  if (item == null) return null;
  if (typeof item === 'object') {
    const name = (item as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim()) return name.trim();
    return null;
  }
  if (typeof item === 'string') {
    // 古い文字列表現 "...,name=Sprint 1,startDate=..." から name= を拾う。
    const m = /name=([^,\]]+)/.exec(item);
    if (m && m[1].trim()) return m[1].trim();
    const s = item.trim();
    return s.length > 0 ? s : null;
  }
  return null;
}
