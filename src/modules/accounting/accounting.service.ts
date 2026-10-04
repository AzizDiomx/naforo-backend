import { accountingRepository, convertAmountXof } from './accounting.repository';
import { prisma } from '@/config/database';
import { NotFoundError, ForbiddenError, BadRequestError } from '@/shared/errors/AppError';
import { logger } from '@/config/logger';
import ExcelJS from 'exceljs';

export class AccountingService {

  // ─── Transactions Comptables (Dépenses & Revenus) ──────────────────────────

  async createExpense(
    userId: string,
    organizationId: string,
    data: {
      propertyId?: string;
      contractId?: string;
      category: string;
      subCategory?: string;
      label: string;
      amountXof: number;
      transactionDate: Date;
      periodMonth: number;
      periodYear: number;
      paymentMethod?: string;
      referenceNumber?: string;
      documentUrl?: string;
      notes?: string;
    }
  ) {
    // 1. Validation de la propriété (si fournie)
    if (data.propertyId) {
      const property = await prisma.property.findUnique({
        where: { id: data.propertyId },
      });
      if (!property || property.organizationId !== organizationId) {
        throw new NotFoundError("La propriété sélectionnée n'existe pas ou n'appartient pas à cette organisation");
      }
    }

    // 2. Validation du contrat (si fourni)
    if (data.contractId) {
      const contract = await prisma.contract.findUnique({
        where: { id: data.contractId },
      });
      if (!contract || contract.organizationId !== organizationId) {
        throw new NotFoundError("Le contrat sélectionné n'existe pas ou n'appartient pas à cette organisation");
      }
    }

    logger.info(`[Accounting] Dépense de ${data.amountXof} FCFA créée manuellement par l'owner ${userId}`);

    const txn = await accountingRepository.createTransaction({
      ...data,
      organizationId,
      type: 'EXPENSE',
      createdBy: userId,
      isAutomatic: false,
    });

    const converted = await convertAmountXof(Number(txn.amountXof));
    return { ...txn, amountXof: Number(txn.amountXof), converted };
  }

