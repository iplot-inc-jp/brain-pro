'use client';

// ページ別スクリーンショット。
// 1ページ(slug)に複数ソースのビジュアル参照（GitHub取り込み / アップロード / 画像URL / Figmaリンク）を
// 紐づけてギャラリー表示する。GitHub連携時は docs/screenshots/ 配下を自動取り込みできる。
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Image as ImageIcon,
  Github,
  Upload,
  Link2,
  Figma,
  Plus,
  Loader2,
  Trash2,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useReadOnly } from '@/components/read-only-context';
import { EditGate } from '@/components/edit-gate';
import {
  pageScreenshotApi,
  figmaEmbedUrl,
  type PageScreenshot,
  type PageScreenshotList,
  type PageScreenshotSource,
} from '@/lib/page-screenshots';

const SOURCE_META: Record<PageScreenshotSource, { label: string; badge: string }> = {
  GITHUB: { label: 'GitHub', badge: 'border-gray-300 bg-gray-50 text-gray-700' },
  UPLOAD: { label: 'アップロード', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  IMAGE_URL: { label: '画像URL', badge: 'border-blue-200 bg-blue-50 text-blue-700' },
  FIGMA: { label: 'Figma', badge: 'border-purple-200 bg-purple-50 text-purple-700' },
};

type AddSource = 'UPLOAD' | 'IMAGE_URL' | 'FIGMA';

export default function PageScreenshotsPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { canEdit } = useReadOnly();

  const [data, setData] = useState<PageScreenshotList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [lightbox, setLightbox] = useState<PageScreenshot | null>(null);

  // 追加ダイアログ
  const [addOpen, setAddOpen] = useState(false);
  const [addSource, setAddSource] = useState<AddSource>('UPLOAD');
  const [addSlug, setAddSlug] = useState('');
  const [addCaption, setAddCaption] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addFile, setAddFile] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await pageScreenshotApi.list(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleImport = async () => {
    setImporting(true);
    setImportMsg(null);
    try {
      const s = await pageScreenshotApi.importGithub(projectId);
      setImportMsg(
        `取り込み完了: 新規${s.imported} / 更新${s.updated} / 変更なし${s.skipped} / 削除${s.removed}（対象${s.total}件）`,
      );
      await load();
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : '取り込みに失敗しました');
    } finally {
      setImporting(false);
    }
  };

  const resetAdd = () => {
    setAddSource('UPLOAD');
    setAddSlug('');
    setAddCaption('');
    setAddUrl('');
    setAddFile(null);
    setAddError(null);
  };

  const handleAdd = async () => {
    if (!addSlug.trim()) {
      setAddError('ページの slug を入力してください（例: /orders/list）');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      if (addSource === 'UPLOAD') {
        if (!addFile) {
          setAddError('画像ファイルを選択してください');
          setAdding(false);
          return;
        }
        await pageScreenshotApi.upload(projectId, addFile, addSlug.trim(), addCaption.trim());
      } else {
        if (!addUrl.trim()) {
          setAddError('URL を入力してください');
          setAdding(false);
          return;
        }
        await pageScreenshotApi.createLink(projectId, {
          source: addSource,
          slug: addSlug.trim(),
          linkUrl: addUrl.trim(),
          caption: addCaption.trim() || undefined,
        });
      }
      setAddOpen(false);
      resetAdd();
      await load();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : '追加に失敗しました');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('この参照を削除しますか？')) return;
    try {
      await pageScreenshotApi.remove(id);
      setData((d) => (d ? { ...d, items: d.items.filter((i) => i.id !== id) } : d));
    } catch {
      /* noop */
    }
  };

  // slug ごとにグルーピング（slug 昇順、各 slug 内は order）。
  const groups = useMemo(() => {
    const map = new Map<string, PageScreenshot[]>();
    for (const it of data?.items ?? []) {
      const arr = map.get(it.slug) ?? [];
      arr.push(it);
      map.set(it.slug, arr);
    }
    return Array.from(map.entries())
      .map(([slug, items]) => ({ slug, items: items.sort((a, b) => a.order - b.order) }))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }, [data]);

  const connected = data?.connected ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="ページ別スクリーンショット"
        description="ページ(URL slug)ごとに画面イメージを集約します。GitHub連携・アップロード・画像URL・Figmaリンクに対応。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setGuideOpen((v) => !v)}>
              <Info className="mr-1.5 h-4 w-4" />
              配置ガイド
            </Button>
            {canEdit && connected && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleImport}
                disabled={importing}
                title={`${data?.repoFullName ?? ''} の docs/screenshots/ から取り込み`}
              >
                {importing ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Github className="mr-1.5 h-4 w-4" />
                )}
                GitHubから取り込む
              </Button>
            )}
            {canEdit && (
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => setAddOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                追加
              </Button>
            )}
          </>
        }
      />

      {/* 取り込み結果メッセージ */}
      {importMsg && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          {importMsg}
        </div>
      )}

      {/* 配置ガイド */}
      {(guideOpen || (!loading && (data?.items.length ?? 0) === 0)) && (
        <Card className="border-blue-200 bg-blue-50/40">
          <CardContent className="space-y-3 p-4 text-sm text-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-gray-800">
                <Info className="h-4 w-4 text-blue-600" />
                ファイル配置と取り込み方法
              </div>
              <button
                type="button"
                onClick={() => setGuideOpen((v) => !v)}
                className="text-gray-400 hover:text-gray-600"
              >
                {guideOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            </div>
            <p>
              ① <Link href={`/dashboard/projects/${projectId}/integrations`} className="text-blue-700 underline">コード連携</Link>
              {' '}でGitHubリポジトリ（PAT）を接続します。
              {connected ? (
                <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">
                  連携済み: {data?.repoFullName}
                </span>
              ) : (
                <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">未連携</span>
              )}
            </p>
            <p>
              ② リポジトリに次の規約でスクリーンショットを置きます（<b>フォルダ階層＝ページのURL slug</b>、ファイル名＝キャプション）:
            </p>
            <pre className="overflow-x-auto rounded-md border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-800">
{`docs/screenshots/
├─ login.png                  →  ページ /login
├─ dashboard/
│   ├─ main.png               →  /dashboard（キャプション: main）
│   └─ empty.png              →  /dashboard（キャプション: empty）
└─ orders/
    └─ list/
        └─ filled.png         →  /orders/list（キャプション: filled）`}
            </pre>
            <p>
              ③ 上の「GitHubから取り込む」を押すか、コード連携の同期に同梱されて<b>自動取り込み</b>されます
              （ファイルのgit sha が変わった分だけ再取得し、リポジトリから消した分は削除されます）。
            </p>
            <p className="text-gray-500">
              ※ GitHubを使わず、この画面の「追加」から<b>直接アップロード</b>・<b>画像URL</b>・<b>Figmaの共有リンク</b>（ライブ埋め込み）でページに紐づけることもできます。
            </p>
          </CardContent>
        </Card>
      )}

      {/* 本体 */}
      {loading ? (
        <div className="flex h-[300px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="mb-4 text-red-600">{error}</p>
            <Button variant="outline" onClick={load}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              再読み込み
            </Button>
          </CardContent>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <ImageIcon className="h-8 w-8 text-gray-400" />
            </div>
            <p className="mb-1 font-medium text-gray-700">スクリーンショットがありません</p>
            <p className="mb-4 text-sm text-gray-500">
              上の「配置ガイド」に従ってGitHubから取り込むか、「追加」で直接登録してください。
            </p>
          </CardContent>
        </Card>
      ) : (
        <EditGate dim={false}>
          <div className="space-y-8">
            {groups.map((g) => (
              <section key={g.slug}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-md bg-gray-900 px-2 py-0.5 font-mono text-sm text-white">{g.slug}</span>
                  <span className="text-xs text-gray-400">{g.items.length}件</span>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {g.items.map((it) => (
                    <ScreenshotCard
                      key={it.id}
                      item={it}
                      canEdit={canEdit}
                      onOpen={() => setLightbox(it)}
                      onDelete={() => handleDelete(it.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </EditGate>
      )}

      {/* 追加ダイアログ */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) resetAdd(); }}>
        <DialogContent className="max-w-lg bg-white">
          <DialogHeader>
            <DialogTitle>ビジュアル参照を追加</DialogTitle>
            <DialogDescription>ページ(slug)に画像・URL・Figmaリンクを紐づけます。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>種別</Label>
              <Select value={addSource} onValueChange={(v) => setAddSource(v as AddSource)}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="UPLOAD">画像をアップロード</SelectItem>
                  <SelectItem value="IMAGE_URL">画像URLリンク</SelectItem>
                  <SelectItem value="FIGMA">Figma共有リンク（ライブ埋め込み）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>ページ slug <span className="text-red-500">*</span></Label>
              <Input
                placeholder="/orders/list"
                value={addSlug}
                onChange={(e) => setAddSlug(e.target.value)}
                className="bg-white font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>キャプション（任意・状態名など）</Label>
              <Input placeholder="empty / filled / エラー時 など" value={addCaption} onChange={(e) => setAddCaption(e.target.value)} className="bg-white" />
            </div>
            {addSource === 'UPLOAD' ? (
              <div className="space-y-2">
                <Label>画像ファイル <span className="text-red-500">*</span></Label>
                <Input type="file" accept="image/*" onChange={(e) => setAddFile(e.target.files?.[0] ?? null)} className="bg-white" />
                <p className="text-xs text-gray-400">4MBまで。png/jpg/webp等。</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>{addSource === 'FIGMA' ? 'Figma共有URL' : '画像URL'} <span className="text-red-500">*</span></Label>
                <Input
                  placeholder={addSource === 'FIGMA' ? 'https://www.figma.com/file/...' : 'https://.../shot.png'}
                  value={addUrl}
                  onChange={(e) => setAddUrl(e.target.value)}
                  className="bg-white"
                />
                {addSource === 'FIGMA' && (
                  <p className="text-xs text-gray-400">フレーム/コンポーネントの共有リンクを貼ると読み取り専用で埋め込み表示されます。</p>
                )}
              </div>
            )}
            {addError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">{addError}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); resetAdd(); }}>キャンセル</Button>
            <Button onClick={handleAdd} disabled={adding} className="bg-blue-600 hover:bg-blue-700">
              {adding ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />追加中...</> : <><Plus className="mr-1.5 h-4 w-4" />追加</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 画像ライトボックス */}
      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-w-5xl bg-white">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              {lightbox?.slug}
              {lightbox?.caption ? <span className="ml-2 text-gray-400">{lightbox.caption}</span> : null}
            </DialogTitle>
          </DialogHeader>
          {lightbox && (lightbox.blobUrl || lightbox.linkUrl) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox.blobUrl ?? lightbox.linkUrl ?? ''}
              alt={lightbox.caption || lightbox.slug}
              className="max-h-[75vh] w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScreenshotCard({
  item,
  canEdit,
  onOpen,
  onDelete,
}: {
  item: PageScreenshot;
  canEdit: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const meta = SOURCE_META[item.source];
  const imgSrc = item.blobUrl ?? (item.source === 'IMAGE_URL' ? item.linkUrl : null);
  return (
    <div className="group overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="relative aspect-video w-full bg-gray-50">
        {item.source === 'FIGMA' && item.linkUrl ? (
          <iframe
            src={figmaEmbedUrl(item.linkUrl)}
            title={item.caption || item.slug}
            className="h-full w-full border-0"
            allowFullScreen
          />
        ) : imgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imgSrc}
            alt={item.caption || item.slug}
            className="h-full w-full cursor-zoom-in object-cover"
            onClick={onOpen}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-gray-400">画像なし</div>
        )}
        <span className={cn('absolute left-1.5 top-1.5 rounded border px-1.5 py-0.5 text-[10px] font-medium', meta.badge)}>
          {meta.label}
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={onDelete}
            title="削除"
            className="absolute right-1.5 top-1.5 rounded bg-white/90 p-1 text-red-500 opacity-0 transition-opacity hover:bg-white group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="truncate text-xs text-gray-600" title={item.caption}>
          {item.caption || <span className="text-gray-300">（キャプションなし）</span>}
        </span>
        {item.linkUrl && (
          <a
            href={item.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 text-gray-400 hover:text-blue-600"
            title="元リンクを開く"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
