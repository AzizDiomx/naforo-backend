import { prisma } from '@/config/database';
import { User, Prisma } from '@prisma/client';
import { PaginationQuery } from '@/shared/types';

export class UsersRepository {
  async findAll(organizationId: string, options: PaginationQuery): Promise<{ users: User[]; total: number }> {
    const { page, limit, search, sortBy, sortOrder } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {
      organizationId,
      isActive: true,
      OR: search
        ? [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
          ]
        : undefined,
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy || 'createdAt']: (sortOrder || 'ASC').toLowerCase() as 'asc' | 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    return { users, total };
  }

  async findById(id: string, organizationId?: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: {
        id,
        organizationId: organizationId || undefined,
      },
    });
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({
      data,
    });
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({
      where: { id },
      data,
    });
  }

  async softDelete(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async updateFCMToken(id: string, fcmToken: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { fcmToken },
    });
  }

  async updatePassword(id: string, passwordHash: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
  }
}

export const usersRepository = new UsersRepository();
