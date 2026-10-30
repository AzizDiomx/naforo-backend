import * as bcrypt from 'bcryptjs';
import { env } from '@/config/env';
import { usersRepository } from './users.repository';
import { authRepository } from '../auth/auth.repository';
import { ConflictError, NotFoundError, ForbiddenError } from '@/shared/errors/AppError';
import { prisma } from '@/config/database';
import { User, Prisma } from '@prisma/client';
import { sendMail } from '@/config/mailer';
import { logger } from '@/config/logger';
import { PaginationQuery, PaginationMeta } from '@/shared/types';
import { buildPaginationMeta } from '@/shared/helpers/pagination';
import { getOrganizationPlanContext, planIncludesFeature } from '@/shared/helpers/plan-policy';

export class UsersService {
  async getAllUsers(
    organizationId: string,
    query: PaginationQuery
  ): Promise<{ data: User[]; meta: PaginationMeta }> {
    const { users, total } = await usersRepository.findAll(organizationId, query);
    const meta = buildPaginationMeta(total, query.page, query.limit);
    return { data: users, meta };
  }

  async getUserById(id: string, organizationId: string): Promise<User> {
    const user = await usersRepository.findById(id, organizationId);
    if (!user) {
      throw new NotFoundError('Utilisateur introuvable.');
    }
    return user;
  }

  async createUser(data: any, organizationId: string): Promise<User> {
    // Contrôle du multi-utilisateurs selon l'abonnement (rôles staff/gestion)
    if (data.role !== 'tenant') {
      const ctx = await getOrganizationPlanContext(organizationId);
      const hasMultiUsers = planIncludesFeature(ctx.planCode, ctx.features, 'multi_users');
      if (!hasMultiUsers) {
        const staffCount = await prisma.user.count({
          where: {
            organizationId,
            role: { in: ['admin', 'manager', 'accountant', 'owner'] },
          },
        });

        const maxStaff = ctx.planCode.includes('pro') ? 2 : 1;
        if (staffCount >= maxStaff) {
          throw new ForbiddenError(
            `La création de collaborateurs supplémentaires requiert la formule Expert / Agence (Option Multi-Gestionnaires). Votre formule actuelle (${ctx.planName}) est limitée à ${maxStaff} accès gestionnaire.`
          );
        }
      }
    }

    // Check if email already taken
    const existing = await authRepository.findByEmail(data.email);
    if (existing) {
      throw new ConflictError('Cette adresse email est déjà utilisée.');
    }

    const salt = await bcrypt.genSalt(env.BCRYPT_ROUNDS);
    const passwordHash = await bcrypt.hash(data.password, salt);

    const user = await usersRepository.create({
      email: data.email,
      phone: data.phone,
      passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role,
      organization: { connect: { id: organizationId } },
      isActive: true,
      isEmailVerified: true, // Created by admin directly, auto-verified
    });

    // Create preferences
    await authRepository.createNotificationPreferences(user.id);

    // Send welcome email
    await sendMail(
      user.email,
      'Bienvenue sur Naforo !',
      `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #4f46e5;">Bienvenue sur Naforo</h2>
        <p>Bonjour ${user.firstName},</p>
        <p>Un administrateur de votre organisation a créé votre compte Naforo avec le rôle de <strong>${user.role}</strong>.</p>
        <p>Vous pouvez vous connecter avec vos identifiants temporaires :</p>
        <ul style="background-color: #f9fafb; padding: 15px 30px; border-radius: 6px; list-style-type: none;">
          <li><strong>Email :</strong> ${user.email}</li>
          <li><strong>Mot de passe temporaire :</strong> ${data.password}</li>
        </ul>
        <p style="color: #ef4444; font-weight: bold;">Nous vous recommandons vivement de changer votre mot de passe dès votre première connexion.</p>
        <a href="${env.FRONTEND_URL}/login" style="display: inline-block; background-color: #4f46e5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 15px 0;">Se connecter</a>
      </div>`
    ).catch((err) => logger.error('Failed to send welcome email to new user', err));

    return user;
  }

  async updateUser(id: string, data: any, organizationId: string): Promise<User> {
    // Verify user exists and belongs to org
    await this.getUserById(id, organizationId);

    return usersRepository.update(id, data);
  }

