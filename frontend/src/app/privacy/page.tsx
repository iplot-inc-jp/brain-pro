import type { Metadata } from 'next';
import Link from 'next/link';
import { Database } from 'lucide-react';

const NAVY = '#050f3e';

// 最終更新日。改定時はここを更新する。
const UPDATED_AT = '2026年7月3日';

export const metadata: Metadata = {
  title: 'プライバシーポリシー | Brain Pro',
  description: 'Brain Pro のプライバシーポリシー。取得する情報、Google ユーザーデータの取り扱い、利用目的、第三者提供、データの削除方法について定めます。',
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

export default function PrivacyPolicyPage() {
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
            プライバシーポリシー
          </h1>
          <p className="mt-2 text-xs text-gray-500">最終更新日：{UPDATED_AT}</p>
        </div>

        <p className="mt-8 text-sm leading-7 text-gray-700">
          株式会社IPLoT（以下「当社」といいます）は、当社が提供するプロジェクト管理サービス「Brain
          Pro」（以下「本サービス」といいます）における利用者の個人情報およびデータの取り扱いについて、以下のとおりプライバシーポリシー（以下「本ポリシー」といいます）を定めます。
        </p>

        <Section title="1. 事業者情報">
          <ul className="list-disc space-y-1 pl-5">
            <li>事業者名：株式会社IPLoT</li>
            <li>所在地：【本店所在地を記載してください】</li>
            <li>お問い合わせ先：【問い合わせ用メールアドレスを記載してください】</li>
          </ul>
        </Section>

        <Section title="2. 取得する情報">
          <p>本サービスは、以下の情報を取得します。</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              アカウント情報：メールアドレス、氏名、パスワード（パスワードは復元不可能な形式にハッシュ化して保管します）。
            </li>
            <li>
              Google アカウントでログインした場合：Google が提供する基本プロフィール情報（<code>openid</code>、
              <code>email</code>）。
            </li>
            <li>
              Google ドライブ連携を利用者が明示的に許可した場合：利用者が選択した Google
              ドライブ上のファイル・ドキュメント・スプレッドシートの内容（読み取り専用）。
            </li>
            <li>利用ログ、端末・ブラウザ情報、Cookie 等の技術情報。</li>
          </ul>
        </Section>

        <Section title="3. Google ユーザーデータの取り扱い">
          <p className="font-medium text-gray-900">
            本サービスによる Google API から受け取った情報の使用および他アプリケーションへの転送は、
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: NAVY }}
            >
              Google API Services User Data Policy
            </a>
            （Limited Use の要件を含みます）に準拠します。
          </p>
          <p>本サービスが要求する権限（スコープ）と、その利用目的は以下のとおりです。</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <code>openid</code> / <code>email</code>
              ：利用者の認証および本人識別のために使用します。
            </li>
            <li>
              <code>https://www.googleapis.com/auth/drive.readonly</code>
              （Google ドライブへの読み取り専用アクセス）：利用者が指定した Google
              ドキュメント・スプレッドシート・ファイルを本サービスに読み込み、ナレッジ化および業務資料の生成に利用するために使用します。
              <span className="font-medium text-gray-900">
                読み取り専用であり、当社が利用者のファイルを編集・削除することはありません。
              </span>
            </li>
          </ul>
          <p>
            取り込んだ文書の内容は、本サービスの機能（要約・抽出・ナレッジグラフ生成等）を提供する目的でのみ、AI
            処理の委託先（第4項参照）に送信して処理することがあります。当社は、Google
            ユーザーデータを広告目的で使用しません。また、これらのデータを人間が閲覧するのは、(a)
            利用者の明示的な同意がある場合、(b) セキュリティ目的（不正・障害の調査等）、(c)
            法令の遵守のために必要な場合、(d)
            集計・匿名化された場合に限られます。
          </p>
        </Section>

        <Section title="4. 第三者への提供・外部サービスの利用">
          <p>
            当社は、法令に基づく場合を除き、利用者の同意なく個人情報を第三者に提供しません。ただし、本サービスの提供に必要な範囲で、以下の外部サービス（処理の委託先）を利用します。
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Anthropic PBC（Claude API）：文書の要約・抽出等の AI 処理のため、対象文書の内容を送信することがあります。
            </li>
            <li>Vercel Inc.：本サービスのホスティング。</li>
            <li>データベース・ストレージ基盤：利用者データの保管。</li>
          </ul>
          <p>
            ※ 実際に利用している委託先に応じて、上記の記載を修正・追記してください。
          </p>
        </Section>

        <Section title="5. 利用目的">
          <ul className="list-disc space-y-1 pl-5">
            <li>本サービスの提供、維持、改善のため。</li>
            <li>利用者の認証、本人確認、アカウント管理のため。</li>
            <li>利用者からのお問い合わせへの対応のため。</li>
            <li>不正利用の防止、セキュリティの確保のため。</li>
          </ul>
        </Section>

        <Section title="6. データの保管とセキュリティ">
          <p>
            当社は、取得した情報を適切に管理し、不正アクセス、紛失、破壊、改ざん、漏えい等を防止するために合理的な安全管理措置を講じます。認証情報（リフレッシュトークン等）は暗号化して保管します。
          </p>
        </Section>

        <Section title="7. データの削除・Google 連携の解除">
          <p>利用者は、いつでも以下の方法でデータの削除および連携の解除を行うことができます。</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>本サービス内の設定画面から Google ドライブ連携を解除する。</li>
            <li>
              Google アカウントの
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: NAVY }}
              >
                サードパーティ アクセス設定
              </a>
              から、本サービスへのアクセス権を取り消す。
            </li>
            <li>
              アカウントおよび保存データの削除を希望する場合は、第1項のお問い合わせ先までご連絡ください。
            </li>
          </ul>
        </Section>

        <Section title="8. Cookie 等の利用">
          <p>
            本サービスは、ログイン状態の維持や利便性向上のために Cookie
            および類似技術（localStorage 等）を利用します。ブラウザの設定により無効化できますが、その場合一部機能が利用できないことがあります。
          </p>
        </Section>

        <Section title="9. 本ポリシーの改定">
          <p>
            当社は、必要に応じて本ポリシーを改定することがあります。重要な変更を行う場合は、本サービス上での掲示等により通知します。改定後のポリシーは、本ページに掲載した時点から効力を生じます。
          </p>
        </Section>

        <Section title="10. お問い合わせ">
          <p>
            本ポリシーに関するお問い合わせは、【問い合わせ用メールアドレス】までご連絡ください。
          </p>
        </Section>

        <div className="mt-10 border-t border-gray-100 pt-6 text-center text-sm">
          <Link href="/terms" className="underline" style={{ color: NAVY }}>
            利用規約
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
