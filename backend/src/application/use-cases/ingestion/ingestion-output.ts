import { IngestionBatch, IngestionFile } from '../../../domain';

export interface IngestionBatchOutput {
  id: string;
  projectId: string;
  name: string;
  status: string;
  totalFiles: number;
  succeededFiles: number;
  failedFiles: number;
  pendingFiles: number;
  options: Record<string, unknown> | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface IngestionFileOutput {
  id: string;
  batchId: string;
  projectId: string;
  sourceType: string;
  sourceRef: string | null;
  filename: string;
  displayName: string | null;
  mimeType: string | null;
  size: number | null;
  blobUrl: string | null;
  isArchive: boolean;
  parentFileId: string | null;
  status: string;
  step: string | null;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  jobId: string | null;
  knowledgeDocumentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface IngestionBatchDetailOutput extends IngestionBatchOutput {
  files: IngestionFileOutput[];
}

export function toIngestionBatchOutput(
  batch: IngestionBatch,
): IngestionBatchOutput {
  return {
    id: batch.id,
    projectId: batch.projectId,
    name: batch.name,
    status: batch.status,
    totalFiles: batch.totalFiles,
    succeededFiles: batch.succeededFiles,
    failedFiles: batch.failedFiles,
    pendingFiles: batch.pendingFiles,
    options: batch.options,
    createdById: batch.createdById,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    startedAt: batch.startedAt,
    finishedAt: batch.finishedAt,
  };
}

export interface IngestionBatchWithProjectOutput extends IngestionBatchOutput {
  projectName: string;
}

export function toIngestionBatchWithProjectOutput(
  batch: IngestionBatch,
  projectName: string,
): IngestionBatchWithProjectOutput {
  return { ...toIngestionBatchOutput(batch), projectName };
}

export function toIngestionFileOutput(
  file: IngestionFile,
): IngestionFileOutput {
  return {
    id: file.id,
    batchId: file.batchId,
    projectId: file.projectId,
    sourceType: file.sourceType,
    sourceRef: file.sourceRef,
    filename: file.filename,
    displayName: file.displayName,
    mimeType: file.mimeType,
    size: file.size,
    blobUrl: file.blobUrl,
    isArchive: file.isArchive,
    parentFileId: file.parentFileId,
    status: file.status,
    step: file.step,
    progress: file.progress,
    attempts: file.attempts,
    maxAttempts: file.maxAttempts,
    error: file.error,
    jobId: file.jobId,
    knowledgeDocumentId: file.knowledgeDocumentId,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    startedAt: file.startedAt,
    finishedAt: file.finishedAt,
  };
}
