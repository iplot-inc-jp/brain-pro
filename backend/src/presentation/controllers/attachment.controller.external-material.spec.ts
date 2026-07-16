import { NotFoundException } from '@nestjs/common';
import { AttachmentController } from './attachment.controller';

describe('AttachmentController private external material', () => {
  it('never serves or redirects a LINE・Slack original from the public route', async () => {
    const prisma = {
      attachment: {
        findUnique: jest.fn(async () => ({
          id: 'attachment-1',
          folder: 'LINE・Slack',
          filename: 'secret.pdf',
          mimeType: 'application/pdf',
          data: null,
          blobUrl: 'private-blob:external-materials/p1/i1/secret.pdf',
        })),
      },
    };
    const response = {
      setHeader: jest.fn(),
      redirect: jest.fn(),
      send: jest.fn(),
    };
    const controller = new AttachmentController(prisma as any, {} as any);

    await expect(
      controller.serveFile('attachment-1', response as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(response.redirect).not.toHaveBeenCalled();
    expect(response.send).not.toHaveBeenCalled();
  });
});
