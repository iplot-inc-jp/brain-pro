/**
 * 記録シート（配布物テンプレ）レジストリ
 *
 * 教材（社内教育の各講座）の配布物 Excel の実シート構造から起こした、列定義カタログ。
 * 1つの「意味のあるシート（=表）」につき1テンプレ。使い方 / INDEX / 図表INDEX シート、
 * 列が空のシート、単一の例示値だけの行（表ヘッダーではない）は除外。combined ファイルと
 * その per-sheet 分割ファイル（name が "_<sheetName>" で終わる重複）が両方ある場合は、
 * 重複を避けるため combined 側のシートのみ採用。
 *
 * 各テンプレは templateKey（= RecordTemplate.key）で一意に識別され、record-sheets API の
 * :templateKey に対応する。rows(Json) の各オブジェクトは RecordColumn.key をキーに持つ。
 *
 * NOTE: このファイルの「型（RecordColumn / RecordTemplate / RECORD_TEMPLATES /
 * RECORD_GROUPS）」が記録機能のフロント契約。テンプレ内容の追加・更新は自由だが、
 * 型シェイプは変更しないこと（記録ページがこの形に依存している）。
 */

export type RecordColumn = {
  /** 列キー（rows の各オブジェクトのキーになる。安定した英数字推奨） */
  key: string;
  /** 列見出し（表ヘッダーに表示する日本語ラベル） */
  label: string;
};

export type RecordTemplate = {
  /** テンプレ識別子（projectId と組で一意。URL とAPIの :templateKey に使う） */
  key: string;
  /** テンプレ名（一覧カード・編集ページのタイトル） */
  label: string;
  /** 所属グループ（一覧のセクション分け） */
  group: string;
  /** 由来する講座（courseId） */
  course: string;
  /** 補足説明（任意） */
  description?: string;
  /** 列定義（左→右の表示順） */
  columns: RecordColumn[];
};

/** 一覧のセクション表示順（= グループ名の順序） */
export const RECORD_GROUPS: string[] = [
  '課題・ヒアリング',
  '現状把握',
  '分析',
  '発想',
  '推進・検証',
  '資料・合意',
];

