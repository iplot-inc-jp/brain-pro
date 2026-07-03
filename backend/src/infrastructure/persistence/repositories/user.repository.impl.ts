import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { User, UserRepository } from '../../../domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ユーザーリポジトリ実装
 */
@Injectable()
export class UserRepositoryImpl implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    const data = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!data) return null;

    return User.reconstruct({
      id: data.id,
      email: data.email,
      password: data.password,
      name: data.name,
      avatarUrl: data.avatarUrl,
      isSuperAdmin: data.isSuperAdmin,
      googleId: data.googleId,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    const data = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!data) return null;

    return User.reconstruct({
      id: data.id,
      email: data.email,
      password: data.password,
      name: data.name,
      avatarUrl: data.avatarUrl,
      isSuperAdmin: data.isSuperAdmin,
      googleId: data.googleId,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  async existsByEmail(email: string): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: { email: email.toLowerCase() },
    });
    return count > 0;
  }

  async save(user: User): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email,
        password: user.password,
        name: user.name,
        avatarUrl: user.avatarUrl,
        googleId: user.googleId,
        isSuperAdmin: user.isSuperAdmin,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      update: {
        email: user.email,
        password: user.password,
        name: user.name,
        avatarUrl: user.avatarUrl,
        googleId: user.googleId,
        isSuperAdmin: user.isSuperAdmin,
        updatedAt: user.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.user.delete({
      where: { id },
    });
  }

  generateId(): string {
    return randomUUID();
  }
}

