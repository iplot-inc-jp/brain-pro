import { Inject, Injectable } from '@nestjs/common';
import {
  InformationCategoryValue,
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

export interface UpdateInformationTypeInput {
  userId: string;
  informationTypeId: string;
  name?: string;
  category?: InformationCategoryValue;
  description?: string | null;
  order?: number;
  // 紐づくサブ領域（共通マスタ基盤。任意）
  subProjectId?: string | null;
}

/**
 * 情報種別更新ユースケース
 */
@Injectable()
export class UpdateInformationTypeUseCase {
  constructor(
    @Inject(INFORMATION_TYPE_REPOSITORY)
    private readonly informationTypeRepository: IInformationTypeRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: UpdateInformationTypeInput): Promise<InformationTypeOutput> {
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

    informationType.update({
      name: input.name,
      category: input.category,
      description: input.description,
      order: input.order,
      subProjectId: input.subProjectId,
    });
    await this.informationTypeRepository.save(informationType);

    const counts = await this.informationTypeRepository.countAttachmentsByProjectId(
      informationType.projectId,
    );
    return toInformationTypeOutput(
      informationType,
      counts.get(informationType.id) ?? 0,
    );
  }
}
