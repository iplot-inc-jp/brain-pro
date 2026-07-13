// meeting-occurrence.controller.spec.ts
// list() の検索条件（会議帯 / キーワード横断 / 開催日レンジ）が Prisma の where に正しく落ちるかを検証。
import { MeetingOccurrenceController } from './meeting-occurrence.controller';

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
