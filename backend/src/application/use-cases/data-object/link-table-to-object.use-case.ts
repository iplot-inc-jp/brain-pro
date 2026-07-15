import { Inject, Injectable } from '@nestjs/common';
import {
  DATA_OBJECT_REPOSITORY, IDataObjectRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  EntityNotFoundError, ValidationError,
} from '../../../domain';
import { authorizeProject } from './data-object-authz';
import { AccessPrincipal, ProjectAccessService } from '../../../infrastructure/services/project-access.service';

export interface LinkTableToObjectInput {
  userId: string;
  principal: AccessPrincipal;
  tableId: string;
  /** null で紐づけ解除 */
  dataObjectId: string | null;
}

/** 実態テーブルをデータオブジェクトに紐づけ/解除する */
@Injectable()
export class LinkTableToObjectUseCase {
  constructor(
    @Inject(DATA_OBJECT_REPOSITORY) private readonly repo: IDataObjectRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: LinkTableToObjectInput): Promise<void> {
    const table = await this.repo.findTableProjectRef(input.tableId);
    if (!table) throw new EntityNotFoundError('Table', input.tableId);
    await authorizeProject(this.projectRepo, this.orgRepo, table.projectId, input.principal, this.projectAccess, 'edit');

    if (input.dataObjectId !== null) {
      const object = await this.repo.findById(input.dataObjectId);
      if (!object) throw new EntityNotFoundError('DataObject', input.dataObjectId);
      if (object.projectId !== table.projectId) {
        throw new ValidationError('Data object does not belong to this project');
      }
    }
    await this.repo.linkTableToObject(input.tableId, input.dataObjectId);
  }
}
