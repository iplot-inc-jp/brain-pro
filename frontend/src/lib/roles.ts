/**
 * 権限ラベルの一元定義。権限は3つに集約する:
 *  - 会社管理者   = 会社内ロール OWNER / ADMIN
 *  - 会社メンバー = 会社内ロール MEMBER / VIEWER
 *  - すべての管理者 = プラットフォーム全体の super-admin（isSuperAdmin。会社内ロールではない）
 *
 * DB の MemberRole enum(OWNER/ADMIN/MEMBER/VIEWER) は温存し、表示・選択をこの2区分に丸める。
 */
export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export const SUPER_ADMIN_LABEL = 'すべての管理者';
export const COMPANY_ADMIN_LABEL = '会社管理者';
export const COMPANY_MEMBER_LABEL = '会社メンバー';

/** OWNER/ADMIN を「会社管理者」とみなす。 */
export function isCompanyAdminRole(role?: string | null): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/** 会社内ロール → 2区分のラベル（会社管理者 / 会社メンバー）。 */
export function companyRoleLabel(role?: string | null): string {
  return isCompanyAdminRole(role) ? COMPANY_ADMIN_LABEL : COMPANY_MEMBER_LABEL;
}

/**
 * 招待・メンバー追加で選べる会社内ロール。
 * 「すべての管理者」はプラットフォーム権限で会社単位では付与しないため含めない。
 */
export const COMPANY_ROLE_OPTIONS: { value: 'ADMIN' | 'MEMBER'; label: string }[] = [
  { value: 'ADMIN', label: COMPANY_ADMIN_LABEL },
  { value: 'MEMBER', label: COMPANY_MEMBER_LABEL },
];
