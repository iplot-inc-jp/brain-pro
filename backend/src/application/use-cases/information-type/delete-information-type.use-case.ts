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

export interface DeleteInformationTypeInput {
  userId: string;
  informationTypeId: string;
}

/**
 * 情報種別削除ユースケース
 * 紐づく Attachment は onDelete: Cascade、DfdFlow.informationTypeId は onDelete: SetNull。
 */
@Injectable()
export class DeleteInformationTypeUseCase {
  constructor(
    @Inject(INFORMATION_TYPE_REPOSITORY)
    private readonly informationTypeRepository: IInformationTypeRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: DeleteInformationTypeInput): Promise<void> {
    const informationType = await this.informationTypeRepository.findById(
      input.informationTypeId,
    );
    if (!informationType) {
      throw new EntityNotFoundError('InformationType', input.informationTypeId);
    }

    const project = await this.projectRepository.findById(
      informationType.projectId,
    );
    if (!project) {
      throw new EntityNotFoundError('Project', informationType.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    await this.informationTypeRepository.delete(input.informationTypeId);
  }
}
