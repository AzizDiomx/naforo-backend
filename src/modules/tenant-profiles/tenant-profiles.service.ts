import { tenantProfilesRepository } from './tenant-profiles.repository';
import { NotFoundError, BadRequestError } from '@/shared/errors/AppError';
import { TenantProfile } from '@prisma/client';
import { prisma } from '@/config/database';
import { PaginationQuery, PaginationMeta } from '@/shared/types';
import { buildPaginationMeta } from '@/shared/helpers/pagination';
import bcrypt from 'bcryptjs';
import { sendMail, welcome } from '@/config/mailer';
import { dispatchNotification } from '@/shared/helpers/notification';
import { logger } from '@/config/logger';

export class TenantProfilesService {
  async getAllTenantProfiles(
    organizationId: string,
    query: PaginationQuery
  ): Promise<{ data: TenantProfile[]; meta: PaginationMeta }> {
    const { tenantProfiles, total } = await tenantProfilesRepository.findAll(organizationId, query);
    const meta = buildPaginationMeta(total, query.page, query.limit);
    return { data: tenantProfiles, meta };
  }

  async getTenantProfileById(id: string, organizationId: string): Promise<TenantProfile> {
    const profile = await tenantProfilesRepository.findById(id, organizationId);
    if (!profile) {
      throw new NotFoundError('Profil locataire introuvable.');
    }
    return profile;
  }

  async getTenantProfileByUserId(userId: string): Promise<TenantProfile> {
    const profile = await tenantProfilesRepository.findByUserId(userId);
    if (!profile) {
      throw new NotFoundError('Profil locataire introuvable pour cet utilisateur.');
    }
    return profile;
  }

  async createTenantProfile(data: any, organizationId: string): Promise<any> {
    // 1. Contrôle du quota d'abonnement
    let activeSub = await prisma.subscription.findFirst({
      where: { organizationId },
      include: { plan: true },
      orderBy: { endDate: 'desc' },
    });

    let plan = activeSub?.plan;
    if (!plan) {
      plan = await prisma.subscriptionPlan.findUnique({ where: { code: 'starter' } }) || undefined;
    }

    if (plan) {
      const tenantCount = await prisma.tenantProfile.count({ where: { organizationId, isActive: true } });
      if (tenantCount >= plan.maxTenants) {
        throw new BadRequestError(
          `Vous avez atteint la limite de locataires autorisée par votre forfait (${tenantCount}/${plan.maxTenants} locataires). Veuillez surclasser votre abonnement.`
        );
      }
    }

    let userId = (data.userId && typeof data.userId === 'string' && data.userId.trim() !== '') ? data.userId.trim() : null;
    let email = (data.email && typeof data.email === 'string' && data.email.trim() !== '') ? data.email.trim().toLowerCase() : null;
    let tempPassword = data.password;

    // 2. Si un email est renseigné mais pas de userId explicite, créer ou lier l'utilisateur User
    if (!userId && email) {
      const existingUser = await prisma.user.findUnique({ where: { email } });

      if (existingUser) {
        // Vérifier si l'utilisateur possède déjà un profil locataire
        const existingProfile = await prisma.tenantProfile.findUnique({ where: { userId: existingUser.id } });
        if (existingProfile) {
          throw new BadRequestError('Un profil locataire existe déjà pour cette adresse email.');
        }

        // Rattacher l'utilisateur à l'organisation si nécessaire
        if (existingUser.organizationId !== organizationId) {
          await prisma.user.update({
            where: { id: existingUser.id },
            data: { organizationId },
          });
        }

        userId = existingUser.id;
      } else {
        // Auto-générer un mot de passe temporaire si non spécifié
        if (!tempPassword) {
          tempPassword = `Naforo-${Math.floor(100000 + Math.random() * 900000)}`;
        }

        const passwordHash = await bcrypt.hash(tempPassword, 10);

        const newUser = await prisma.user.create({
          data: {
            organizationId,
            email,
            passwordHash,
            firstName: data.firstName,
            lastName: data.lastName,
            phone: data.phone,
            role: 'tenant',
            isActive: true,
          },
        });

        userId = newUser.id;

        // Envoyer les identifiants d'accès (Email avec fallback SMS automatique)
        try {
          const emailHtml = welcome({
            firstName: data.firstName,
            email,
            role: 'Locataire',
            tempPassword,
            loginUrl: 'http://localhost:3003/login',
          });

          const smsText = `Naforo: Bonjour ${data.firstName}, vos identifiants Espace Locataire: Email: ${email}, Mot de passe: ${tempPassword}. Connectez-vous sur: http://localhost:3003/login`;

          await dispatchNotification({
            organizationId,
            userId: newUser.id,
            email,
            phone: data.phone,
            type: 'WELCOME_TENANT',
            title: '🎉 Vos accès à votre Espace Locataire Naforo',
            emailSubject: '🎉 Vos accès à votre Espace Locataire Naforo',
            emailHtml,
            smsText,
          });
        } catch (notifErr) {
          logger.warn(`Erreur lors de l'envoi de la notification au locataire (${email}):`, notifErr);
        }
      }
    }

    // 3. Validation de sécurité si un userId spécifique est transmis
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new BadRequestError('L\'utilisateur lié n\'existe pas.');
      }