export const RECORD_TEMPLATES: RecordTemplate[] = [
  // ── 課題・ヒアリング（project-start-hearing 課題一覧表）─────────────
  {
    key: 'issue-list',
    label: '課題一覧',
    group: '課題・ヒアリング',
    course: 'project-start-hearing',
    description: 'ASIS・TOBE・GAP で課題を洗い出し、優先度をつけて一覧化します。',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'domain', label: '業務・領域' },
      { key: 'asis', label: 'ASIS（現状）' },
      { key: 'tobe', label: 'TOBE（あるべき姿）' },
      { key: 'gap', label: 'GAP（問題=課題）' },
      { key: 'priority', label: '優先度' },
      { key: 'owner', label: '担当' },
      { key: 'note', label: '補足' },
    ],
  },
  {
    key: 'issue-coverage',
    label: '対応表',
    group: '課題・ヒアリング',
    course: 'project-start-hearing',
    description: '課題ごとに ASIS/TOBE/GAP が揃っているかを点検します。',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'domain', label: '業務・領域' },
      { key: 'asisFilled', label: 'ASIS埋まってる？' },
      { key: 'tobeFilled', label: 'TOBE埋まってる？' },
      { key: 'gapFilled', label: 'GAP埋まってる？' },
      { key: 'allThree', label: '3つ揃ってる？' },
      { key: 'toComplete', label: '補完すべきこと' },
    ],
  },

  // ── 現状把握（asis-gyomu-flow 業務定義ツール / 発注計画ツール）────────
  {
    key: 'gyomu-definition',
    label: '業務定義シート',
    group: '現状把握',
    course: 'asis-gyomu-flow',
    description: '1つの業務を目的・担当・INPUT/DO/OUTPUT で定義します。',
    columns: [
      { key: 'gyomuName', label: '業務名' },
      { key: 'purpose', label: '目的（なぜ必要か）' },
      { key: 'owner', label: '担当者（主担当）' },
      { key: 'stakeholders', label: '関係者' },
      { key: 'input', label: 'INPUT（何を受け取るか）' },
      { key: 'trigger', label: 'トリガー（いつ始まるか）' },
      { key: 'do', label: 'DO（何をするか）' },
      { key: 'output', label: 'OUTPUT（何を渡すか）' },
      { key: 'frequency', label: '頻度' },
      { key: 'system', label: '使用システム' },
    ],
  },
  {
    key: 'gyomu-map',
    label: '業務の地図',
    group: '現状把握',
    course: 'asis-gyomu-flow',
    description: 'ステップ×担当・システムで業務の流れを時系列に並べます。',
    columns: [
      { key: 'step', label: 'ステップ（時系列）' },
      { key: 'roleTantou', label: '山田太郎（購買部）' },
      { key: 'roleBuchou', label: '部長（承認）' },
      { key: 'systemErp', label: 'ERP' },
      { key: 'systemExcel', label: 'Excel（発注計画ツール）' },
      { key: 'systemMail', label: 'メール' },
      { key: 'supplier', label: '仕入先（SUP-001/002）' },
      { key: 'note', label: '備考・条件' },
    ],
  },
  {
    key: 'info-map',
    label: '情報の地図',
    group: '現状把握',
    course: 'asis-gyomu-flow',
    description: '情報項目が誰・どのシステムに存在するかを整理します。',
    columns: [
      { key: 'infoItem', label: '情報項目' },
      { key: 'roleTantou', label: '山田太郎（購買部）' },
      { key: 'roleBuchou', label: '部長' },
      { key: 'systemErp', label: 'ERP' },
      { key: 'systemExcel', label: 'Excel' },
      { key: 'systemMail', label: 'メール' },
      { key: 'supplier', label: '仕入先' },
    ],
  },
  {
    key: 'demand-history',
    label: '過去需要データ',
    group: '現状把握',
    course: 'asis-gyomu-flow',
    description: '商品ごとの月次需要実績を記録します。',
    columns: [
      { key: 'productCode', label: '商品コード' },
      { key: 'productName', label: '商品名' },
      { key: 'm01', label: '1月' },
      { key: 'm02', label: '2月' },
      { key: 'm03', label: '3月' },
      { key: 'm04', label: '4月' },
      { key: 'm05', label: '5月' },
      { key: 'm06', label: '6月' },
      { key: 'm07', label: '7月' },
      { key: 'm08', label: '8月' },
      { key: 'm09', label: '9月' },
      { key: 'm10', label: '10月' },
      { key: 'm11', label: '11月' },
      { key: 'm12', label: '12月' },
    ],
  },
  {
    key: 'supplier-master',
    label: '仕入先マスタ',
    group: '現状把握',
    course: 'asis-gyomu-flow',
    description: '仕入先の連絡先・リードタイムを管理します。',
    columns: [
      { key: 'supplierCode', label: '仕入先コード' },
      { key: 'supplierName', label: '仕入先名' },
      { key: 'salesRep', label: '担当営業' },
      { key: 'phone', label: '電話番号' },
      { key: 'email', label: 'メールアドレス' },
      { key: 'leadTime', label: 'リードタイム（日）' },
      { key: 'note', label: '備考' },
    ],
  },
  {
    key: 'product-min-lot',
    label: '商品×最小ロット',
    group: '現状把握',
    course: 'asis-gyomu-flow',
    description: '商品ごとの仕入先・最小ロット・単価を管理します。',
    columns: [
      { key: 'productCode', label: '商品コード' },
      { key: 'productName', label: '商品名' },
      { key: 'supplier', label: '仕入先' },
      { key: 'minLot', label: '最小ロット（個）' },
      { key: 'unitPrice', label: '単価（円）' },
    ],
  },

  // ── 分析（bunseki-ryoku アジカQ1〜Q4 / 図表）───────────────────────
  {
    key: 'ajika-q1-sku-pareto',
    label: 'Q1 SKU 80-20 分析',
    group: '分析',
    course: 'bunseki-ryoku',
    description: 'SKU別の累積金額シェアで ABC ランクを判定します（パレート分析）。',
    columns: [
      { key: 'productCode', label: '商品コード' },
      { key: 'count', label: '件数' },
      { key: 'totalAmount', label: '合計金額(円)' },
      { key: 'cumulativeAmount', label: '累積金額' },
      { key: 'cumulativeShare', label: '累積シェア' },
      { key: 'rank', label: 'ランク' },
    ],
  },
  {
    key: 'ajika-q2-sensitivity',
    label: 'Q2 改革施策感度分析',
    group: '分析',
    course: 'bunseki-ryoku',
    description: '打ち手ごとの営業利益への影響と実行難易度をスコア化します。',
    columns: [
      { key: 'lever', label: '打ち手' },
      { key: 'target', label: '改善対象' },
      { key: 'improvement', label: '改善幅(仮)' },
      { key: 'profitImpact', label: '営業利益への影響' },
      { key: 'difficulty', label: '実行難易度' },
      { key: 'duration', label: '実行期間' },
      { key: 'score', label: 'スコア' },
    ],
  },
  {
    key: 'ajika-q3-supplier-compare',
    label: 'Q3 サプライヤー比較',
    group: '分析',
    course: 'bunseki-ryoku',
    description: '観点別に複数サプライヤーを横並びで比較します。',
    columns: [
      { key: 'perspective', label: '観点' },
      { key: 'sup001', label: 'SUP-001 丸山商事' },
      { key: 'sup002', label: 'SUP-002 東洋商会' },
      { key: 'sup003', label: 'SUP-003 関西物産' },
      { key: 'sup004', label: 'SUP-004 中部産業' },
      { key: 'sup005', label: 'SUP-005 東京物産' },
      { key: 'note', label: '備考' },
    ],
  },
  {
    key: 'ajika-q4-gap',
    label: 'Q4 ギャップ分析',
    group: '分析',
    course: 'bunseki-ryoku',
    description: '自社と業界平均のギャップを指標ごとに把握します。',
    columns: [
      { key: 'metric', label: '指標' },
      { key: 'ajika', label: 'アジカ' },
      { key: 'industryAvg', label: '業界平均' },
      { key: 'gap', label: 'ギャップ' },
      { key: 'source', label: '出典' },
    ],
  },
  {
    key: 'product-rank-review',
    label: '図表1-2 製品別検討',
    group: '分析',
    course: 'bunseki-ryoku',
    description: '製品ランク別の品目数・売上・在庫月数を整理します。',
    columns: [
      { key: 'productRank', label: '製品ランク' },
      { key: 'itemCount', label: '品目数' },
      { key: 'itemShare', label: '品目数シェア' },
      { key: 'salesAmount', label: '売上金額(億円)' },
      { key: 'salesShare', label: '売上シェア' },
      { key: 'stockMonths', label: '在庫月数' },
    ],
  },
  {
    key: 'sensitivity-summary',
    label: '図表1-3 感度総括',
    group: '分析',
    course: 'bunseki-ryoku',
    description: '打ち手ごとの収益改善感度を総括します。',
    columns: [
      { key: 'lever', label: '打ち手' },
      { key: 'target', label: '改善対象' },
      { key: 'improvement', label: '改善幅' },
      { key: 'profitImpact', label: '営業利益への影響' },
      { key: 'difficulty', label: '実行難易度' },
      { key: 'duration', label: '実行期間' },
      { key: 'score', label: 'スコア(★ ÷ 難易度)' },
    ],
  },
  {
    key: 'product-compare-framework',
    label: '図表3-2 製品比較枠組み',
    group: '分析',
    course: 'bunseki-ryoku',
    description: '製品比較の観点・評価項目・重視顧客層を定めます。',
    columns: [
      { key: 'perspective', label: '観点' },
      { key: 'evaluationItem', label: '具体的な評価項目' },
      { key: 'targetCustomer', label: '重視する顧客層' },
      { key: 'note', label: '備考' },
    ],
  },
  {
    key: 'gap-analysis-450',
    label: '図表3-3 ギャップ分析',
    group: '分析',
    course: 'bunseki-ryoku',
    description: '要因ごとのギャップ寄与と打ち手の有無を整理します。',
    columns: [
      { key: 'factor', label: '要因' },
      { key: 'gapContribution', label: 'ギャップ寄与(億円)' },
      { key: 'share', label: 'シェア' },
      { key: 'hasLever', label: '打ち手の有無' },
      { key: 'memo', label: 'メモ' },
    ],
  },
  {
    key: 'leakage-analysis',
    label: '図表6-5 漏れ分析',
    group: '分析',
    course: 'bunseki-ryoku',
    description: '段階ごとの通過数・歩留りと漏れ要因の仮説を整理します。',
    columns: [
      { key: 'stage', label: '段階' },
      { key: 'passed', label: '通過数' },
      { key: 'yieldRate', label: '歩留り' },
      { key: 'leakageCause', label: '次段への漏れ要因（仮説）' },
    ],
  },

  // ── 発想（hassou-ryoku 発想法・アジカQ1〜Q6 等）──────────────────────
  {
    key: 'idea-methods',
    label: '6 発想法一覧',
    group: '発想',
    course: 'hassou-ryoku',
    description: '6つの発想法と軸の方向・起動トリガー・代表事例の一覧です。',
    columns: [
      { key: 'no', label: '#' },
      { key: 'method', label: '発想法' },
      { key: 'original', label: '原語' },
      { key: 'axis', label: '軸の方向' },
      { key: 'trigger', label: '起動トリガー' },
      { key: 'example', label: '代表事例（本書より）' },
    ],
  },
  {
    key: 'rtocs-template',
    label: 'RTOCS 視点テンプレ',
    group: '発想',
    course: 'hassou-ryoku',
    description: '相手の立場で考えるべき事業構造を整理する視点テンプレートです。',
    columns: [
      { key: 'target', label: '相手' },
      { key: 'businessStructure', label: '考えるべき事業構造（5項目）' },
      { key: 'note', label: '備考' },
    ],
  },
  {
    key: 'sdf-coffee-maker',
    label: 'SDF コーヒーメーカー',
    group: '発想',
    course: 'hassou-ryoku',
    description: '発想・アプローチ・結末・限界で SDF 事例を整理します。',
    columns: [
      { key: 'idea', label: '発想' },
      { key: 'approach', label: 'アプローチ' },
      { key: 'result', label: '結末' },
      { key: 'limit', label: '限界' },
    ],
  },
  {
    key: 'idle-economy-models',
    label: 'アイドル・エコノミー4モデル',
    group: '発想',
    course: 'hassou-ryoku',
    description: 'アイドルエコノミーの4モデルを提供側・利用側で比較します。',
    columns: [
      { key: 'model', label: 'モデル' },
      { key: 'provider', label: '提供側（資産保有）' },
      { key: 'platform', label: 'プラットフォーム' },
      { key: 'user', label: '利用側' },
      { key: 'fitSituation', label: '応用しやすい状況' },
    ],
  },
  {
    key: 'ajika-q1-sdf-utility',
    label: 'Q1 SDF 光熱費',
    group: '発想',
    course: 'hassou-ryoku',
    description: 'SDF の問いに沿って光熱費の発想を段階的に書き出します。',
    columns: [
      { key: 'step', label: 'ステップ' },
      { key: 'question', label: '問い' },
      { key: 'answer', label: '解答欄' },
    ],
  },
  {
    key: 'ajika-q2-idle-economy',
    label: 'Q2 アイドル 3軸',
    group: '発想',
    course: 'hassou-ryoku',
    description: 'カテゴリ別に自社の "空き" を書き出し、適用モデルを検討します。',
    columns: [
      { key: 'category', label: 'カテゴリ' },
      { key: 'idleAsset', label: 'アジカの "空き"（書き出す）' },
      { key: 'modelCandidate', label: '適用モデル候補' },
    ],
  },
  {
    key: 'ajika-q3-tco',
    label: 'Q3 5年TCO比較',
    group: '発想',
    course: 'hassou-ryoku',
    description: '評価項目ごとに5年 TCO で仕入先候補を比較します。',
    columns: [
      { key: 'evaluationItem', label: '評価項目' },
      { key: 'sup001', label: 'SUP-001 丸山' },
      { key: 'supX', label: 'SUP-X 新規' },
      { key: 'note', label: '備考' },
    ],
  },
  {
    key: 'ajika-q4-rtocs',
    label: 'Q4 RTOCS SUP-001',
    group: '発想',
    course: 'hassou-ryoku',
    description: 'SUP-001 の立場で項目ごとに推論を書き出します。',
    columns: [
      { key: 'item', label: '項目' },
      { key: 'inference', label: '推論' },
    ],
  },
  {
    key: 'ajika-q5-cross-industry',
    label: 'Q5 横展開 3 異業種',
    group: '発想',
    course: 'hassou-ryoku',
    description: '異業種の課題・解決構造を自社への応用案に変換します。',
    columns: [
      { key: 'industry', label: '異業種' },
      { key: 'industryIssue', label: '業界の課題' },
      { key: 'solvedStructure', label: '解決した構造' },
      { key: 'application', label: 'アジカへの応用案' },
    ],
  },
  {
    key: 'ajika-q6-spice-methods',
    label: 'Q6 6発想法 総合',
    group: '発想',
    course: 'hassou-ryoku',
    description: '6発想法それぞれで案を5行以上書き出します。',
    columns: [
      { key: 'no', label: '#' },
      { key: 'method', label: '発想法' },
      { key: 'ideas', label: '案（5 行以上）' },
    ],
  },
  {
    key: 'fixed-cost-contribution',
    label: '固定費貢献',
    group: '発想',
    course: 'hassou-ryoku',
    description: '主体ごとの事情・悩みと Lastminute.com の解決を整理します。',
    columns: [
      { key: 'actor', label: '主体' },
      { key: 'situation', label: '事情' },
      { key: 'pain', label: '悩み' },
      { key: 'solution', label: 'Lastminute.com の解決' },
    ],
  },
  {
    key: 'time-shift-komtrax',
    label: '時間軸ずらし KOMTRAX',
    group: '発想',
    course: 'hassou-ryoku',
    description: '売り切りと IoT 課金を観点ごとに比較します。',
    columns: [
      { key: 'perspective', label: '観点' },
      { key: 'traditional', label: '従来型「売り切り」' },
      { key: 'komtrax', label: 'KOMTRAX「IoT課金」' },
      { key: 'customerEffect', label: '顧客への効果' },
    ],
  },
  {
    key: 'cross-industry-cases',
    label: '横展開 異業種事例',
    group: '発想',
    course: 'hassou-ryoku',
    description: '学んだ会社・業界の課題と構造、結果を整理します。',
    columns: [
      { key: 'learnedCompany', label: '学んだ会社' },
      { key: 'learnedIndustry', label: '学んだ業界' },
      { key: 'industryIssue', label: '業界の課題' },
      { key: 'learnedStructure', label: '学んだ構造' },
      { key: 'result', label: '結果' },
    ],
  },

  // ── 推進・検証（project-management ステークホルダー管理の各シート）─────
  {
    key: 'stakeholder-map',
    label: 'ステークホルダーマップ',
    group: '推進・検証',
    course: 'project-management',
    description: '関係者の関心・影響度・支持度・巻き込み方を一覧管理します。',
    columns: [
      { key: 'no', label: 'No.' },
      { key: 'name', label: '氏名' },
      { key: 'affiliation', label: '所属・役職' },
      { key: 'role', label: '役割' },
      { key: 'interest', label: '関心事（成功と感じるもの）' },
      { key: 'concern', label: '不安・懸念' },
      { key: 'influence', label: '影響度(高/中/低)' },
      { key: 'support', label: '支持度(支持/中立/反対)' },
      { key: 'asisHearing', label: 'ASISヒアリング状況' },
      { key: 'tobeSparring', label: 'TOBE壁打ち状況' },
      { key: 'engagement', label: '巻き込み方' },
      { key: 'reportFrequency', label: '報告頻度' },
      { key: 'contactMethod', label: '連絡手段' },
      { key: 'owner', label: '主担当' },
      { key: 'reportLine', label: '上司 (報告ライン)' },
      { key: 'note', label: '備考' },
    ],
  },
  {
    key: 'report-calendar',
    label: '報告・連絡カレンダー',
    group: '推進・検証',
    course: 'project-management',
    description: '誰に何をいつ報告するかを定例化します。',
    columns: [
      { key: 'no', label: 'No.' },
      { key: 'reportTo', label: '報告対象（誰に）' },
      { key: 'reportContent', label: '報告内容（何を）' },
      { key: 'frequency', label: '頻度' },
      { key: 'dayTime', label: '曜日・時刻' },
      { key: 'format', label: '形式' },
      { key: 'medium', label: '媒体' },
      { key: 'drafter', label: '起票担当' },
      { key: 'approver', label: '承認者' },
      { key: 'templateRef', label: 'テンプレ・参考' },
      { key: 'note', label: '備考' },
    ],
  },
  {
    key: 'meeting-list',
    label: '会議体一覧',
    group: '推進・検証',
    course: 'project-management',
    description: '会議の目的・頻度・参加者・意思決定者を一覧化します。',
    columns: [
      { key: 'no', label: 'No.' },
      { key: 'meetingName', label: '会議名' },
      { key: 'purpose', label: '目的・ゴール' },
      { key: 'frequency', label: '頻度' },
      { key: 'dayTime', label: '曜日・時刻' },
      { key: 'requiredAttendees', label: '参加者（必須）' },
      { key: 'optionalAttendees', label: '参加者（任意）' },
      { key: 'agendaTemplate', label: 'アジェンダ雛形' },
      { key: 'preMaterials', label: '事前資料' },
      { key: 'minutesOwner', label: '議事録担当' },
      { key: 'decisionMaker', label: '意思決定者' },
      { key: 'note', label: '備考' },
    ],
  },
  {
    key: 'risk-register',
    label: 'リスク・ボトルネック登録簿',
    group: '推進・検証',
    course: 'project-management',
    description: 'リスク・ボトルネックを発生確率・影響度・優先度で管理します。',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'type', label: '種別(リスク/ボトルネック)' },
      { key: 'event', label: '事象内容' },
      { key: 'causeCategory', label: '原因区分(人/情報/決裁/技術/外部)' },
      { key: 'probability', label: '発生確率(高/中/低)' },
      { key: 'impact', label: '影響度(高/中/低)' },
      { key: 'priority', label: '優先度' },
      { key: 'countermeasure', label: '対応策（予防・軽減）' },
      { key: 'needsMtg', label: '対応MTG(要/不要)' },
      { key: 'mtgDate', label: 'MTG設定日' },
      { key: 'deadline', label: '期限' },
      { key: 'owner', label: '担当' },
      { key: 'status', label: 'ステータス' },
      { key: 'note', label: '備考' },
    ],
  },

  // ── 資料・合意（meeting-material フェーズ別アジェンダ・関心ごとマトリクス）─
  {
    key: 'interest-matrix',
    label: '関心ごとマトリクス（フェーズ×ロール OPQ）',
    group: '資料・合意',
    course: 'meeting-material',
    description: 'フェーズ×ロールで各関係者の関心ごと（OPQ）を整理します。',
    columns: [
      { key: 'phase', label: 'フェーズ' },
      { key: 'duration', label: '期間目安' },
      { key: 'mainMeetings', label: '主要ミーティング体' },
      { key: 'fieldStaff', label: '現場（実務担当）' },
      { key: 'clientPm', label: '先方プロマネ' },
      { key: 'executive', label: '役員（経営層）' },
    ],
  },
  {
    key: 'phase-quick-list',
    label: 'クイック一覧',
    group: '資料・合意',
    course: 'meeting-material',
    description: 'フェーズ別の主要ミーティングとロール別関心の早見表です。',
    columns: [
      { key: 'phase', label: 'フェーズ' },
      { key: 'duration', label: '期間目安' },
      { key: 'mainMeetings', label: '主要ミーティング体' },
      { key: 'fieldStaff', label: '現場（実務担当）' },
      { key: 'clientPm', label: '先方プロマネ' },
      { key: 'executive', label: '役員（経営層）' },
    ],
  },
  {
    key: 'field-effort-roadmap',
    label: '現場工数ロードマップ',
    group: '資料・合意',
    course: 'meeting-material',
    description: 'フェーズ別の現場工数目安と関与内容を整理します。',
    columns: [
      { key: 'phase', label: 'フェーズ' },
      { key: 'duration', label: '期間目安' },
      { key: 'fieldEffort', label: '現場工数目安' },
      { key: 'involvement', label: '主な関与内容' },
      { key: 'meetings', label: '参加ミーティング（種類×回数）' },
    ],
  },
  {
    key: 'meeting-catalog',
    label: 'ミーティング体カタログ',
    group: '資料・合意',
    course: 'meeting-material',
    description: '各ミーティングの目的・参加者・主メッセージ・資料を定義します。',
    columns: [
      { key: 'meetingName', label: 'ミーティング名' },
      { key: 'goal', label: '目的・ゴール' },
      { key: 'timing', label: 'タイミング/頻度' },
      { key: 'duration', label: '所要' },
      { key: 'attendees', label: '主な参加者' },
      { key: 'mainQ', label: '参加者の主たるQ' },
      { key: 'mainMessage', label: 'MTGの主メッセージ（Qへの回答）' },
      { key: 'agendaTemplate', label: 'アジェンダ雛形（主メッセージを支える論点）' },
      { key: 'requiredMaterials', label: '必須資料・提示物（根拠）' },
      { key: 'minutesHowto', label: '議事録・宿題のまとめ方' },
      { key: 'commonFailures', label: 'ありがちな失敗' },
    ],
  },
  {
    key: 'role-responsibility',
    label: 'ロール別責任範囲',
    group: '資料・合意',
    course: 'meeting-material',
    description: 'ロールごとの責任・意思決定範囲・関心KPIを定義します。',
    columns: [
      { key: 'role', label: 'ロール' },
      { key: 'responsibility', label: '主な責任' },
      { key: 'decisionScope', label: '主な意思決定範囲' },
      { key: 'evaluation', label: '評価される観点' },
      { key: 'kpi', label: '関心のあるKPI' },
      { key: 'present', label: 'ミーティングで提示してほしいもの' },
      { key: 'commonFailures', label: 'やりがちな失敗' },
    ],
  },
];
