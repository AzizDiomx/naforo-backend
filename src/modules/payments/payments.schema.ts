import { z } from 'zod';

export const DeclarePaymentSchema = z.object({
  body: z.object({
    invoiceId: z.string().uuid('Format d\'ID de facture invalide.').optional().nullable(),
    contractId: z.string().uuid('Format d\'ID de contrat invalide.'),
    amount: z.number().positive('Le montant doit être supérieur à 0.'),
    paymentMethod: z.enum([
      'orange_money',
      'mtn_money',
      'moov_money',
      'wave',
      'bank_transfer',
      'cash',
      'card',
    ]),
    transactionNumber: z.string().optional().nullable(),
    paymentDate: z.string().transform((val) => new Date(val)),
    comment: z.string().optional().nullable(),
  }),
});

export const ValidatePaymentSchema = z.object({
  body: z.object({
    status: z.enum(['validated', 'rejected', 'complement_requested']),
    rejectionReason: z.string().optional().nullable(),
    complementMessage: z.string().optional().nullable(),
  }),
});