  async deleteUser(id: string, organizationId: string): Promise<void> {
    const user = await this.getUserById(id, organizationId);
    if (user.role === 'super_admin') {
      throw new ForbiddenError('Le compte SuperAdmin de la plateforme ne peut pas être supprimé.');
    }
    await usersRepository.softDelete(id);
  }

  async updateFCMToken(userId: string, fcmToken: string): Promise<void> {
    await usersRepository.updateFCMToken(userId, fcmToken);
  }

  async getManagers(organizationId: string): Promise<any[]> {
    const managers = await prisma.user.findMany({
      where: {
        organizationId,
        role: { in: ['manager', 'accountant', 'admin'] },
      },
      orderBy: [{ role: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        managedProperties: {
          select: {
            id: true,
            name: true,
            type: true,
            address: true,
            city: true,
            parentId: true,
            rentAmount: true,
            status: true,
            contracts: {
              where: { status: 'active' },
              select: { id: true, rentAmount: true },
            },
            incidents: {
              where: { status: { in: ['open', 'in_progress'] } },
              select: { id: true },
            },
            children: {
              select: {
                id: true,
                name: true,
                type: true,
                rentAmount: true,
                status: true,
                contracts: {
                  where: { status: 'active' },
                  select: { id: true, rentAmount: true },
                },
                incidents: {
                  where: { status: { in: ['open', 'in_progress'] } },
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    });

    return managers.map((m: any) => {
      const directProps = m.managedProperties || [];
      
      let totalUnits = 0;
      let occupiedUnits = 0;
      let monthlyRent = 0;
      let activeContractsCount = 0;
      let activeIncidentsCount = 0;

      directProps.forEach((prop: any) => {
        if (prop.children && prop.children.length > 0) {
          prop.children.forEach((child: any) => {
            totalUnits += 1;
            if (child.status === 'occupied') occupiedUnits += 1;
            if (child.contracts && child.contracts.length > 0) {
              activeContractsCount += child.contracts.length;
              monthlyRent += child.contracts.reduce((sum: number, c: any) => sum + Number(c.rentAmount || 0), 0);
            }
            if (child.incidents) {
              activeIncidentsCount += child.incidents.length;
            }
          });
        } else {
          totalUnits += 1;
          if (prop.status === 'occupied') occupiedUnits += 1;
          if (prop.contracts && prop.contracts.length > 0) {
            activeContractsCount += prop.contracts.length;
            monthlyRent += prop.contracts.reduce((sum: number, c: any) => sum + Number(c.rentAmount || 0), 0);
          }
          if (prop.incidents) {
            activeIncidentsCount += prop.incidents.length;
          }
        }
      });

      const occupancyRate = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 1000) / 10 : 0;

      return {
        id: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
        phone: m.phone,
        role: m.role,
        isActive: m.isActive,
        createdAt: m.createdAt,
        propertiesCount: directProps.length,
        totalUnitsCount: totalUnits,
        activeContractsCount,
        monthlyRent,
        occupancyRate,
        activeIncidentsCount,
        assignedProperties: directProps.map((p: any) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          address: p.address,
          city: p.city,
          unitsCount: p.children?.length || 0,
        })),
      };
    });
  }

  async createManager(organizationId: string, data: any): Promise<any> {
    const ctx = await getOrganizationPlanContext(organizationId);
    const hasMultiUsers = planIncludesFeature(ctx.planCode, ctx.features, 'multi_users');
    if (!hasMultiUsers) {
      const staffCount = await prisma.user.count({
        where: {
          organizationId,
          role: { in: ['admin', 'manager', 'accountant', 'owner'] },
        },
      });

      const maxStaff = ctx.planCode.includes('pro') ? 2 : 1;
      if (staffCount >= maxStaff) {
        throw new ForbiddenError(
          `La création de collaborateurs supplémentaires requiert la formule Expert / Entreprise (Option Multi-Gestionnaires). Votre formule actuelle (${ctx.planName}) est limitée à ${maxStaff} accès gestionnaire.`
        );
      }
    }

    const existing = await authRepository.findByEmail(data.email);
    if (existing) {
      throw new ConflictError('Cette adresse email est déjà utilisée.');
    }

    const plainPassword = data.password || `Nf@${Math.random().toString(36).slice(-6)}1`;
    const salt = await bcrypt.genSalt(env.BCRYPT_ROUNDS);
    const passwordHash = await bcrypt.hash(plainPassword, salt);

    const user = await prisma.user.create({
      data: {
        organizationId,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        email: data.email.toLowerCase().trim(),
        phone: data.phone || null,
        passwordHash,
        role: data.role || 'manager',
        isActive: true,
        isEmailVerified: true,
      },
    });

    await authRepository.createNotificationPreferences(user.id);

    if (Array.isArray(data.propertyIds) && data.propertyIds.length > 0) {
      await prisma.property.updateMany({
        where: {
          id: { in: data.propertyIds },
          organizationId,
        },
        data: { managerId: user.id },
      });
    }

    // Send welcome email with credentials
    await sendMail(
      user.email,
      'Votre accès collaborateur Naforo',
      `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #E5E7EB; border-radius: 12px; background-color: #FFFFFF;">
        <div style="background-color: #013E37; padding: 18px 24px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="color: #FACC15; margin: 0; font-size: 20px;">Bienvenue sur Naforo</h2>
          <p style="color: #E2E8F0; margin: 4px 0 0 0; font-size: 13px;">Plateforme de gestion immobilière de votre agence</p>
        </div>
        <p style="color: #374151; font-size: 15px;">Bonjour <strong>${user.firstName} ${user.lastName}</strong>,</p>
        <p style="color: #4B5563; font-size: 14px; line-height: 1.5;">Votre compte collaborateur a été créé avec le rôle de <strong>${user.role}</strong>.</p>
        <p style="color: #4B5563; font-size: 14px;">Vos identifiants d'accès :</p>
        <div style="background-color: #F9FAFB; border: 1px solid #E5E7EB; padding: 16px 20px; border-radius: 8px; margin: 15px 0;">
          <p style="margin: 4px 0; color: #1F2937; font-size: 14px;"><strong>Email :</strong> ${user.email}</p>
          <p style="margin: 4px 0; color: #1F2937; font-size: 14px;"><strong>Mot de passe :</strong> ${plainPassword}</p>
        </div>
        <p style="color: #DC2626; font-size: 13px; font-weight: 500;">Pour des raisons de sécurité, veuillez modifier ce mot de passe dès votre première connexion.</p>
        <div style="margin-top: 24px; text-align: center;">
          <a href="${env.FRONTEND_URL}/login" style="display: inline-block; background-color: #013E37; color: #FACC15; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">Accéder à mon espace</a>
        </div>
      </div>`
    ).catch((err) => logger.error('Failed to send welcome email to new manager', err));

    const { passwordHash: _, refreshTokenHash: __, ...sanitized } = user;
    return sanitized;
  }

  async updateManagerPortfolio(organizationId: string, managerId: string, propertyIds: string[]): Promise<any> {
    const manager = await prisma.user.findFirst({
      where: { id: managerId, organizationId },
    });
    if (!manager) {
      throw new NotFoundError('Gestionnaire ou collaborateur introuvable.');
    }

    // Unassign old properties
    await prisma.property.updateMany({
      where: { organizationId, managerId },
      data: { managerId: null },
    });

    // Assign new properties
    if (propertyIds && propertyIds.length > 0) {
      await prisma.property.updateMany({
        where: {
          id: { in: propertyIds },
          organizationId,
        },
        data: { managerId },
      });
    }

    const allManagers = await this.getManagers(organizationId);
    return allManagers.find((m) => m.id === managerId);
  }

  async updateManagerStatus(organizationId: string, managerId: string, isActive: boolean): Promise<any> {
    const manager = await prisma.user.findFirst({
      where: { id: managerId, organizationId },
    });
    if (!manager) {
      throw new NotFoundError('Collaborateur introuvable.');
    }
    if (manager.role === 'super_admin') {
      throw new ForbiddenError('Impossible de modifier le compte SuperAdmin.');
    }

    const updated = await prisma.user.update({
      where: { id: managerId },
      data: { isActive },
    });

    const { passwordHash, refreshTokenHash, ...sanitized } = updated;
    return sanitized;
  }
}

export const usersService = new UsersService();

