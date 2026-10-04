import { paymentsRepository } from './payments.repository';
import { prisma } from '@/config/database';
import { NotFoundError, BadRequestError } from '@/shared/errors/AppError';
import { Payment } from '@prisma/client';
import { emitToOrg, emitToUser } from '@/sockets/socket.handler';
import { PaginationQuery, PaginationMeta } from '@/shared/types';
import { buildPaginationMeta } from '@/shared/helpers/pagination';
import { dispatchNotification } from '@/shared/helpers/notification';

let receiptsService: any;
let tenantProfilesService: any;
let notificationsService: any;
let accountingService: any;

import('@/modules/receipts/receipts.service').then((m) => {
  receiptsService = m.receiptsService;
});
import('@/modules/tenant-profiles/tenant-profiles.service').then((m) => {
  tenantProfilesService = m.tenantProfilesService;
});
import('@/modules/notifications/notifications.service').then((m) => {
  notificationsService = m.notificationsService;
});
import('@/modules/accounting/accounting.service').then((m) => {
  accountingService = new m.AccountingService();
});

import { getDueDate } from '@/shared/helpers/date';

export class PaymentsService {
  async getAllPayments(
    organizationId: string,
    query: PaginationQuery & {
      status?: string;
      contractId?: string;
      propertyId?: string;
      tenantProfileId?: string;
      paymentMethod?: string;
      startDate?: string;
      endDate?: string;
    }
  ): Promise<{ data: any[]; meta: PaginationMeta }> {
    const { payments, total } = await paymentsRepository.findAll(organizationId, query);
    const meta = buildPaginationMeta(total, query.page, query.limit);
    return { data: payments, meta };
  }

  async getPaymentById(id: string, organizationId: string): Promise<Payment> {
    const payment = await paymentsRepository.findById(id, organizationId);
    if (!payment) {
      throw new NotFoundError('Paiement introuvable.');
    }
    return payment;
  }

  async getPendingPayments(organizationId: string): Promise<Payment[]> {
    return paymentsRepository.findPending(organizationId);
  }

  async declarePayment(data: any, tenantProfileId: string, declaredBy: string, organizationId: string): Promise<Payment> {
    // 1. Verify contract belongs to organization
    const contract = await prisma.contract.findFirst({
      where: { id: data.contractId, organizationId, status: 'active' },
    });

    if (!contract) {
      throw new BadRequestError('Le contrat spécifié est invalide, inactif ou introuvable.');
    }

    const actualTenantProfileId = tenantProfileId || contract.tenantProfileId;

    // 2. Anti-doublon check: Prevent duplicate PENDING declarations for the same contract/invoice (if declared by tenant)
    if (data.isTenantSelfDeclaration) {
      const existingPending = await prisma.payment.findFirst({
        where: {
          contractId: data.contractId,
          tenantProfileId: actualTenantProfileId,
          status: { in: ['pending', 'complement_requested'] },
          ...(data.invoiceId ? { invoiceId: data.invoiceId } : {}),
        },
      });

      if (existingPending) {
        throw new BadRequestError("Une déclaration de paiement est déjà en cours de vérification par votre bailleur pour ce bail. Veuillez patienter jusqu'à son traitement.");
      }
    }

    // 3. Verify invoice if specified
    if (data.invoiceId) {
      const invoice = await prisma.invoice.findFirst({
        where: { id: data.invoiceId, contractId: data.contractId },
      });
      if (!invoice) {
        throw new BadRequestError('La facture associée est introuvable.');
      }
      if (invoice.status === 'paid') {
        throw new BadRequestError('Cette facture a déjà été intégralement réglée.');
      }
    }

    // 4. Unique transaction number check
    if (data.transactionNumber && data.transactionNumber.trim() && data.transactionNumber.trim() !== '-') {
      const existingTransaction = await prisma.payment.findFirst({
        where: {
          transactionNumber: data.transactionNumber.trim(),
          status: { in: ['pending', 'validated', 'complement_requested'] },
        },
      });

      if (existingTransaction) {
        throw new BadRequestError('Ce numéro de transaction Mobile Money ou bancaire a déjà été enregistré pour une autre déclaration.');
      }
    }

    const monthsCount = Math.max(1, Number(data.monthsCount || 1));
    const monthlyRent = Number(contract.rentAmount || 0) + Number(contract.chargesAmount || 0);
    const amount = Number(data.amount || (monthlyRent * monthsCount));

    const comment = monthsCount > 1
      ? `[Paiement de ${monthsCount} mois d'avance] ${data.comment || ''}`.trim()
      : data.comment;

    const payment = await paymentsRepository.create({
      contractId: data.contractId,
      invoiceId: data.invoiceId || null,
      amount,
      paymentMethod: data.paymentMethod,
      transactionNumber: data.transactionNumber || null,
      paymentDate: new Date(data.paymentDate || Date.now()),
      proofUrl: data.proofUrl || null,
      comment: comment || null,
      tenantProfileId: actualTenantProfileId,
      declaredBy,
      organizationId,
      status: 'pending',
    });

    // Si auto-validation demandée (ex: encaissement comptant saisi directement par le gestionnaire)
    if (data.autoValidate) {
      return this.validatePayment(payment.id, declaredBy, { status: 'validated' }, organizationId);
    }

    // Notify organization (Admins, Managers, Accountants) via Socket.IO
    emitToOrg(organizationId, 'payment:declared', payment);

    // Internal In-App Notification for Landlord
    try {
      const tenant = await prisma.tenantProfile.findUnique({ where: { id: actualTenantProfileId } });
      await prisma.notification.create({
        data: {
          organizationId,
          type: 'PAYMENT_DECLARED',
          title: '💳 Nouveau paiement déclaré !',
          message: `Un paiement de ${Number(amount).toLocaleString()} FCFA a été déclaré par ${tenant ? `${tenant.firstName} ${tenant.lastName}` : 'le locataire'} via ${data.paymentMethod}. Réf: ${payment.paymentReference}.`,
          channels: ['in_app'],
        },
      });
    } catch (e) {}

    // Envoi de notification asynchrone (email/push)
    if (notificationsService) {
      notificationsService.notifyOwnerPaymentDeclared(payment, organizationId).catch(console.error);
    }

    return payment;
  }

