import { Inject, Injectable } from '@nestjs/common';
import {
  IInformationTypeRepository,
  INFORMATION_TYPE_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import {
  InformationTypeOutput,
  toInformationTypeOutput,
} from './information-type.output';

export interface GetInformationTypesInput {
  userId: string;
  projectId: string;
}

/**
 * プロジェクトの情報種別一覧取得ユースケース（添付件数付き）
 */
@Injectable()
export class GetInformationTypesUseCase {
  constructor(
    @Inject(INFORMATION_TYPE_REPOSITORY)
    private readonly informationTypeRepository: IInformationTypeRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: GetInformationTypesInput): Promise<InformationTypeOutput[]> {
    const project = await this.projectRepository.findById(input.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', input.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    const informationTypes = await this.informationTypeRepository.findByProjectId(
      input.projectId,
    );
    const counts = await this.informationTypeRepository.countAttachmentsByProjectId(
      input.projectId,
    );

    return informationTypes.map((it) =>
      toInformationTypeOutput(it, counts.get(it.id) ?? 0),
    );
  }
}
