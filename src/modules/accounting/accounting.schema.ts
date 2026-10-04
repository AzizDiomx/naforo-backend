import { z } from 'zod';

export const CreateExpenseSchema = z.object({
  propertyId: z.string().uuid().optional().or(z.literal('')).transform(val => val || undefined),
  contractId: z.string().uuid().optional().or(z.literal('')).transform(val => val || undefined),
  category: z.string().min(1, 'La catégorie est obligatoire'),
  subCategory: z.string().optional(),
  label: z.string().min(1, 'Le libellé est obligatoire'),
  amountXof: z.coerce.number().positive('Le montant doit être supérieur à 0'),
  transactionDate: z.coerce.date(),
  periodMonth: z.coerce.number().int().min(1).max(12),
  periodYear: z.coerce.number().int().min(2000).max(2100),
  paymentMethod: z.string().optional(),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const ReturnDepositSchema = z.object({
  amountReturnedXof: z.coerce.number().nonnegative('Le montant restitué doit être positif ou nul'),
  deductionAmountXof: z.coerce.number().nonnegative('La retenue doit être positive ou nulle').optional().default(0),
  deductionReason: z.string().optional(),
  returnedAt: z.coerce.date(),
});

export const ManualRateSchema = z.object({
  targetCurrency: z.enum(['USD', 'CAD']),
  rate: z.coerce.number().positive('Le taux de change doit être strictement supérieur à 0'),
});

export const TransactionQuerySchema = z.object({
  propertyId: z.string().uuid().optional().or(z.literal('')).transform(val => val || undefined),
  type: z.enum(['REVENUE', 'EXPENSE']).optional(),
  category: z.string().optional(),
  periodYear: z.string().transform(val => parseInt(val, 10)).optional(),
  periodMonth: z.string().transform(val => parseInt(val, 10)).optional(),
  page: z.string().transform(val => parseInt(val, 10)).optional().default('1'),
  limit: z.string().transform(val => parseInt(val, 10)).optional().default('20'),
});
