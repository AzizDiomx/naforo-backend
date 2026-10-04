import { Request } from 'express';
import { PaginationQuery, PaginationMeta } from '../types';

/**
 * Extract and validate pagination parameters from request query
 */
export function getPaginationParams(req: Request): PaginationQuery {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const search = (req.query.search as string) || undefined;
  const sortBy = (req.query.sortBy as string) || 'createdAt';
  const sortOrder = (req.query.sortOrder as string)?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  return {
    page: page > 0 ? page : 1,
    limit: limit > 0 && limit <= 100 ? limit : 10,
    search,
    sortBy,
    sortOrder,
  };
}

/**
 * Build pagination meta object
 */
export function buildPaginationMeta(
  total: number,
  page: number,
  limit: number
): PaginationMeta {
  const totalPages = Math.ceil(total / limit);
  const finalTotalPages = totalPages > 0 ? totalPages : 1;

  return {
    total,
    page,
    limit,
    totalPages: finalTotalPages,
    hasNextPage: page < finalTotalPages,
    hasPreviousPage: page > 1,
  };
}
