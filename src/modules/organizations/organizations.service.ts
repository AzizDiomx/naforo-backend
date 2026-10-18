import { organizationsRepository } from './organizations.repository';
import { NotFoundError, BadRequestError } from '@/shared/errors/AppError';
import { Organization } from '@prisma/client';
import { PaginationQuery, PaginationMeta } from '@/shared/types';
import { buildPaginationMeta } from '@/shared/helpers/pagination';
import { prisma } from '@/config/database';
import bcrypt from 'bcryptjs';
import { sendMail, organizationWelcome } from '@/config/mailer';
import { logger } from '@/config/logger';
import { env } from '@/config/env';

export class OrganizationsService {
  async getAllOrganizations(
    query: PaginationQuery
  ): Promise<{ data: any[]; meta: PaginationMeta }> {
    const { organizations, total } = await organizationsRepository.findAll(query);
    const meta = buildPaginationMeta(total, query.page, query.limit);
    return { data: organizations, meta };
  }

  async getOrganizationById(id: string): Promise<any> {
    const organization = await organizationsRepository.findById(id);
    if (!organization) {
      throw new NotFoundError('Organisation introuvable.');
    }
    return organization;
  }

  async createOrganization(data: any): Promise<any> {
    const {
      adminFirstName,
      adminLastName,
      adminEmail,
      adminPassword,
      sendCredentialsEmail = true,
      ...orgData
    } = data;

    // 1. Créer l'organisation
    const org = await organizationsRepository.create(orgData);

    // 2. Initialiser l'abonnement correspondant au plan choisi
    try {
      const planCode = orgData.plan || 'starter';
      const plan = await prisma.subscriptionPlan.findUnique({ where: { code: planCode } });
      if (plan) {
        const oneYearFromNow = new Date();
        oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
        await prisma.subscription.create({
          data: {
            organizationId: org.id,
            planId: plan.id,
            startDate: new Date(),
            endDate: oneYearFromNow,
            status: 'active',
          },
        });
      }
    } catch (subErr) {
      logger.warn('Abonnement initial non créé pour organisation:', subErr);
    }

    // 3. Provisionner l'administrateur si un email est fourni
    const targetAdminEmail = (adminEmail || orgData.email || '').trim().toLowerCase();
    let generatedCredentials: {
      email: string;
      tempPassword?: string;
      adminName: string;
      emailSent: boolean;
    } | null = null;

    if (targetAdminEmail) {
      const firstName = (adminFirstName || 'Admin').trim();
      const lastName = (adminLastName || org.name).trim();
      const rawPassword = adminPassword && adminPassword.trim().length >= 6
        ? adminPassword.trim()
        : `Naforo${Math.floor(100000 + Math.random() * 900000)}!`;

      try {
        const existingUser = await prisma.user.findUnique({ where: { email: targetAdminEmail } });
        let user;

        if (existingUser) {
          user = await prisma.user.update({
            where: { id: existingUser.id },
            data: {
              organizationId: org.id,
              role: existingUser.role === 'super_admin' ? 'super_admin' : 'admin',
              phone: existingUser.phone || orgData.phone || null,
            },
          });
          logger.info(`Utilisateur existant ${targetAdminEmail} rattaché en tant qu'admin à l'organisation ${org.name}`);
        } else {
          const passwordHash = await bcrypt.hash(rawPassword, 12);
          user = await prisma.user.create({
            data: {
              organizationId: org.id,
              email: targetAdminEmail,
              phone: orgData.phone || null,
              passwordHash,
              firstName,
              lastName,
              role: 'admin',
              isActive: true,
              isEmailVerified: true,
            },
          });

          await prisma.notificationPreference.create({
            data: {
              userId: user.id,
              emailEnabled: true,
              smsEnabled: false,
              pushEnabled: true,
              reminderEnabled: true,
            },
          }).catch((prefErr) => {
            logger.warn('Préférences de notification non initialisées pour nouvel admin:', prefErr);
          });

          logger.info(`Nouvel administrateur créé pour l'organisation ${org.name}: ${targetAdminEmail}`);
        }

        let emailSent = false;
        if (sendCredentialsEmail) {
          try {
            const loginUrl = `${env.BACKOFFICE_URL}/login`;
            const emailHtml = organizationWelcome({
              orgName: org.name,
              adminName: `${firstName} ${lastName}`.trim(),
              email: targetAdminEmail,
              tempPassword: rawPassword,
              loginUrl,
              planName: orgData.plan || 'starter',
            });

            emailSent = await sendMail({
              to: targetAdminEmail,
              subject: `Bienvenue sur Naforo - Vos identifiants de connexion pour ${org.name}`,
              html: emailHtml,
              service: 'contact',
            });

            logger.info(`Email de bienvenue avec identifiants envoyé à ${targetAdminEmail} (succès: ${emailSent})`);
          } catch (mailErr: any) {
            logger.error(`Échec lors de l'envoi du mail de bienvenue à ${targetAdminEmail}:`, mailErr);
          }
        }

        generatedCredentials = {
          email: targetAdminEmail,
          tempPassword: rawPassword,
          adminName: `${firstName} ${lastName}`.trim(),
          emailSent,
        };
      } catch (userErr: any) {
        logger.error(`Erreur lors de la création de l'administrateur pour ${org.name}:`, userErr);
      }
    }

    return {
      ...org,
      generatedCredentials,
    };
  }

