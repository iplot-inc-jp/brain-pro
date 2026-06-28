import {
  UserRepository,
  OrganizationRepository,
  ForbiddenError,
} from '../../../domain';

/**
 * 会社の管理者（superAdmin / OWNER / ADMIN）であることを保証する。
 */
export async function assertOrgAdmin(
  userRepository: UserRepository,
  organizationRepository: OrganizationRepository,
  organizationId: string,
  userId: string,
): Promise<void> {
  const user = await userRepository.findById(userId);
  if (user?.isSuperAdmin) return;

  const role = await organizationRepository.getMemberRole(organizationId, userId);
  if (role === 'OWNER' || role === 'ADMIN') return;

  throw new ForbiddenError('この会社を管理する権限がありません');
}
