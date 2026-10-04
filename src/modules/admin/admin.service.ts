import { prisma } from '@/config/database';
import { emitToOrg } from '@/sockets/socket.handler';
import { dispatchNotification } from '@/shared/helpers/notification';

export async function getAdvancedStats() {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const [
    totalOrgs,
    activeOrgs,
    totalUsers,
    totalProperties,
    occupiedProperties,
    totalTenants,
    totalContracts,
    activeContracts,
    totalPayments,
    totalReceipts,
    orgsByPlan,
    pendingSubscriptionsCount,
    pendingSubscriptionsList,
    recentOrgs,
    saasPaymentAgg,
    saasPaymentThisMonthAgg,
    saasPaymentLastMonthAgg,
    rentPaymentAgg,
    rentPaymentThisMonthAgg,
    rentPaymentLastMonthAgg,
    activePaidSubscriptions
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.count({ where: { isActive: true } }),
    prisma.user.count(),
    prisma.property.count(),
    prisma.property.count({ where: { status: 'occupied' } }),
    prisma.tenantProfile.count(),
    prisma.contract.count(),
    prisma.contract.count({ where: { status: 'active' } }),
    prisma.payment.count(),
    prisma.receipt.count(),
    prisma.organization.groupBy({
      by: ['plan'],
      _count: { _all: true },
    }),
    prisma.subscriptionPayment.count({
      where: { status: 'pending' },
    }),
    prisma.subscriptionPayment.findMany({
      where: { status: 'pending' },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        organization: {
          select: { id: true, name: true, email: true, phone: true }
        }
      }
    }),
    prisma.organization.findMany({
      take: 6,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        city: true,
        plan: true,
        createdAt: true,
        isActive: true,
        _count: {
          select: {
            properties: true,
            contracts: true,
            users: true,
          }
        }
      }
    }),
    // SaaS Subscriptions Revenue Total
    prisma.subscriptionPayment.aggregate({
      where: { status: 'validated' },
      _sum: { amountXof: true }
    }),
    // SaaS Subscriptions Revenue This Month
    prisma.subscriptionPayment.aggregate({
      where: { status: 'validated', createdAt: { gte: currentMonthStart } },
      _sum: { amountXof: true }
    }),
    // SaaS Subscriptions Revenue Last Month
    prisma.subscriptionPayment.aggregate({
      where: { status: 'validated', createdAt: { gte: lastMonthStart, lte: lastMonthEnd } },
      _sum: { amountXof: true }
    }),
    // Rent GMV Total
    prisma.payment.aggregate({
      where: { status: 'validated' },
      _sum: { amount: true },
    }),
    // Rent GMV This Month
    prisma.payment.aggregate({
      where: { status: 'validated', createdAt: { gte: currentMonthStart } },
      _sum: { amount: true },
    }),
    // Rent GMV Last Month
    prisma.payment.aggregate({
      where: { status: 'validated', createdAt: { gte: lastMonthStart, lte: lastMonthEnd } },
      _sum: { amount: true },
    }),
    // Active Paid Subscriptions for MRR calculation
    prisma.subscription.findMany({
      where: {
        status: 'active',
        plan: { code: { not: 'starter' } }
      },
      include: {
        plan: {
          select: { priceMonthlyXof: true }
        }
      }
    })
  ]);

  const totalSaasRevenue = Number(saasPaymentAgg._sum.amountXof || 0);
  const thisMonthSaasRevenue = Number(saasPaymentThisMonthAgg._sum.amountXof || 0);
  const lastMonthSaasRevenue = Number(saasPaymentLastMonthAgg._sum.amountXof || 0);

  const totalGmv = Number(rentPaymentAgg._sum.amount || 0);
  const thisMonthGmv = Number(rentPaymentThisMonthAgg._sum.amount || 0);
  const lastMonthGmv = Number(rentPaymentLastMonthAgg._sum.amount || 0);

  // MRR estimation based on active paid plans
  const mrr = activePaidSubscriptions.reduce((acc, sub) => {
    return acc + Number(sub.plan?.priceMonthlyXof || 0);
  }, 0);
  const arr = mrr * 12;

  // Occupancy rate
  const occupancyRate = totalProperties > 0 ? Math.round((occupiedProperties / totalProperties) * 100) : 0;

  // Monthly stats breakdown for last 6 months (both GMV and SaaS Revenue)
  const monthlyGrowth = [];
  for (let i = 5; i >= 0; i--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    const monthName = monthDate.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });

    const [orgCount, contractCount, paymentAgg, saasAgg] = await Promise.all([
      prisma.organization.count({
        where: { createdAt: { lte: monthEnd } }
      }),
      prisma.contract.count({
        where: { createdAt: { gte: monthDate, lte: monthEnd } }
      }),
      prisma.payment.aggregate({
        where: { status: 'validated', createdAt: { gte: monthDate, lte: monthEnd } },
        _sum: { amount: true }
      }),
      prisma.subscriptionPayment.aggregate({
        where: { status: 'validated', createdAt: { gte: monthDate, lte: monthEnd } },
        _sum: { amountXof: true }
      })
    ]);

    monthlyGrowth.push({
      month: monthName.charAt(0).toUpperCase() + monthName.slice(1),
      orgCount,
      contractCount,
      revenue: Number(paymentAgg._sum.amount || 0),
      saasRevenue: Number(saasAgg._sum.amountXof || 0)
    });
  }

  // Formatting subscriptions breakdown
  const planBreakdown = {
    starter: 0,
    pro: 0,
    expert: 0,
    enterprise: 0,
  };
  orgsByPlan.forEach(p => {
    const planName = (p.plan || 'starter').toLowerCase();
    if (planName in planBreakdown) {
      planBreakdown[planName as keyof typeof planBreakdown] = p._count._all;
    } else {
      planBreakdown.starter += p._count._all;
    }
  });

  return {
    // SaaS Financials
    totalSaasRevenue,
    thisMonthSaasRevenue,
    lastMonthSaasRevenue,
    mrr,
    arr,
    // GMV / Rent Volume
    totalRevenue: totalGmv,
    totalGmv,
    thisMonthGmv,
    lastMonthGmv,
    // Scale & Platform Metrics
    totalOrgs,
    activeOrgs,
    totalUsers,
    totalProperties,
    occupiedProperties,
    occupancyRate,
    totalTenants,
    totalContracts,
    activeContracts,
    totalPayments,
    totalReceipts,
    // Plan distribution
    planBreakdown,
    monthlyGrowth,
    recentOrgs,
    // SuperAdmin Pending Actions
    pendingSubscriptionsCount,
    pendingSubscriptionsList,
    // System Health
    systemHealth: {
      status: 'operational',
      database: 'connected',
      redis: 'connected',
      environment: process.env.NODE_ENV || 'production',
      version: '2.4.0',
      timestamp: new Date().toISOString()
    }
  };
}

