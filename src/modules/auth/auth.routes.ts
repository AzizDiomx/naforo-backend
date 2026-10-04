import { Router } from 'express';
import * as authController from './auth.controller';
import { validate } from '@/shared/middlewares/validate.middleware';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { auditLog } from '@/shared/middlewares/audit.middleware';
import {
  RegisterSchema,
  LoginSchema,
  RefreshTokenSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  VerifyEmailSchema,
  ChangePasswordSchema,
} from './auth.schema';

const router = Router();

router.post(
  '/register', 
  validate(RegisterSchema), 
  auditLog('REGISTER', 'User'),
  authController.register
);

router.post(
  '/login', 
  validate(LoginSchema), 
  auditLog('LOGIN', 'User'),
  authController.login
);

router.post(
  '/logout', 
  authenticate, 
  auditLog('LOGOUT', 'User'),
  authController.logout
);

router.post(
  '/refresh-token', 
  validate(RefreshTokenSchema), 
  authController.refreshTokens
);

router.post(
  '/forgot-password', 
  validate(ForgotPasswordSchema), 
  authController.forgotPassword
);

router.post(
  '/reset-password', 
  validate(ResetPasswordSchema), 
  auditLog('RESET_PASSWORD', 'User'),
  authController.resetPassword
);

router.post(
  '/verify-email', 
  validate(VerifyEmailSchema), 
  auditLog('VERIFY_EMAIL', 'User'),
  authController.verifyEmail
);

router.put(
  '/change-password',
  authenticate,
  validate(ChangePasswordSchema),
  auditLog('CHANGE_PASSWORD', 'User'),
  authController.changePassword
);

router.get(
  '/me', 
  authenticate, 
  authController.me
);

router.put(
  '/profile',
  authenticate,
  auditLog('UPDATE_PROFILE', 'User'),
  authController.updateProfile
);

export default router;
