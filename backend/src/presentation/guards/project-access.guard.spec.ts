import { ForbiddenException } from '@nestjs/common';
import { ProjectAccessGuard } from './project-access.guard';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';

/**
 * 機能(section) import の認可: VIEW 権限ユーザーは POST(=edit) で 403、
 * GET(=view) は許可されることを、実 Guard + 実 satisfies で検証する。
 * FeatureIoController は @UseGuards(ProjectAccessGuard) かつ params.projectId を持つため、
 * このガードの method 別ゲートがそのまま import/export に適用される。
 */
describe('ProjectAccessGuard (feature-section import authz)', () => {
  // satisfies は実装をそのまま使い、resolveForPrincipal（主体別の実効レベル解決の一元入口）だけモックする。
  const realService = new ProjectAccessService({} as never);
  const makeService = (level: 'EDIT' | 'VIEW' | null) =>
    ({
      resolveForPrincipal: jest.fn().mockResolvedValue(level),
      satisfies: realService.satisfies.bind(realService),
    }) as unknown as ProjectAccessService;

  const ctxFor = (method: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          user: { id: 'viewer-user' },
          params: { projectId: 'proj-1' },
        }),
      }),
      getClass: () => ({ name: 'FeatureIoController' }),
    }) as never;

  it('VIEW ユーザーの section import (POST) は 403 (ForbiddenException)', async () => {
    const guard = new ProjectAccessGuard(makeService('VIEW'));
    await expect(guard.canActivate(ctxFor('POST'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('VIEW ユーザーの section export (GET) は許可', async () => {
    const guard = new ProjectAccessGuard(makeService('VIEW'));
    await expect(guard.canActivate(ctxFor('GET'))).resolves.toBe(true);
  });

  it('EDIT ユーザーの section import (POST) は許可', async () => {
    const guard = new ProjectAccessGuard(makeService('EDIT'));
    await expect(guard.canActivate(ctxFor('POST'))).resolves.toBe(true);
  });

  it('権限なし(null)は section export (GET) でも 403', async () => {
    const guard = new ProjectAccessGuard(makeService(null));
    await expect(guard.canActivate(ctxFor('GET'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // サービスアカウントAPIキーのリクエストは、発行者の会員権限ではなくキーのスコープで判定する
  // （resolveForPrincipal が内部で resolveApiKeyProjectAccess/フォールバックを振り分ける）。
  it('APIキー(apiKeyRole)のリクエストは resolveForPrincipal に principal を渡して判定する', async () => {
    const resolveForPrincipal = jest.fn().mockResolvedValue('EDIT');
    const svc = {
      resolveForPrincipal,
      satisfies: realService.satisfies.bind(realService),
    } as unknown as ProjectAccessService;
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          user: { id: 'issuer', apiKeyRole: 'COMPANY_ADMIN', organizationId: 'org-1', projectId: null },
          params: { projectId: 'proj-1' },
        }),
      }),
      getClass: () => ({ name: 'FeatureIoController' }),
    } as never;
    const guard = new ProjectAccessGuard(svc);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(resolveForPrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'issuer', apiKeyRole: 'COMPANY_ADMIN', organizationId: 'org-1' }),
      'proj-1',
    );
  });
});

describe('ProjectAccessService.resolveForPrincipal（主体別スコープの一元判定）', () => {
  it('通常ユーザー（apiKeyRole 無し）は resolveProjectAccess にフォールバック', async () => {
    const svc = new ProjectAccessService({} as never);
    const spyUser = jest.spyOn(svc, 'resolveProjectAccess').mockResolvedValue('VIEW');
    const spyKey = jest.spyOn(svc, 'resolveApiKeyProjectAccess');
    const level = await svc.resolveForPrincipal({ id: 'u1' }, 'proj-1');
    expect(level).toBe('VIEW');
    expect(spyUser).toHaveBeenCalledWith('proj-1', 'u1');
    expect(spyKey).not.toHaveBeenCalled();
  });

  it('会社紐付けのあるサービスアカウントキーは resolveApiKeyProjectAccess で判定', async () => {
    const svc = new ProjectAccessService({} as never);
    const spyKey = jest.spyOn(svc, 'resolveApiKeyProjectAccess').mockResolvedValue('EDIT');
    const spyUser = jest.spyOn(svc, 'resolveProjectAccess');
    const level = await svc.resolveForPrincipal(
      { id: 'issuer', apiKeyRole: 'GENERAL_USER', organizationId: 'org-1', projectId: 'proj-1' },
      'proj-1',
    );
    expect(level).toBe('EDIT');
    expect(spyKey).toHaveBeenCalled();
    expect(spyUser).not.toHaveBeenCalled();
  });

  // ★後方互換の要: organizationId 未設定の旧キーは発行者権限にフォールバック（デプロイで 403 にしない）。
  it('organizationId 未設定の旧APIキーは resolveProjectAccess（発行者権限）にフォールバック', async () => {
    const svc = new ProjectAccessService({} as never);
    const spyUser = jest.spyOn(svc, 'resolveProjectAccess').mockResolvedValue('EDIT');
    const spyKey = jest.spyOn(svc, 'resolveApiKeyProjectAccess');
    const level = await svc.resolveForPrincipal(
      { id: 'issuer', apiKeyRole: 'GENERAL_USER', organizationId: null, projectId: null },
      'proj-1',
    );
    expect(level).toBe('EDIT');
    expect(spyUser).toHaveBeenCalledWith('proj-1', 'issuer');
    expect(spyKey).not.toHaveBeenCalled();
  });
});

describe('ProjectAccessService.resolveApiKeyProjectAccess (サービスアカウントのスコープ)', () => {
  const makeSvc = (projectOrgId: string | null) => {
    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue(projectOrgId ? { organizationId: projectOrgId } : null),
      },
    };
    return new ProjectAccessService(prisma as never);
  };

  it('他社のプロジェクトは常に null（越境不可）', async () => {
    const svc = makeSvc('org-OTHER');
    const level = await svc.resolveApiKeyProjectAccess(
      { apiKeyRole: 'COMPANY_ADMIN', organizationId: 'org-1', projectId: null },
      'proj-x',
    );
    expect(level).toBeNull();
  });

  it('COMPANY_ADMIN は自社の全プロジェクトで EDIT', async () => {
    const svc = makeSvc('org-1');
    const level = await svc.resolveApiKeyProjectAccess(
      { apiKeyRole: 'COMPANY_ADMIN', organizationId: 'org-1', projectId: null },
      'proj-any',
    );
    expect(level).toBe('EDIT');
  });

  it('GENERAL_USER は紐付いたプロジェクトのみ EDIT', async () => {
    const svc = makeSvc('org-1');
    const bound = await svc.resolveApiKeyProjectAccess(
      { apiKeyRole: 'GENERAL_USER', organizationId: 'org-1', projectId: 'proj-1' },
      'proj-1',
    );
    expect(bound).toBe('EDIT');
  });

  it('GENERAL_USER は同じ会社でも紐付け外のプロジェクトは null', async () => {
    const svc = makeSvc('org-1');
    const other = await svc.resolveApiKeyProjectAccess(
      { apiKeyRole: 'GENERAL_USER', organizationId: 'org-1', projectId: 'proj-1' },
      'proj-2',
    );
    expect(other).toBeNull();
  });

  it('存在しないプロジェクトは null', async () => {
    const svc = makeSvc(null);
    const level = await svc.resolveApiKeyProjectAccess(
      { apiKeyRole: 'COMPANY_ADMIN', organizationId: 'org-1', projectId: null },
      'missing',
    );
    expect(level).toBeNull();
  });

  it('GENERAL_USER は projectIds（複数紐付け）のいずれでも EDIT', async () => {
    const svc = makeSvc('org-1');
    const a = await svc.resolveApiKeyProjectAccess(
      { apiKeyRole: 'GENERAL_USER', organizationId: 'org-1', projectId: 'proj-1', projectIds: ['proj-1', 'proj-2'] },
      'proj-2',
    );
    expect(a).toBe('EDIT');
  });

  it('GENERAL_USER は projectIds 外のプロジェクトは同じ会社でも null', async () => {
    const svc = makeSvc('org-1');
    const level = await svc.resolveApiKeyProjectAccess(
      { apiKeyRole: 'GENERAL_USER', organizationId: 'org-1', projectId: 'proj-1', projectIds: ['proj-1', 'proj-2'] },
      'proj-3',
    );
    expect(level).toBeNull();
  });

  it('GENERAL_USER は projectIds が空なら旧来の単一 projectId にフォールバック（後方互換）', async () => {
    const svc = makeSvc('org-1');
    const level = await svc.resolveApiKeyProjectAccess(
      { apiKeyRole: 'GENERAL_USER', organizationId: 'org-1', projectId: 'proj-1', projectIds: [] },
      'proj-1',
    );
    expect(level).toBe('EDIT');
  });
});
