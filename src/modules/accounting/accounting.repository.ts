import { prisma } from '@/config/database';
import { redis } from '@/config/redis';
import type { AccountingTransaction, SecurityDeposit } from '@prisma/client';

const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'CAD'] as const;
// Taux fixe officiel FCFA/EUR (parité CFA)
const FIXED_EUR_RATE = 0.00152449;

export interface ConvertedAmounts {
  XOF: number;
  EUR: number;
  USD: number;
  CAD: number;
  rateDate: string;
}

// ─── Exchange Rate Helpers ────────────────────────────────────────────────────

async function getLatestRates(): Promise<Record<string, number>> {
  // Try Redis cache first (TTL: 1 hour)
  const cached = await redis.get('exchange_rates:XOF');
  if (cached) return JSON.parse(cached);

  // Fallback: read from DB (latest row per currency)
  const rates: Record<string, number> = { EUR: FIXED_EUR_RATE };
  for (const currency of SUPPORTED_CURRENCIES) {
    const row = await prisma.exchangeRate.findFirst({
      where: { baseCurrency: 'XOF', targetCurrency: currency },
      orderBy: { fetchedAt: 'desc' },
    });
    if (row) rates[currency] = Number(row.rate);
    else if (currency !== 'EUR') rates[currency] = 0; // unknown yet
  }
  await redis.set('exchange_rates:XOF', JSON.stringify(rates), 'EX', 3600);
  return rates;
}

export async function convertAmountXof(amountXof: number): Promise<ConvertedAmounts> {
  const rates = await getLatestRates();
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    XOF: amountXof,
    EUR: round2(amountXof * (rates['EUR'] ?? FIXED_EUR_RATE)),
    USD: round2(amountXof * (rates['USD'] ?? 0)),
    CAD: round2(amountXof * (rates['CAD'] ?? 0)),
    rateDate: new Date().toISOString().split('T')[0],
  };
}

export async function refreshExchangeRates(): Promise<void> {
  try {
    // EUR is pegged — always fixed
    await prisma.exchangeRate.create({
      data: { baseCurrency: 'XOF', targetCurrency: 'EUR', rate: FIXED_EUR_RATE, source: 'fixed' },
    });

    // USD & CAD: fetch from open.er-api.com (free, no key)
    const res = await fetch('https://open.er-api.com/v6/latest/XOF');
    if (!res.ok) throw new Error('Exchange rate API unavailable');
    const json = await res.json() as { rates: Record<string, number> };

    for (const currency of ['USD', 'CAD'] as const) {
      const rate = json.rates[currency];
      if (rate) {
        await prisma.exchangeRate.create({
          data: { baseCurrency: 'XOF', targetCurrency: currency, rate, source: 'api' },
        });
      }
    }
    // Invalidate cache
    await redis.del('exchange_rates:XOF');
  } catch (err) {
    console.error('[ExchangeRate] Refresh failed:', err);
  }
}

