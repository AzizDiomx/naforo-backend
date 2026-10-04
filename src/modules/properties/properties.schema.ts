import { z } from 'zod';

export const CreatePropertySchema = z.object({
  body: z.object({
    name: z.string({ required_error: 'Le nom du bien est obligatoire.' }).min(2, 'Le nom du bien doit contenir au moins 2 caractères.'),
    type: z.enum(['building', 'residence', 'villa', 'apartment', 'shop', 'office', 'parking'], {
      errorMap: () => ({ message: 'Veuillez sélectionner un type de bien valide.' }),
    }),
    address: z.string({ required_error: "L'adresse physique est obligatoire." }).min(3, "L'adresse physique doit contenir au moins 3 caractères."),
    city: z.string().min(2, 'Le nom de la ville est obligatoire.').default('Abidjan'),
    country: z.string().default('CI'),
    parentId: z.string().uuid('Format d\'ID parent invalide.').optional().nullable(),
    floor: z.number().int('L\'étage doit être un nombre entier.').optional().nullable(),
    areaSqm: z.number().positive('La surface doit être supérieure à 0.').optional().nullable(),
    rooms: z.number().int().positive('Le nombre de pièces doit être supérieur à 0.').optional().nullable(),
    bathrooms: z.number().int().positive('Le nombre de salles d\'eau doit être supérieur à 0.').optional().nullable(),
    description: z.string().optional().nullable(),
    rentAmount: z.number().positive('Le loyer doit être un montant positif.').optional().nullable(),
    chargesAmount: z.number().nonnegative('Le montant des charges ne peut pas être négatif.').default(0),
    depositAmount: z.number().nonnegative('Le dépôt de garantie ne peut pas être négatif.').default(0),
    photos: z.array(z.string().url()).default([]),
    amenities: z.array(z.string()).default([]),
  }),
});

export const UpdatePropertySchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Le nom du bien doit contenir au moins 2 caractères.').optional(),
    type: z.enum(['building', 'residence', 'villa', 'apartment', 'shop', 'office', 'parking']).optional(),
    address: z.string().min(3, 'L\'adresse physique est obligatoire.').optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    parentId: z.string().uuid('Format d\'ID parent invalide.').optional().nullable(),
    floor: z.number().int().optional().nullable(),
    areaSqm: z.number().positive().optional().nullable(),
    rooms: z.number().int().positive().optional().nullable(),
    bathrooms: z.number().int().positive().optional().nullable(),
    description: z.string().optional().nullable(),
    rentAmount: z.number().positive('Le loyer doit être un montant positif.').optional().nullable(),
    chargesAmount: z.number().nonnegative().optional(),
    depositAmount: z.number().nonnegative().optional(),
    photos: z.array(z.string().url()).optional(),
    amenities: z.array(z.string()).optional(),
  }),
});

export const UpdatePropertyStatusSchema = z.object({
  body: z.object({
    status: z.enum(['available', 'occupied', 'maintenance', 'reserved']),
  }),
});
