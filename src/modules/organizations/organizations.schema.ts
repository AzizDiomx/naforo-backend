import { z } from 'zod';

export const CreateOrganizationSchema = z.object({
  body: z.object({
    name: z.string().min(3, 'Le nom doit contenir au moins 3 caractères.'),
    email: z.string().email('Format d\'adresse email invalide.').or(z.literal('')).optional().nullable().transform((v) => v || null),
    phone: z.string().min(8, 'Le numéro de téléphone doit contenir au moins 8 chiffres.').or(z.literal('')).optional().nullable().transform((v) => v || null),
    address: z.string().optional().nullable().transform((v) => v || null),
    city: z.string().optional().nullable().transform((v) => v || 'Abidjan'),
    country: z.string().max(5).default('CI'),
    plan: z.string().default('starter'),
    adminFirstName: z.string().optional().nullable().transform((v) => v || null),
    adminLastName: z.string().optional().nullable().transform((v) => v || null),
    adminEmail: z.string().email('Format d\'adresse email invalide.').or(z.literal('')).optional().nullable().transform((v) => v || null),
    adminPassword: z.string().min(6).optional().nullable(),
    sendCredentialsEmail: z.boolean().default(true),
  }),
});

export const UpdateOrganizationSchema = z.object({
  body: z.object({
    name: z.string().min(3, 'Le nom doit contenir au moins 3 caractères.').optional(),
    email: z.string().email('Format d\'adresse email invalide.').or(z.literal('')).optional().nullable().transform((v) => v || null),
    phone: z.string().min(8, 'Le numéro de téléphone doit contenir au moins 8 chiffres.').or(z.literal('')).optional().nullable().transform((v) => v || null),
    address: z.string().optional().nullable().transform((v) => v || null),
    city: z.string().optional().nullable(),
    country: z.string().max(5).optional(),
    plan: z.string().optional(),
    logoUrl: z.string().optional().nullable().transform((v) => v || null),
    isActive: z.boolean().optional(),
    settings: z.record(z.any()).optional(),
  }),
});

export const UpdateBrandingSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Le nom de marque doit comporter au moins 2 caractères.').optional(),
    primaryColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Format hexadécimal de couleur invalide (ex: #013e37)').optional(),
    accentColor: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Format hexadécimal de couleur invalide (ex: #ffefb3)').optional(),
    rccm: z.string().optional().nullable().transform((v) => v || null),
    taxNumber: z.string().optional().nullable().transform((v) => v || null),
    licenseNumber: z.string().optional().nullable().transform((v) => v || null),
    website: z.string().optional().nullable().transform((v) => v || null),
    tagline: z.string().optional().nullable().transform((v) => v || null),
    phone: z.string().optional().nullable().transform((v) => v || null),
    email: z.string().email('Format email invalide.').or(z.literal('')).optional().nullable().transform((v) => v || null),
    address: z.string().optional().nullable().transform((v) => v || null),
    city: z.string().optional().nullable().transform((v) => v || null),
    whiteLabelEnabled: z.boolean().optional(),
    logoUrl: z.string().optional().nullable().transform((v) => v || null),
    stampUrl: z.string().optional().nullable().transform((v) => v || null),
  }),
});
