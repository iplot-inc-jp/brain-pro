import { AttachmentRegisterService } from './attachment-register.service';

function makePrisma(existing?: any) {
  return {
    attachment: {
      findFirst: jest.fn(async () => existing ?? null),
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: any) => ({ ...data })),
    },
  } as any;
}

describe('AttachmentRegisterService', () => {
  const input = {
    projectId: 'p1',
    blobUrl: 'https://x.public.blob.vercel-storage.com/a.pdf',
    filename: 'a.pdf',
    mimeType: 'application/pdf',
    size: 123,
  };

  it('同じ blobUrl が既存ならそれを返す（冪等・create しない）', async () => {
    const prisma = makePrisma({ id: 'old1', blobUrl: input.blobUrl });
    const svc = new AttachmentRegisterService(prisma);
    const r = await svc.register(input);
    expect((r as any).id).toBe('old1');
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });

  it('未登録なら data=null・blobUrl・kind推定・url で作成', async () => {
    const prisma = makePrisma(null);
    const svc = new AttachmentRegisterService(prisma);
    await svc.register(input);
    const arg = prisma.attachment.create.mock.calls[0][0].data;
    expect(arg.blobUrl).toBe(input.blobUrl);
    expect(arg.data).toBeNull();
    expect(arg.kind).toBe('PDF');
    expect(arg.url).toBe(`/api/attachments/${arg.id}/file`);
    expect(arg.projectId).toBe('p1');
  });

  it('image/* は IMAGE、その他は FILE', async () => {
    const prisma = makePrisma(null);
    const svc = new AttachmentRegisterService(prisma);
    await svc.register({ ...input, mimeType: 'image/png' });
    expect(prisma.attachment.create.mock.calls[0][0].data.kind).toBe('IMAGE');
    await svc.register({ ...input, mimeType: 'application/zip' });
    expect(prisma.attachment.create.mock.calls[1][0].data.kind).toBe('FILE');
  });

  it('scope FK（taskId 等）を引き継ぐ', async () => {
    const prisma = makePrisma(null);
    const svc = new AttachmentRegisterService(prisma);
    await svc.register({ ...input, taskId: 't9', flowId: 'f3' });
    const arg = prisma.attachment.create.mock.calls[0][0].data;
    expect(arg.taskId).toBe('t9');
    expect(arg.flowId).toBe('f3');
    expect(arg.phaseId).toBeNull();
  });
});
