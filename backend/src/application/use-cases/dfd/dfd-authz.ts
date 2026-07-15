import {
  IDfdRepository,
  ProjectRepository,
  OrganizationRepository,
  EntityNotFoundError,
  ForbiddenError,
  DfdDiagram,
} from '../../../domain';
import {
  AccessPrincipal,
  ProjectAccessService,
  RequiredAccess,
} from '../../../infrastructure/services/project-access.service';

/**
 * diagramId をプロジェクトメンバー認可し、図を返す。
 * projectAccess による プロジェクト単位 RBAC（VIEW/EDIT）を必ず強制する
 * （scopeOrgId 越境拒否 / sk_ キースコープ含む）。
 * 既存の isMember は多層防御として残す。
 */
export async function authorizeDiagram(
  repo: IDfdRepository,
  projectRepo: ProjectRepository,
  orgRepo: OrganizationRepository,
  diagramId: string,
  principal: AccessPrincipal,
  projectAccess: ProjectAccessService,
  required: RequiredAccess,
): Promise<DfdDiagram> {
  const diagram = await repo.findDiagramById(diagramId);
  if (!diagram) throw new EntityNotFoundError('DfdDiagram', diagramId);
  const project = await projectRepo.findById(diagram.projectId);
  if (!project) throw new EntityNotFoundError('Project', diagram.projectId);
  if (!(await orgRepo.isMember(project.organizationId, principal.id))) {
    throw new ForbiddenError('You are not a member of this organization');
  }
  await projectAccess.assertPrincipalAccess(principal, diagram.projectId, required);
  return diagram;
}
