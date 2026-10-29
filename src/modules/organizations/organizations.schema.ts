import { z } from 'zod';

export const CreateOrganizationSchema = z.object({
  body: z.object({
    name: z.string().min(3, 'Le nom doit contenir au moins 3 caractères.'),
    email: z.string().email('Format d\'adresse email invalide.').optional().nullable(),
    phone: z.string().min(8, 'Le numéro de téléphone doit contenir au moins 8 chiffres.').optional().nullable(),
    address: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    country: z.string().max(5).default('CI'),
    plan: z.string().default('starter'),
    adminFirstName: z.string().optional().nullable(),
    adminLastName: z.string().optional().nullable(),
    adminEmail: z.string().email('Format d\'adresse email invalide.').optional().nullable(),
    adminPassword: z.string().min(6).optional().nullable(),
    sendCredentialsEmail: z.boolean().default(true),
  }),
});

export const UpdateOrganizationSchema = z.object({
  body: z.object({
    name: z.string().min(3, 'Le nom doit contenir au moins 3 caractères.').optional(),
    email: z.string().email('Format d\'adresse email invalide.').optional().nullable(),
    phone: z.string().min(8, 'Le numéro de téléphone doit contenir au moins 8 chiffres.').optional().nullable(),
    address: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    country: z.string().max(5).optional(),
    plan: z.string().optional(),
    logoUrl: z.string().url('L\'URL du logo doit être valide.').optional().nullable(),
    isActive: z.boolean().optional(),
    settings: z.record(z.any()).optional(),
  }),
});

export const UpdateBrandingSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    primaryColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Format hexadécimal de couleur invalide (ex: #013e37)').optional(),
    accentColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Format hexadécimal de couleur invalide (ex: #ffefb3)').optional(),
    rccm: z.string().optional().nullable(),
    taxNumber: z.string().optional().nullable(),
    licenseNumber: z.string().optional().nullable(),
    website: z.string().optional().nullable(),
    tagline: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    email: z.string().email('Format email invalide').optional().nullable(),
    address: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    whiteLabelEnabled: z.boolean().optional(),
  }),
});
