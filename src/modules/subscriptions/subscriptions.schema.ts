import { z } from 'zod';

export const CreatePlanSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Le nom est requis'),
    code: z.string().min(1, 'Le code est requis'),
    description: z.string().optional(),
    priceMonthlyXof: z.number().nonnegative('Le prix doit être positif ou nul'),
    yearlyDiscountPercent: z.number().int().min(0).max(100).default(20),
    maxProperties: z.number().int().nonnegative('La limite de biens doit être positive ou nulle'),
    maxTenants: z.number().int().nonnegative('La limite de locataires doit être positive ou nulle'),
    features: z.array(z.string()).default([]),
    isRecommended: z.boolean().default(false),
  }),
});

export const DeclareSubscriptionPaymentSchema = z.object({
  body: z.object({
    planId: z.string().uuid('L\'ID du forfait doit être un UUID valide'),
    billingCycle: z.enum(['monthly', 'yearly']),
    paymentMethod: z.enum(['orange_money', 'mtn_money', 'moov_money', 'wave', 'bank_transfer', 'cash', 'card']),
    transactionNumber: z.string().optional(),
    paymentDate: z.string().datetime()
      .or(z.string().refine(val => !isNaN(Date.parse(val)), { message: 'Date invalide' }))
      .transform(val => new Date(val)),
  }),
});

export const ValidateSubscriptionPaymentSchema = z.object({
  body: z.object({
    status: z.enum(['validated', 'rejected']),
    rejectionReason: z.string().optional(),
  }),
});
