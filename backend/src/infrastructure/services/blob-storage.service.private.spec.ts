const issueSignedToken = jest.fn();
const presignUrl = jest.fn();
const head = jest.fn();
const get = jest.fn();
const del = jest.fn();
const put = jest.fn();

jest.mock('@vercel/blob', () => ({
  issueSignedToken,
  presignUrl,
  head,
  get,
  del,
  put,
}));

import { BlobStorageService } from './blob-storage.service';

describe('BlobStorageService private external materials', () => {
  const originalPrivateToken = process.env.PRIVATE_BLOB_READ_WRITE_TOKEN;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PRIVATE_BLOB_READ_WRITE_TOKEN = 'private-store-token';
  });

  afterAll(() => {
    if (originalPrivateToken === undefined) {
      delete process.env.PRIVATE_BLOB_READ_WRITE_TOKEN;
    } else {
      process.env.PRIVATE_BLOB_READ_WRITE_TOKEN = originalPrivateToken;
    }
  });

  it('issues an exact-path private PUT URL with type, size and expiry constraints', async () => {
    issueSignedToken.mockResolvedValue({
      clientSigningToken: 'client-signing',
      delegationToken: 'delegation',
      validUntil: 123_456,
    });
    presignUrl.mockResolvedValue({
      presignedUrl: 'https://blob.example/upload',
    });
    const service = new BlobStorageService();

    const result = await service.createPrivateUpload(
      'external-materials/p1/i1/file.pdf',
      'application/pdf',
      1024,
      120_000,
    );

    expect(issueSignedToken).toHaveBeenCalledWith({
      token: 'private-store-token',
      pathname: 'external-materials/p1/i1/file.pdf',
      operations: ['put'],
      validUntil: 120_000,
      allowedContentTypes: ['application/pdf'],
      maximumSizeInBytes: 1024,
    });
    expect(presignUrl).toHaveBeenCalledWith(
      expect.objectContaining({ delegationToken: 'delegation' }),
      expect.objectContaining({
        access: 'private',
        operation: 'put',
        pathname: 'external-materials/p1/i1/file.pdf',
        allowedContentTypes: ['application/pdf'],
        maximumSizeInBytes: 1024,
        addRandomSuffix: false,
        allowOverwrite: true,
      }),
    );
    expect(result).toEqual({
      uploadUrl: 'https://blob.example/upload',
      pathname: 'external-materials/p1/i1/file.pdf',
      expiresAt: 123_456,
    });
  });

  it('heads and reads private bytes without CDN cache and enforces measured size', async () => {
    head.mockResolvedValue({
      pathname: 'external-materials/p1/i1/file.pdf',
      size: 5,
      contentType: 'application/pdf',
      url: 'https://private.blob/file.pdf',
    });
    get.mockImplementation(async () => ({
      statusCode: 200,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4, 5]));
          controller.close();
        },
      }),
      blob: {},
      headers: new Headers(),
    }));
    const service = new BlobStorageService();

    await expect(
      service.headPrivate('external-materials/p1/i1/file.pdf'),
    ).resolves.toEqual(expect.objectContaining({ size: 5 }));
    await expect(
      service.readPrivate('external-materials/p1/i1/file.pdf', 5),
    ).resolves.toEqual(Buffer.from([1, 2, 3, 4, 5]));
    expect(head).toHaveBeenCalledWith('external-materials/p1/i1/file.pdf', {
      token: 'private-store-token',
    });
    expect(get).toHaveBeenCalledWith('external-materials/p1/i1/file.pdf', {
      access: 'private',
      token: 'private-store-token',
      useCache: false,
    });

    await expect(
      service.readPrivate('external-materials/p1/i1/file.pdf', 4),
    ).rejects.toThrow('private blob exceeds');
  });

  it('fails closed without the dedicated private store token', async () => {
    delete process.env.PRIVATE_BLOB_READ_WRITE_TOKEN;
    const service = new BlobStorageService();

    await expect(
      service.createPrivateUpload(
        'external-materials/p1/i1/file.pdf',
        'application/pdf',
        10,
      ),
    ).rejects.toThrow('PRIVATE_BLOB_READ_WRITE_TOKEN');
    expect(issueSignedToken).not.toHaveBeenCalled();
  });

  it('issues a short-lived private GET URL without exposing the store token', async () => {
    issueSignedToken.mockResolvedValue({
      clientSigningToken: 'client-signing',
      delegationToken: 'delegation',
      validUntil: 99_000,
    });
    presignUrl.mockResolvedValue({ presignedUrl: 'https://private.blob/get' });
    const service = new BlobStorageService();

    await expect(
      service.createPrivateDownload(
        'external-materials/p1/i1/file.pdf',
        90_000,
      ),
    ).resolves.toEqual({
      downloadUrl: 'https://private.blob/get',
      expiresAt: 99_000,
    });
    expect(issueSignedToken).toHaveBeenCalledWith({
      token: 'private-store-token',
      pathname: 'external-materials/p1/i1/file.pdf',
      operations: ['get'],
      validUntil: 90_000,
    });
    expect(presignUrl).toHaveBeenCalledWith(
      expect.objectContaining({ delegationToken: 'delegation' }),
      {
        access: 'private',
        operation: 'get',
        pathname: 'external-materials/p1/i1/file.pdf',
        validUntil: 90_000,
      },
    );
  });
});
