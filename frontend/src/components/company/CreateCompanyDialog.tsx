'use client';

import { useState } from 'react';
import { Building2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { organizationsApi } from '@/lib/api';

export type CreatedOrganization = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
};

/** 会社名から URL 用スラッグを生成（日本語など英数字以外は除去。空になりうる）。 */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * 会社を新規作成するダイアログ（認証済みユーザーなら誰でも作成可・作成者は OWNER）。
 * open/onOpenChange で制御し、成功時に onCreated(作成された会社) を呼ぶ。
 */
export function CreateCompanyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (org: CreatedOrganization) => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setName('');
    setSlug('');
    setSlugEdited(false);
    setDescription('');
    setError('');
  }

  function handleNameChange(v: string) {
    setName(v);
    if (!slugEdited) setSlug(slugify(v));
  }

  async function submit() {
    if (!name.trim() || !slug.trim()) {
      setError('会社名とスラッグ（半角英数字）を入力してください');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const org = await organizationsApi.create({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
      });
      reset();
      onOpenChange(false);
      onCreated(org as CreatedOrganization);
    } catch (e) {
      setError(e instanceof Error ? e.message : '会社の作成に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="bg-white border-gray-200">
        <DialogHeader>
          <DialogTitle className="text-gray-900 flex items-center gap-2">
            <Building2 className="h-5 w-5" /> 会社を作成
          </DialogTitle>
          <DialogDescription className="text-gray-500">
            あなたが作成した会社のオーナーになります。後からメンバーを招待できます。
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-2 rounded bg-red-50 border border-red-200 text-red-600 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cc-name" className="text-gray-700 text-sm">
              会社名
            </Label>
            <Input
              id="cc-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="株式会社サンプル"
              className="bg-white border-gray-300 text-gray-900"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-slug" className="text-gray-700 text-sm">
              スラッグ（URL用の半角英数字）
            </Label>
            <Input
              id="cc-slug"
              value={slug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value);
              }}
              placeholder="my-company"
              className="bg-white border-gray-300 text-gray-900"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-desc" className="text-gray-700 text-sm">
              説明（任意）
            </Label>
            <Input
              id="cc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="事業の概要など"
              className="bg-white border-gray-300 text-gray-900"
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={busy} className="gap-1 bg-blue-600 hover:bg-blue-700">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
            作成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
