import { prisma } from '@/config/database';
import { NotFoundError } from '@/shared/errors/AppError';

export class DashboardService {
  /**
   * Fetch full dashboard stats for an organization manager/owner
   */
  async getOwnerDashboard(organizationId: string): Promise<any> {
    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() + 30); // 30 days from now

    // Execute queries in parallel
    const [
      propertiesCount,
      contractsCount,
      expiringContracts,
      invoicesStats,
      recentPayments,
      recentIncidents,
      validatedSums,
      lastMonthSums,
    ] = await Promise.all([
      // 1. Properties status breakdown
      prisma.property.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { id: true },
      }),
      // 2. Contracts status breakdown
      prisma.contract.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { id: true },
      }),
      // 3. Contracts expiring in next 30 days
      prisma.contract.findMany({
        where: {
          organizationId,
          status: 'active',
          endDate: { gte: new Date(), lte: limitDate },
        },
        include: { property: { select: { name: true } }, tenantProfile: { select: { firstName: true, lastName: true } } },
      }),
      // 4. Invoices sum grouped by status
      prisma.invoice.groupBy({
        by: ['status'],
        where: { organizationId },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      // 5. Recent 5 declared payments
      prisma.payment.findMany({
        where: { organizationId },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { tenantProfile: { select: { firstName: true, lastName: true } } },
      }),
      // 6. Recent 5 incidents
      prisma.incident.findMany({
        where: { organizationId },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { property: { select: { name: true } } },
      }),
      // 7. This month validated revenue
      prisma.payment.aggregate({
        where: {
          organizationId,
          status: 'validated',
          paymentDate: {
            gte: new Date(currentYear, currentMonth - 1, 1),
            lte: new Date(currentYear, currentMonth, 0),
          },
        },
        _sum: { amount: true },
      }),
      // 8. Last month validated revenue
      prisma.payment.aggregate({
        where: {
          organizationId,
          status: 'validated',
          paymentDate: {
            gte: new Date(currentMonth === 1 ? currentYear - 1 : currentYear, currentMonth === 1 ? 11 : currentMonth - 2, 1),
            lte: new Date(currentMonth === 1 ? currentYear - 1 : currentYear, currentMonth === 1 ? 12 : currentMonth - 1, 0),
          },
        },
        _sum: { amount: true },
      }),
    ]);

    // Format properties stats
    const properties = {
      total: propertiesCount.reduce((a, c) => a + c._count.id, 0),
      available: propertiesCount.find((p) => p.status === 'available')?._count.id || 0,
      occupied: propertiesCount.find((p) => p.status === 'occupied')?._count.id || 0,
      maintenance: propertiesCount.find((p) => p.status === 'maintenance')?._count.id || 0,
    };

    // Occupancy Rate
    const occupancyRate = properties.total > 0 ? (properties.occupied / properties.total) * 100 : 0;

    // Format invoices stats
    const invoices = {
      pendingCount: invoicesStats.find((i) => i.status === 'pending')?._count.id || 0,
      pendingAmount: invoicesStats.find((i) => i.status === 'pending')?._sum.totalAmount || 0,
      overdueCount: invoicesStats.find((i) => i.status === 'overdue')?._count.id || 0,
      overdueAmount: invoicesStats.find((i) => i.status === 'overdue')?._sum.totalAmount || 0,
      collectedAmount: invoicesStats.find((i) => i.status === 'paid')?._sum.totalAmount || 0,
    };

    // Fetch subscription details
    const activeSub = await prisma.subscription.findFirst({
      where: { organizationId },
      include: { plan: true },
      orderBy: { endDate: 'desc' },
    });

    let subscriptionAlert = false;
    let subscriptionDaysLeft = 0;
    let isSuspended = false;
    let isDeactivated = false;
    let hasPendingPayment = false;
    let subscriptionInfo = null;

    if (activeSub) {
      const expirationDate = new Date(activeSub.endDate);
      const diffTime = expirationDate.getTime() - today.getTime();
      subscriptionDaysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      const isExpired = today > expirationDate && activeSub.plan.code !== 'starter';
      const daysSinceExpiration = isExpired ? Math.abs(subscriptionDaysLeft) : 0;
      isSuspended = activeSub.status === 'suspended' || (isExpired && daysSinceExpiration <= 5);
      isDeactivated = activeSub.status === 'deactivated' || (isExpired && daysSinceExpiration > 5);

      // Alerte J-5, suspendu ou désactivé
      if (subscriptionDaysLeft <= 5 || isSuspended || isDeactivated) {
        subscriptionAlert = true;
      }

      subscriptionInfo = {
        planName: activeSub.plan.name,
        planCode: activeSub.plan.code,
        endDate: activeSub.endDate,
        status: isDeactivated ? 'deactivated' : (isSuspended ? 'suspended' : (isExpired ? 'expired' : activeSub.status)),
        isSuspended,
        isDeactivated,
        daysSinceExpiration,
      };
    }

    const pendingPaymentCount = await prisma.subscriptionPayment.count({
      where: { organizationId, status: 'pending' },
    });
    hasPendingPayment = pendingPaymentCount > 0;

    // Calculate last 6 months real validated revenue breakdown for chart directly from database
    const monthlyHistory = [];
    const monthNamesFr = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
    
    for (let i = 5; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - 1 - i, 1);
      const mYear = d.getFullYear();
      const mIndex = d.getMonth();
      const mStart = new Date(mYear, mIndex, 1);
      const mEnd = new Date(mYear, mIndex + 1, 0, 23, 59, 59);

      const monthAgg = await prisma.payment.aggregate({
        where: {
          organizationId,
          status: 'validated',
          paymentDate: { gte: mStart, lte: mEnd },
        },
        _sum: { amount: true },
      });

      monthlyHistory.push({
        name: monthNamesFr[mIndex],
        revenus: Number(monthAgg._sum.amount || 0),
      });
    }

    return {
      properties,
      occupancyRate: Math.round(occupancyRate * 10) / 10,
      activeContractsCount: contractsCount.find((c) => c.status === 'active')?._count.id || 0,
      expiringContracts,
      invoices,
      recentPayments,
      recentIncidents,
      revenues: {
        thisMonth: Number(validatedSums._sum.amount || 0),
        lastMonth: Number(lastMonthSums._sum.amount || 0),
        monthlyHistory,
      },
      subscription: {
        alert: subscriptionAlert,
        daysLeft: subscriptionDaysLeft,
        isSuspended,
        isDeactivated,
        hasPendingPayment,
        info: subscriptionInfo,
      },
    };
  }

  /**
   * Fetch personal dashboard stats for a logged-in Tenant user
   */
  async getTenantDashboard(userId: string, organizationId: string): Promise<any> {
    const profile = await prisma.tenantProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundError('Profil locataire introuvable.');
    }

    const [activeContract, pendingInvoice, recentPayments, receipts, incidents] = await Promise.all([
      // 1. Active Contract
      prisma.contract.findFirst({
        where: { tenantProfileId: profile.id, organizationId, status: 'active' },
        include: { property: true },
      }),
      // 2. First Pending/Overdue Invoice
      prisma.invoice.findFirst({
        where: { tenantProfileId: profile.id, organizationId, status: { in: ['pending', 'overdue'] } },
        orderBy: { dueDate: 'asc' },
      }),
      // 3. Last 5 Payments history
      prisma.payment.findMany({
        where: { tenantProfileId: profile.id, organizationId },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      // 4. Last 5 Receipts
      prisma.receipt.findMany({
        where: { tenantProfileId: profile.id, organizationId },
        take: 5,
        orderBy: { issuedAt: 'desc' },
      }),
      // 5. Incidents tickets
      prisma.incident.findMany({
        where: { tenantProfileId: profile.id, organizationId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      profile,
      activeContract,
      pendingInvoice,
      recentPayments,
      receipts,
      incidents,
      reliabilityScore: profile.reliabilityScore,
    };
  }
}

export const dashboardService = new DashboardService();
export default dashboardService;
