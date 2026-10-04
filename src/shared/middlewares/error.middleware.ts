import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError';
import { sendError } from '../helpers/response';
import { logger } from '@/config/logger';

export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Log critical/unknown errors
  const isOperational = err instanceof AppError;
  
  if (!isOperational) {
    logger.error('Unhandled Exception occurred', {
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });
  } else {
    logger.warn(`AppError: ${err.message}`, {
      statusCode: (err as AppError).statusCode,
      path: req.path,
    });
  }

  // 1. Zod Validation Error
  if (err instanceof ZodError) {
    const formattedErrors = err.errors.map((e) => {
      const parts = [...e.path];
      if (parts[0] === 'body' || parts[0] === 'query' || parts[0] === 'params') {
        parts.shift();
      }
      return {
        field: parts.join('.') || String(e.path[0] || 'champ'),
        message: e.message,
      };
    });
    const summary = formattedErrors.length === 1
      ? formattedErrors[0].message
      : `Erreur de validation : ${formattedErrors.map((fe) => fe.message).join(' • ')}`;
    sendError(res, summary, 422, formattedErrors);
    return;
  }

  // 2. Custom AppError (operational)
  if (err instanceof AppError) {
    sendError(res, err.message, err.statusCode, (err as any).errors);
    return;
  }

  // 3. Prisma Client Errors
  // Check prisma error code (usually present on PrismaClientKnownRequestError)
  const prismaErr = err as any;
  if (prismaErr.code) {
    switch (prismaErr.code) {
      case 'P2002': {
        const target = Array.isArray(prismaErr.meta?.target) ? prismaErr.meta.target : [];
        let specificMessage = 'Une ressource avec ces données existe déjà.';
        const fieldErrors: { field: string; message: string }[] = [];

        if (target.includes('name')) {
          specificMessage = 'Un bien portant ce libellé existe déjà dans votre patrimoine.';
          fieldErrors.push({ field: 'name', message: specificMessage });
        } else if (target.includes('email')) {
          specificMessage = 'Cette adresse email est déjà utilisée.';
          fieldErrors.push({ field: 'email', message: specificMessage });
        } else if (target.includes('phone')) {
          specificMessage = 'Ce numéro de téléphone est déjà associé à un autre dossier.';
          fieldErrors.push({ field: 'phone', message: specificMessage });
        } else if (target.includes('contract_number') || target.includes('contractNumber')) {
          specificMessage = 'Ce numéro de contrat existe déjà.';
          fieldErrors.push({ field: 'contractNumber', message: specificMessage });
        } else if (target.length > 0) {
          specificMessage = `Le champ ${target.join(', ')} doit être unique et existe déjà.`;
          target.forEach((f: string) => fieldErrors.push({ field: f, message: specificMessage }));
        }

        sendError(res, specificMessage, 409, fieldErrors.length > 0 ? fieldErrors : undefined);
        return;
      }
      case 'P2003': {
        sendError(res, 'Violation de contrainte d\'intégrité : référence liée invalide.', 400);
        return;
      }
      case 'P2025': {
        sendError(res, 'Ressource introuvable ou déjà supprimée.', 404);
        return;
      }
      default:
        break;
    }
  }

  // 4. JWT JsonWebTokenError
  if (err.name === 'JsonWebTokenError') {
    sendError(res, 'Token invalide.', 401);
    return;
  }
  if (err.name === 'TokenExpiredError') {
    sendError(res, 'Le token a expiré.', 401);
    return;
  }

  // 5. Catch-all for 500 Internal Server Errors
  const responseMessage =
    process.env.NODE_ENV === 'production'
      ? 'Une erreur interne est survenue sur le serveur.'
      : err.message;

  sendError(res, responseMessage, 500);
}
