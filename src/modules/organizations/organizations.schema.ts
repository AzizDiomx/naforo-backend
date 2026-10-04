import { z } from 'zod';

export const CreateOrganizationSchema = z.object({
  body: z.object({
    name: z.string().min(3, 'Le nom doit contenir au moins 3 caractères.'),
    email: z.string().email('Format d\'adresse email invalide.').optional().nullable(),
    phone: z.string().min(8, 'Le numéro de téléphone doit contenir au moins 8 chiffres.').optional().nullable(),
    address: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    country: z.string().max(3).default('CI'),
    plan: z.enum(['starter', 'pro', 'enterprise']).default('starter'),
  }),
});

export const UpdateOrganizationSchema = z.object({
  body: z.object({
    name: z.string().min(3, 'Le nom doit contenir au moins 3 caractères.').optional(),
    email: z.string().email('Format d\'adresse email invalide.').optional().nullable(),
    phone: z.string().min(8, 'Le numéro de téléphone doit contenir au moins 8 chiffres.').optional().nullable(),
    address: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    logoUrl: z.string().url('L\'URL du logo doit être valide.').optional().nullable(),
    isActive: z.boolean().optional(),
    settings: z.record(z.any()).optional(),
  }),
});
