import { z } from 'zod';

export const CreatePropertySchema = z.object({
  body: z.object({
    name: z.string({ required_error: 'Le nom du bien est obligatoire.' }).min(2, 'Le nom du bien doit contenir au moins 2 caractères.'),
    type: z.enum(['building', 'residence', 'villa', 'apartment', 'shop', 'office', 'parking', 'lot'], {
      errorMap: () => ({ message: 'Veuillez sélectionner un type de bien valide.' }),
    }),
    address: z.string({ required_error: "L'adresse physique est obligatoire." }).min(3, "L'adresse physique doit contenir au moins 3 caractères."),
    city: z.string().min(2, 'Le nom de la ville est obligatoire.').default('Abidjan'),
    country: z.string().default('CI'),
    parentId: z.string().uuid('Format d\'ID parent invalide.').or(z.literal('')).optional().nullable().transform((v) => v || null),
    floor: z.coerce.number().int('L\'étage doit être un nombre entier.').optional().nullable(),
    areaSqm: z.coerce.number().positive('La surface doit être supérieure à 0.').optional().nullable(),
    rooms: z.coerce.number().int().nonnegative('Le nombre de pièces ne peut pas être négatif.').optional().nullable(),
    bathrooms: z.coerce.number().int().nonnegative('Le nombre de salles d\'eau ne peut pas être négatif.').optional().nullable(),
    description: z.string().optional().nullable().transform((v) => v || null),
    rentAmount: z.coerce.number().positive('Le loyer doit être un montant positif.').optional().nullable(),
    chargesAmount: z.coerce.number().nonnegative('Le montant des charges ne peut pas être négatif.').default(0),
    depositAmount: z.coerce.number().nonnegative('Le dépôt de garantie ne peut pas être négatif.').default(0),
    photos: z.array(z.string()).default([]),
    amenities: z.array(z.string()).default([]),
    managerId: z.string().uuid('Format d\'ID gérant invalide.').or(z.literal('')).optional().nullable().transform((v) => v || null),
  }),
});

export const UpdatePropertySchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Le nom du bien doit contenir au moins 2 caractères.').optional(),
    type: z.enum(['building', 'residence', 'villa', 'apartment', 'shop', 'office', 'parking', 'lot']).optional(),
    address: z.string().min(3, 'L\'adresse physique est obligatoire.').optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    parentId: z.string().uuid('Format d\'ID parent invalide.').or(z.literal('')).optional().nullable().transform((v) => v || null),
    managerId: z.string().uuid('Format d\'ID gérant invalide.').or(z.literal('')).optional().nullable().transform((v) => v || null),
    floor: z.coerce.number().int().optional().nullable(),
    areaSqm: z.coerce.number().positive().optional().nullable(),
    rooms: z.coerce.number().int().nonnegative().optional().nullable(),
    bathrooms: z.coerce.number().int().nonnegative().optional().nullable(),
    description: z.string().optional().nullable().transform((v) => v || null),
    rentAmount: z.coerce.number().positive('Le loyer doit être un montant positif.').optional().nullable(),
    chargesAmount: z.coerce.number().nonnegative().optional(),
    depositAmount: z.coerce.number().nonnegative().optional(),
    photos: z.array(z.string()).optional(),
    amenities: z.array(z.string()).optional(),
  }),
});

export const UpdatePropertyStatusSchema = z.object({
  body: z.object({
    status: z.enum(['available', 'occupied', 'maintenance', 'reserved']),
  }),
});
