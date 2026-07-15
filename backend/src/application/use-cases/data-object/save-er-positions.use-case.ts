import { Inject, Injectable } from '@nestjs/common';
import {
  DATA_OBJECT_REPOSITORY, IDataObjectRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
} from '../../../domain';
import { authorizeProject } from './data-object-authz';
import { AccessPrincipal, ProjectAccessService } from '../../../infrastructure/services/project-access.service';

export interface SaveErPositionsInput {
  userId: string;
  principal: AccessPrincipal;
  projectId: string;
  positions: { id: string; positionX: number; positionY: number }[];
}

/** ER図キャンバス上のテーブル位置（erPositionX/Y）一括保存 */
@Injectable()
export class SaveErPositionsUseCase {
  constructor(
    @Inject(DATA_OBJECT_REPOSITORY) private readonly repo: IDataObjectRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: SaveErPositionsInput): Promise<void> {
    await authorizeProject(this.projectRepo, this.orgRepo, input.projectId, input.principal, this.projectAccess, 'edit');
    await this.repo.bulkSaveErPositions(input.projectId, input.positions ?? []);
  }
}
