import { Request, Response } from 'express';
import { SubscriptionsService } from './subscriptions.service';
import { sendSuccess, asyncHandler } from '@/shared/helpers/response';
import { CreatePlanSchema, DeclareSubscriptionPaymentSchema, ValidateSubscriptionPaymentSchema } from './subscriptions.schema';
import { ForbiddenError } from '@/shared/errors/AppError';

const subscriptionsService = new SubscriptionsService();

export const subscriptionsController = {

  // --- PLANS ---
  createPlan: asyncHandler(async (req: Request, res: Response) => {
    if (req.user!.role !== 'super_admin') {
      throw new ForbiddenError("Accès réservé au super administrateur");
    }

    const data = req.body;
    const plan = await subscriptionsService.createPlan(data);
    return sendSuccess(res, plan, 'Plan d\'abonnement créé avec succès', 201);
  }),

  listPlans: asyncHandler(async (req: Request, res: Response) => {
    const isSuperAdmin = req.user?.role === 'super_admin';
    const includeInactive = req.query.includeInactive === 'true' || isSuperAdmin;
    const plans = await subscriptionsService.listPlans(includeInactive);
    return sendSuccess(res, plans, 'Plans d\'abonnements récupérés avec succès');
  }),

  updatePlan: asyncHandler(async (req: Request, res: Response) => {
    if (req.user!.role !== 'super_admin') {
      throw new ForbiddenError("Accès réservé au super administrateur");
    }

    const { id } = req.params;
    const data = req.body;
    const plan = await subscriptionsService.updatePlan(id, data);
    return sendSuccess(res, plan, 'Forfait d\'abonnement mis à jour avec succès');
  }),

  togglePlanStatus: asyncHandler(async (req: Request, res: Response) => {
    if (req.user!.role !== 'super_admin') {
      throw new ForbiddenError("Accès réservé au super administrateur");
    }

    const { id } = req.params;
    const { isActive } = req.body;
    const plan = await subscriptionsService.togglePlanActive(id, Boolean(isActive));
    return sendSuccess(res, plan, `Forfait d'abonnement ${isActive ? 'activé' : 'bloqué/archivé'} avec succès`);
  }),

  deletePlan: asyncHandler(async (req: Request, res: Response) => {
    if (req.user!.role !== 'super_admin') {
      throw new ForbiddenError("Accès réservé au super administrateur");
    }

    const { id } = req.params;
    await subscriptionsService.deletePlan(id);
    return sendSuccess(res, null, "Forfait d'abonnement supprimé définitivement avec succès");
  }),

  // --- MY SUBSCRIPTION & QUOTAS ---
  getMySubscription: asyncHandler(async (req: Request, res: Response) => {
    const subscription = await subscriptionsService.getMySubscription(req.organizationId!);
    return sendSuccess(res, subscription, 'Détails de votre abonnement récupérés avec succès');
  }),

  // --- PAYMENTS & DECLARATIONS ---
  declarePayment: asyncHandler(async (req: Request, res: Response) => {
    if (req.user!.role !== 'owner' && req.user!.role !== 'admin') {
      throw new ForbiddenError("Seuls les propriétaires de comptes peuvent s'abonner");
    }

    const data = req.body;
    const payment = await subscriptionsService.declarePayment(req.organizationId!, req.user!.userId, data);

    return sendSuccess(res, payment, 'Paiement d\'abonnement déclaré avec succès. En attente de validation par le support.', 201);
  }),

  uploadProof: asyncHandler(async (req: Request, res: Response) => {
    if (req.user!.role !== 'owner' && req.user!.role !== 'admin') {
      throw new ForbiddenError("Privilèges insuffisants");
    }

    if (!req.file) {
      throw new ForbiddenError("Veuillez téléverser un fichier justificatif");
    }

    const { id } = req.params;
    const fileUrl = `uploads/${req.file.filename}`;
    const payment = await subscriptionsService.uploadProof(id, fileUrl, req.organizationId!);

    return sendSuccess(res, payment, 'Justificatif de paiement téléversé avec succès');
  }),

  getPaymentsHistory: asyncHandler(async (req: Request, res: Response) => {
    if (req.user!.role !== 'owner' && req.user!.role !== 'admin') {
      throw new ForbiddenError("Privilèges insuffisants");
    }

    const history = await subscriptionsService.getPaymentsHistory(req.organizationId!);
    return sendSuccess(res, history, 'Historique des paiements d\'abonnements récupéré avec succès');
  }),

  // --- SUPERADMIN ENPOINTS ---
  getPendingPayments: asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const payments = await subscriptionsService.getPendingPayments(req.user!.userId, status);
    return sendSuccess(res, payments, 'Paiements d\'abonnements récupérés avec succès');
  }),

  validatePayment: asyncHandler(async (req: Request, res: Response) => {
    if (req.user!.role !== 'super_admin') {
      throw new ForbiddenError("Accès réservé au super administrateur");
    }

    const { id } = req.params;
    const data = req.body;

    const payment = await subscriptionsService.validatePayment(id, req.user!.userId, data);
    return sendSuccess(res, payment, `Paiement d'abonnement ${data.status === 'validated' ? 'validé' : 'rejeté'} avec succès`);
  }),

  getAdminStats: asyncHandler(async (req: Request, res: Response) => {
    if (req.user!.role !== 'super_admin') {
      throw new ForbiddenError("Accès réservé au super administrateur");
    }

    const stats = await subscriptionsService.getAdminStats(req.user!.userId);
    return sendSuccess(res, stats, 'Statistiques SaaS globales récupérées avec succès');
  }),

  // --- EXPORT COMPLET DE SAUVEGARDE & RÉTENTION RGPD ---
  exportData: asyncHandler(async (req: Request, res: Response) => {
    if (req.user!.role !== 'owner' && req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
      throw new ForbiddenError("Privilèges insuffisants pour exporter les données de l'organisation");
    }

    const backupData = await subscriptionsService.exportTenantData(req.organizationId!);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="naforo-backup-${req.organizationId}-${Date.now()}.json"`);
    return res.status(200).json(backupData);
  }),
};
