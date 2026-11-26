import { z } from 'zod';

export const CreatePlanSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Le nom est requis'),
    code: z.string().min(1, 'Le code est requis'),
    description: z.string().optional(),
    priceMonthlyXof: z.number().nonnegative('Le prix doit être positif ou nul'),
    yearlyDiscountPercent: z.number().int().min(0).max(100).default(20),
    maxProperties: z.number().int().nonnegative('La limite de biens doit être positive ou nulle'),
    maxLots: z.number().int().nonnegative('La limite de lots doit être positive ou nulle').default(1),
    maxTenants: z.number().int().nonnegative('La limite de locataires doit être positive ou nulle'),
    features: z.array(z.string()).default([]),
    isRecommended: z.boolean().default(false),
  }),
});

export const DeclareSubscriptionPaymentSchema = z.object({
  body: z.object({
    planId: z.string().uuid('L\'ID du forfait doit être un UUID valide'),
    billingCycle: z.enum(['monthly', 'yearly']),
    paymentMethod: z.enum(['orange_money', 'mtn_money', 'moov_money', 'wave', 'bank_transfer', 'cash', 'card', 'saspay']),
    transactionNumber: z.string().optional(),
    paymentDate: z.string().datetime()
      .or(z.string().refine(val => !isNaN(Date.parse(val)), { message: 'Date invalide' }))
      .transform(val => new Date(val)),
  }),
});

export const InitiateSaspayPaymentSchema = z.object({
  body: z.object({
    planId: z.string().uuid('L\'ID du forfait doit être un UUID valide'),
    billingCycle: z.enum(['monthly', 'yearly']),
    mode: z.enum(['checkout', 'softpay']).default('checkout'),
    // Champs optionnels requis uniquement pour le mode Softpay (Push direct Mobile Money)
    country: z.string().length(2, 'Code pays ISO sur 2 lettres requis (ex: CI, BJ, SN)').optional(),
    network: z.string().min(2, 'Opérateur Mobile Money requis (ex: wave_ci, orange_ci, mtn_ci)').optional(),
    phone: z.string().min(8, 'Numéro de téléphone Mobile Money invalide').optional(),
    returnUrl: z.string().url('URL de retour invalide').optional(),
  }).superRefine((val, ctx) => {
    if (val.mode === 'softpay') {
      if (!val.country) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['country'],
          message: 'Le code pays (ex: CI) est requis pour un paiement Softpay.',
        });
      }
      if (!val.network) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['network'],
          message: 'L’opérateur réseau (ex: wave_ci, orange_ci, mtn_ci) est requis pour Softpay.',
        });
      }
      if (!val.phone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['phone'],
          message: 'Le numéro Mobile Money du payeur est requis pour Softpay.',
        });
      }
    }
  }),
});

export const ValidateSubscriptionPaymentSchema = z.object({
  body: z.object({
    status: z.enum(['validated', 'rejected']),
    rejectionReason: z.string().optional(),
  }),
});