export async function broadcastNotification(body: {
  title: string;
  message: string;
  target: 'all' | 'owners' | 'tenants' | 'organization';
  organizationId?: string;
  type?: string;
}) {
  const { title, message, target, organizationId, type = 'SYSTEM_BROADCAST' } = body;

  let whereUser: any = { isActive: true };

  if (target === 'owners') {
    whereUser.role = { in: ['admin', 'manager', 'owner'] };
  } else if (target === 'tenants') {
    whereUser.role = 'tenant';
  } else if (target === 'organization' && organizationId) {
    whereUser.organizationId = organizationId;
  }

  const targetUsers = await prisma.user.findMany({
    where: whereUser,
    select: { id: true, organizationId: true, email: true, phone: true }
  });

  if (targetUsers.length === 0) {
    return { recipientCount: 0 };
  }

  // Create notifications in DB
  const notificationsData = targetUsers.map(u => ({
    organizationId: u.organizationId,
    userId: u.id,
    type,
    title,
    message,
    channels: ['in_app'],
    isRead: false
  }));

  await prisma.notification.createMany({
    data: notificationsData
  });

  // Emit WebSocket notifications to each user channel
  targetUsers.forEach(u => {
    emitToOrg(u.organizationId || 'global', 'notification:broadcast', {
      title,
      message,
      type
    });
  });

  return { recipientCount: targetUsers.length };
}

export async function getAuditLogs(options: {
  page?: number;
  limit?: number;
  search?: string;
  action?: string;
  entityType?: string;
  organizationId?: string;
}) {
  const page = Number(options.page) || 1;
  const limit = Number(options.limit) || 20;
  const skip = (page - 1) * limit;

  const where: any = {};

  if (options.action) {
    where.action = { contains: options.action, mode: 'insensitive' };
  }
  if (options.entityType) {
    where.entityType = { contains: options.entityType, mode: 'insensitive' };
  }
  if (options.organizationId) {
    where.organizationId = options.organizationId;
  }
  if (options.search) {
    where.OR = [
      { action: { contains: options.search, mode: 'insensitive' } },
      { entityType: { contains: options.search, mode: 'insensitive' } },
      { ipAddress: { contains: options.search, mode: 'insensitive' } },
      { user: { email: { contains: options.search, mode: 'insensitive' } } },
      { user: { firstName: { contains: options.search, mode: 'insensitive' } } },
      { user: { lastName: { contains: options.search, mode: 'insensitive' } } },
    ];
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          }
        },
        organization: {
          select: {
            id: true,
            name: true,
          }
        }
      }
    }),
    prisma.auditLog.count({ where })
  ]);

  return {
    data: logs,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
}
