import type { Metadata } from 'next';
import { fetchForOg } from '@/lib/share-og';

/** URL貼付時のunfurl用タイトル（PUBLICリンクのみ実名。ORG/無効は汎用）。 */
export async function generateMetadata({
  params,
}: {
  params: { token: string };
}): Promise<Metadata> {
  const data = await fetchForOg<{ diagram: { title: string | null }; projectName: string | null }>(
    `/api/shared/dfd/${params.token}`,
  );
  const name = data?.diagram?.title || (data ? 'DFD（データフロー図）' : null);
  const title = name ? `${name} | Brain Pro 共有` : '共有されたDFD | Brain Pro';
  return {
    title,
    description: 'DFD（データフロー図）の閲覧専用共有リンク',
  };
}

export default function SharedDfdLayout({ children }: { children: React.ReactNode }) {
  return children;
}
