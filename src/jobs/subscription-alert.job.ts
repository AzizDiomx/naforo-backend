import { Job } from 'bull';
import { logger } from '@/config/logger';
import { prisma } from '@/config/database';
import { emailQueue, smsQueue } from '@/queues';

export async function processSubscriptionAlertJob(job: Job): Promise<void> {
  logger.info(`[Subscription Lifecycle Scanner] Démarrage du job ${job.id}`);
  const start = Date.now();

  try {
    const now = new Date();

    // Récupérer tous les abonnements payants (exclure le plan starter gratuit)
    const paidSubscriptions = await prisma.subscription.findMany({
      where: {
        plan: {
          code: { not: 'starter' },
        },
      },
      include: {
        organization: {
          include: {
            users: {
              where: { role: { in: ['owner', 'admin'] } },
            },
          },
        },
        plan: true,
      },
    });

    logger.debug(`[Subscription Lifecycle] ${paidSubscriptions.length} abonnements payants analysés.`);

    for (const sub of paidSubscriptions) {
      const owner = sub.organization.users[0];
      if (!owner) continue;

      const endDate = new Date(sub.endDate);
      const diffMs = endDate.getTime() - now.getTime();
      const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      const daysSinceExpiration = daysRemaining < 0 ? Math.abs(daysRemaining) : 0;
      const endDateStr = endDate.toLocaleDateString('fr-FR');

      // -----------------------------------------------------------------------
      // RÈGLE 1 : 5 jours avant échéance (J-5 à J0) -> Rappel quotidien par mail
      // -----------------------------------------------------------------------
      if (daysRemaining > 0 && daysRemaining <= 5 && sub.status === 'active') {
        const lastReminder = sub.lastReminderSentAt ? new Date(sub.lastReminderSentAt) : null;
        const alreadySentToday = lastReminder && lastReminder.toDateString() === now.toDateString();

        if (!alreadySentToday) {
          logger.info(`[Lifecycle] Envoi du rappel J-${daysRemaining} à ${owner.email} (${sub.organization.name})`);
          await emailQueue.add('send-email', {
            to: owner.email,
            subject: `⚠️ Rappel Échéance : Votre abonnement Naforo expire dans ${daysRemaining} jour(s)`,
            html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #f59e0b; border-radius: 8px;">
              <h2 style="color: #b45309; margin-top: 0;">⚠️ Rappel d'échéance d'abonnement</h2>
              <p>Bonjour ${owner.firstName},</p>
              <p>Votre abonnement pour l'organisation <strong>${sub.organization.name}</strong> (Forfait <strong>${sub.plan.name}</strong>) expire dans <strong>${daysRemaining} jour(s)</strong>, le <strong>${endDateStr}</strong>.</p>
              <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px; margin: 16px 0; color: #92400e;">
                <strong>Attention :</strong> À compter du ${endDateStr}, en l'absence de réabonnement validé, votre espace passera en <strong>mode lecture seule</strong> (suspension des ajouts et modifications).
              </div>
              <p>Pour éviter toute interruption de vos activités, nous vous invitons à déclarer votre renouvellement dès maintenant depuis votre tableau de bord.</p>
              <p>L'équipe Naforo</p>
            </div>`,
          });

          await prisma.subscription.update({
            where: { id: sub.id },
            data: { lastReminderSentAt: now },
          });
        }
      }

      // -----------------------------------------------------------------------
      // RÈGLE 2 : À l'échéance (J0 à J+5) -> Suspension en mode LECTURE SEULE
      // -----------------------------------------------------------------------
      if (daysRemaining <= 0 && daysSinceExpiration <= 5 && sub.status === 'active') {
        logger.warn(`[Lifecycle] Suspension de l'abonnement pour ${sub.organization.name} (expiré depuis ${daysSinceExpiration}j)`);
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'suspended' },
        });

        await emailQueue.add('send-email', {
          to: owner.email,
          subject: `🚨 Votre abonnement Naforo a expiré - Espace suspendu en mode LECTURE SEULE`,
          html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ef4444; border-radius: 8px;">
            <h2 style="color: #b91c1c; margin-top: 0;">🚨 Suspension de votre compte</h2>
            <p>Bonjour ${owner.firstName},</p>
            <p>Votre abonnement a expiré le <strong>${endDateStr}</strong>. Votre espace est désormais <strong>SUSPENDU EN MODE LECTURE SEULE</strong>.</p>
            <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; margin: 16px 0; color: #991b1b;">
              Vous pouvez toujours consulter vos données, mais vous ne pouvez plus créer ou modifier de biens, locataires, baux ou factures.
              <strong>Vous disposez de ${Math.max(0, 5 - daysSinceExpiration)} jour(s) pour régulariser votre abonnement avant désactivation complète de votre compte.</strong>
            </div>
            <p>Rendez-vous sur votre espace pour soumettre votre preuve de paiement.</p>
            <p>L'équipe Naforo</p>
          </div>`,
        });
      }

      // -----------------------------------------------------------------------
      // RÈGLE 3 : 5 jours après échéance (J+5) -> Désactivation complète du tenant
      // -----------------------------------------------------------------------
      if (daysSinceExpiration > 5 && sub.status !== 'deactivated' && sub.status !== 'deleted') {
        logger.error(`[Lifecycle] DÉSACTIVATION COMPLÈTE du tenant ${sub.organization.name}`);
        const graceEndDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 jours de grâce

        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: 'deactivated',
            gracePeriodEndDate: graceEndDate,
            lastGraceReminderSentAt: now,
          },
        });

        await prisma.organization.update({
          where: { id: sub.organizationId },
          data: { isActive: false },
        });

        await emailQueue.add('send-email', {
          to: owner.email,
          subject: `⛔ Compte Désactivé : Période de grâce de 90 jours engagée (Naforo)`,
          html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #b91c1c; border-radius: 8px;">
            <h2 style="color: #b91c1c; margin-top: 0;">⛔ Compte Organisation Désactivé</h2>
            <p>Bonjour ${owner.firstName},</p>
            <p>Votre abonnement ayant expiré depuis plus de 5 jours, l'accès à votre compte pour l'organisation <strong>${sub.organization.name}</strong> a été <strong>entièrement désactivé</strong>.</p>
            <div style="background-color: #fef2f2; border-left: 4px solid #b91c1c; padding: 12px; margin: 16px 0; color: #7f1d1d;">
              <strong>Période de grâce de 90 jours :</strong> Vos données sont conservées jusqu'au <strong>${graceEndDate.toLocaleDateString('fr-FR')}</strong>.
              Passé ce délai, conformément à notre politique de rétention, l'intégralité de vos données sera <strong>définitivement supprimée</strong> de nos serveurs.
            </div>
            <p>Pour débloquer vos accès et éviter la purge définitive de votre portefeuille immobilier, veuillez contacter notre service client ou procéder à votre régularisation.</p>
            <p>L'équipe Naforo</p>
          </div>`,
        });
      }

      // -----------------------------------------------------------------------
      // RÈGLE 4 : Période de grâce de 90 jours -> Rappel par mail TOUS LES 5 JOURS
      // -----------------------------------------------------------------------
      if (sub.status === 'deactivated' && sub.gracePeriodEndDate) {
        const graceEnd = new Date(sub.gracePeriodEndDate);
        const remainingGraceDays = Math.max(0, Math.ceil((graceEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

        // Vérifier si 5 jours se sont écoulés depuis le dernier rappel de grâce
        const lastGrace = sub.lastGraceReminderSentAt ? new Date(sub.lastGraceReminderSentAt) : null;
        const daysSinceLastGrace = lastGrace
          ? Math.floor((now.getTime() - lastGrace.getTime()) / (1000 * 60 * 60 * 24))
          : 999;

        if (remainingGraceDays > 0 && daysSinceLastGrace >= 5) {
          logger.warn(`[Lifecycle] Envoi du rappel de grâce (reste ${remainingGraceDays}j) à ${owner.email}`);
          await emailQueue.add('send-email', {
            to: owner.email,
            subject: `🔴 ALERTE PÉRIODE DE GRÂCE : Il vous reste ${remainingGraceDays} jours avant suppression définitive`,
            html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 2px solid #b91c1c; border-radius: 8px;">
              <h2 style="color: #b91c1c; margin-top: 0;">🔴 RAPPEL PÉRIODE DE GRÂCE RGPD</h2>
              <p>Bonjour ${owner.firstName},</p>
              <p>Votre organisation <strong>${sub.organization.name}</strong> est actuellement désactivée.</p>
              <div style="background-color: #fef2f2; border: 1px solid #f87171; padding: 14px; border-radius: 6px; margin: 16px 0; color: #7f1d1d;">
                <p style="font-size: 1.1rem; font-weight: bold; margin: 0 0 8px 0;">Il ne vous reste que ${remainingGraceDays} jour(s) de grâce.</p>
                <p style="margin: 0;">Date butoir de suppression : <strong>${graceEnd.toLocaleDateString('fr-FR')}</strong>.</p>
                <p style="margin: 8px 0 0 0;">Après cette date, l'intégralité de vos biens, profils locataires, contrats, quittances et historiques de paiements sera <strong>irrémédiablement détruite</strong>.</p>
              </div>
              <p>Vous pouvez à tout moment exporter une copie de vos données ou régulariser votre souscription.</p>
              <p>L'équipe Naforo</p>
            </div>`,
          });

          await prisma.subscription.update({
            where: { id: sub.id },
            data: { lastGraceReminderSentAt: now },
          });
        }

        // ---------------------------------------------------------------------
        // RÈGLE 5 : Au bout des 90 jours de grâce -> Suppression totale des données
        // ---------------------------------------------------------------------
        if (remainingGraceDays <= 0) {
          logger.error(`[Lifecycle] PURGE DÉFINITIVE DES DONNÉES pour l'organisation ${sub.organization.name} (${sub.organizationId})`);

          // 1. Envoyer le courriel ultime
          await emailQueue.add('send-email', {
            to: owner.email,
            subject: `🗑️ Suppression définitive de vos données Naforo effectuée`,
            html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #64748b; border-radius: 8px;">
              <h2 style="color: #334155; margin-top: 0;">Purge définitive effectuée</h2>
              <p>Bonjour,</p>
              <p>La période de grâce de 90 jours pour l'organisation <strong>${sub.organization.name}</strong> étant arrivée à son terme sans réabonnement, l'ensemble de vos données a été définitivement supprimé de notre plateforme conformément à notre politique de rétention.</p>
              <p>Nous vous remercions d'avoir utilisé Naforo.</p>
            </div>`,
          });

          // 2. Suppression en cascade des données de l'organisation
          await prisma.organization.delete({
            where: { id: sub.organizationId },
          });
        }
      }
    }

    const duration = Date.now() - start;
    logger.info(`[Subscription Lifecycle Scanner] Scanner terminé en ${duration}ms (Job ${job.id})`);
  } catch (error) {
    logger.error(`[Subscription Lifecycle Scanner] Échec du scanner: ${job.id}`, error);
    throw error;
  }
}

