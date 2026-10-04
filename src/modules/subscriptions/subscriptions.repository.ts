import { prisma } from '@/config/database';
import type { SubscriptionPlan, Subscription, SubscriptionPayment } from '@prisma/client';

export const subscriptionsRepository = {

  // --- PLANS ---
  async createPlan(data: {
    name: string;
    code: string;
    description?: string;
    priceMonthlyXof: number;
    yearlyDiscountPercent?: number;
    maxProperties: number;
    maxTenants: number;
    features: string[];
    isRecommended?: boolean;
  }): Promise<SubscriptionPlan> {
    return prisma.subscriptionPlan.create({
      data: {
        ...data,
        yearlyDiscountPercent: data.yearlyDiscountPercent ?? 20,
        isRecommended: data.isRecommended ?? false,
        features: JSON.stringify(data.features),
      },
    });
  },

  async updatePlan(id: string, data: Partial<{
    name: string;
    description: string;
    priceMonthlyXof: number;
    yearlyDiscountPercent: number;
    maxProperties: number;
    maxTenants: number;
    features: string[];
    isRecommended: boolean;
    isActive: boolean;
  }>): Promise<SubscriptionPlan> {
    return prisma.subscriptionPlan.update({
      where: { id },
      data: {
        ...data,
        ...(data.features && { features: JSON.stringify(data.features) }),
      },
    });
  },

  async findPlanById(id: string): Promise<SubscriptionPlan | null> {
    return prisma.subscriptionPlan.findUnique({ where: { id } });
  },

  async findPlanByCode(code: string): Promise<SubscriptionPlan | null> {
    return prisma.subscriptionPlan.findUnique({ where: { code } });
  },

  async listPlans(includeInactive: boolean = false): Promise<any[]> {
    return prisma.subscriptionPlan.findMany({
      where: includeInactive ? undefined : { isActive: true },
      include: {
        _count: {
          select: {
            subscriptions: true,
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });
  },

  async deletePlan(id: string): Promise<SubscriptionPlan> {
    return prisma.subscriptionPlan.delete({ where: { id } });
  },

  // --- SUBSCRIPTIONS ---
  async getActiveSubscription(organizationId: string): Promise<(Subscription & { plan: SubscriptionPlan }) | null> {
    // Renvoie l'abonnement actif (ou même expiré, le plus récent pour vérifier le statut de restriction)
    return prisma.subscription.findFirst({
      where: { organizationId },
      include: { plan: true },
      orderBy: { endDate: 'desc' },
    });
  },

  async createSubscription(data: {
    organizationId: string;
    planId: string;
    startDate: Date;
    endDate: Date;
    status: string;
  }): Promise<Subscription> {
    return prisma.subscription.create({ data });
  },

  async updateSubscriptionStatus(id: string, status: string): Promise<Subscription> {
    return prisma.subscription.update({ where: { id }, data: { status } });
  },

  // --- PAYMENTS ---
  async createPayment(data: {
    paymentReference: string;
    organizationId: string;
    subscriptionId: string;
    targetPlanId?: string;
    billingCycle?: string;
    amountXof: number;
    paymentMethod: string;
    transactionNumber?: string;
    paymentDate: Date;
  }): Promise<SubscriptionPayment> {
    return prisma.subscriptionPayment.create({ data });
  },

  async findPaymentById(id: string): Promise<(SubscriptionPayment & { subscription: Subscription & { plan: SubscriptionPlan } }) | null> {
    return prisma.subscriptionPayment.findUnique({
      where: { id },
      include: {
        subscription: {
          include: { plan: true },
        },
      },
    });
  },

  async updatePaymentProof(id: string, proofUrl: string): Promise<SubscriptionPayment> {
    return prisma.subscriptionPayment.update({ where: { id }, data: { proofUrl } });
  },

  async listPendingPayments(status?: string): Promise<any[]> {
    const whereClause: any = {};
    if (status && status !== 'all') {
      whereClause.status = status;
    } else if (!status) {
      whereClause.status = 'pending';
    }

    const payments = await prisma.subscriptionPayment.findMany({
      where: whereClause,
      include: {
        organization: { select: { id: true, name: true, email: true, phone: true } },
        subscription: { include: { plan: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const planIds = Array.from(new Set(payments.map(p => p.targetPlanId).filter(Boolean))) as string[];
    const targetPlans = planIds.length > 0 
      ? await prisma.subscriptionPlan.findMany({ where: { id: { in: planIds } } })
      : [];
    const planMap = new Map(targetPlans.map(p => [p.id, p]));

    return payments.map(p => ({
      ...p,
      targetPlan: p.targetPlanId ? planMap.get(p.targetPlanId) || null : null,
    }));
  },

  async listPaymentsHistory(organizationId: string): Promise<SubscriptionPayment[]> {
    return prisma.subscriptionPayment.findMany({
      where: { organizationId },
      include: {
        subscription: { include: { plan: true } },
      },
      orderBy: { paymentDate: 'desc' },
    });
  },

  async validatePayment(
    id: string,
    validatedBy: string,
    pdfUrl: string
  ): Promise<SubscriptionPayment> {
    return prisma.subscriptionPayment.update({
      where: { id },
      data: {
        status: 'validated',
        validatedBy,
        validatedAt: new Date(),
        pdfUrl,
      },
    });
  },

  async rejectPayment(id: string, reason: string): Promise<SubscriptionPayment> {
    return prisma.subscriptionPayment.update({
      where: { id },
      data: {
        status: 'rejected',
        rejectionReason: reason,
      },
    });
  },
};
