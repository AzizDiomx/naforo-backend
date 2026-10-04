import { z } from 'zod';

export const CreateTenantProfileSchema = z.object({
  body: z.object({
    firstName: z.string({ required_error: 'Le prénom du locataire est obligatoire.' }).min(2, 'Le prénom doit contenir au moins 2 caractères.'),
    lastName: z.string({ required_error: 'Le nom du locataire est obligatoire.' }).min(2, 'Le nom doit contenir au moins 2 caractères.'),
    email: z.string().email('Format d\'adresse email invalide.').optional().nullable(),
    phone: z.string({ required_error: 'Le numéro de téléphone est obligatoire.' }).min(8, 'Le numéro de téléphone doit contenir au moins 8 chiffres.'),
    nationalId: z.string().optional().nullable(),
    profession: z.string().optional().nullable(),
    employer: z.string().optional().nullable(),
    monthlyIncome: z.number().positive('Les revenus mensuels doivent être un montant positif.').optional().nullable(),
    emergencyContactName: z.string().optional().nullable(),
    emergencyContactPhone: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    userId: z.string().uuid('Format d\'ID utilisateur lié invalide.').optional().nullable(),
    password: z.string().min(6, 'Le mot de passe doit contenir au moins 6 caractères.').optional().nullable(),
  }),
});

export const UpdateTenantProfileSchema = z.object({
  body: z.object({
    firstName: z.string().min(2, 'Le prénom doit contenir au moins 2 caractères.').optional(),
    lastName: z.string().min(2, 'Le nom doit contenir au moins 2 caractères.').optional(),
    email: z.string().email('Format d\'adresse email invalide.').optional().nullable(),
    phone: z.string().min(8, 'Le numéro de téléphone doit contenir au moins 8 chiffres.').optional(),
    nationalId: z.string().optional().nullable(),
    profession: z.string().optional().nullable(),
    employer: z.string().optional().nullable(),
    monthlyIncome: z.number().positive().optional().nullable(),
    emergencyContactName: z.string().optional().nullable(),
    emergencyContactPhone: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    userId: z.string().uuid().optional().nullable(),
  }),
});
