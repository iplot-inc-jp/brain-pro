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
import { ProductOutput, toProductOutput } from './create-product.use-case';

export interface UpdateProductInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
  code?: string | null;
  name?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  minLot?: number | null;
  unitPrice?: number | null;
  note?: string | null;
  order?: number;
}

/**
 * 商品更新ユースケース
 */
@Injectable()
export class UpdateProductUseCase {
  constructor(
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: IProductRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: UpdateProductInput): Promise<ProductOutput> {
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

    // 4. ドメインロジック適用
    product.update({
      code: input.code,
      name: input.name,
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      minLot: input.minLot,
      unitPrice: input.unitPrice,
      note: input.note,
      order: input.order,
    });

    // 5. 永続化
    await this.productRepository.save(product);

    // 6. 出力返却
    return toProductOutput(product);
  }
}
