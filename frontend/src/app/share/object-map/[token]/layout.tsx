import type { Metadata } from 'next';
import { fetchForOg } from '@/lib/share-og';

/** URL貼付時のunfurl用タイトル（PUBLICリンクのみプロジェクト名入り）。 */
export async function generateMetadata({
  params,
}: {
  params: { token: string };
}): Promise<Metadata> {
  const data = await fetchForOg<{ projectName: string | null }>(
    `/api/shared/object-map/${params.token}`,
  );
  const title = data?.projectName
    ? `オブジェクト関係性マップ（${data.projectName}） | Brain Pro 共有`
    : 'オブジェクト関係性マップ | Brain Pro 共有';
  return {
    title,
    description: 'オブジェクト関係性マップの閲覧専用共有リンク',
  };
}

export default function SharedObjectMapLayout({ children }: { children: React.ReactNode }) {
  return children;
}
