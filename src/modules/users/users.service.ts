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
      const activeSub = await prisma.subscription.findFirst({
        where: { organizationId },
        include: { plan: true },
        orderBy: { endDate: 'desc' },
      });

      let features: string[] = [];
      try {
        features = typeof activeSub?.plan.features === 'string'
          ? JSON.parse(activeSub.plan.features)
          : (activeSub?.plan.features as string[]) || [];
      } catch {
        features = [];
      }

      const hasMultiUsers = features.includes('multi_users') || activeSub?.plan.code === 'expert';
      if (!hasMultiUsers) {
        const staffCount = await prisma.user.count({
          where: {
            organizationId,
            role: { in: ['admin', 'manager', 'accountant', 'owner'] },
          },
        });

        const maxStaff = activeSub?.plan.code === 'pro' ? 2 : 1;
        if (staffCount >= maxStaff) {
          throw new ForbiddenError(
            `La création de collaborateurs supplémentaires requiert la formule Expert / Agence (Option Multi-Gestionnaires). Votre formule actuelle (${activeSub?.plan.name || 'Starter'}) est limitée à ${maxStaff} accès gestionnaire.`
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
    sendMail(
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
}

export const usersService = new UsersService();

