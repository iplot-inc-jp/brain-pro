import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import {
  OrganizationInviteRepository,
  OrganizationInviteRecord,
  CreateInviteData,
  InviteRole,
} from '../../../domain';
import { PrismaService } from '../prisma/prisma.service';

type PrismaInviteRow = {
  id: string;
  organizationId: string;
  token: string;
  role: string;
  createdByUserId: string;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: Date | null;
  createdAt: Date;
};

@Injectable()
export class OrganizationInviteRepositoryImpl implements OrganizationInviteRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: PrismaInviteRow): OrganizationInviteRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      token: row.token,
      role: row.role as InviteRole,
      createdByUserId: row.createdByUserId,
      expiresAt: row.expiresAt,
      maxUses: row.maxUses,
      useCount: row.useCount,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    };
  }

  async create(data: CreateInviteData): Promise<OrganizationInviteRecord> {
    const row = await this.prisma.organizationInvite.create({
      data: {
        id: data.id,
        organizationId: data.organizationId,
        token: data.token,
        role: data.role,
        createdByUserId: data.createdByUserId,
        expiresAt: data.expiresAt,
        maxUses: data.maxUses,
      },
    });
    return this.toRecord(row);
  }

  async findByToken(token: string): Promise<OrganizationInviteRecord | null> {
    const row = await this.prisma.organizationInvite.findUnique({ where: { token } });
    return row ? this.toRecord(row) : null;
  }

  async findById(id: string): Promise<OrganizationInviteRecord | null> {
    const row = await this.prisma.organizationInvite.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findByOrganizationId(organizationId: string): Promise<OrganizationInviteRecord[]> {
    const rows = await this.prisma.organizationInvite.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async incrementUseCount(id: string): Promise<void> {
    await this.prisma.organizationInvite.update({
      where: { id },
      data: { useCount: { increment: 1 } },
    });
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.organizationInvite.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  generateId(): string {
    return randomUUID();
  }

  generateToken(): string {
    return randomBytes(24).toString('base64url');
  }
}
