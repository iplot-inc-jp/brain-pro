import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../persistence/prisma/prisma.service';
import {
  DEFAULT_RAG_MODEL,
  DEFAULT_RAG_SYSTEM_PROMPT,
  RAG_ALLOWED_MODELS,
  RAG_PROMPT_MAX_LENGTH,
} from './rag-prompt.defaults';

export interface UpdateRagPromptInput {
  model: string;
  systemPrompt: string;
}

@Injectable()
export class RagPromptService {
  constructor(private readonly prisma: PrismaService) {}

  async getActive(projectId: string, createdById?: string | null): Promise<any> {
    const current = await this.prisma.ragPromptVersion.findFirst({
      where: { projectId, isActive: true },
    });
    if (current) return current;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const concurrent = await tx.ragPromptVersion.findFirst({
          where: { projectId, isActive: true },
        });
        if (concurrent) return concurrent;
        const latest = await tx.ragPromptVersion.findFirst({
          where: { projectId },
          orderBy: { version: 'desc' },
        });
        return tx.ragPromptVersion.create({
          data: {
            projectId,
            version: (latest?.version ?? 0) + 1,
            model: DEFAULT_RAG_MODEL,
            systemPrompt: DEFAULT_RAG_SYSTEM_PROMPT,
            isActive: true,
            createdById: createdById ?? null,
          },
        });
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const concurrent = await this.prisma.ragPromptVersion.findFirst({
          where: { projectId, isActive: true },
        });
        if (concurrent) return concurrent;
      }
      throw error;
    }
  }

  async getSettings(projectId: string, createdById?: string | null) {
    const active = await this.getActive(projectId, createdById);
    const history = await this.prisma.ragPromptVersion.findMany({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    return {
      active,
      history,
      defaults: {
        model: DEFAULT_RAG_MODEL,
        systemPrompt: DEFAULT_RAG_SYSTEM_PROMPT,
      },
      allowedModels: [...RAG_ALLOWED_MODELS],
    };
  }

  async update(
    projectId: string,
    input: UpdateRagPromptInput,
    createdById?: string | null,
  ): Promise<any> {
    const data = this.validate(input);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const latest = await tx.ragPromptVersion.findFirst({
          where: { projectId },
          orderBy: { version: 'desc' },
        });
        await tx.ragPromptVersion.updateMany({
          where: { projectId, isActive: true },
          data: { isActive: false },
        });
        return tx.ragPromptVersion.create({
          data: {
            projectId,
            version: (latest?.version ?? 0) + 1,
            model: data.model,
            systemPrompt: data.systemPrompt,
            isActive: true,
            createdById: createdById ?? null,
          },
        });
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException(
          'RAG設定が同時に更新されました。最新の設定を読み直してください',
        );
      }
      throw error;
    }
  }

  reset(projectId: string, createdById?: string | null): Promise<any> {
    return this.update(
      projectId,
      { model: DEFAULT_RAG_MODEL, systemPrompt: DEFAULT_RAG_SYSTEM_PROMPT },
      createdById,
    );
  }

  private validate(input: UpdateRagPromptInput): UpdateRagPromptInput {
    if (!(RAG_ALLOWED_MODELS as readonly string[]).includes(input.model)) {
      throw new BadRequestException(`許可されていないモデルです: ${input.model}`);
    }
    const systemPrompt = input.systemPrompt?.trim();
    if (!systemPrompt) {
      throw new BadRequestException('システムプロンプトを空にはできません');
    }
    if (systemPrompt.length > RAG_PROMPT_MAX_LENGTH) {
      throw new BadRequestException(
        `システムプロンプトは${RAG_PROMPT_MAX_LENGTH}文字以内にしてください`,
      );
    }
    return { model: input.model, systemPrompt };
  }

  private isUniqueConflict(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
  }
}