  async integrateValidatedPayment(paymentId: string): Promise<void> {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { contract: true },
    });

    if (!payment || payment.status !== 'validated') {
      throw new BadRequestError("Seuls les paiements validés peuvent être comptabilisés");
    }

    // Évite les doublons d'écriture
    const existing = await prisma.accountingTransaction.findUnique({
      where: { paymentId },
    });
    if (existing) return;

    const invoice = payment.invoiceId 
      ? await prisma.invoice.findUnique({ where: { id: payment.invoiceId } })
      : null;

    logger.info(`[Accounting] Intégration automatique du paiement validé ${payment.paymentReference} en REVENUE`);

    await accountingRepository.createTransaction({
      organizationId: payment.organizationId,
      propertyId: invoice ? invoice.propertyId : payment.contract.propertyId,
      contractId: payment.contractId,
      paymentId: payment.id,
      type: 'REVENUE',
      category: 'loyer',
      subCategory: 'paiement_locataire',
      label: `Loyer reçu - Réf ${payment.paymentReference}`,
      amountXof: Number(payment.amount),
      transactionDate: payment.paymentDate,
      periodMonth: invoice ? invoice.periodMonth : new Date(payment.paymentDate).getMonth() + 1,
      periodYear: invoice ? invoice.periodYear : new Date(payment.paymentDate).getFullYear(),
      paymentMethod: payment.paymentMethod,
      referenceNumber: payment.transactionNumber || undefined,
      isAutomatic: true,
      createdBy: payment.validatedBy || 'system',
    });
  }

  async getTransactions(
    organizationId: string,
    filters: {
      propertyId?: string;
      type?: string;
      category?: string;
      periodYear?: number;
      periodMonth?: number;
      page?: number;
      limit?: number;
    }
  ) {
    const { total, items } = await accountingRepository.listTransactions({
      ...filters,
      organizationId,
    });

    const itemsWithConversion = await Promise.all(
      items.map(async item => {
        const converted = await convertAmountXof(Number(item.amountXof));
        return {
          ...item,
          amountXof: Number(item.amountXof),
          converted,
        };
      })
    );

    return {
      total,
      items: itemsWithConversion,
    };
  }

  async deleteTransaction(id: string, organizationId: string, userId: string) {
    // Seul le propriétaire peut supprimer une écriture non automatique
    const txn = await prisma.accountingTransaction.findFirst({
      where: { id, organizationId },
    });

    if (!txn) {
      throw new NotFoundError("Transaction introuvable");
    }

    if (txn.isAutomatic) {
      throw new ForbiddenError("Les écritures automatiques liées aux paiements ne peuvent pas être supprimées");
    }

    if (txn.createdBy !== userId) {
      throw new ForbiddenError("Seul le créateur de cette écriture peut la supprimer");
    }

    await accountingRepository.deleteTransaction(id, organizationId);
  }

  // ─── Compte de Résultat par Bien (P&L) ──────────────────────────────────────

  async getPropertyPnl(
    organizationId: string,
    propertyId: string,
    year: number,
    month?: number
  ) {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
    });

    if (!property || property.organizationId !== organizationId) {
      throw new NotFoundError("Propriété introuvable");
    }

    const pnl = await accountingRepository.getPnlByProperty(organizationId, propertyId, year, month);

    const [convertedRevenue, convertedExpense, convertedNet] = await Promise.all([
      convertAmountXof(pnl.totalRevenueXof),
      convertAmountXof(pnl.totalExpenseXof),
      convertAmountXof(pnl.netResultXof),
    ]);

    // Calcul de rendement théorique (par rapport à la valeur estimée ou au loyer attendu)
    let yieldPercentage = 0;
    if (property.rentAmount && Number(property.rentAmount) > 0) {
      const annualTargetRent = Number(property.rentAmount) * 12;
      const actualAnnualNet = month ? pnl.netResultXof * 12 : pnl.netResultXof;
      yieldPercentage = (actualAnnualNet / annualTargetRent) * 100;
    }

    return {
      ...pnl,
      yieldPercentage: Math.round(yieldPercentage * 100) / 100,
      converted: {
        totalRevenue: convertedRevenue,
        totalExpense: convertedExpense,
        netResult: convertedNet,
      },
    };
  }

  // ─── Dashboard Financier Consolidé ──────────────────────────────────────────

  async getFinancialDashboard(organizationId: string, year: number, month: number) {
    const dashboard = await accountingRepository.getGlobalDashboard(organizationId, year, month);

    const [convertedRevenue, convertedExpense, convertedNet] = await Promise.all([
      convertAmountXof(dashboard.totalRevenueXof),
      convertAmountXof(dashboard.totalExpenseXof),
      convertAmountXof(dashboard.netXof),
    ]);

    const breakdownWithConversion = await Promise.all(
      dashboard.breakdown.map(async b => {
        const converted = await convertAmountXof(b.amountXof);
        return {
          ...b,
          converted,
        };
      })
    );

    return {
      ...dashboard,
      breakdown: breakdownWithConversion,
      converted: {
        totalRevenue: convertedRevenue,
        totalExpense: convertedExpense,
        net: convertedNet,
      },
    };
  }

  // ─── Dépôts de Garantie ───────────────────────────────────────────────────

  async createDeposit(
    organizationId: string,
    contractId: string,
    data: {
      amountReceivedXof: number;
      receivedAt: Date;
      notes?: string;
    }
  ) {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
    });
    if (!contract || contract.organizationId !== organizationId) {
      throw new NotFoundError("Contrat introuvable");
    }

    const existing = await accountingRepository.getDepositByContract(contractId);
    if (existing) {
      throw new BadRequestError("Un dépôt de garantie existe déjà pour ce contrat");
    }

    return accountingRepository.createDeposit({
      organizationId,
      contractId,
      tenantProfileId: contract.tenantProfileId,
      amountReceivedXof: data.amountReceivedXof,
      receivedAt: data.receivedAt,
      notes: data.notes,
    });
  }

  async getDeposit(contractId: string, organizationId: string) {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
    });
    if (!contract || contract.organizationId !== organizationId) {
      throw new NotFoundError("Contrat introuvable");
    }

    const deposit = await accountingRepository.getDepositByContract(contractId);
    if (!deposit) {
      throw new NotFoundError("Aucun dépôt de garantie enregistré pour ce contrat");
    }

    const convertedReceived = await convertAmountXof(Number(deposit.amountReceivedXof));
    const convertedReturned = deposit.amountReturnedXof ? await convertAmountXof(Number(deposit.amountReturnedXof)) : null;
    const convertedDeduction = deposit.deductionAmountXof ? await convertAmountXof(Number(deposit.deductionAmountXof)) : null;

    return {
      ...deposit,
      amountReceivedXof: Number(deposit.amountReceivedXof),
      amountReturnedXof: deposit.amountReturnedXof ? Number(deposit.amountReturnedXof) : null,
      deductionAmountXof: deposit.deductionAmountXof ? Number(deposit.deductionAmountXof) : null,
      converted: {
        amountReceived: convertedReceived,
        amountReturned: convertedReturned,
        deductionAmount: convertedDeduction,
      },
    };
  }

  async processDepositReturn(
    contractId: string,
    organizationId: string,
    data: {
      amountReturnedXof: number;
      deductionAmountXof?: number;
      deductionReason?: string;
      deductionDocUrl?: string;
      returnedAt: Date;
    }
  ) {
    const deposit = await this.getDeposit(contractId, organizationId);

    const received = Number(deposit.amountReceivedXof);
    const returned = data.amountReturnedXof;
    const deduction = data.deductionAmountXof ?? 0;

    if (returned + deduction !== received) {
      throw new BadRequestError(
        `Le montant total (restitué : ${returned} + retenues : ${deduction} = ${returned + deduction}) doit être exactement égal au montant initial reçu (${received} FCFA)`
      );
    }

    const updated = await accountingRepository.returnDeposit(deposit.id, {
      amountReturnedXof: data.amountReturnedXof,
      deductionAmountXof: data.deductionAmountXof,
      deductionReason: data.deductionReason,
      deductionDocUrl: data.deductionDocUrl,
      returnedAt: data.returnedAt,
    });

    // Inscription automatique de la dépense/retenue en comptabilité si dégâts facturés
    if (deduction > 0) {
      const dep = deposit as any;
      await accountingRepository.createTransaction({
        organizationId,
        propertyId: dep.contract.propertyId,
        contractId,
        type: 'EXPENSE',
        category: 'reparation',
        subCategory: 'retenue_depot_garantie',
        label: `Retenue sur caution - Réf Bail ${dep.contract.contractNumber} (${data.deductionReason || 'Dégâts locatifs'})`,
        amountXof: deduction,
        transactionDate: data.returnedAt,
        periodMonth: data.returnedAt.getMonth() + 1,
        periodYear: data.returnedAt.getFullYear(),
        isAutomatic: true,
        createdBy: 'system',
      });
    }

    return updated;
  }

  // ─── Taux de change manuels ───────────────────────────────────────────────

  async updateManualRate(targetCurrency: 'USD' | 'CAD', rate: number) {
    await accountingRepository.setManualRate(targetCurrency, rate);
    logger.info(`[Accounting] Taux de change manuel mis à jour : 1 XOF = ${rate} ${targetCurrency}`);
  }

  // ─── Exportation Excel .xlsx ──────────────────────────────────────────────

  async exportFinancialReportToExcel(organizationId: string, yearInput?: number): Promise<Buffer> {
    const year = yearInput || new Date().getFullYear();
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });

    // Fetch transactions for the year
    const transactions = await prisma.accountingTransaction.findMany({
      where: {
        organizationId,
        periodYear: year,
      },
      include: {
        property: true,
        contract: { include: { tenantProfile: true } },
      },
      orderBy: { transactionDate: 'desc' },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Naforo SaaS';
    workbook.created = new Date();

    // ─── FEUILLE 1 : Bilan Synthetique (PnL) ──────────────────────────────
    const sheet1 = workbook.addWorksheet('Bilan Synthetique');

    // Title
    sheet1.mergeCells('A1:E1');
    const titleCell = sheet1.getCell('A1');
    titleCell.value = `BILAN FINANCIER & COMPTABILITÉ - ${org?.name || 'AGENCE'} (${year})`;
    titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

    // KPI Summary
    let totalIncome = 0;
    let totalExpense = 0;

    transactions.forEach(t => {
      const val = Number(t.amountXof);
      if (t.type === 'REVENUE' || t.type === 'INCOME') totalIncome += val;
      else if (t.type === 'EXPENSE') totalExpense += val;
    });

    const netResult = totalIncome - totalExpense;

    sheet1.addRow([]);
    sheet1.addRow(['INDICATEUR FINANCIER', 'MONTANT (FCFA)']);
    sheet1.addRow(['Total Revenus (Loyers Encaissés)', totalIncome]);
    sheet1.addRow(['Total Dépenses & Charges', totalExpense]);
    sheet1.addRow(['Résultat Net (Bénéfice / Perte)', netResult]);

    sheet1.getRow(3).font = { bold: true };
    sheet1.getRow(4).font = { bold: true, color: { argb: 'FF16A34A' } };
    sheet1.getRow(5).font = { bold: true, color: { argb: 'FFDC2626' } };
    sheet1.getRow(6).font = { bold: true, size: 12 };

    sheet1.addRow([]);
    sheet1.addRow(['MOIS', 'REVENUS (FCFA)', 'DÉPENSES (FCFA)', 'SOLDE NET (FCFA)']);
    sheet1.getRow(8).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet1.getRow(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };

    const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

    for (let m = 1; m <= 12; m++) {
      let mInc = 0;
      let mExp = 0;
      transactions.filter(t => t.periodMonth === m).forEach(t => {
        const v = Number(t.amountXof);
        if (t.type === 'REVENUE' || t.type === 'INCOME') mInc += v;
        else if (t.type === 'EXPENSE') mExp += v;
      });
      sheet1.addRow([monthNames[m - 1], mInc, mExp, mInc - mExp]);
    }

    // ─── FEUILLE 2 : Loyers Encaisses ───────────────────────────────────────
    const sheet2 = workbook.addWorksheet('Loyers Encaissés');
    sheet2.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Locataire', key: 'tenant', width: 25 },
      { header: 'Propriété / Logement', key: 'property', width: 25 },
      { header: 'Période', key: 'period', width: 14 },
      { header: 'Mode de Règlement', key: 'method', width: 20 },
      { header: 'Référence', key: 'ref', width: 20 },
      { header: 'Montant (FCFA)', key: 'amount', width: 18 },
    ];
    sheet2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } };

    transactions.filter(t => t.type === 'REVENUE' || t.type === 'INCOME').forEach(t => {
      sheet2.addRow({
        date: new Date(t.transactionDate).toLocaleDateString('fr-FR'),
        tenant: t.contract?.tenantProfile ? `${t.contract.tenantProfile.firstName} ${t.contract.tenantProfile.lastName}` : 'N/A',
        property: t.property?.name || 'Logement',
        period: `${t.periodMonth}/${t.periodYear}`,
        method: t.paymentMethod ? t.paymentMethod.toUpperCase() : 'ESPÈCES',
        ref: t.referenceNumber || 'N/A',
        amount: Number(t.amountXof),
      });
    });

    // ─── FEUILLE 3 : Depenses & Charges ─────────────────────────────────────
    const sheet3 = workbook.addWorksheet('Dépenses & Charges');
    sheet3.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Catégorie', key: 'cat', width: 20 },
      { header: 'Libellé / Description', key: 'label', width: 35 },
      { header: 'Propriété Concernée', key: 'property', width: 25 },
      { header: 'Période', key: 'period', width: 14 },
      { header: 'Montant (FCFA)', key: 'amount', width: 18 },
    ];
    sheet3.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };

    transactions.filter(t => t.type === 'EXPENSE').forEach(t => {
      sheet3.addRow({
        date: new Date(t.transactionDate).toLocaleDateString('fr-FR'),
        cat: t.category.toUpperCase(),
        label: t.label,
        property: t.property?.name || 'Toutes Propriétés',
        period: `${t.periodMonth}/${t.periodYear}`,
        amount: Number(t.amountXof),
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer as any);
  }
}

