import { locationsRepository } from './locations.repository';
import { Country, City } from '@prisma/client';

export class LocationsService {
  async getCountries(): Promise<(Country & { citiesCount: number })[]> {
    return locationsRepository.findCountries(true);
  }

  async getCities(countryIdOrCode?: string, search?: string): Promise<City[]> {
    return locationsRepository.findCities({
      countryIdOrCode,
      search,
      onlyActive: true,
    });
  }

  async getLocationsGrouped(): Promise<any[]> {
    return locationsRepository.getAllLocationsGrouped();
  }
}

export const locationsService = new LocationsService();
