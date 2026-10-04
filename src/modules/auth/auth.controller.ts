import { Request, Response } from 'express';
import { authService } from './auth.service';
import { sendSuccess, asyncHandler } from '@/shared/helpers/response';

/**
 * Sanitize user object to omit sensitive password hashes
 */
function sanitizeUser(user: any) {
  const { passwordHash, refreshTokenHash, ...sanitized } = user;
  return sanitized;
}

/**
 * Helper to set HttpOnly cookies for session tokens
 */
function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000, // 15 min
  });
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
  });
}

function clearAuthCookies(res: Response) {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.register(req.body);
  setAuthCookies(res, result.accessToken, result.refreshToken);

  return sendSuccess(
    res,
    {
      user: sanitizeUser(result.user),
      organization: result.organization,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    },
    'Inscription réussie. Veuillez vérifier votre adresse email grâce au code OTP envoyé.',
    201
  );
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.ip;
  const userAgent = req.headers['user-agent'];
  const result = await authService.login(req.body, clientIp, userAgent);
  setAuthCookies(res, result.accessToken, result.refreshToken);

  return sendSuccess(
    res,
    {
      user: sanitizeUser(result.user),
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    },
    'Connexion réussie.'
  );
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  let token = req.cookies?.accessToken;
  if (!token && req.headers.authorization) {
    token = req.headers.authorization.split(' ')[1];
  }
  
  if (token) {
    await authService.logout(req.user!.userId, token);
  }
  
  clearAuthCookies(res);
  return sendSuccess(res, null, 'Déconnexion réussie.');
});

export const refreshTokens = asyncHandler(async (req: Request, res: Response) => {
  const refreshTokenInput = req.body.refreshToken || req.cookies?.refreshToken;
  const result = await authService.refreshTokens(refreshTokenInput);
  setAuthCookies(res, result.accessToken, result.refreshToken);

  return sendSuccess(res, result, 'Tokens rafraîchis avec succès.');
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.forgotPassword(req.body.email);
  
  return sendSuccess(
    res,
    null,
    'Si un compte existe pour cet e-mail, un code OTP de réinitialisation vous a été envoyé.'
  );
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.resetPassword(req.body);
  
  return sendSuccess(res, null, 'Votre mot de passe a été réinitialisé avec succès.');
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  await authService.verifyEmail(req.body);
  
  return sendSuccess(res, null, 'Votre adresse email a été validée avec succès.');
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.changePassword(req.user!.userId, req.body);
  
  return sendSuccess(res, null, 'Votre mot de passe a été modifié avec succès.');
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.getFreshUser(req.user!.userId);
  return sendSuccess(res, { user }, 'Profil récupéré.');
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.updateProfile(req.user!.userId, req.body);
  return sendSuccess(res, { user }, 'Votre profil a été mis à jour avec succès.');
});
