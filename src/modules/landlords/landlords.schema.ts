import { z } from 'zod';

export const CreateLandlordSchema = z.object({
  body: z.object({
    type: z.enum(['individual', 'company']).default('individual'),
    firstName: z.string().optional().nullable().transform((v) => v || null),
    lastName: z.string().optional().nullable().transform((v) => v || null),
    companyName: z.string().optional().nullable().transform((v) => v || null),
    email: z.string().email('Format email invalide.').or(z.literal('')).optional().nullable().transform((v) => v || null),
    phone: z.string({ required_error: 'Numéro de téléphone requis.' }).min(4, 'Numéro de téléphone requis.'),
    address: z.string().optional().nullable().transform((v) => v || null),
    city: z.string().default('Abidjan'),
    idNumber: z.string().optional().nullable().transform((v) => v || null),
    bankName: z.string().optional().nullable().transform((v) => v || null),
    ibanOrRib: z.string().optional().nullable().transform((v) => v || null),
    mobileMoneyNumber: z.string().optional().nullable().transform((v) => v || null),
    managementFeeRate: z.coerce.number().min(0).max(100).default(8.0),
    feeTaxRate: z.coerce.number().min(0).max(100).default(0.0),
    notes: z.string().optional().nullable().transform((v) => v || null),
    propertyIds: z.array(z.string().uuid()).optional().default([]),
  }),
});

export const UpdateLandlordSchema = z.object({
  body: z.object({
    type: z.enum(['individual', 'company']).optional(),
    firstName: z.string().optional().nullable().transform((v) => v || null),
    lastName: z.string().optional().nullable().transform((v) => v || null),
    companyName: z.string().optional().nullable().transform((v) => v || null),
    email: z.string().email('Format email invalide.').or(z.literal('')).optional().nullable().transform((v) => v || null),
    phone: z.string().min(4).optional(),
    address: z.string().optional().nullable().transform((v) => v || null),
    city: z.string().optional(),
    idNumber: z.string().optional().nullable().transform((v) => v || null),
    bankName: z.string().optional().nullable().transform((v) => v || null),
    ibanOrRib: z.string().optional().nullable().transform((v) => v || null),
    mobileMoneyNumber: z.string().optional().nullable().transform((v) => v || null),
    managementFeeRate: z.coerce.number().min(0).max(100).optional(),
    feeTaxRate: z.coerce.number().min(0).max(100).optional(),
    notes: z.string().optional().nullable().transform((v) => v || null),
    isActive: z.boolean().optional(),
    propertyIds: z.array(z.string().uuid()).optional(),
  }),
});

export const AssignPropertiesSchema = z.object({
  body: z.object({
    propertyIds: z.array(z.string().uuid('Format d\'ID de bien invalide.')),
  }),
});
