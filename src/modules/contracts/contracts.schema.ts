import { z } from 'zod';

export const CreateContractSchema = z.object({
  body: z.object({
    propertyId: z.string({ required_error: 'Veuillez sélectionner un bien immobilier.' }).uuid('Format d\'ID du bien invalide.'),
    tenantProfileId: z.string({ required_error: 'Veuillez sélectionner un locataire.' }).uuid('Format d\'ID locataire invalide.'),
    ownerId: z.string().uuid('Format d\'ID propriétaire invalide.').optional().nullable(),
    startDate: z.string({ required_error: 'La date de début du bail est obligatoire.' }).transform((val) => new Date(val)),
    endDate: z.string().transform((val) => new Date(val)).optional().nullable(),
    rentAmount: z.number({ required_error: 'Le montant du loyer est obligatoire.' }).positive('Le loyer de base doit être un montant positif.'),
    chargesAmount: z.number().nonnegative('Le montant des charges ne peut pas être négatif.').default(0),
    depositAmount: z.number().nonnegative('Le dépôt de garantie ne peut pas être négatif.').default(0),
    cautionAmount: z.number().nonnegative('Le montant de la caution ne peut pas être négatif.').default(0),
    paymentDay: z.number().int().min(1, 'Le jour d\'échéance doit être compris entre 1 et 31.').max(31, 'Le jour d\'échéance doit être compris entre 1 et 31.').default(5),
    paymentReminderEnabled: z.boolean().default(true),
    notes: z.string().optional().nullable(),
  })
  .refine((data) => (data.depositAmount || data.cautionAmount || 0) <= 2 * data.rentAmount, {
    message: 'Conformément à la loi n° 2019-576, le dépôt de garantie ne peut pas excéder 2 mois de loyer hors charges.',
    path: ['depositAmount'],
  })
  .refine((data) => {
    if (!data.endDate) return true;
    return new Date(data.endDate) > new Date(data.startDate);
  }, {
    message: 'La date de fin de bail doit être postérieure à la date de début.',
    path: ['endDate'],
  }),
});

export const UpdateContractSchema = z.object({
  body: z.object({
    endDate: z.string().transform((val) => new Date(val)).optional().nullable(),
    rentAmount: z.number().positive('Le loyer de base doit être positif.').optional(),
    chargesAmount: z.number().nonnegative('Le montant des charges ne peut pas être négatif.').optional(),
    depositAmount: z.number().nonnegative('Le montant de la garantie ne peut pas être négatif.').optional(),
    cautionAmount: z.number().nonnegative('Le montant de la caution ne peut pas être négatif.').optional(),
    paymentDay: z.number().int().min(1, 'Le jour d\'échéance doit être compris entre 1 et 31.').max(31, 'Le jour d\'échéance doit être compris entre 1 et 31.').optional(),
    paymentReminderEnabled: z.boolean().optional(),
    notes: z.string().optional().nullable(),
    status: z.enum(['draft', 'active', 'expired', 'terminated', 'suspended'], {
      errorMap: () => ({ message: 'Le statut du contrat spécifié est invalide.' }),
    }).optional(),
  }),
});

export const TerminateContractSchema = z.object({
  body: z.object({
    terminationReason: z.string({ required_error: 'Le motif de résiliation est obligatoire.' }).min(3, 'Le motif de résiliation doit faire au moins 3 caractères.'),
    terminatedAt: z.string().transform((val) => new Date(val)).default(() => new Date().toISOString()),
  }),
});
