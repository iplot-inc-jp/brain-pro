import { Inject, Injectable } from '@nestjs/common';
import {
  IProductRepository,
  PRODUCT_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import {
  AccessPrincipal,
  ProjectAccessService,
} from '../../../infrastructure/services/project-access.service';

export interface DeleteProductInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
}

/**
 * 商品削除ユースケース
 */
@Injectable()
export class DeleteProductUseCase {
  constructor(
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: IProductRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteProductInput): Promise<void> {
    // 1. 商品存在確認
    const product = await this.productRepository.findById(input.id);
    if (!product) {
      throw new EntityNotFoundError('Product', input.id);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(product.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', product.projectId);
    }

    // 3. 組織メンバー確認
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // プロジェクト単位 RBAC: 書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      product.projectId,
      'edit',
    );

    // 4. 削除
    await this.productRepository.delete(input.id);
  }
}
