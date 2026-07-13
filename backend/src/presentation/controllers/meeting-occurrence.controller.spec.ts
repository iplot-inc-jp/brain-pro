// meeting-occurrence.controller.spec.ts
// list() の検索条件（会議帯 / キーワード横断 / 開催日レンジ）が Prisma の where に正しく落ちるかと、
// by-id ルートの認可が「principal（＝APIキーのスコープを含む）」で判定されるかを検証。
import { MeetingOccurrenceController, MeetingOccurrenceByIdController } from './meeting-occurrence.controller';

function makePrisma() {
  return {
    meetingOccurrence: { findMany: jest.fn(async () => []) },
    meeting: { findFirst: jest.fn(async () => ({ id: 'm1' })) },
  } as any;
}

/** 直近の findMany に渡った where を取り出す。 */
function lastWhere(prisma: any) {
  return prisma.meetingOccurrence.findMany.mock.calls.at(-1)[0].where;
}

describe('MeetingOccurrenceController.list（検索）', () => {
  it('フィルタ無しなら projectId だけで絞る（OR・heldAt は付けない）', async () => {
    const prisma = makePrisma();
    const c = new MeetingOccurrenceController(prisma);
    await c.list('p1');
    const where = lastWhere(prisma);
    expect(where).toEqual({ projectId: 'p1' });
  });

  it('会議帯IDでフィルタする', async () => {
    const prisma = makePrisma();
    const c = new MeetingOccurrenceController(prisma);
    await c.list('p1', 'series-1');
    expect(lastWhere(prisma)).toMatchObject({ projectId: 'p1', meetingId: 'series-1' });
  });

  it('キーワードは題名・議事録・決定・ネクストアクション・出席者・アジェンダを横断（大小無視）', async () => {
    const prisma = makePrisma();
    const c = new MeetingOccurrenceController(prisma);
    await c.list('p1', undefined, '  仕様変更  ');
    const where = lastWhere(prisma);
    // 前後空白はトリムされ、6フィールドの OR になる。
    expect(where.OR).toEqual([
      { title: { contains: '仕様変更', mode: 'insensitive' } },
      { minutes: { contains: '仕様変更', mode: 'insensitive' } },
      { decisions: { contains: '仕様変更', mode: 'insensitive' } },
      { nextActions: { contains: '仕様変更', mode: 'insensitive' } },
      { attendees: { contains: '仕様変更', mode: 'insensitive' } },
      { agenda: { contains: '仕様変更', mode: 'insensitive' } },
    ]);
  });

  it('空白のみのキーワードは無視（OR を付けない）', async () => {
    const prisma = makePrisma();
    const c = new MeetingOccurrenceController(prisma);
    await c.list('p1', undefined, '   ');
    expect(lastWhere(prisma).OR).toBeUndefined();
  });

  it('開催日レンジ from/to を heldAt の gte/lte に落とす', async () => {
    const prisma = makePrisma();
    const c = new MeetingOccurrenceController(prisma);
    await c.list('p1', undefined, undefined, '2026-07-01', '2026-07-31');
    const where = lastWhere(prisma);
    expect(where.heldAt.gte).toBeInstanceOf(Date);
    expect(where.heldAt.lte).toBeInstanceOf(Date);
    expect(where.heldAt.gte.toISOString()).toBe(new Date('2026-07-01').toISOString());
  });

  it('不正な日付は無視して壊さない（heldAt を付けない）', async () => {
    const prisma = makePrisma();
    const c = new MeetingOccurrenceController(prisma);
    await c.list('p1', undefined, undefined, 'not-a-date', '');
    expect(lastWhere(prisma).heldAt).toBeUndefined();
  });

  it('新しい開催順（heldAt desc）で並べる', async () => {
    const prisma = makePrisma();
    const c = new MeetingOccurrenceController(prisma);
    await c.list('p1');
    const arg = prisma.meetingOccurrence.findMany.mock.calls.at(-1)[0];
    expect(arg.orderBy).toEqual([{ heldAt: 'desc' }, { createdAt: 'desc' }]);
  });
});

describe('MeetingOccurrenceByIdController の認可（APIキーのプロジェクトスコープを効かせる）', () => {
  const occRow = { id: 'occ2', projectId: 'P2', title: 't', heldAt: null, attendees: null, agenda: null, minutes: null, decisions: null, nextActions: null, source: null, sourceRef: null, order: 0, createdAt: new Date(), updatedAt: new Date() };
  function makePrismaById() {
    return {
      meetingOccurrence: {
        findUnique: jest.fn(async ({ select }: any) => (select?.projectId ? { projectId: 'P2' } : occRow)),
        update: jest.fn(async () => occRow),
        delete: jest.fn(async () => occRow),
      },
      meeting: { findFirst: jest.fn(async () => ({ id: 'm1' })) },
    } as any;
  }
  // 実 ProjectAccessService は使わず、assertPrincipalAccess の呼ばれ方だけを検証する。
  function makeAccess() {
    return { assertPrincipalAccess: jest.fn(async () => undefined) } as any;
  }
  const generalKeyPrincipal = { id: 'issuer', email: '', apiKeyRole: 'GENERAL_USER', organizationId: 'orgA', projectId: 'P1' };

  it('GET :id は assertProjectAccess(userIdのみ)ではなく principal 全体で assertPrincipalAccess する', async () => {
    const prisma = makePrismaById();
    const access = makeAccess();
    const c = new MeetingOccurrenceByIdController(prisma, access);
    await c.get(generalKeyPrincipal as any, 'occ2');
    // occ2 は P2 所属。principal（P1 スコープのキー）と対象 projectId=P2 を渡していること。
    expect(access.assertPrincipalAccess).toHaveBeenCalledWith(generalKeyPrincipal, 'P2', 'view');
  });

  it('DELETE :id は edit レベルで principal 判定してから削除する', async () => {
    const prisma = makePrismaById();
    const access = makeAccess();
    const c = new MeetingOccurrenceByIdController(prisma, access);
    await c.remove(generalKeyPrincipal as any, 'occ2');
    expect(access.assertPrincipalAccess).toHaveBeenCalledWith(generalKeyPrincipal, 'P2', 'edit');
    expect(prisma.meetingOccurrence.delete).toHaveBeenCalledWith({ where: { id: 'occ2' } });
  });

  it('assertPrincipalAccess が拒否(throw)すると更新まで到達しない', async () => {
    const prisma = makePrismaById();
    const access = { assertPrincipalAccess: jest.fn(async () => { throw new Error('You do not have access to this project'); }) } as any;
    const c = new MeetingOccurrenceByIdController(prisma, access);
    await expect(c.patch(generalKeyPrincipal as any, 'occ2', { title: 'x' } as any)).rejects.toThrow();
    expect(prisma.meetingOccurrence.update).not.toHaveBeenCalled();
  });
});
