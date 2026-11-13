import { z } from 'zod';

export const CreateInvoiceSchema = z.object({
  body: z.object({
    contractId: z.string().uuid('Format d\'ID de contrat invalide.'),
    periodMonth: z.coerce.number().int().min(1).max(12, 'Le mois doit être compris entre 1 et 12.').optional(),
    month: z.coerce.number().int().min(1).max(12, 'Le mois doit être compris entre 1 et 12.').optional(),
    periodYear: z.coerce.number().int().min(2020, 'L\'année doit être valide.').optional(),
    year: z.coerce.number().int().min(2020, 'L\'année doit être valide.').optional(),
    dueDate: z.string().or(z.literal('')).optional().nullable()
      .refine((val) => !val || !isNaN(Date.parse(val)), { message: 'Date d\'échéance invalide.' })
      .transform((val) => (val && val !== '' ? new Date(val) : undefined)),
    rentAmount: z.coerce.number().positive('Le montant du loyer doit être positif.').optional(),
    chargesAmount: z.coerce.number().nonnegative().default(0),
    penaltyAmount: z.coerce.number().nonnegative().default(0),
  }),
});

export const UpdateInvoiceSchema = z.object({
  body: z.object({
    status: z.enum(['pending', 'partial', 'paid', 'overdue', 'cancelled']).optional(),
    penaltyAmount: z.coerce.number().nonnegative().optional(),
  }),
});
