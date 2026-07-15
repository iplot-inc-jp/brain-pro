import { Inject, Injectable } from '@nestjs/common';
import {
  DATA_OBJECT_REPOSITORY, IDataObjectRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
} from '../../../domain';
import { authorizeProject } from './data-object-authz';
import { AccessPrincipal, ProjectAccessService } from '../../../infrastructure/services/project-access.service';

export interface SaveObjectPositionsInput {
  userId: string;
  principal: AccessPrincipal;
  projectId: string;
  positions: { id: string; positionX: number; positionY: number }[];
}

/** オブジェクト関係性マップ上の位置一括保存 */
@Injectable()
export class SaveObjectPositionsUseCase {
  constructor(
    @Inject(DATA_OBJECT_REPOSITORY) private readonly repo: IDataObjectRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: SaveObjectPositionsInput): Promise<void> {
    await authorizeProject(this.projectRepo, this.orgRepo, input.projectId, input.principal, this.projectAccess, 'edit');
    await this.repo.bulkSavePositions(input.projectId, input.positions ?? []);
  }
}
