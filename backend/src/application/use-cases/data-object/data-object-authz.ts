import {
  ProjectRepository,
  OrganizationRepository,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import {
  AccessPrincipal,
  ProjectAccessService,
  RequiredAccess,
} from '../../../infrastructure/services/project-access.service';

/**
 * projectId をプロジェクトメンバー認可する（dfd-authz と同パターン）。
 * projectAccess+required を渡すと、プロジェクト単位 RBAC（VIEW/EDIT）も併せて強制する。
 * 既存の isMember は多層防御として残す。
 */
export async function authorizeProject(
  projectRepo: ProjectRepository,
  orgRepo: OrganizationRepository,
  projectId: string,
  principal: AccessPrincipal,
  projectAccess?: ProjectAccessService,
  required: RequiredAccess = 'view',
): Promise<void> {
  const project = await projectRepo.findById(projectId);
  if (!project) throw new EntityNotFoundError('Project', projectId);
  if (!(await orgRepo.isMember(project.organizationId, principal.id))) {
    throw new ForbiddenError('You are not a member of this organization');
  }
  if (projectAccess) {
    await projectAccess.assertPrincipalAccess(principal, projectId, required);
  }
}
