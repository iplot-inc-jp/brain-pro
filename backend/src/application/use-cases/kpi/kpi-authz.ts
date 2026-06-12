import {
  ProjectRepository,
  OrganizationRepository,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';

/** projectId をプロジェクトメンバー認可する（data-object-authz と同パターン） */
export async function authorizeProject(
  projectRepo: ProjectRepository,
  orgRepo: OrganizationRepository,
  projectId: string,
  userId: string,
): Promise<void> {
  const project = await projectRepo.findById(projectId);
  if (!project) throw new EntityNotFoundError('Project', projectId);
  if (!(await orgRepo.isMember(project.organizationId, userId))) {
    throw new ForbiddenError('You are not a member of this organization');
  }
}