      // Si l'utilisateur a un organizationId différent ou nul, le mettre à jour pour l'organisation courante
      if (user.organizationId !== organizationId) {
        await prisma.user.update({
          where: { id: userId },
          data: { organizationId },
        });
      }

      const existingProfile = await prisma.tenantProfile.findUnique({ where: { userId } });
      if (existingProfile) {
        throw new BadRequestError('Cet utilisateur possède déjà un profil locataire.');
      }
    }

    // Nettoyer les champs non-model Prisma avant création
    const { password, ...createData } = data;

    const createdProfile = await tenantProfilesRepository.create({
      ...createData,
      email,
      userId,
      organizationId,
    });

    // 4. Notification Interne pour le Propriétaire / Gestionnaire (avec identifiants)
    try {
      await prisma.notification.create({
        data: {
          organizationId,
          type: 'TENANT_CREATED_LANDLORD_NOTIF',
          title: `🔑 Nouveau locataire créé: ${data.firstName} ${data.lastName}`,
          message: `La fiche locataire de ${data.firstName} ${data.lastName} a été enregistrée. Identifiant d'accès: ${email || data.phone}. Mot de passe d'accès: ${tempPassword || 'Personnalisé'}.`,
          channels: ['in_app'],
        },
      });
    } catch (err) {}

    return {
      ...createdProfile,
      generatedPassword: tempPassword || null,
    };
  }

  async updateTenantProfile(id: string, data: any, organizationId: string): Promise<TenantProfile> {
    await this.getTenantProfileById(id, organizationId);

    if (data.userId) {
      const user = await prisma.user.findUnique({ where: { id: data.userId } });
      if (!user) {
        throw new BadRequestError('L\'utilisateur lié est invalide.');
      }
      if (user.organizationId !== organizationId) {
        await prisma.user.update({
          where: { id: data.userId },
          data: { organizationId },
        });
      }
    }

    return tenantProfilesRepository.update(id, data);
  }

  async uploadAvatar(id: string, avatarUrl: string, organizationId: string): Promise<TenantProfile> {
    await this.getTenantProfileById(id, organizationId);
    return tenantProfilesRepository.update(id, { avatarUrl });
  }

  async getTenantHistory(id: string, organizationId: string): Promise<any> {
    await this.getTenantProfileById(id, organizationId);
    return tenantProfilesRepository.getHistory(id, organizationId);
  }

  /**
   * Recalculate tenant reliability score (Clamped: 0 - 100)
   */
  async calculateReliabilityScore(tenantProfileId: string): Promise<number> {
    const payments = await prisma.payment.findMany({
      where: {
        tenantProfileId,
        status: 'validated',
      },
      include: {
        invoice: true,
      },
    });

    let score = 100;

    for (const payment of payments) {
      if (payment.invoice && payment.paymentDate > payment.invoice.dueDate) {
        score -= 5;
      } else {
        score += 2;
      }
    }

    const openIncidents = await prisma.incident.count({
      where: {
        tenantProfileId,
        status: { in: ['open', 'in_progress'] },
      },
    });

    score -= openIncidents * 2;
    const finalScore = Math.max(0, Math.min(100, score));

    await prisma.tenantProfile.update({
      where: { id: tenantProfileId },
      data: { reliabilityScore: finalScore },
    });

    return finalScore;
  }

  async deleteTenantProfile(id: string, organizationId: string): Promise<void> {
    await this.getTenantProfileById(id, organizationId);

    // Vérifier s'il existe au moins un contrat actif pour ce locataire
    const activeContract = await prisma.contract.findFirst({
      where: {
        tenantProfileId: id,
        organizationId,
        status: 'active',
      },
    });

    if (activeContract) {
      throw new BadRequestError(
        `Impossible de supprimer ce locataire : le contrat de bail (${activeContract.contractNumber}) est actuellement en cours. Vous devez d'abord résilier ou terminer le contrat de bail.`
      );
    }

    await tenantProfilesRepository.softDelete(id);
  }
}

export const tenantProfilesService = new TenantProfilesService();

