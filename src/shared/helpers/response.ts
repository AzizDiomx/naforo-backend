import { Request, Response, NextFunction } from 'express';
import { PaginationMeta } from '../types';

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  errors?: any;
}

export interface ApiPaginatedResponse<T = any> {
  success: boolean;
  message?: string;
  data: T[];
  meta: PaginationMeta;
}

/**
 * Send a success response
 */
export function sendSuccess<T = any>(
  res: Response,
  data?: T,
  message?: string,
  statusCode = 200
): Response<ApiResponse<T>> {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

/**
 * Send an error response
 */
export function sendError(
  res: Response,
  message: string,
  statusCode = 500,
  errors?: any
): Response<ApiResponse<null>> {
  return res.status(statusCode).json({
    success: false,
    message,
    errors,
  });
}

/**
 * Send a paginated success response
 */
export function sendPaginated<T = any>(
  res: Response,
  data: T[],
  meta: PaginationMeta,
  message?: string
): Response<ApiPaginatedResponse<T>> {
  return res.status(200).json({
    success: true,
    message,
    data,
    meta,
  });
}

/**
 * Express async handler wrapper to catch and forward errors to error middleware
 */
export function asyncHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
