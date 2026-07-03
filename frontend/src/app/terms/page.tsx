import type { Metadata } from 'next';
import Link from 'next/link';
import { Database } from 'lucide-react';

const NAVY = '#050f3e';

// 最終更新日。改定時はここを更新する。
const UPDATED_AT = '2026年7月3日';

export const metadata: Metadata = {
  title: '利用規約 | Brain Pro',
  description: 'Brain Pro の利用規約。アカウント、禁止事項、免責事項、Google サービス連携、準拠法について定めます。',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold" style={{ color: NAVY }}>
        {title}
      </h2>
      <div className="mt-2 space-y-2 text-sm leading-7 text-gray-700">{children}</div>
    </section>
  );
}

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12 text-gray-900">
      <main className="mx-auto w-full max-w-3xl rounded-2xl border border-gray-200 bg-white p-8 shadow-sm sm:p-12">
        <div className="flex flex-col items-center text-center">
          <span
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg text-white"
            style={{ backgroundColor: NAVY }}
          >
            <Database className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: NAVY }}>
            利用規約
          </h1>
          <p className="mt-2 text-xs text-gray-500">最終更新日：{UPDATED_AT}</p>
        </div>

        <p className="mt-8 text-sm leading-7 text-gray-700">
          本利用規約（以下「本規約」といいます）は、株式会社IPLoT（以下「当社」といいます）が提供するプロジェクト管理サービス「Brain
          Pro」（以下「本サービス」といいます）の利用条件を定めるものです。利用者は、本規約に同意のうえ本サービスを利用するものとします。
        </p>

        <Section title="第1条（適用）">
          <p>
            本規約は、本サービスの利用に関する当社と利用者との間の一切の関係に適用されます。当社が本サービス上で別途定める個別規定・ガイドラインは、本規約の一部を構成します。
          </p>
        </Section>

        <Section title="第2条（アカウント登録）">
          <ul className="list-disc space-y-1 pl-5">
            <li>利用者は、正確かつ最新の情報でアカウントを登録するものとします。</li>
            <li>
              利用者は、自己の責任においてアカウント情報（メールアドレス、パスワード、Google
              アカウント連携等）を管理するものとします。
            </li>
            <li>
              アカウントの管理不十分・第三者の使用等による損害の責任は利用者が負うものとし、当社は責任を負いません。
            </li>
          </ul>
        </Section>

        <Section title="第3条（Google サービスとの連携）">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              本サービスは、利用者の任意により Google
              アカウントおよび Google ドライブと連携する機能を提供します。
            </li>
            <li>
              連携により当社が取得するデータの取り扱いは、
              <Link href="/privacy" className="underline" style={{ color: NAVY }}>
                プライバシーポリシー
              </Link>
              に従います。
            </li>
            <li>
              利用者は、Google が定める利用規約およびポリシーにも従うものとします。連携はいつでも解除できます。
            </li>
          </ul>
        </Section>

        <Section title="第4条（禁止事項）">
          <p>利用者は、本サービスの利用にあたり、以下の行為をしてはなりません。</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>法令または公序良俗に違反する行為。</li>
            <li>当社、他の利用者、または第三者の権利・利益を侵害する行為。</li>
            <li>本サービスの運営を妨害し、またはサーバー等に過度の負荷をかける行為。</li>
            <li>不正アクセス、リバースエンジニアリング、その他不正に本サービスを利用する行為。</li>
            <li>権限のないデータへのアクセスを試みる行為。</li>
            <li>その他、当社が不適切と判断する行為。</li>
          </ul>
        </Section>

        <Section title="第5条（本サービスの提供の停止・変更）">
          <p>
            当社は、システムの保守、障害、天災その他やむを得ない事由がある場合、利用者への事前の通知なく本サービスの全部または一部の提供を停止・中断・変更できるものとします。これにより利用者に生じた損害について、当社は責任を負いません。
          </p>
        </Section>

        <Section title="第6条（保証の否認および免責）">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              当社は、本サービスが利用者の特定の目的に適合すること、期待する機能・正確性・有用性を有すること、および不具合が生じないことを保証しません。
            </li>
            <li>
              当社は、本サービスに関して利用者に生じた損害について、当社に故意または重過失がある場合を除き、責任を負いません。
            </li>
            <li>
              利用者と他の利用者または第三者との間で生じた紛争については、利用者の責任と費用で解決するものとします。
            </li>
          </ul>
        </Section>

        <Section title="第7条（知的財産権）">
          <p>
            本サービスに関する著作権、商標権その他の知的財産権は、当社または正当な権利者に帰属します。利用者が本サービスに入力・登録したデータの権利は利用者に帰属し、当社は本サービスの提供に必要な範囲でこれを利用できるものとします。
          </p>
        </Section>

        <Section title="第8条（本規約の変更）">
          <p>
            当社は、必要と判断した場合、利用者に通知することなく本規約を変更できるものとします。変更後の規約は、本ページに掲載した時点から効力を生じます。
          </p>
        </Section>

        <Section title="第9条（準拠法・裁判管轄）">
          <p>
            本規約の解釈および適用は日本法に準拠します。本サービスに関して紛争が生じた場合は、当社の本店所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。
          </p>
        </Section>

        <Section title="第10条（お問い合わせ）">
          <p>本規約に関するお問い合わせは、【問い合わせ用メールアドレス】までご連絡ください。</p>
        </Section>

        <div className="mt-10 border-t border-gray-100 pt-6 text-center text-sm">
          <Link href="/privacy" className="underline" style={{ color: NAVY }}>
            プライバシーポリシー
          </Link>
          <span className="mx-3 text-gray-300">|</span>
          <Link href="/login" className="underline" style={{ color: NAVY }}>
            ログインに戻る
          </Link>
        </div>
      </main>
    </div>
  );
}
