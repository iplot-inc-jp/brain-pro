/**
 * OpenAPI スペックのキャッシュ
 *
 * 起動時に initOpenApi(apiUrl) を呼ぶと `${apiUrl}/api/docs-json` を fetch してキャッシュする。
 * fetch に失敗してもサーバ自体は起動し、listOperations() がエラーメッセージ付きで throw するだけ。
 */

let spec = null;
let loadError = null;
let loading = null;

export function initOpenApi(apiUrl) {
  const base = apiUrl.replace(/\/$/, '');
  loading = (async () => {
    try {
      const res = await fetch(`${base}/api/docs-json`);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      spec = await res.json();
      loadError = null;
    } catch (err) {
      loadError = err instanceof Error ? err : new Error(String(err));
      spec = null;
    }
  })();
  return loading;
}

/**
 * タグ別に { method, path, summary } を列挙する。
 * @param {string} [tagFilter] タグ名の部分一致フィルタ（大文字小文字無視）
 * @returns {{ totalOperations: number, tags: Record<string, Array<{method:string,path:string,summary:string}>> }}
 */
export async function listOperations(tagFilter) {
  if (loading) await loading;
  if (!spec) {
    throw new Error(
      `OpenAPI スペックを取得できていません（${loadError ? loadError.message : '未初期化'}）。` +
        'バックエンド（/api/docs-json）が起動しているか確認してください。',
    );
  }

  const filter = tagFilter ? String(tagFilter).toLowerCase() : null;
  const tags = {};
  let total = 0;

  for (const [path, ops] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(ops)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const opTags = op.tags && op.tags.length ? op.tags : ['(untagged)'];
      for (const tag of opTags) {
        if (filter && !tag.toLowerCase().includes(filter)) continue;
        if (!tags[tag]) tags[tag] = [];
        tags[tag].push({
          method: method.toUpperCase(),
          // api_request にそのまま渡せるよう /api プレフィックスを剥がす
          path: path.replace(/^\/api/, ''),
          summary: op.summary ?? '',
        });
        total += 1;
      }
    }
  }

  for (const list of Object.values(tags)) {
    list.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
  }

  return { totalOperations: total, tags };
}
