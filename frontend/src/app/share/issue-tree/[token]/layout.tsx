import type { Metadata } from 'next';
import { fetchForOg } from '@/lib/share-og';

/** URL貼付時のunfurl用タイトル（PUBLICリンクのみ実名。ORG/無効は汎用）。 */
export async function generateMetadata({
  params,
}: {
  params: { token: string };
}): Promise<Metadata> {
  const data = await fetchForOg<{ name: string; projectName: string | null }>(
    `/api/shared/issue-tree/${params.token}`,
  );
  const title = data?.name
    ? `${data.name} | Brain Pro 共有`
    : '共有されたイシューツリー | Brain Pro';
  return {
    title,
    description: 'イシューツリーの閲覧専用共有リンク',
  };
}

export default function SharedIssueTreeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
