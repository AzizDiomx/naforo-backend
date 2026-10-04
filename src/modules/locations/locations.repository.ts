import { prisma } from '@/config/database';
import { Country, City } from '@prisma/client';

export class LocationsRepository {
  async findCountries(onlyActive = true): Promise<(Country & { citiesCount: number })[]> {
    const countries = await prisma.country.findMany({
      where: onlyActive ? { isActive: true } : undefined,
      orderBy: [
        { order: 'asc' },
        { name: 'asc' },
      ],
      include: {
        _count: {
          select: { cities: true },
        },
      },
    });

    return countries.map((c) => ({
      ...c,
      citiesCount: c._count.cities,
    }));
  }

  async findCountryByIdOrCode(idOrCode: string): Promise<Country | null> {
    return prisma.country.findFirst({
      where: {
        OR: [
          { id: idOrCode },
          { code: { equals: idOrCode, mode: 'insensitive' } },
          { name: { equals: idOrCode, mode: 'insensitive' } },
        ],
      },
    });
  }

  async findCities(params: {
    countryIdOrCode?: string;
    search?: string;
    onlyActive?: boolean;
  }): Promise<City[]> {
    const { countryIdOrCode, search, onlyActive = true } = params;

    let countryId: string | undefined;

    if (countryIdOrCode) {
      const country = await this.findCountryByIdOrCode(countryIdOrCode);
      if (country) {
        countryId = country.id;
      }
    }

    return prisma.city.findMany({
      where: {
        isActive: onlyActive ? true : undefined,
        countryId: countryId || undefined,
        name: search ? { contains: search, mode: 'insensitive' } : undefined,
      },
      orderBy: [
        { order: 'asc' },
        { name: 'asc' },
      ],
      include: {
        country: {
          select: {
            id: true,
            code: true,
            name: true,
            flag: true,
          },
        },
      },
    });
  }

  async getAllLocationsGrouped(): Promise<any[]> {
    return prisma.country.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      include: {
        cities: {
          where: { isActive: true },
          orderBy: [{ order: 'asc' }, { name: 'asc' }],
        },
      },
    });
  }
}

export const locationsRepository = new LocationsRepository();
