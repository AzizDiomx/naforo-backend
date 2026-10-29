import { z } from 'zod';

export const CreateLandlordSchema = z.object({
  body: z.object({
    type: z.enum(['individual', 'company']).default('individual'),
    firstName: z.string().optional().nullable(),
    lastName: z.string().optional().nullable(),
    companyName: z.string().optional().nullable(),
    email: z.string().email('Format email invalide.').optional().nullable(),
    phone: z.string().min(4, 'Numéro de téléphone requis.'),
    address: z.string().optional().nullable(),
    city: z.string().default('Abidjan'),
    idNumber: z.string().optional().nullable(),
    bankName: z.string().optional().nullable(),
    ibanOrRib: z.string().optional().nullable(),
    mobileMoneyNumber: z.string().optional().nullable(),
    managementFeeRate: z.number().min(0).max(100).default(8.0),
    feeTaxRate: z.number().min(0).max(100).default(0.0),
    notes: z.string().optional().nullable(),
    propertyIds: z.array(z.string().uuid()).optional().default([]),
  }),
});

export const UpdateLandlordSchema = z.object({
  body: z.object({
    type: z.enum(['individual', 'company']).optional(),
    firstName: z.string().optional().nullable(),
    lastName: z.string().optional().nullable(),
    companyName: z.string().optional().nullable(),
    email: z.string().email('Format email invalide.').optional().nullable(),
    phone: z.string().min(4).optional(),
    address: z.string().optional().nullable(),
    city: z.string().optional(),
    idNumber: z.string().optional().nullable(),
    bankName: z.string().optional().nullable(),
    ibanOrRib: z.string().optional().nullable(),
    mobileMoneyNumber: z.string().optional().nullable(),
    managementFeeRate: z.number().min(0).max(100).optional(),
    feeTaxRate: z.number().min(0).max(100).optional(),
    notes: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
    propertyIds: z.array(z.string().uuid()).optional(),
  }),
});

export const AssignPropertiesSchema = z.object({
  body: z.object({
    propertyIds: z.array(z.string().uuid('Format d\'ID de bien invalide.')),
  }),
});
