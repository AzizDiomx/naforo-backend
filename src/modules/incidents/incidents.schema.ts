import { z } from 'zod';

export const CreateIncidentSchema = z.object({
  body: z.object({
    propertyId: z.string().uuid("Veuillez sélectionner un bien immobilier valide."),
    tenantProfileId: z.string().uuid("Format d'identifiant locataire invalide.").or(z.literal('')).optional().nullable().transform((v) => v || null),
    type: z.enum(['leak', 'breakdown', 'ac', 'electricity', 'plumbing', 'security', 'other'], {
      errorMap: () => ({ message: "Veuillez sélectionner une catégorie d'incident valide." }),
    }),
    title: z.string().min(3, "Le titre de l'incident doit comporter au moins 3 caractères.").max(150, "Le titre ne peut pas dépasser 150 caractères."),
    description: z.string().min(5, "Veuillez fournir une description détaillée d'au moins 5 caractères.").or(z.literal('')).optional().nullable().transform((v) => v || null),
    priority: z.enum(['low', 'medium', 'high', 'urgent'], {
      errorMap: () => ({ message: "Veuillez sélectionner un niveau de priorité valide." }),
    }).default('medium'),
  }),
});

export const UpdateIncidentSchema = z.object({
  body: z.object({
    title: z.string().min(3, "Le titre doit comporter au moins 3 caractères.").max(150).optional(),
    description: z.string().optional().nullable().transform((v) => v || null),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    assignedTo: z.string().uuid("Identifiant de l'intervenant invalide.").or(z.literal('')).optional().nullable().transform((v) => v || null),
    status: z.enum(['open', 'in_progress', 'resolved', 'closed'], {
      errorMap: () => ({ message: "Statut d'incident invalide." }),
    }).optional(),
  }),
});

export const ResolveIncidentSchema = z.object({
  body: z.object({
    resolutionNotes: z.string().min(5, "Le rapport de résolution doit comporter au moins 5 caractères."),
    resolvedAt: z.union([z.string(), z.date()]).optional(),
  }),
});

export const SubmitQuoteSchema = z.object({
  body: z.object({
    estimatedCost: z.coerce.number().positive("Le montant du devis doit être supérieur à zéro."),
    quoteUrl: z.string().optional().nullable().transform((v) => v || null),
    description: z.string().optional().nullable().transform((v) => v || null),
  }),
});

export const ApproveExpenseSchema = z.object({
  body: z.object({
    approved: z.boolean(),
    actualCost: z.coerce.number().nonnegative().optional(),
    invoiceUrl: z.string().optional().nullable().transform((v) => v || null),
    rejectionReason: z.string().optional().nullable().transform((v) => v || null),
    isDeductibleFromCRG: z.boolean().default(true),
  }),
});

export const PayExpenseSchema = z.object({
  body: z.object({
    actualCost: z.coerce.number().positive().optional(),
    invoiceUrl: z.string().optional().nullable().transform((v) => v || null),
    notes: z.string().optional().nullable().transform((v) => v || null),
  }),
});