  async updateOrganization(id: string, data: any): Promise<Organization> {
    await this.getOrganizationById(id);
    const updated = await organizationsRepository.update(id, data);

    // Si le plan est modifié, synchroniser également la table subscription
    if (data.plan) {
      try {
        const plan = await prisma.subscriptionPlan.findUnique({ where: { code: data.plan } });
        if (plan) {
          const oneYearFromNow = new Date();
          oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

          const existingSub = await prisma.subscription.findFirst({
            where: { organizationId: id },
            orderBy: { endDate: 'desc' },
          });

          if (existingSub) {
            await prisma.subscription.update({
              where: { id: existingSub.id },
              data: { planId: plan.id, status: 'active' },
            });
          } else {
            await prisma.subscription.create({
              data: {
                organizationId: id,
                planId: plan.id,
                startDate: new Date(),
                endDate: oneYearFromNow,
                status: 'active',
              },
            });
          }
        }
      } catch (err) {
        logger.warn('Synchronisation abonnement échouée lors de la mise à jour organisation:', err);
      }
    }

    return updated;
  }

  async getOrganizationStats(id: string): Promise<any> {
    await this.getOrganizationById(id);
    return organizationsRepository.getStats(id);
  }

  /**
   * Owner Account Deletion Request (30-day grace period soft-delete)
   */
  async requestAccountDeletion(id: string, userId: string, password: string): Promise<any> {
    const org = await this.getOrganizationById(id);

    // 1. Verify user & password
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundError('Utilisateur introuvable.');
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new BadRequestError('Mot de passe incorrect. La suppression a été refusée par sécurité.');
    }

    // 2. Business Check: Cannot delete organization with active contracts
    const activeContract = await prisma.contract.findFirst({
      where: {
        organizationId: id,
        status: 'active',
      },
    });

    if (activeContract) {
      throw new BadRequestError(
        `Impossible de demander la suppression de votre compte : le contrat de bail (${activeContract.contractNumber}) est actuellement en cours. Veuillez résilier ou terminer tous les baux avant de faire cette demande.`
      );
    }

    // 3. Mark organization as pending deletion & set grace period
    const now = new Date();
    const currentSettings = (org.settings as Record<string, any>) || {};
    const updatedSettings = {
      ...currentSettings,
      deletionRequested: true,
      deletionRequestedAt: now.toISOString(),
      deletionRequestedBy: userId,
    };

    const updatedOrg = await prisma.organization.update({
      where: { id },
      data: {
        isActive: false,
        settings: updatedSettings,
      },
    });

    // 4. Send email confirmation to owner
    try {
      await sendMail(
        user.email,
        '⚠️ Confirmation de demande de suppression de votre compte Naforo',
        `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b;">
          <h2>Demande de suppression enregistrée</h2>
          <p>Bonjour <strong>${user.firstName}</strong>,</p>
          <p>Nous avons bien pris en compte votre demande de suppression définitive de votre compte et de votre organisation <strong>${org.name}</strong>.</p>
          <p style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; font-weight: bold;">
            Votre compte est entré dans une période de rétractation de 30 jours. Vos accès sont temporairement suspendus.
          </p>
          <p>Si vous n'êtes pas à l'origine de cette demande ou si vous souhaitez annuler la suppression, vous pouvez réactiver votre compte à tout moment avant le 30ème jour en vous connectant à votre espace.</p>
          <p style="margin-top: 30px; font-size: 12px; color: #64748b;">équipe Naforo · Conformité & Protection des Données</p>
        </div>
        `
      );
    } catch (mailErr) {
      logger.warn('Erreur envoi email suppression compte:', mailErr);
    }

    return {
      status: 'pending_deletion',
      message: 'Demande enregistrée. Votre compte entre dans une période de grâce de 30 jours avant suppression définitive.',
      deletionRequestedAt: now,
      gracePeriodDays: 30,
    };
  }

  /**
   * Cancel Account Deletion Request (Restore organization)
   */
  async cancelAccountDeletion(id: string, userId: string): Promise<any> {
    const org = await this.getOrganizationById(id);

    const currentSettings = (org.settings as Record<string, any>) || {};
    const { deletionRequested, deletionRequestedAt, deletionRequestedBy, ...cleanSettings } = currentSettings;

    await prisma.organization.update({
      where: { id },
      data: {
        isActive: true,
        settings: cleanSettings,
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      try {
        await sendMail(
          user.email,
          '✅ Suppression de compte annulée - Naforo',
          `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b;">
            <h2>Suppression de compte annulée !</h2>
            <p>Bonjour <strong>${user.firstName}</strong>,</p>
            <p>La demande de suppression de votre organisation <strong>${org.name}</strong> a bien été annulée.</p>
            <p>Votre compte et l'ensemble de vos accès ont été réactivés avec succès.</p>
          </div>
          `
        );
      } catch (e) {}
    }

    return {
      status: 'active',
      message: 'La demande de suppression a été annulée avec succès. Votre compte est réactivé.',
    };
  }
}

export const organizationsService = new OrganizationsService();


