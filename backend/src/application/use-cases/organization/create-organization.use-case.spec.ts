import { CreateOrganizationUseCase } from './create-organization.use-case';
import { EntityNotFoundError, EntityAlreadyExistsError } from '../../../domain';

describe('CreateOrganizationUseCase', () => {
  let orgRepo: any;
  let userRepo: any;
  let useCase: CreateOrganizationUseCase;

  beforeEach(() => {
    orgRepo = {
      existsBySlug: jest.fn().mockResolvedValue(false),
      generateId: jest.fn().mockReturnValue('org-new'),
      save: jest.fn().mockResolvedValue(undefined),
      addMember: jest.fn().mockResolvedValue(undefined),
    };
    userRepo = { findById: jest.fn() };
    useCase = new CreateOrganizationUseCase(orgRepo, userRepo);
  });

  it('一般ユーザー（非super-admin）でも会社を作成でき、作成者が OWNER になる', async () => {
    userRepo.findById.mockResolvedValue({ id: 'u-1', isSuperAdmin: false });

    const res = await useCase.execute({
      userId: 'u-1',
      name: 'Acme',
      slug: 'acme',
      description: 'desc',
    });

    expect(orgRepo.save).toHaveBeenCalledTimes(1);
    // 作成者は OWNER メンバーとして追加される（＝即アクセス＆招待可能）
    expect(orgRepo.addMember).toHaveBeenCalledWith('org-new', {
      userId: 'u-1',
      role: 'OWNER',
    });
    expect(res).toEqual({
      id: 'org-new',
      name: 'Acme',
      slug: 'acme',
      description: 'desc',
    });
  });

  it('存在しないユーザーは EntityNotFoundError（会社は作られない）', async () => {
    userRepo.findById.mockResolvedValue(null);

    await expect(
      useCase.execute({ userId: 'ghost', name: 'X', slug: 'x' }),
    ).rejects.toBeInstanceOf(EntityNotFoundError);

    expect(orgRepo.save).not.toHaveBeenCalled();
    expect(orgRepo.addMember).not.toHaveBeenCalled();
  });

  it('スラッグ重複は EntityAlreadyExistsError（会社は作られない）', async () => {
    userRepo.findById.mockResolvedValue({ id: 'u-1', isSuperAdmin: false });
    orgRepo.existsBySlug.mockResolvedValue(true);

    await expect(
      useCase.execute({ userId: 'u-1', name: 'Acme', slug: 'taken' }),
    ).rejects.toBeInstanceOf(EntityAlreadyExistsError);

    expect(orgRepo.save).not.toHaveBeenCalled();
    expect(orgRepo.addMember).not.toHaveBeenCalled();
  });
});