  async uploadProof(id: string, proofUrl: string, organizationId: string): Promise<Payment> {
    await this.getPaymentById(id, organizationId);
    return paymentsRepository.update(id, { proofUrl });
  }

  async validatePayment(id: string, validatorId: string, data: any, organizationId: string): Promise<Payment> {
    const payment = await this.getPaymentById(id, organizationId);

    if (payment.status !== 'pending' && payment.status !== 'complement_requested') {
      throw new BadRequestError('Ce paiement a déjà été traité (validé ou rejeté).');
    }

    const updatedPayment = await prisma.$transaction(async (tx) => {
      // 1. Update payment status
      const p = await tx.payment.update({
        where: { id },
        data: {
          status: data.status,
          validatedBy: validatorId,
          validatedAt: data.status === 'validated' ? new Date() : null,
          rejectionReason: data.status === 'rejected' ? data.rejectionReason : null,
          complementMessage: data.status === 'complement_requested' ? data.complementMessage : null,
        },
      });

      // 2. If validated, update invoice status and handle multi-month / partial payments with FIFO allocation
      if (data.status === 'validated') {
        let paymentAmount = Number(payment.amount);
        let targetInvoiceId = payment.invoiceId;

        // Si aucun invoiceId n'a été spécifié lors du paiement, trouver la plus ancienne facture impayée
        if (!targetInvoiceId) {
          const oldestUnpaid = await tx.invoice.findFirst({
            where: {
              contractId: payment.contractId,
              status: { in: ['overdue', 'pending', 'partial'] },
            },
            orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }, { dueDate: 'asc' }],
          });

          if (oldestUnpaid) {
            targetInvoiceId = oldestUnpaid.id;
            await tx.payment.update({
              where: { id: payment.id },
              data: { invoiceId: targetInvoiceId },
            });
          }
        }

        if (targetInvoiceId) {
          const primaryInvoice = await tx.invoice.findUnique({
            where: { id: targetInvoiceId },
            include: { payments: { where: { status: 'validated', id: { not: payment.id } } } },
          });

          if (primaryInvoice) {
            const invoiceTotal = Number(primaryInvoice.totalAmount);
            const alreadyPaid = (primaryInvoice.payments || []).reduce((sum: number, p: any) => sum + Number(p.amount), 0);
            const remainingToPay = Math.max(0, invoiceTotal - alreadyPaid);

            if (paymentAmount < remainingToPay) {
              // Paiement partiel
              await tx.invoice.update({
                where: { id: targetInvoiceId },
                data: { status: 'partial' },
              });
            } else {
              // Paiement complet de la facture principale
              await tx.invoice.update({
                where: { id: targetInvoiceId },
                data: { status: 'paid' },
              });

              let remainingCredit = paymentAmount - remainingToPay;

              // Apurement des factures suivantes si excédent
              if (remainingCredit > 0) {
                const nextInvoices = await tx.invoice.findMany({
                  where: {
                    contractId: payment.contractId,
                    id: { not: targetInvoiceId },
                    status: { in: ['overdue', 'pending', 'partial'] },
                  },
                  include: { payments: { where: { status: 'validated', id: { not: payment.id } } } },
                  orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }, { dueDate: 'asc' }],
                });

                for (const nextInv of nextInvoices) {
                  if (remainingCredit <= 0) break;
                  const nextTotal = Number(nextInv.totalAmount);
                  const nextAlreadyPaid = (nextInv.payments || []).reduce((sum: number, p: any) => sum + Number(p.amount), 0);
                  const nextRemaining = Math.max(0, nextTotal - nextAlreadyPaid);

                  if (remainingCredit >= nextRemaining) {
                    await tx.invoice.update({
                      where: { id: nextInv.id },
                      data: { status: 'paid' },
                    });
                    remainingCredit -= nextRemaining;
                  } else {
                    await tx.invoice.update({
                      where: { id: nextInv.id },
                      data: { status: 'partial' },
                    });
                    remainingCredit = 0;
                  }
                }

                // Si excédent restant après apurement de toutes les factures émises, créer les factures des mois d'avance
                if (remainingCredit > 0) {
                  const contract = await tx.contract.findUnique({
                    where: { id: payment.contractId },
                  });

                  if (contract) {
                    const monthlyRent = Number(contract.rentAmount) + Number(contract.chargesAmount || 0);
                    if (monthlyRent > 0) {
                      const latestInvoice = await tx.invoice.findFirst({
                        where: { contractId: payment.contractId },
                        orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
                      });

                      let curMonth = latestInvoice ? latestInvoice.periodMonth : new Date().getMonth() + 1;
                      let curYear = latestInvoice ? latestInvoice.periodYear : new Date().getFullYear();

                      while (remainingCredit >= monthlyRent) {
                        curMonth++;
                        if (curMonth > 12) {
                          curMonth = 1;
                          curYear++;
                        }

                        const invNum = `INV-${curYear}${String(curMonth).padStart(2, '0')}-${Date.now().toString().slice(-6)}`;
                        const dueDate = getDueDate(contract.paymentDay || 5, curMonth, curYear);

                        await tx.invoice.create({
                          data: {
                            invoiceNumber: invNum,
                            organizationId: payment.organizationId,
                            contractId: payment.contractId,
                            tenantProfileId: payment.tenantProfileId,
                            propertyId: contract.propertyId,
                            periodMonth: curMonth,
                            periodYear: curYear,
                            dueDate,
                            rentAmount: contract.rentAmount,
                            chargesAmount: contract.chargesAmount || 0,
                            penaltyAmount: 0,
                            totalAmount: monthlyRent,
                            status: 'paid',
                          },
                        });

                        remainingCredit -= monthlyRent;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      return p;
    });

    // Post-transaction tasks (receipt generation, reliability scores, accounting posting, notifications)
    if (data.status === 'validated') {
      try {
        if (receiptsService) {
          // Generate Receipt PDF & Record
          await receiptsService.generateReceipt(payment.id, organizationId);
        }
        if (tenantProfilesService) {
          // Recalculate score
          await tenantProfilesService.calculateReliabilityScore(payment.tenantProfileId);
        }
        if (accountingService) {
          // Integrate into accounting ledger
          await accountingService.integrateValidatedPayment(payment.id);
        }
      } catch (error) {
        console.error('Failed to execute post-validation processes', error);
      }
    }

    // Fetch tenant details for bidirectional notifications
    const tenantProfile = await prisma.tenantProfile.findUnique({
      where: { id: payment.tenantProfileId },
      include: { user: true },
    });

    const tenantName = tenantProfile ? `${tenantProfile.firstName} ${tenantProfile.lastName}` : 'Locataire';
    const amountFormatted = Number(payment.amount).toLocaleString('fr-FR');

    // Notify user via Socket.IO
    if (payment.declaredBy) {
      emitToUser(payment.declaredBy, `payment:${data.status}`, updatedPayment);
    }

    if (data.status === 'validated') {
      // 1. Notify Tenant
      try {
        await dispatchNotification({
          userId: tenantProfile?.userId || payment.declaredBy || undefined,
          email: tenantProfile?.email || tenantProfile?.user?.email,
          phone: tenantProfile?.phone,
          type: 'PAYMENT_VALIDATED',
          title: '🎉 Quittance de loyer émise !',
          emailSubject: `[Naforo] Votre paiement de ${amountFormatted} FCFA a été validé`,
          emailHtml: `
            <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #16a34a;">Quittance de loyer disponible</h2>
              <p>Bonjour <strong>${tenantName}</strong>,</p>
              <p>Votre règlement de loyer de <strong>${amountFormatted} FCFA</strong> a été validé par votre propriétaire.</p>
              <p>Votre quittance officielle certifiée PDF est téléchargeable dans votre Espace Locataire.</p>
            </div>
          `,
          smsText: `Naforo: Votre versement de ${amountFormatted} FCFA a été validé. Votre quittance PDF est disponible dans votre Espace Locataire.`,
          data: { paymentId: payment.id },
        });
      } catch (e) {}

      // 2. Notify Landlord / Organization
      try {
        await dispatchNotification({
          organizationId,
          type: 'PAYMENT_VALIDATED_CONFIRMATION',
          title: '✅ Règlement validé et écriture comptable enregistrée',
          emailSubject: `[Naforo] Validation du loyer de ${tenantName}`,
          emailHtml: `
            <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #2563eb;">Règlement confirmé</h2>
              <p>Le versement de <strong>${amountFormatted} FCFA</strong> du locataire <strong>${tenantName}</strong> a été validé avec succès.</p>
              <p>La quittance PDF a été expédiée et l'écriture comptable a été ajoutée à votre journal.</p>
            </div>
          `,
          smsText: `Naforo: Vous avez validé le loyer de ${amountFormatted} FCFA de ${tenantName}. La quittance PDF a été transmise.`,
          data: { paymentId: payment.id, tenantProfileId: payment.tenantProfileId },
        });
      } catch (e) {}

    } else if (data.status === 'rejected') {
      const reason = data.rejectionReason || 'Justificatif ou règlement non conforme';

      // 1. Notify Tenant
      try {
        await dispatchNotification({
          userId: tenantProfile?.userId || payment.declaredBy || undefined,
          email: tenantProfile?.email || tenantProfile?.user?.email,
          phone: tenantProfile?.phone,
          type: 'PAYMENT_REJECTED',
          title: '⚠️ Déclaration de loyer non retenue',
          emailSubject: `[Naforo] Rejet de votre déclaration de paiement`,
          emailHtml: `
            <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #dc2626;">Déclaration non validée</h2>
              <p>Bonjour <strong>${tenantName}</strong>,</p>
              <p>Votre déclaration de paiement de <strong>${amountFormatted} FCFA</strong> n'a pas été retenue par votre propriétaire.</p>
              <p><strong>Motif du rejet:</strong> ${reason}</p>
              <p>Connectez-vous à votre Espace Locataire pour transmettre un justificatif conforme.</p>
            </div>
          `,
          smsText: `Naforo: Votre règlement de ${amountFormatted} FCFA a été rejeté. Motif: ${reason}. Veuillez vous connecter pour régulariser.`,
          data: { paymentId: payment.id },
        });
      } catch (e) {}

      // 2. Notify Landlord / Organization
      try {
        await dispatchNotification({
          organizationId,
          type: 'PAYMENT_REJECTED_CONFIRMATION',
          title: '❌ Déclaration de paiement rejetée',
          emailSubject: `[Naforo] Rejet du versement de ${tenantName}`,
          emailHtml: `
            <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #dc2626;">Règlement rejeté</h2>
              <p>Vous avez rejeté la déclaration de versement de <strong>${amountFormatted} FCFA</strong> du locataire <strong>${tenantName}</strong>.</p>
              <p><strong>Motif:</strong> ${reason}</p>
            </div>
          `,
          smsText: `Naforo: Vous avez rejeté la déclaration de ${amountFormatted} FCFA de ${tenantName}. Motif: ${reason}.`,
          data: { paymentId: payment.id },
        });
      } catch (e) {}
    } else if (data.status === 'complement_requested') {
      const complementMsg = data.complementMessage || 'Merci de nous transmettre un justificatif de paiement plus lisible.';

      // 1. Notify Tenant
      try {
        await dispatchNotification({
          userId: tenantProfile?.userId || payment.declaredBy || undefined,
          email: tenantProfile?.email || tenantProfile?.user?.email,
          phone: tenantProfile?.phone,
          type: 'PAYMENT_COMPLEMENT_REQUESTED',
          title: '📋 Justificatif complémentaire requis',
          emailSubject: `[Naforo] Complément requis pour votre paiement de loyer`,
          emailHtml: `
            <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #d97706;">Précision demandée sur votre règlement</h2>
              <p>Bonjour <strong>${tenantName}</strong>,</p>
              <p>Votre propriétaire a examiné votre versement de <strong>${amountFormatted} FCFA</strong> et requiert un complément d'information.</p>
              <div style="background: #fffbeb; border: 1px solid #fef3c7; padding: 14px; border-radius: 8px; margin: 16px 0;">
                <strong style="color: #92400e;">Message du bailleur :</strong><br/>
                ${complementMsg}
              </div>
              <p>Veuillez vous connecter à votre Espace Locataire pour mettre à jour votre justificatif.</p>
            </div>
          `,
          smsText: `Naforo: Complément demandé pour votre versement de ${amountFormatted} FCFA : "${complementMsg}". Rendez-vous sur votre Espace Locataire.`,
          data: { paymentId: payment.id },
        });
      } catch (e) {}
    }

    return updatedPayment;
  }

  async getStats(organizationId: string): Promise<any> {
    return paymentsRepository.getStats(organizationId);
  }
}

export const paymentsService = new PaymentsService();

