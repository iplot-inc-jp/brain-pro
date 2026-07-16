import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { ExternalMaterialController } from './external-material.controller';

const user = {
  id: 'service-user',
  email: '',
  apiKeyId: 'key-1',
  apiKeyRole: 'GENERAL_USER',
  organizationId: 'org-1',
  projectIds: ['p1'],
} as any;

const file = {
  originalname: 'deck.pptx',
  mimetype:
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  size: 8,
  buffer: Buffer.from('PK\x03\x04test'),
} as Express.Multer.File;

describe('ExternalMaterialController', () => {
  it('maps prepare metadata and exposes finalize, status, and signed download operations', async () => {
    const importUseCase = {
      prepare: jest.fn(async () => ({ importId: 'i1', status: 'PENDING' })),
      finalize: jest.fn(async () => ({ importId: 'i1', status: 'STORED' })),
      getStatus: jest.fn(async () => ({ importId: 'i1', status: 'STORED' })),
      getDownload: jest.fn(async () => ({
        downloadUrl: 'https://private.example/get',
        expiresAt: 123,
      })),
    };
    const access = { assertPrincipalAccess: jest.fn(async () => undefined) };
    const controller = new ExternalMaterialController(
      importUseCase as any,
      access as any,
    );
    const dto = {
      idempotencyKey: 'ipro:slack:file:p1',
      sourcePlatform: 'slack' as const,
      sourceChannelId: 'C1',
      sourceMessageId: '123.456',
      sourceFileId: 'F1',
      filename: 'deck.pptx',
      mimeType: file.mimetype,
      size: 1024,
      contentSha256: 'a'.repeat(64),
    };

    await controller.prepare(user, 'p1', dto);
    await controller.finalize(user, 'p1', 'i1');
    await controller.status(user, 'p1', 'i1');
    await controller.download(user, 'p1', 'i1');

    expect(importUseCase.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'service-user',
        principal: user,
        projectId: 'p1',
        file: {
          filename: 'deck.pptx',
          mimeType: file.mimetype,
          size: 1024,
          contentSha256: 'a'.repeat(64),
        },
      }),
    );
    expect(importUseCase.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ importId: 'i1', principal: user }),
    );
    expect(importUseCase.getStatus).toHaveBeenCalledWith(
      expect.objectContaining({ importId: 'i1', principal: user }),
    );
    expect(importUseCase.getDownload).toHaveBeenCalledWith(
      expect.objectContaining({ importId: 'i1', principal: user }),
    );
    expect(access.assertPrincipalAccess).toHaveBeenCalledWith(
      user,
      'p1',
      'edit',
    );
    expect(access.assertPrincipalAccess).toHaveBeenCalledWith(
      user,
      'p1',
      'view',
    );
  });

  it('requires edit access for the full API-key principal and maps multipart input', async () => {
    const importUseCase = {
      execute: jest.fn(async () => ({
        importId: 'i1',
        attachmentId: 'a1',
        batchId: 'b1',
        status: 'BATCHED',
      })),
    };
    const access = { assertPrincipalAccess: jest.fn(async () => undefined) };
    const controller = new ExternalMaterialController(
      importUseCase as any,
      access as any,
    );

    const result = await controller.create(
      user,
      'p1',
      {
        idempotencyKey: 'ipro:slack:file:p1',
        sourcePlatform: 'slack',
        sourceChannelId: 'C1',
        sourceMessageId: '123.456',
        sourceFileId: 'F1',
      },
      file,
      String(1024),
    );

    expect(access.assertPrincipalAccess).toHaveBeenCalledWith(
      user,
      'p1',
      'edit',
    );
    expect(importUseCase.execute).toHaveBeenCalledWith({
      userId: 'service-user',
      principal: user,
      projectId: 'p1',
      idempotencyKey: 'ipro:slack:file:p1',
      sourcePlatform: 'slack',
      sourceChannelId: 'C1',
      sourceMessageId: '123.456',
      sourceFileId: 'F1',
      file: {
        filename: 'deck.pptx',
        mimeType: file.mimetype,
        size: 8,
        bytes: file.buffer,
      },
    });
    expect(result).toEqual({
      importId: 'i1',
      attachmentId: 'a1',
      batchId: 'b1',
      status: 'BATCHED',
    });
  });

  it('rejects a request without a file before calling the use case', async () => {
    const importUseCase = { execute: jest.fn() };
    const access = { assertPrincipalAccess: jest.fn(async () => undefined) };
    const controller = new ExternalMaterialController(
      importUseCase as any,
      access as any,
    );

    await expect(
      controller.create(
        user,
        'p1',
        {
          idempotencyKey: 'key',
          sourcePlatform: 'line',
          sourceChannelId: 'channel',
          sourceMessageId: 'message',
          sourceFileId: 'file',
        },
        undefined as any,
        undefined,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(importUseCase.execute).not.toHaveBeenCalled();
  });

  it('does not invoke the use case when project access is denied', async () => {
    const importUseCase = { execute: jest.fn() };
    const access = {
      assertPrincipalAccess: jest.fn(async () => {
        throw new Error('forbidden');
      }),
    };
    const controller = new ExternalMaterialController(
      importUseCase as any,
      access as any,
    );

    await expect(
      controller.create(
        user,
        'foreign-project',
        {
          idempotencyKey: 'key',
          sourcePlatform: 'slack',
          sourceChannelId: 'channel',
          sourceMessageId: 'message',
          sourceFileId: 'file',
        },
        file,
        '1024',
      ),
    ).rejects.toThrow('forbidden');
    expect(importUseCase.execute).not.toHaveBeenCalled();
  });

  it('rejects an oversized Content-Length before invoking the use case', async () => {
    const importUseCase = { execute: jest.fn() };
    const access = { assertPrincipalAccess: jest.fn(async () => undefined) };
    const controller = new ExternalMaterialController(
      importUseCase as any,
      access as any,
    );

    await expect(
      controller.create(
        user,
        'p1',
        {
          idempotencyKey: 'key',
          sourcePlatform: 'slack',
          sourceChannelId: 'channel',
          sourceMessageId: 'message',
          sourceFileId: 'file',
        },
        file,
        String(52 * 1024 * 1024),
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(importUseCase.execute).not.toHaveBeenCalled();
  });
});
