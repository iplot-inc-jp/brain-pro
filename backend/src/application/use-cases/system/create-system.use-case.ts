import { Inject, Injectable } from '@nestjs/common';
import {
  System,
  SystemKindValue,
  ISystemRepository,
  SYSTEM_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import { SystemOutput, toSystemOutput } from './system.output';

export interface CreateSystemInput {
  userId: string;
  projectId: string;
  name: string;
  kind?: SystemKindValue;
  description?: string | null;
  order?: number;
  subProjectId?: string | null;
}

/**
 * システム作成ユースケース
 */
@Injectable()
export class CreateSystemUseCase {
  constructor(
    @Inject(SYSTEM_REPOSITORY)
    private readonly systemRepository: ISystemRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: CreateSystemInput): Promise<SystemOutput> {
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

    const id = this.systemRepository.generateId();
    const system = System.create(
      {
        projectId: input.projectId,
        name: input.name,
        kind: input.kind,
        description: input.description,
        order: input.order,
        subProjectId: input.subProjectId,
      },
      id,
    );

    await this.systemRepository.create(system);

    return toSystemOutput(system);
  }
}
