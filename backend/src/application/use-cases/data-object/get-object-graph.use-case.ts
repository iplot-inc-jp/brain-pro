import { Inject, Injectable } from '@nestjs/common';
import {
  DATA_OBJECT_REPOSITORY, IDataObjectRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
} from '../../../domain';
import { authorizeProject } from './data-object-authz';
import {
  AccessPrincipal,
  ProjectAccessService,
} from '../../../infrastructure/services/project-access.service';
import { ObjectGraphOutput, toObjectGraphOutput } from './data-object.output';

export interface GetObjectGraphInput { userId: string; principal: AccessPrincipal; projectId: string; }

/** オブジェクト関係性マップ取得（objects: 紐づくtables/dfdNodes含む ＋ relations） */
@Injectable()
export class GetObjectGraphUseCase {
  constructor(
    @Inject(DATA_OBJECT_REPOSITORY) private readonly repo: IDataObjectRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: GetObjectGraphInput): Promise<ObjectGraphOutput> {
    await authorizeProject(this.projectRepo, this.orgRepo, input.projectId, input.principal, this.projectAccess, 'view');
    const graph = await this.repo.findObjectGraph(input.projectId);
    return toObjectGraphOutput(graph);
  }
}
