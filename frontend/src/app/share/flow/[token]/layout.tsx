import type { Metadata } from 'next';
import { fetchForOg } from '@/lib/share-og';

/** URL貼付時のunfurl用タイトル（PUBLICリンクのみ実名。ORG/無効は汎用）。 */
export async function generateMetadata({
  params,
}: {
  params: { token: string };
}): Promise<Metadata> {
  const data = await fetchForOg<{ flow: { name: string }; projectName: string | null }>(
    `/api/business-flows/shared/${params.token}`,
  );
  const title = data?.flow?.name
    ? `${data.flow.name} | Brain Pro 共有`
    : '共有された業務フロー図 | Brain Pro';
  return {
    title,
    description: '業務フロー図の閲覧専用共有リンク（拡大しても劣化しないベクタ描画）',
  };
}

export default function SharedFlowLayout({ children }: { children: React.ReactNode }) {
  return children;
}
