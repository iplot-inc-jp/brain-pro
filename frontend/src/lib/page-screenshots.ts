// ページ別スクリーンショット API クライアント。
// 1ページ(slug)に複数ソース（GitHub取り込み / アップロード / 画像URL / Figmaリンク）の参照を持てる。
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function authToken(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
}
function jsonHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = authToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}
// multipart は Content-Type をブラウザに任せる（boundary 付与のため手動設定しない）。
function multipartHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const t = authToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

export type PageScreenshotSource = 'GITHUB' | 'UPLOAD' | 'IMAGE_URL' | 'FIGMA';

export interface PageScreenshot {
  id: string;
  projectId: string;
  source: PageScreenshotSource;
  slug: string;
  caption: string;
  blobUrl: string | null;
  linkUrl: string | null;
  mimeType: string | null;
  filePath: string | null;
  order: number;
  importedAt: string;
}

export interface PageScreenshotList {
  connected: boolean;
  repoFullName: string | null;
  branch: string | null;
  items: PageScreenshot[];
}

export interface ScreenshotImportSummary {
  imported: number;
  updated: number;
  skipped: number;
  removed: number;
  total: number;
}

/** Figma 共有URL → 読み取り専用ライブ埋め込み用 URL。 */
export function figmaEmbedUrl(url: string): string {
  return `https://www.figma.com/embed?embed_host=brain-pro&url=${encodeURIComponent(url.trim())}`;
}

export const pageScreenshotApi = {
  async list(projectId: string): Promise<PageScreenshotList> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/page-screenshots`, {
      headers: jsonHeaders(),
    });
    if (!res.ok) throw new Error('スクリーンショットの取得に失敗しました');
    return res.json();
  },

  /** GitHub連携の docs/screenshots/ から取り込み。 */
  async importGithub(projectId: string): Promise<ScreenshotImportSummary> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/page-screenshots/import`,
      { method: 'POST', headers: jsonHeaders() },
    );
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      throw new Error(
        (d && (Array.isArray(d.message) ? d.message.join(' / ') : d.message)) ||
          '取り込みに失敗しました',
      );
    }
    return res.json();
  },

  /** 画像URL / Figma リンクを追加。 */
  async createLink(
    projectId: string,
    body: { source: 'IMAGE_URL' | 'FIGMA'; slug: string; linkUrl: string; caption?: string },
  ): Promise<PageScreenshot> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/page-screenshots/link`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      throw new Error(
        (d && (Array.isArray(d.message) ? d.message.join(' / ') : d.message)) ||
          'リンクの追加に失敗しました',
      );
    }
    return res.json();
  },

  /** 画像を直接アップロード。 */
  async upload(
    projectId: string,
    file: File,
    slug: string,
    caption?: string,
  ): Promise<PageScreenshot> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('slug', slug);
    if (caption) fd.append('caption', caption);
    const res = await fetch(`${API_URL}/api/projects/${projectId}/page-screenshots/upload`, {
      method: 'POST',
      headers: multipartHeaders(),
      body: fd,
    });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      throw new Error(
        (d && (Array.isArray(d.message) ? d.message.join(' / ') : d.message)) ||
          'アップロードに失敗しました',
      );
    }
    return res.json();
  },

  async update(
    id: string,
    patch: { slug?: string; caption?: string; linkUrl?: string; order?: number },
  ): Promise<PageScreenshot> {
    const res = await fetch(`${API_URL}/api/page-screenshots/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('更新に失敗しました');
    return res.json();
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/page-screenshots/${id}`, {
      method: 'DELETE',
      headers: jsonHeaders(),
    });
    if (!res.ok && res.status !== 204) throw new Error('削除に失敗しました');
  },
};
