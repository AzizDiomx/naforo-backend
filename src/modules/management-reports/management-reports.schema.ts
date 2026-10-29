import { z } from 'zod';

export const GenerateReportSchema = z.object({
  body: z.object({
    landlordId: z.string().uuid('Format d\'ID bailleur invalide.'),
    periodMonth: z.number().int().min(1).max(12),
    periodYear: z.number().int().min(2020).max(2050),
    otherDeductions: z.number().nonnegative().optional().default(0),
    notes: z.string().optional().nullable(),
  }),
});

export const GenerateAllReportsSchema = z.object({
  body: z.object({
    periodMonth: z.number().int().min(1).max(12),
    periodYear: z.number().int().min(2020).max(2050),
  }),
});

export const UpdateReportStatusSchema = z.object({
  body: z.object({
    status: z.enum(['draft', 'validated', 'paid_out']),
    paymentReference: z.string().optional().nullable(),
    paymentDate: z.string().datetime().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
});
