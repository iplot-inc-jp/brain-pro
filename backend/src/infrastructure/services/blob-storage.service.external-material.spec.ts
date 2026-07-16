import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BlobStorageService } from './blob-storage.service';

describe('BlobStorageService external materials', () => {
  const originalUploadDir = process.env.UPLOAD_DIR;
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  let uploadDir: string;

  beforeEach(() => {
    uploadDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'brain-pro-external-material-'),
    );
    process.env.UPLOAD_DIR = uploadDir;
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });

  afterEach(() => {
    fs.rmSync(uploadDir, { recursive: true, force: true });
    if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = originalUploadDir;
    if (originalToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = originalToken;
  });

  it('reads a server-stored external material from the disk fallback', async () => {
    const service = new BlobStorageService();
    const original = Buffer.from('%PDF-1.7 external');

    const saved = await service.save(
      'external-materials/p1/import-1/file.pdf',
      original,
      'application/pdf',
      { stable: true },
    );

    await expect(service.read(saved.url)).resolves.toEqual(original);
  });
});
