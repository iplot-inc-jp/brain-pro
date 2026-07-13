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
  // satisfies は実装をそのまま使い、resolveProjectAccess だけ VIEW を返す。
  const realService = new ProjectAccessService({} as never);
  const makeService = (level: 'EDIT' | 'VIEW' | null) =>
    ({
      resolveProjectAccess: jest.fn().mockResolvedValue(level),
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

  // サービスアカウントAPIキーのリクエストは、発行者の会員権限ではなくキーのスコープで判定する。
  it('APIキー(apiKeyRole)のリクエストは resolveApiKeyProjectAccess で判定（user 権限は見ない）', async () => {
    const resolveApiKeyProjectAccess = jest.fn().mockResolvedValue('EDIT');
    const resolveProjectAccess = jest.fn().mockResolvedValue(null);
    const svc = {
      resolveApiKeyProjectAccess,
      resolveProjectAccess,
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
    expect(resolveApiKeyProjectAccess).toHaveBeenCalled();
    expect(resolveProjectAccess).not.toHaveBeenCalled();
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
});
