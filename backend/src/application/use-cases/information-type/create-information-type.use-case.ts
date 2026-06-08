import { Inject, Injectable } from '@nestjs/common';
import {
  InformationType,
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

export interface CreateInformationTypeInput {
  userId: string;
  projectId: string;
  name: string;
  category?: InformationCategoryValue;
  description?: string | null;
  order?: number;
}

/**
 * 情報種別作成ユースケース
 */
@Injectable()
export class CreateInformationTypeUseCase {
  constructor(
    @Inject(INFORMATION_TYPE_REPOSITORY)
    private readonly informationTypeRepository: IInformationTypeRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: CreateInformationTypeInput): Promise<InformationTypeOutput> {
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

    const id = this.informationTypeRepository.generateId();
    const informationType = InformationType.create(
      {
        projectId: input.projectId,
        name: input.name,
        category: input.category,
        description: input.description,
        order: input.order,
      },
      id,
    );

    await this.informationTypeRepository.save(informationType);

    return toInformationTypeOutput(informationType, 0);
  }
}
