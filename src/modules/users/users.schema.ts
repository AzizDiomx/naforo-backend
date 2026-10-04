import { z } from 'zod';

export const CreateUserSchema = z.object({
  body: z.object({
    firstName: z.string().min(2, 'Le prénom doit contenir au moins 2 caractères.'),
    lastName: z.string().min(2, 'Le nom doit contenir au moins 2 caractères.'),
    email: z.string().email('Format d\'adresse email invalide.'),
    phone: z.string().min(8, 'Le numéro de téléphone doit contenir au moins 8 chiffres.'),
    password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères.'),
    role: z.enum(['admin', 'manager', 'accountant', 'owner', 'tenant', 'technician']),
  }),
});

export const UpdateUserSchema = z.object({
  body: z.object({
    firstName: z.string().min(2, 'Le prénom doit contenir au moins 2 caractères.').optional(),
    lastName: z.string().min(2, 'Le nom doit contenir au moins 2 caractères.').optional(),
    phone: z.string().min(8, 'Le numéro de téléphone doit contenir au moins 8 chiffres.').optional(),
    avatarUrl: z.string().url('L\'URL de l\'avatar doit être valide.').optional().nullable(),
    isActive: z.boolean().optional(),
  }),
});

export const UpdateFCMTokenSchema = z.object({
  body: z.object({
    fcmToken: z.string().min(1, 'Le token FCM est obligatoire.'),
  }),
});
