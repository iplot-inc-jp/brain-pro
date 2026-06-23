import { Injectable, Logger } from '@nestjs/common';
import { TaskStatus, TaskPriority } from '@prisma/client';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { ClaudeService, ExtractedTaskNode } from './claude.service';
import { FileExtractionService } from '../knowledge/file-extraction.service';
import { LlmUsageContext } from './llm-usage-recorder.service';

export interface ExcelImportResult {
  created: number; // 作成タスク総数（子含む）
  rootCount: number; // ルート（大項目相当）件数
  preview: { title: string; childCount: number }[]; // 確認用プレビュー（最大30件）
}

/**
 * Excel(.xlsx) を生成AIで読み取り、大項目/中項目などの階層を推測して Task を自動生成するサービス。
 * xlsx → Markdown(表) → Claude(入れ子JSON) → Task を parentId で再帰生成。
 */
@Injectable()
export class ExcelTaskImportService {
  private readonly logger = new Logger(ExcelTaskImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly claude: ClaudeService,
    private readonly fileExtraction: FileExtractionService,
  ) {}

  async importFromXlsx(opts: {
    projectId: string;
    bytes: Buffer;
    instructions?: string;
    apiKey: string;
    userId: string;
  }): Promise<ExcelImportResult> {
    const extracted = await this.fileExtraction.extractText('spreadsheet', opts.bytes);
    const markdown = (extracted.text ?? '').trim();
    if (!markdown) {
      throw new Error('Excelから表データを抽出できませんでした（空のファイルの可能性）');
    }

    const usage: LlmUsageContext = {
      projectId: opts.projectId,
      area: 'OTHER', // Excel→タスク取り込み（専用areaは設けず OTHER に集約）
      userId: opts.userId,
    };

    let nodes: ExtractedTaskNode[];
    try {
      nodes = await this.claude.extractTasksFromSpreadsheet(
        markdown,
        opts.instructions,
        opts.apiKey,
        usage,
      );
    } catch (e) {
      this.logger.warn(`Excel import retry after parse error: ${(e as Error).message}`);
      nodes = await this.claude.extractTasksFromSpreadsheet(
        markdown,
        opts.instructions,
        opts.apiKey,
        usage,
      );
    }

    // 既存ルートタスクの最大 order の続きから採番。
    const max = await this.prisma.task.aggregate({
      where: { projectId: opts.projectId, parentId: null },
      _max: { order: true },
    });
    let order = (max._max.order ?? -1) + 1;

    let created = 0;
    let rootCount = 0;
    const preview: { title: string; childCount: number }[] = [];
    for (const node of nodes) {
      const n = await this.createNode(opts.projectId, node, null, order++);
      if (n > 0) {
        created += n;
        rootCount++;
        preview.push({
          title: (node.title ?? '').trim().slice(0, 60),
          childCount: node.children?.length ?? 0,
        });
      }
    }

    this.logger.log(
      `Excel import: created ${created} tasks (${rootCount} roots) for project ${opts.projectId}`,
    );
    return { created, rootCount, preview: preview.slice(0, 30) };
  }

  /** 1ノードを作成し、children を再帰生成する。作成総数を返す（title空はスキップ=0）。 */
  private async createNode(
    projectId: string,
    node: ExtractedTaskNode,
    parentId: string | null,
    order: number,
  ): Promise<number> {
    const title = (node.title ?? '').trim();
    if (!title) return 0;

    const task = await this.prisma.task.create({
      data: {
        projectId,
        parentId,
        title: title.slice(0, 500),
        description: node.description?.trim() || null,
        status: mapStatus(node.status),
        priority: mapPriority(node.priority),
        assigneeName: node.assigneeName?.trim() || null,
        startDate: parseDate(node.startDate),
        dueDate: parseDate(node.dueDate),
        order,
      },
    });

    let count = 1;
    const children = node.children ?? [];
    let childOrder = 0;
    for (const child of children) {
      count += await this.createNode(projectId, child, task.id, childOrder++);
    }
    return count;
  }
}

function mapStatus(v?: string | null): TaskStatus {
  const s = (v ?? '').trim().toUpperCase();
  if (s === 'IN_PROGRESS' || s.includes('進行') || s.includes('対応中')) return 'IN_PROGRESS';
  if (s === 'RESOLVED' || s.includes('解決') || s.includes('完了')) return 'RESOLVED';
  if (s === 'CLOSED' || s.includes('クローズ') || s.includes('終了')) return 'CLOSED';
  return 'OPEN';
}

function mapPriority(v?: string | null): TaskPriority {
  const s = (v ?? '').trim().toUpperCase();
  if (s === 'HIGH' || s.includes('高') || s === '高') return 'HIGH';
  if (s === 'LOW' || s.includes('低')) return 'LOW';
  return 'MEDIUM';
}

function parseDate(v?: string | null): Date | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  // YYYY-MM-DD / YYYY/MM/DD を許容。
  const m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}
