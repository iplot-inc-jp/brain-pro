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
import { SupplierOutput, toSupplierOutput } from './create-supplier.use-case';

export interface UpdateSupplierInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
  code?: string | null;
  name?: string | null;
  salesRep?: string | null;
  tel?: string | null;
  email?: string | null;
  leadTimeDays?: number | null;
  note?: string | null;
  order?: number;
}

/**
 * 仕入先更新ユースケース
 */
@Injectable()
export class UpdateSupplierUseCase {
  constructor(
    @Inject(SUPPLIER_REPOSITORY)
    private readonly supplierRepository: ISupplierRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: UpdateSupplierInput): Promise<SupplierOutput> {
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

    // 4. ドメインロジック適用
    supplier.update({
      code: input.code,
      name: input.name,
      salesRep: input.salesRep,
      tel: input.tel,
      email: input.email,
      leadTimeDays: input.leadTimeDays,
      note: input.note,
      order: input.order,
    });

    // 5. 永続化
    await this.supplierRepository.save(supplier);

    // 6. 出力返却
    return toSupplierOutput(supplier);
  }
}
