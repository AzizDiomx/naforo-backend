import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { redis } from '@/config/redis';
import { logger } from '@/config/logger';
import { sendMail } from '@/config/mailer';
import { prisma } from '@/config/database';
import { authRepository } from './auth.repository';
import { generateOTP, hashToken } from '@/shared/helpers/crypto';
import { 
  BadRequestError, 
  ConflictError, 
  ForbiddenError,
  NotFoundError, 
  UnauthorizedError 
} from '@/shared/errors/AppError';
import { User, Organization } from '@prisma/client';
import { JwtPayload } from '@/shared/types';
import { recordSecurityAuditLog } from '@/shared/middlewares/audit.middleware';

export class AuthService {
  async register(data: any): Promise<{ user: User; organization: Organization | null; accessToken: string; refreshToken: string }> {
    const existingUser = await authRepository.findByEmail(data.email);
    if (existingUser) {
      throw new ConflictError('Cette adresse email est déjà utilisée.');
    }

    const salt = await bcrypt.genSalt(env.BCRYPT_ROUNDS);
    const passwordHash = await bcrypt.hash(data.password, salt);

    let organization: Organization | null = null;

    // Multi-tenant: Create organization if registering as Admin or Owner (Landlord)
    if (data.role === 'admin' || data.role === 'owner') {
      const orgName = data.organizationName && data.organizationName.trim() !== '' 
        ? data.organizationName.trim() 
        : `Gestion ${data.firstName} ${data.lastName}`;

      organization = await authRepository.createOrganization({
        name: orgName,
        email: data.email,
        phone: data.phone,
      });

      // Créer automatiquement l'abonnement starter gratuit de 60 jours pour l'organisation
      try {
        const { SubscriptionsService } = require('@/modules/subscriptions/subscriptions.service');
        const subscriptionsService = new SubscriptionsService();
        await subscriptionsService.createStarterSubscription(organization.id);
      } catch (err) {
        logger.error('Failed to create default starter subscription during registration', err);
        // Internal Notification for SuperAdmin
        try {
          await prisma.notification.create({
            data: {
              type: 'NEW_ORGANIZATION',
              title: '🏢 Nouvelle entreprise inscrite',
              message: `L'entreprise "${data.organizationName}" s'est inscrite sur Naforo. Administrateur: ${data.firstName} ${data.lastName} (${data.email}).`,
              channels: ['in_app'],
            },
          });
        } catch (e) {}
      }
    }

    // Create user
    const user = await authRepository.createUser({
      email: data.email,
      phone: data.phone,
      passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role,
      organizationId: organization?.id || null,
      isActive: true,
      isEmailVerified: false,
    });

    // Create notification preferences
    await authRepository.createNotificationPreferences(user.id);

    // Generate tokens
    const { accessToken, refreshToken } = this.generateTokens(user);

    // Save hashed refresh token to DB
    const refreshTokenHash = hashToken(refreshToken);
    await authRepository.updateUser(user.id, { refreshTokenHash });

    // Generate OTP for email verification
    const otp = generateOTP(6);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
    await authRepository.createOTP(user.id, otp, 'email_verification', expiresAt);

    // Send verification email
    sendMail(
      user.email,
      'Vérifiez votre adresse email - Naforo',
      `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #4f46e5;">Bienvenue sur Naforo !</h2>
        <p>Merci pour votre inscription. Veuillez utiliser le code OTP ci-dessous pour valider votre compte :</p>
        <div style="background-color: #f3f4f6; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 4px; border-radius: 6px; margin: 20px 0; color: #111827;">
          ${otp}
        </div>
        <p>Ce code est valide pendant 15 minutes.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #6b7280;">Si vous n'avez pas créé ce compte, veuillez ignorer cet email.</p>
      </div>`
    ).catch((err) => logger.error('Failed to send verification email during registration', err));

    return { user, organization, accessToken, refreshToken };
  }

