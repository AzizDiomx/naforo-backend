import { z } from 'zod';

export const GenerateReportSchema = z.object({
  body: z.object({
    landlordId: z.string().uuid('Format d\'ID bailleur invalide.'),
    periodMonth: z.coerce.number().int().min(1).max(12).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    periodYear: z.coerce.number().int().min(2020).max(2050).optional(),
    year: z.coerce.number().int().min(2020).max(2050).optional(),
    otherDeductions: z.coerce.number().nonnegative().optional().default(0),
    notes: z.string().optional().nullable(),
  }),
});

export const GenerateAllReportsSchema = z.object({
  body: z.object({
    periodMonth: z.coerce.number().int().min(1).max(12).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    periodYear: z.coerce.number().int().min(2020).max(2050).optional(),
    year: z.coerce.number().int().min(2020).max(2050).optional(),
  }),
});

export const UpdateReportStatusSchema = z.object({
  body: z.object({
    status: z.enum(['draft', 'validated', 'paid_out', 'paid']),
    paymentReference: z.string().optional().nullable(),
    paymentRef: z.string().optional().nullable(),
    paymentDate: z.string().optional().nullable(),
    paidAt: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
});
