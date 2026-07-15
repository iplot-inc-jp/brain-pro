import { CreateProjectUseCase } from './create-project.use-case';
import { ForbiddenError } from '../../../domain';

/**
 * 権限追従の要（回帰）: user-following API トークンは request.user = { id } しか載せないため、
 * 認可はこの use-case の「発行ユーザーが組織の会員か」チェック（organizationRepository.isMember）に
 * そのまま帰着する。非会員 userId は ForbiddenError となり、プロジェクト作成（永続化）に到達しない。
 */
describe('CreateProjectUseCase — ユーザー主体（権限追従）', () => {
  let projectRepo: any;
  let orgRepo: any;
  let useCase: CreateProjectUseCase;

  beforeEach(() => {
    projectRepo = {
      findById: jest.fn(),
      findByOrganizationId: jest.fn(),
      findByOrganizationIdAndSlug: jest.fn(),
      existsByOrganizationIdAndSlug: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn(),
      generateId: jest.fn().mockReturnValue('project-new'),
    };
    orgRepo = {
      isMember: jest.fn().mockResolvedValue(false),
    };
    // 実 constructor 順: (projectRepository, organizationRepository)
    useCase = new CreateProjectUseCase(projectRepo, orgRepo);
  });

  it('org の会員でない userId は ForbiddenError（プロジェクトは作成されない）', async () => {
    await expect(
      useCase.execute({
        userId: 'not-a-member',
        // 権限追従トークンは request.user = { id } しか載せない（scopeOrgId / apiKey 無し）。
        // → 会社スコープ検査は素通りし、認可は isMember に帰着する。
        principal: { id: 'not-a-member' },
        organizationId: 'org-1',
        name: 'X',
        slug: 'x',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(orgRepo.isMember).toHaveBeenCalledWith('org-1', 'not-a-member');
    expect(projectRepo.existsByOrganizationIdAndSlug).not.toHaveBeenCalled();
    expect(projectRepo.generateId).not.toHaveBeenCalled();
    expect(projectRepo.save).not.toHaveBeenCalled();
  });
});
