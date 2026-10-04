import { z } from 'zod';

export const CreateInvoiceSchema = z.object({
  body: z.object({
    contractId: z.string().uuid('Format d\'ID de contrat invalide.'),
    periodMonth: z.number().int().min(1).max(12, 'Le mois doit être compris entre 1 et 12.'),
    periodYear: z.number().int().min(2020, 'L\'année doit être valide.'),
    dueDate: z.string().transform((val) => new Date(val)),
    rentAmount: z.number().positive('Le montant du loyer doit être positif.'),
    chargesAmount: z.number().nonnegative().default(0),
    penaltyAmount: z.number().nonnegative().default(0),
  }),
});

export const UpdateInvoiceSchema = z.object({
  body: z.object({
    status: z.enum(['pending', 'partial', 'paid', 'overdue', 'cancelled']).optional(),
    penaltyAmount: z.number().nonnegative().optional(),
  }),
});
