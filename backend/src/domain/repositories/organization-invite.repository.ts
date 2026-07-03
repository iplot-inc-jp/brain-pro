export type InviteRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

/**
 * 招待リンクの永続データ表現。
 */
export interface OrganizationInviteRecord {
  id: string;
  organizationId: string;
  token: string;
  role: InviteRole;
  createdByUserId: string;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CreateInviteData {
  id: string;
  organizationId: string;
  token: string;
  role: InviteRole;
  createdByUserId: string;
  expiresAt: Date | null;
  maxUses: number | null;
}

/**
 * 招待リポジトリインターフェース。
 */
export interface OrganizationInviteRepository {
  create(data: CreateInviteData): Promise<OrganizationInviteRecord>;
  findByToken(token: string): Promise<OrganizationInviteRecord | null>;
  findById(id: string): Promise<OrganizationInviteRecord | null>;
  findByOrganizationId(organizationId: string): Promise<OrganizationInviteRecord[]>;
  incrementUseCount(id: string): Promise<void>;
  revoke(id: string): Promise<void>;
  generateId(): string;
  generateToken(): string;
}

export const ORGANIZATION_INVITE_REPOSITORY = Symbol('ORGANIZATION_INVITE_REPOSITORY');
