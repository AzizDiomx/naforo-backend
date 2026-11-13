import { z } from 'zod';

export const CreateTenantProfileSchema = z.object({
  body: z.object({
    firstName: z.string({ required_error: 'Le prénom du locataire est obligatoire.' }).min(2, 'Le prénom doit contenir au moins 2 caractères.'),
    lastName: z.string({ required_error: 'Le nom du locataire est obligatoire.' }).min(2, 'Le nom doit contenir au moins 2 caractères.'),
    email: z.string().email('Format d\'adresse email invalide.').or(z.literal('')).optional().nullable().transform((v) => v || null),
    phone: z.string({ required_error: 'Le numéro de téléphone est obligatoire.' }).min(8, 'Le numéro de téléphone doit contenir au moins 8 chiffres.'),
    nationalId: z.string().optional().nullable().transform((v) => v || null),
    nationalIdType: z.string().optional().nullable().transform((v) => v || null),
    nationalIdDocUrl: z.string().optional().nullable().transform((v) => v || null),
    profession: z.string().optional().nullable().transform((v) => v || null),
    employer: z.string().optional().nullable().transform((v) => v || null),
    monthlyIncome: z.coerce.number().nonnegative('Les revenus mensuels doivent être un montant positif ou nul.').optional().nullable(),
    emergencyContactName: z.string().optional().nullable().transform((v) => v || null),
    emergencyContactPhone: z.string().optional().nullable().transform((v) => v || null),
    notes: z.string().optional().nullable().transform((v) => v || null),
    userId: z.string().uuid('Format d\'ID utilisateur lié invalide.').or(z.literal('')).optional().nullable().transform((v) => v || null),
    password: z.string().min(6, 'Le mot de passe doit contenir au moins 6 caractères.').or(z.literal('')).optional().nullable().transform((v) => v || null),
  }),
});

export const UpdateTenantProfileSchema = z.object({
  body: z.object({
    firstName: z.string().min(2, 'Le prénom doit contenir au moins 2 caractères.').optional(),
    lastName: z.string().min(2, 'Le nom doit contenir au moins 2 caractères.').optional(),
    email: z.string().email('Format d\'adresse email invalide.').or(z.literal('')).optional().nullable().transform((v) => v || null),
    phone: z.string().min(8, 'Le numéro de téléphone doit contenir au moins 8 chiffres.').optional(),
    nationalId: z.string().optional().nullable().transform((v) => v || null),
    nationalIdType: z.string().optional().nullable().transform((v) => v || null),
    nationalIdDocUrl: z.string().optional().nullable().transform((v) => v || null),
    profession: z.string().optional().nullable().transform((v) => v || null),
    employer: z.string().optional().nullable().transform((v) => v || null),
    monthlyIncome: z.coerce.number().nonnegative().optional().nullable(),
    emergencyContactName: z.string().optional().nullable().transform((v) => v || null),
    emergencyContactPhone: z.string().optional().nullable().transform((v) => v || null),
    notes: z.string().optional().nullable().transform((v) => v || null),
    userId: z.string().uuid().or(z.literal('')).optional().nullable().transform((v) => v || null),
  }),
});