  async login(data: any, clientIp?: string, userAgent?: string): Promise<{ user: User; accessToken: string; refreshToken: string }> {
    const user = await authRepository.findByEmail(data.email);
    if (!user) {
      recordSecurityAuditLog({
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'USER',
        details: { emailAttempted: data.email, reason: 'Utilisateur introuvable' },
        ipAddress: clientIp,
        userAgent: userAgent
      });
      throw new UnauthorizedError('Identifiants de connexion incorrects.');
    }

    if (!user.isActive) {
      recordSecurityAuditLog({
        action: 'AUTH_LOGIN_BLOCKED',
        userId: user.id,
        organizationId: user.organizationId,
        entityType: 'USER',
        details: { reason: 'Compte désactivé' },
        ipAddress: clientIp,
        userAgent: userAgent
      });
      throw new UnauthorizedError('Votre compte a été désactivé. Veuillez contacter le support.');
    }

    // Vérifier si l'organisation du tenant est désactivée pour défaut d'abonnement
    if (user.organizationId && user.role !== 'super_admin') {
      const org = await prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { isActive: true, name: true },
      });
      if (org && !org.isActive) {
        throw new ForbiddenError(
          "L'accès à votre compte est désactivé car l'abonnement de votre organisation a expiré depuis plus de 5 jours. Veuillez contacter le support pour régulariser votre compte."
        );
      }
    }

    const isPasswordValid = await bcrypt.compare(data.password, user.passwordHash);
    if (!isPasswordValid) {
      recordSecurityAuditLog({
        action: 'AUTH_LOGIN_FAILED',
        userId: user.id,
        organizationId: user.organizationId,
        entityType: 'USER',
        details: { reason: 'Mot de passe incorrect' },
        ipAddress: clientIp,
        userAgent: userAgent
      });
      throw new UnauthorizedError('Identifiants de connexion incorrects.');
    }

    // Record successful login audit log
    recordSecurityAuditLog({
      action: 'AUTH_LOGIN_SUCCESS',
      userId: user.id,
      organizationId: user.organizationId,
      entityType: 'USER',
      ipAddress: clientIp,
      userAgent: userAgent
    });

    // Generate tokens
    const { accessToken, refreshToken } = this.generateTokens(user);

    // Save hashed refresh token to DB
    const refreshTokenHash = hashToken(refreshToken);
    await authRepository.updateUser(user.id, { refreshTokenHash });

    // Update last login
    await authRepository.updateLastLogin(user.id);

    return { user, accessToken, refreshToken };
  }

  async logout(userId: string, token: string): Promise<void> {
    // 1. Blacklist the current access token in Redis
    // Set TTL equal to access token lifespan (15 mins)
    await redis.set(`blacklist:${token}`, '1', 'EX', 15 * 60);

    // 2. Remove refresh token hash from database
    await authRepository.updateUser(userId, { refreshTokenHash: null });
  }

  async refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as JwtPayload;
      const user = await authRepository.findById(decoded.userId);
      
      if (!user || !user.isActive) {
        throw new UnauthorizedError('Utilisateur invalide ou inactif.');
      }

      // Check refresh token validity by hashing and comparing with DB
      const currentHash = hashToken(refreshToken);
      if (user.refreshTokenHash !== currentHash) {
        throw new UnauthorizedError('Session expirée ou invalide. Veuillez vous reconnecter.');
      }

      // Generate new token pair
      const tokens = this.generateTokens(user);

      // Update refresh token hash
      const newHash = hashToken(tokens.refreshToken);
      await authRepository.updateUser(user.id, { refreshTokenHash: newHash });

      return tokens;
    } catch (error) {
      throw new UnauthorizedError('Session de rafraîchissement invalide.');
    }
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await authRepository.findByEmail(email);
    if (!user) {
      // Avoid revealing user exists, fail silently for security
      return;
    }

    const otp = generateOTP(6);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
    await authRepository.createOTP(user.id, otp, 'password_reset', expiresAt);

    logger.info(`🔑 [OTP MOT DE PASSE OUBLIÉ] Destinataire: ${user.email} | Code OTP: ${otp}`);

    // Send reset password OTP email via admin@naforo.company
    sendMail(
      user.email,
      'Réinitialisation de votre mot de passe - Naforo',
      `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #013E37;">Réinitialisation de mot de passe</h2>
        <p>Vous avez demandé la réinitialisation de votre mot de passe. Veuillez utiliser le code OTP ci-dessous pour procéder au changement :</p>
        <div style="background-color: #f8fafc; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 4px; border-radius: 6px; margin: 20px 0; color: #013E37; border: 1px solid #e2e8f0;">
          ${otp}
        </div>
        <p>Ce code expire dans 15 minutes.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #6b7280;">Si vous n'avez pas demandé ce changement, vous pouvez ignorer cet email en toute sécurité.</p>
      </div>`,
      undefined,
      undefined,
      'admin'
    ).catch((err) => logger.error('Failed to send forgot password email', err));
  }

  async resetPassword(data: any): Promise<void> {
    const otpRecord = await authRepository.findValidOTP(data.email, data.token, 'password_reset');
    if (!otpRecord) {
      throw new BadRequestError('Code OTP invalide, expiré ou déjà utilisé.');
    }

    const salt = await bcrypt.genSalt(env.BCRYPT_ROUNDS);
    const passwordHash = await bcrypt.hash(data.newPassword, salt);

    // Update password & clear session tokens
    await authRepository.updateUser(otpRecord.userId!, {
      passwordHash,
      refreshTokenHash: null,
    });

    // Mark OTP as used
    await authRepository.markOTPUsed(otpRecord.id);
  }

  async verifyEmail(data: any): Promise<void> {
    const otpRecord = await authRepository.findValidOTP(data.email, data.token, 'email_verification');
    if (!otpRecord) {
      throw new BadRequestError('Code de validation OTP invalide, expiré ou déjà utilisé.');
    }

    // Mark email as verified
    await authRepository.updateUser(otpRecord.userId!, {
      isEmailVerified: true,
    });

    // Mark OTP as used
    await authRepository.markOTPUsed(otpRecord.id);
  }

  async changePassword(userId: string, data: any): Promise<void> {
    const user = await authRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('Utilisateur introuvable.');
    }

    const isPasswordValid = await bcrypt.compare(data.currentPassword, user.passwordHash);
    if (!isPasswordValid) {
      throw new BadRequestError('Le mot de passe actuel saisi est incorrect.');
    }

    const salt = await bcrypt.genSalt(env.BCRYPT_ROUNDS);
    const passwordHash = await bcrypt.hash(data.newPassword, salt);

    await authRepository.updateUser(userId, { passwordHash });
  }

  async getFreshUser(userId: string): Promise<any> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        organization: true,
        notificationPreferences: true
      }
    });
    if (!user) {
      throw new NotFoundError('Utilisateur introuvable.');
    }
    // Ne pas renvoyer le hash du mot de passe
    const { passwordHash, refreshTokenHash, ...userWithoutSecrets } = user;
    return userWithoutSecrets;
  }

  async updateProfile(userId: string, data: any): Promise<any> {
    const user = await authRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('Utilisateur introuvable.');
    }

    // 1. Mettre à jour les informations de base de l'utilisateur
    const updatedUser = await authRepository.updateUser(userId, {
      firstName: data.firstName || user.firstName,
      lastName: data.lastName || user.lastName,
      phone: data.phone || user.phone,
    });

    // 2. Mettre à jour les préférences de notification
    if (data.preferences) {
      await prisma.notificationPreference.update({
        where: { userId },
        data: {
          emailEnabled: data.preferences.emailEnabled ?? true,
          smsEnabled: data.preferences.smsEnabled ?? false,
          pushEnabled: data.preferences.pushEnabled ?? true,
          reminderEnabled: data.preferences.reminderEnabled ?? true,
        }
      });
    }

    return this.getFreshUser(userId);
  }

  // ---------------------------------------------------------------------------
  // Token Generation Helper
  // ---------------------------------------------------------------------------
  private generateTokens(user: User): { accessToken: string; refreshToken: string } {
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };

    const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN as any,
    });

    const refreshToken = jwt.sign(
      { userId: user.id }, 
      env.JWT_REFRESH_SECRET, 
      { expiresIn: env.JWT_REFRESH_EXPIRES_IN as any }
    );

    return { accessToken, refreshToken };
  }
}

export const authService = new AuthService();


