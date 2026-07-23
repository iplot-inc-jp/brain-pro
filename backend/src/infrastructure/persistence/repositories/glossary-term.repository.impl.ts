import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  GlossaryTerm,
  GlossaryTermMapping,
} from '../../../domain/entities/glossary-term.entity';
import { IGlossaryTermRepository } from '../../../domain/repositories/glossary-term.repository';
import { PrismaService } from '../prisma/prisma.service';

interface MappingRecord {
  id: string;
  termId: string;
  context: string;
  systemName: string | null;
  value: string;
  note: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

interface TermRecord {
  id: string;
  projectId: string;
  subProjectId: string | null;
  termCode: string | null;
  name: string;
  definition: string | null;
  sourceOfTruth: string | null;
  sourceOfTruthNote: string | null;
  category: string | null;
  status: string;
  notes: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
  mappings?: MappingRecord[];
}

@Injectable()
export class GlossaryTermRepositoryImpl implements IGlossaryTermRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toMappingDomain(record: MappingRecord): GlossaryTermMapping {
    return GlossaryTermMapping.reconstruct({
      id: record.id,
      termId: record.termId,
      context: record.context,
      systemName: record.systemName,
      value: record.value,
      note: record.note,
      order: record.order,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  private toDomain(record: TermRecord): GlossaryTerm {
    return GlossaryTerm.reconstruct({
      id: record.id,
      projectId: record.projectId,
      subProjectId: record.subProjectId,
      termCode: record.termCode,
      name: record.name,
      definition: record.definition,
      sourceOfTruth: record.sourceOfTruth,
      sourceOfTruthNote: record.sourceOfTruthNote,
      category: record.category,
      status: record.status,
      notes: record.notes,
      order: record.order,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      mappings: (record.mappings ?? []).map((m) => this.toMappingDomain(m)),
    });
  }

  private readonly mappingOrder = [
    { order: 'asc' as const },
    { createdAt: 'asc' as const },
  ];

  async findById(id: string): Promise<GlossaryTerm | null> {
    const record = await this.prisma.glossaryTerm.findUnique({
      where: { id },
      include: { mappings: { orderBy: this.mappingOrder } },
    });
    if (!record) return null;
    return this.toDomain(record);
  }

  async findByProjectId(projectId: string): Promise<GlossaryTerm[]> {
    const records = await this.prisma.glossaryTerm.findMany({
      where: { projectId },
      include: { mappings: { orderBy: this.mappingOrder } },
      orderBy: [{ order: 'asc' }, { termCode: 'asc' }, { createdAt: 'asc' }],
    });
    return records.map((r) => this.toDomain(r));
  }

  async create(term: GlossaryTerm): Promise<void> {
    await this.prisma.glossaryTerm.create({
      data: {
        id: term.id,
        projectId: term.projectId,
        subProjectId: term.subProjectId,
        termCode: term.termCode,
        name: term.name,
        definition: term.definition,
        sourceOfTruth: term.sourceOfTruth,
        sourceOfTruthNote: term.sourceOfTruthNote,
        category: term.category,
        status: term.status,
        notes: term.notes,
        order: term.order,
        createdAt: term.createdAt,
        updatedAt: term.updatedAt,
      },
    });
  }

  async update(term: GlossaryTerm): Promise<void> {
    await this.prisma.glossaryTerm.update({
      where: { id: term.id },
      data: {
        subProjectId: term.subProjectId,
        termCode: term.termCode,
        name: term.name,
        definition: term.definition,
        sourceOfTruth: term.sourceOfTruth,
        sourceOfTruthNote: term.sourceOfTruthNote,
        category: term.category,
        status: term.status,
        notes: term.notes,
        order: term.order,
        updatedAt: term.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    // mappings は onDelete: Cascade で一緒に消える
    await this.prisma.glossaryTerm.delete({ where: { id } });
  }

  async findMappingById(id: string): Promise<GlossaryTermMapping | null> {
    const record = await this.prisma.glossaryTermMapping.findUnique({
      where: { id },
    });
    if (!record) return null;
    return this.toMappingDomain(record);
  }

  async createMapping(mapping: GlossaryTermMapping): Promise<void> {
    await this.prisma.glossaryTermMapping.create({
      data: {
        id: mapping.id,
        termId: mapping.termId,
        context: mapping.context,
        systemName: mapping.systemName,
        value: mapping.value,
        note: mapping.note,
        order: mapping.order,
        createdAt: mapping.createdAt,
        updatedAt: mapping.updatedAt,
      },
    });
  }

  async updateMapping(mapping: GlossaryTermMapping): Promise<void> {
    await this.prisma.glossaryTermMapping.update({
      where: { id: mapping.id },
      data: {
        context: mapping.context,
        systemName: mapping.systemName,
        value: mapping.value,
        note: mapping.note,
        order: mapping.order,
        updatedAt: mapping.updatedAt,
      },
    });
  }

  async deleteMapping(id: string): Promise<void> {
    await this.prisma.glossaryTermMapping.delete({ where: { id } });
  }

  generateId(): string {
    return randomUUID();
  }
}
