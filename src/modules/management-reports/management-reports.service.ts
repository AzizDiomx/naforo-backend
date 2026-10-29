import { prisma } from '@/config/database';
import { NotFoundError, BadRequestError } from '@/shared/errors/AppError';
import { ManagementReport, Prisma } from '@prisma/client';
import { PaginationQuery, PaginationMeta } from '@/shared/types';
import { buildPaginationMeta } from '@/shared/helpers/pagination';
import { generateCrgPdf } from './crg.pdf';

export class ManagementReportsService {
  async generateReport(
    organizationId: string,
    landlordId: string,
    periodMonth: number,
    periodYear: number,
    options: { otherDeductions?: number; notes?: string } = {},
    createdById?: string
  ): Promise<ManagementReport> {
    const [organization, landlord] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId } }),
      prisma.landlord.findFirst({
        where: { id: landlordId, organizationId },
        include: {
          properties: {
            include: {
              children: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    if (!organization) throw new NotFoundError('Organisation introuvable.');
    if (!landlord) throw new NotFoundError('Bailleur mandant introuvable.');

    // 1. Gather all property IDs (direct + children units)
    const propertyIds: string[] = [];
    const propertyNamesMap: Record<string, string> = {};

    landlord.properties.forEach((prop) => {
      propertyIds.push(prop.id);
      propertyNamesMap[prop.id] = prop.name;

      if (prop.children && prop.children.length > 0) {
        prop.children.forEach((child) => {
          propertyIds.push(child.id);
          propertyNamesMap[child.id] = `${prop.name} - ${child.name}`;
        });
      }
    });

    const startDate = new Date(periodYear, periodMonth - 1, 1);
    const endDate = new Date(periodYear, periodMonth, 0, 23, 59, 59);

    // 2. Fetch validated payments for these properties during the period
    const validatedPayments = await prisma.payment.findMany({
      where: {
        organizationId,
        status: 'validated',
        contract: {
          propertyId: { in: propertyIds },
        },
        paymentDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        contract: {
          include: {
            property: { select: { id: true, name: true } },
          },
        },
        tenantProfile: {
          select: { firstName: true, lastName: true },
        },
        receipts: {
          take: 1,
          select: { receiptNumber: true },
        },
      },
      orderBy: { paymentDate: 'asc' },
    });

    let grossRentCollected = 0;
    const collectedRents = validatedPayments.map((p) => {
      const amt = Number(p.amount);
      grossRentCollected += amt;
      const propName = propertyNamesMap[p.contract.propertyId] || p.contract.property?.name || 'Bien';
      const tenantName = p.tenantProfile ? `${p.tenantProfile.firstName} ${p.tenantProfile.lastName}` : 'Locataire';

      return {
        propertyName: propName,
        tenantName,
        receiptNumber: p.receipts[0]?.receiptNumber || p.paymentReference,
        paymentDate: p.paymentDate.toISOString().split('T')[0],
        amount: amt,
      };
    });

    // 3. Calculate agency management fees
    const managementFeeRate = Number(landlord.managementFeeRate || 8.0);
    const feeTaxRate = Number(landlord.feeTaxRate || 0.0);
    const managementFees = Math.round(grossRentCollected * (managementFeeRate / 100));
    const feeTaxAmount = Math.round(managementFees * (feeTaxRate / 100));

    // 4. Fetch approved maintenance/incident expenses for these properties
    const deductibleIncidents = await prisma.incident.findMany({
      where: {
        organizationId,
        propertyId: { in: propertyIds },
        expenseStatus: { in: ['approved', 'paid'] },
        isDeductibleFromCRG: true,
        OR: [
          { approvedAt: { gte: startDate, lte: endDate } },
          { resolvedAt: { gte: startDate, lte: endDate } },
          { createdAt: { gte: startDate, lte: endDate } },
        ],
      },
      include: {
        property: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    let maintenanceExpenses = 0;
    const maintenanceDeductions = deductibleIncidents.map((inc) => {
      const cost = Number(inc.actualCost || inc.estimatedCost || 0);
      maintenanceExpenses += cost;
      const propName = propertyNamesMap[inc.propertyId] || inc.property?.name || 'Bien';

      return {
        incidentNumber: inc.incidentNumber,
        title: inc.title,
        propertyName: propName,
        amount: cost,
        date: inc.resolvedAt ? inc.resolvedAt.toISOString().split('T')[0] : inc.createdAt.toISOString().split('T')[0],
      };
    });

    const otherDeductions = Number(options.otherDeductions || 0);
    const netPayableToLandlord = Math.max(0, grossRentCollected - managementFees - feeTaxAmount - maintenanceExpenses - otherDeductions);

    // 5. Generate unique report number
    const shortCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    const reportNumber = `CRG-${periodYear}-${String(periodMonth).padStart(2, '0')}-${shortCode}`;

    const itemsSummary = {
      collectedRents,
      maintenanceDeductions,
    };

    // 6. Check existing report for same landlord & period
    const existing = await prisma.managementReport.findFirst({
      where: { organizationId, landlordId, periodMonth, periodYear },
    });

    let report: ManagementReport;
    if (existing) {
      report = await prisma.managementReport.update({
        where: { id: existing.id },
        data: {
          grossRentCollected,
          managementFeeRate,
          managementFees,
          feeTaxRate,
          feeTaxAmount,
          maintenanceExpenses,
          otherDeductions,
          netPayableToLandlord,
          itemsSummary,
          notes: options.notes || existing.notes,
          startDate,
          endDate,
        },
      });
    } else {
      report = await prisma.managementReport.create({
        data: {
          reportNumber,
          organizationId,
          landlordId,
          periodMonth,
          periodYear,
          startDate,
          endDate,
          grossRentCollected,
          managementFeeRate,
          managementFees,
          feeTaxRate,
          feeTaxAmount,
          maintenanceExpenses,
          otherDeductions,
          netPayableToLandlord,
          status: 'draft',
          itemsSummary,
          notes: options.notes || null,
          createdById: createdById || null,
        },
      });
    }

    // 7. Generate PDF
    const landlordDisplayName = landlord.type === 'company' && landlord.companyName
      ? landlord.companyName
      : `${landlord.firstName || ''} ${landlord.lastName || ''}`.trim() || landlord.phone;

    try {
      const pdfPath = await generateCrgPdf({
        reportNumber: report.reportNumber,
        periodMonth,
        periodYear,
        startDate,
        endDate,
        grossRentCollected,
        managementFeeRate,
        managementFees,
        feeTaxRate,
        feeTaxAmount,
        maintenanceExpenses,
        otherDeductions,
        netPayableToLandlord,
        organization: {
          name: organization.name,
          email: organization.email,
          phone: organization.phone,
          address: organization.address,
          city: organization.city,
        },
        landlord: {
          displayName: landlordDisplayName,
          email: landlord.email,
          phone: landlord.phone,
          address: landlord.address,
          bankName: landlord.bankName,
          ibanOrRib: landlord.ibanOrRib,
          mobileMoneyNumber: landlord.mobileMoneyNumber,
        },
        itemsSummary,
      });

      report = await prisma.managementReport.update({
        where: { id: report.id },
        data: { pdfUrl: pdfPath },
      });
    } catch (err) {
      // PDF generation error should not abort report creation
    }

    return report;
  }

  async generateAllReports(
    organizationId: string,
    periodMonth: number,
    periodYear: number,
    createdById?: string
  ): Promise<{ generatedCount: number; reports: ManagementReport[] }> {
    const landlords = await prisma.landlord.findMany({
      where: {
        organizationId,
        isActive: true,
        properties: { some: {} },
      },
    });

    const reports: ManagementReport[] = [];
    for (const landlord of landlords) {
      try {
        const report = await this.generateReport(
          organizationId,
          landlord.id,
          periodMonth,
          periodYear,
          {},
          createdById
        );
        reports.push(report);
      } catch (err) {
        // Skip on error
      }
    }

    return { generatedCount: reports.length, reports };
  }

  async getAllReports(
    organizationId: string,
    query: PaginationQuery & { landlordId?: string; periodMonth?: number; periodYear?: number; status?: string }
  ): Promise<{ data: any[]; meta: PaginationMeta }> {
    const { page, limit, landlordId, periodMonth, periodYear, status } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ManagementReportWhereInput = {
      organizationId,
      landlordId: landlordId || undefined,
      periodMonth: periodMonth ? Number(periodMonth) : undefined,
      periodYear: periodYear ? Number(periodYear) : undefined,
      status: status || undefined,
    };

    const [reports, total] = await Promise.all([
      prisma.managementReport.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
        include: {
          landlord: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              companyName: true,
              type: true,
              phone: true,
              email: true,
              managementFeeRate: true,
            },
          },
        },
      }),
      prisma.managementReport.count({ where }),
    ]);

    const formatted = reports.map((r) => {
      const landlordName = r.landlord.type === 'company' && r.landlord.companyName
        ? r.landlord.companyName
        : `${r.landlord.firstName || ''} ${r.landlord.lastName || ''}`.trim() || r.landlord.phone;

      return {
        id: r.id,
        reportNumber: r.reportNumber,
        landlordId: r.landlordId,
        landlordName,
        landlordPhone: r.landlord.phone,
        periodMonth: r.periodMonth,
        periodYear: r.periodYear,
        startDate: r.startDate,
        endDate: r.endDate,
        grossRentCollected: Number(r.grossRentCollected),
        managementFeeRate: Number(r.managementFeeRate),
        managementFees: Number(r.managementFees),
        feeTaxRate: Number(r.feeTaxRate),
        feeTaxAmount: Number(r.feeTaxAmount),
        maintenanceExpenses: Number(r.maintenanceExpenses),
        otherDeductions: Number(r.otherDeductions),
        netPayableToLandlord: Number(r.netPayableToLandlord),
        status: r.status,
        paymentDate: r.paymentDate,
        paymentReference: r.paymentReference,
        pdfUrl: r.pdfUrl,
        notes: r.notes,
        createdAt: r.createdAt,
      };
    });

    const meta = buildPaginationMeta(total, page, limit);
    return { data: formatted, meta };
  }

  async getReportById(id: string, organizationId: string): Promise<any> {
    const report = await prisma.managementReport.findFirst({
      where: { id, organizationId },
      include: {
        landlord: true,
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!report) {
      throw new NotFoundError('Compte-rendu de gestion introuvable.');
    }

    return report;
  }

  async updateReportStatus(
    id: string,
    organizationId: string,
    data: { status: 'draft' | 'validated' | 'paid_out'; paymentReference?: string | null; paymentDate?: string | null; notes?: string | null }
  ): Promise<ManagementReport> {
    await this.getReportById(id, organizationId);

    return prisma.managementReport.update({
      where: { id },
      data: {
        status: data.status,
        paymentReference: data.paymentReference !== undefined ? data.paymentReference : undefined,
        paymentDate: data.paymentDate ? new Date(data.paymentDate) : undefined,
        notes: data.notes !== undefined ? data.notes : undefined,
      },
    });
  }
}

export const managementReportsService = new ManagementReportsService();
