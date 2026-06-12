/**
 * ai-data-flow API fetch クライアント
 *
 * createApiClient({ apiUrl, apiKey }) が返す call(method, path, { body, query }) は
 * `${apiUrl}/api${path}` を x-api-key 付きで叩く。
 * エラー時は status とレスポンス JSON の message を含む Error を投げる
 * （ツール側で wrap() が { isError: true, content: [text] } に変換する）。
 */

export function createApiClient({ apiUrl, apiKey }) {
  const base = apiUrl.replace(/\/$/, '');

  return async function call(method, path, { body, query } = {}) {
    let url = `${base}/api${path.startsWith('/') ? path : `/${path}`}`;

    if (query && typeof query === 'object') {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue;
        qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) url += (url.includes('?') ? '&' : '?') + s;
    }

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      let message = text;
      if (data && typeof data === 'object' && data.message !== undefined) {
        message = Array.isArray(data.message) ? data.message.join('; ') : String(data.message);
      }
      const err = new Error(`HTTP ${res.status} ${method} ${path} — ${message}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  };
}

/** ツールの正常レスポンス（JSON を整形して text content にする） */
export function ok(data) {
  return {
    content: [
      {
        type: 'text',
        text: data === null || data === undefined ? '(empty)' : JSON.stringify(data, null, 2),
      },
    ],
  };
}

/** ハンドラを包んで、例外を { isError: true, content: [text] } として返す */
export function wrap(fn) {
  return async (args) => {
    try {
      return ok(await fn(args ?? {}));
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  };
}
