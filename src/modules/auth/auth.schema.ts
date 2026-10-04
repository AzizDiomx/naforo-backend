import { z } from 'zod';

export const RegisterSchema = z.object({
  body: z.object({
    firstName: z.string().min(2, 'Le prénom doit contenir au moins 2 caractères.'),
    lastName: z.string().min(2, 'Le nom doit contenir au moins 2 caractères.'),
    email: z.string().email('Format d\'adresse email invalide.'),
    phone: z.string().min(8, 'Le numéro de téléphone doit contenir au moins 8 chiffres.'),
    password: z
      .string()
      .min(8, 'Le mot de passe doit contenir au moins 8 caractères.')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/,
        'Le mot de passe doit inclure au moins une majuscule, une minuscule, un chiffre et un caractère spécial.'
      ),
    organizationName: z.string().optional(),
    role: z.enum(['admin', 'owner', 'manager', 'tenant']).default('owner'),
  }),
});

export const LoginSchema = z.object({
  body: z.object({
    email: z.string().email('Format d\'adresse email invalide.'),
    password: z.string().min(1, 'Le mot de passe est obligatoire.'),
  }),
});

export const RefreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Le token de rafraîchissement est obligatoire.'),
  }),
});

export const ForgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email('Format d\'adresse email invalide.'),
  }),
});

export const ResetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'Le code OTP est obligatoire.'),
    email: z.string().email('L\'adresse email est obligatoire.'),
    newPassword: z
      .string()
      .min(8, 'Le mot de passe doit contenir au moins 8 caractères.')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/,
        'Le mot de passe doit inclure au moins une majuscule, une minuscule, un chiffre et un caractère spécial.'
      ),
  }),
});

export const VerifyEmailSchema = z.object({
  body: z.object({
    email: z.string().email('L\'adresse email est obligatoire.'),
    token: z.string().length(6, 'Le code de vérification doit être composé de 6 chiffres.'),
  }),
});

export const ChangePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Le mot de passe actuel est obligatoire.'),
    newPassword: z
      .string()
      .min(8, 'Le nouveau mot de passe doit contenir au moins 8 caractères.')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/,
        'Le mot de passe doit inclure au moins une majuscule, une minuscule, un chiffre et un caractère spécial.'
      ),
  }),
});