export const accountingRepository = {

  // ─── Transactions ──────────────────────────────────────────────────────────

  async createTransaction(data: {
    organizationId: string;
    propertyId?: string;
    contractId?: string;
    paymentId?: string;
    type: 'REVENUE' | 'EXPENSE';
    category: string;
    subCategory?: string;
    label: string;
    amountXof: number;
    transactionDate: Date;
    periodMonth?: number;
    periodYear?: number;
    paymentMethod?: string;
    referenceNumber?: string;
    documentUrl?: string;
    notes?: string;
    createdBy: string;
    isAutomatic?: boolean;
  }): Promise<AccountingTransaction> {
    return prisma.accountingTransaction.create({ data });
  },

  async listTransactions(filters: {
    organizationId: string;
    propertyId?: string;
    type?: string;
    category?: string;
    periodYear?: number;
    periodMonth?: number;
    page?: number;
    limit?: number;
  }) {
    const { organizationId, propertyId, type, category, periodYear, periodMonth, page = 1, limit = 20 } = filters;
    const where = {
      organizationId,
      ...(propertyId && { propertyId }),
      ...(type && { type }),
      ...(category && { category }),
      ...(periodYear && { periodYear }),
      ...(periodMonth && { periodMonth }),
    };
    const [total, items] = await Promise.all([
      prisma.accountingTransaction.count({ where }),
      prisma.accountingTransaction.findMany({
        where,
        include: { property: { select: { id: true, name: true } }, creator: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { transactionDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { total, items };
  },

  async getPnlByProperty(organizationId: string, propertyId: string, year: number, month?: number) {
    const where = {
      organizationId,
      propertyId,
      periodYear: year,
      ...(month && { periodMonth: month }),
    };
    const revenues = await prisma.accountingTransaction.aggregate({
      where: { ...where, type: { in: ['REVENUE', 'INCOME'] } },
      _sum: { amountXof: true },
    });
    const expenses = await prisma.accountingTransaction.aggregate({
      where: { ...where, type: 'EXPENSE' },
      _sum: { amountXof: true },
    });
    const totalRevenue = Number(revenues._sum.amountXof ?? 0);
    const totalExpense = Number(expenses._sum.amountXof ?? 0);
    return {
      propertyId,
      year,
      month: month ?? null,
      totalRevenueXof: totalRevenue,
      totalExpenseXof: totalExpense,
      netResultXof: totalRevenue - totalExpense,
    };
  },

  async getGlobalDashboard(organizationId: string, year: number, month: number) {
    const where = { organizationId, periodYear: year, periodMonth: month };
    const [revenues, expenses, byCategory] = await Promise.all([
      prisma.accountingTransaction.aggregate({ where: { ...where, type: { in: ['REVENUE', 'INCOME'] } }, _sum: { amountXof: true } }),
      prisma.accountingTransaction.aggregate({ where: { ...where, type: 'EXPENSE' }, _sum: { amountXof: true } }),
      prisma.accountingTransaction.groupBy({
        by: ['category', 'type'],
        where,
        _sum: { amountXof: true },
      }),
    ]);
    return {
      month,
      year,
      totalRevenueXof: Number(revenues._sum.amountXof ?? 0),
      totalExpenseXof: Number(expenses._sum.amountXof ?? 0),
      netXof: Number(revenues._sum.amountXof ?? 0) - Number(expenses._sum.amountXof ?? 0),
      breakdown: byCategory.map(b => ({
        category: b.category,
        type: b.type,
        amountXof: Number(b._sum.amountXof ?? 0),
      })),
    };
  },

  async deleteTransaction(id: string, organizationId: string) {
    return prisma.accountingTransaction.deleteMany({ where: { id, organizationId, isAutomatic: false } });
  },

  // ─── Security Deposits ────────────────────────────────────────────────────

  async createDeposit(data: {
    organizationId: string;
    contractId: string;
    tenantProfileId: string;
    amountReceivedXof: number;
    receivedAt: Date;
    notes?: string;
  }): Promise<SecurityDeposit> {
    return prisma.securityDeposit.create({ data });
  },

  async getDepositByContract(contractId: string) {
    return prisma.securityDeposit.findUnique({ where: { contractId }, include: { tenantProfile: true, contract: true } });
  },

  async returnDeposit(id: string, data: {
    amountReturnedXof: number;
    deductionAmountXof?: number;
    deductionReason?: string;
    deductionDocUrl?: string;
    returnedAt: Date;
  }) {
    const status = (data.deductionAmountXof ?? 0) > 0 ? 'PARTIALLY_RETURNED' : 'RETURNED';
    return prisma.securityDeposit.update({ where: { id }, data: { ...data, status } });
  },

  // ─── Exchange Rates ───────────────────────────────────────────────────────

  async getLatestRatesForDisplay() {
    return getLatestRates();
  },

  async setManualRate(targetCurrency: string, rate: number) {
    await prisma.exchangeRate.create({
      data: { baseCurrency: 'XOF', targetCurrency, rate, source: 'manual' },
    });
    await redis.del('exchange_rates:XOF');
  },
};
