// entity-json.controller.scope.spec.ts
//
// 回帰テスト: by-id ルート(getFlowJson)がスコープ非対応の
// ProjectAccessService.assertProjectAccess ではなく、スコープ対応の
// assertPrincipalAccess を「フルの principal(user)」で呼ぶことを検証する。
// Tasks 8-13 で ~30 サイトを assertProjectAccess(id, user.id, R) から
// assertPrincipalAccess(user, id, R) に変換した結果を代表1本で固定する。
import { EntityJsonController } from './entity-json.controller';

describe('EntityJsonController by-id scope wiring', () => {
  it('getFlowJson は assertPrincipalAccess を user(principal) で呼ぶ（scope 対応経路）', async () => {
    const projectAccess = {
      assertPrincipalAccess: jest.fn().mockResolvedValue(undefined),
      assertProjectAccess: jest.fn(), // 呼ばれてはいけない（スコープ非対応の旧経路）
    } as any;
    const orgRepo = { isMember: jest.fn().mockResolvedValue(true) } as any;
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-9' }) },
    } as any;
    // getFlowJson が読む業務フロー → projectId を返す最小 stub。
    const entityJson = {
      getFlowBundle: jest.fn().mockResolvedValue({
        projectId: 'proj-1',
        bundle: { version: 1 } as any,
      }),
    } as any;

    const ctrl = new EntityJsonController(entityJson, prisma, projectAccess, orgRepo);
    const user = { id: 'member-1', email: '', scopeOrgId: 'org-9' } as any;

    const result = await ctrl.getFlowJson(user, 'flow-1');

    // 実際の挙動: bundle がそのまま返る。
    expect(result).toEqual({ version: 1 });
    // ローカルラッパの追加チェック(org メンバーシップ)は principal.id で温存されている。
    expect(orgRepo.isMember).toHaveBeenCalledWith('org-9', 'member-1');
    // スコープ対応の assertPrincipalAccess が principal(user) 全体で呼ばれる。
    expect(projectAccess.assertPrincipalAccess).toHaveBeenCalledWith(user, 'proj-1', 'view');
    const [principalArg] = projectAccess.assertPrincipalAccess.mock.calls[0];
    expect(principalArg).toBe(user); // user.id ではなく user(principal) 全体
    // スコープ非対応の旧メソッドは呼ばれていない。
    expect(projectAccess.assertProjectAccess).not.toHaveBeenCalled();
  });
});
