import { Inject, Injectable } from '@nestjs/common';
import {
  ISupplierRepository,
  SUPPLIER_REPOSITORY,
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

export interface DeleteSupplierInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
}

/**
 * 仕入先削除ユースケース
 */
@Injectable()
export class DeleteSupplierUseCase {
  constructor(
    @Inject(SUPPLIER_REPOSITORY)
    private readonly supplierRepository: ISupplierRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteSupplierInput): Promise<void> {
    // 1. 仕入先存在確認
    const supplier = await this.supplierRepository.findById(input.id);
    if (!supplier) {
      throw new EntityNotFoundError('Supplier', input.id);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(supplier.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', supplier.projectId);
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
      supplier.projectId,
      'edit',
    );

    // 4. 削除
    await this.supplierRepository.delete(input.id);
  }
}
