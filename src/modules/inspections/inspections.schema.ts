import { z } from 'zod';

const RoomElementSchema = z.object({
  name: z.string().min(1, "Le nom de l'élément est obligatoire"),
  condition: z.enum(['neuf', 'bon', 'usage', 'mauvais']).default('bon'),
  comment: z.string().optional().nullable().transform((v) => v || null),
  photos: z.array(z.string()).optional().default([]),
});

const RoomDataSchema = z.object({
  roomName: z.string().min(1, 'Le nom de la pièce est obligatoire'),
  condition: z.enum(['neuf', 'bon', 'usage', 'mauvais']).default('bon'),
  elements: z.array(RoomElementSchema).default([]),
});

const MeterReadingsSchema = z.object({
  electricityMeterNumber: z.string().optional().nullable().transform((v) => v || null),
  electricityIndex: z.string().optional().nullable().transform((v) => v || null),
  waterMeterNumber: z.string().optional().nullable().transform((v) => v || null),
  waterIndex: z.string().optional().nullable().transform((v) => v || null),
  keysCount: z.union([z.number(), z.string()]).optional().nullable(),
  keysDetail: z.string().optional().nullable().transform((v) => v || null),
}).optional().nullable();

export const CreateInspectionSchema = z.object({
  body: z.object({
    propertyId: z.string().uuid('Identifiant du bien invalide'),
    contractId: z.string().uuid('Identifiant du contrat invalide').or(z.literal('')).optional().nullable().transform((v) => v || null),
    tenantProfileId: z.string().uuid('Identifiant du locataire invalide').or(z.literal('')).optional().nullable().transform((v) => v || null),
    type: z.enum(['entry', 'exit'], {
      required_error: "Le type d'état des lieux est requis (Entrée ou Sortie)",
    }),
    inspectionDate: z.string().optional().nullable(),
    inspectorName: z.string().optional().nullable().transform((v) => v || null),
    meterReadings: MeterReadingsSchema,
    roomsData: z.array(RoomDataSchema).min(1, 'Veuillez renseigner au moins une pièce ou espace inspecté'),
    generalObservations: z.string().optional().nullable().transform((v) => v || null),
    estimatedDeductionAmount: z.coerce.number().optional().nullable(),
    deductionDetails: z.string().optional().nullable().transform((v) => v || null),
  }),
});

export const UpdateInspectionSchema = z.object({
  body: z.object({
    propertyId: z.string().uuid().optional(),
    contractId: z.string().uuid().or(z.literal('')).optional().nullable().transform((v) => v || null),
    tenantProfileId: z.string().uuid().or(z.literal('')).optional().nullable().transform((v) => v || null),
    type: z.enum(['entry', 'exit']).optional(),
    status: z.enum(['draft', 'completed', 'signed']).optional(),
    inspectionDate: z.string().optional().nullable(),
    inspectorName: z.string().optional().nullable().transform((v) => v || null),
    meterReadings: MeterReadingsSchema,
    roomsData: z.array(RoomDataSchema).optional(),
    generalObservations: z.string().optional().nullable().transform((v) => v || null),
    estimatedDeductionAmount: z.coerce.number().optional().nullable(),
    deductionDetails: z.string().optional().nullable().transform((v) => v || null),
  }),
});

export const SignInspectionSchema = z.object({
  body: z.object({
    signerRole: z.enum(['inspector', 'tenant'], {
      required_error: 'Le rôle du signataire est obligatoire (Gestionnaire ou Locataire)',
    }),
    signature: z.string().min(1, 'La signature électronique manuscrite est requise'),
  }),
});
