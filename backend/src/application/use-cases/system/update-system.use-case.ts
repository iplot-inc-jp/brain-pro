import { Inject, Injectable } from '@nestjs/common';
import {
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

export interface UpdateSystemInput {
  userId: string;
  systemId: string;
  name?: string;
  kind?: SystemKindValue;
  description?: string | null;
  order?: number;
  subProjectId?: string | null;
}

/**
 * システム更新ユースケース
 */
@Injectable()
export class UpdateSystemUseCase {
  constructor(
    @Inject(SYSTEM_REPOSITORY)
    private readonly systemRepository: ISystemRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: UpdateSystemInput): Promise<SystemOutput> {
    const system = await this.systemRepository.findById(input.systemId);
    if (!system) {
      throw new EntityNotFoundError('System', input.systemId);
    }

    const project = await this.projectRepository.findById(system.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', system.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    system.update({
      name: input.name,
      kind: input.kind,
      description: input.description,
      order: input.order,
      subProjectId: input.subProjectId,
    });
    await this.systemRepository.update(system);

    return toSystemOutput(system);
  }
}
