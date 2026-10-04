import { Request, Response } from 'express';
import { locationsService } from './locations.service';
import { sendSuccess, asyncHandler } from '@/shared/helpers/response';

export const locationsController = {
  getCountries: asyncHandler(async (req: Request, res: Response) => {
    const countries = await locationsService.getCountries();
    return sendSuccess(res, countries, 'Liste des pays récupérée avec succès');
  }),

  getCities: asyncHandler(async (req: Request, res: Response) => {
    const { countryId, countryCode, country, search } = req.query;
    const countryIdentifier = (countryId || countryCode || country) as string | undefined;

    const cities = await locationsService.getCities(countryIdentifier, search as string | undefined);
    return sendSuccess(res, cities, 'Liste des villes récupérée avec succès');
  }),

  getAllGrouped: asyncHandler(async (req: Request, res: Response) => {
    const data = await locationsService.getLocationsGrouped();
    return sendSuccess(res, data, 'Données géographiques groupées récupérées');
  }),
};
