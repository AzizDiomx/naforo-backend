// =============================================================================
// Naforo – Custom Error Classes
// =============================================================================

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public isOperational: boolean;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    // Capture stack trace (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// ---------------------------------------------------------------------------
// 400 Bad Request
// ---------------------------------------------------------------------------
export class BadRequestError extends AppError {
  public readonly errors?: any;

  constructor(message: string = 'Requête invalide', errors?: any) {
    super(message, 400, 'BAD_REQUEST');
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// 401 Unauthorized
// ---------------------------------------------------------------------------
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Authentification requise') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

// ---------------------------------------------------------------------------
// 403 Forbidden
// ---------------------------------------------------------------------------
export class ForbiddenError extends AppError {
  constructor(message: string = 'Accès refusé') {
    super(message, 403, 'FORBIDDEN');
  }
}

// ---------------------------------------------------------------------------
// 404 Not Found
// ---------------------------------------------------------------------------
export class NotFoundError extends AppError {
  constructor(message: string = 'Ressource introuvable') {
    super(message, 404, 'NOT_FOUND');
  }
}

// ---------------------------------------------------------------------------
// 409 Conflict
// ---------------------------------------------------------------------------
export class ConflictError extends AppError {
  public readonly errors?: any;

  constructor(message: string = 'Conflit de données', errors?: any) {
    super(message, 409, 'CONFLICT');
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// 422 Validation Error
// ---------------------------------------------------------------------------
export class ValidationError extends AppError {
  public readonly errors?: Record<string, string[]>;

  constructor(
    message: string = 'Données invalides',
    errors?: Record<string, string[]>
  ) {
    super(message, 422, 'VALIDATION_ERROR');
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// 500 Internal Server Error
// ---------------------------------------------------------------------------
export class InternalError extends AppError {
  constructor(message: string = 'Erreur interne du serveur') {
    super(message, 500, 'INTERNAL_ERROR');
    this.isOperational = false;
  }
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

