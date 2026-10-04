import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@bailflow.ci';
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'BailflowSecure2026!';

  console.log('Seeding database...');

  // 1. Create default organization
  const organization = await prisma.organization.upsert({
    where: { email: 'demo@bailflow.ci' },
    update: {},
    create: {
      name: 'BAILFLOW Demo',
      email: 'demo@bailflow.ci',
      phone: '+2250700000000',
      address: 'Plateau, Abidjan',
      city: 'Abidjan',
      country: 'CI',
      plan: 'pro',
      isActive: true,
    },
  });

  console.log(`Created Organization: ${organization.name} (${organization.id})`);

  // Create or Update default plans matching landing page
  const starterPlan = await prisma.subscriptionPlan.upsert({
    where: { code: 'starter' },
    update: {
      name: 'Starter',
      description: 'Formule Gratuite — Idéale pour démarrer (1 à 2 logements)',
      priceMonthlyXof: 0,
      yearlyDiscountPercent: 0,
      maxProperties: 2,
      maxTenants: 2,
      features: ['email_reminders', 'standard_pdf', 'basic_support'],
      isRecommended: false,
    },
    create: {
      name: 'Starter',
      code: 'starter',
      description: 'Formule Gratuite — Idéale pour démarrer (1 à 2 logements)',
      priceMonthlyXof: 0,
      yearlyDiscountPercent: 0,
      maxProperties: 2,
      maxTenants: 2,
      features: ['email_reminders', 'standard_pdf', 'basic_support'],
      isRecommended: false,
    },
  });

  const proPlan = await prisma.subscriptionPlan.upsert({
    where: { code: 'pro' },
    update: {
      name: 'Pro / Sérénité',
      description: 'Formule Recommandée — Jusqu\'à 15 biens immobiliers',
      priceMonthlyXof: 24900,
      yearlyDiscountPercent: 20,
      maxProperties: 15,
      maxTenants: 15,
      features: ['email_reminders', 'sms_whatsapp', 'mobile_money_autovalidate', 'qr_code_verification', 'excel_export', 'ged_vault', 'chat_encrypted', 'incident_management'],
      isRecommended: true,
    },
    create: {
      name: 'Pro / Sérénité',
      code: 'pro',
      description: 'Formule Recommandée — Jusqu\'à 15 biens immobiliers',
      priceMonthlyXof: 24900,
      yearlyDiscountPercent: 20,
      maxProperties: 15,
      maxTenants: 15,
      features: ['email_reminders', 'sms_whatsapp', 'mobile_money_autovalidate', 'qr_code_verification', 'excel_export', 'ged_vault', 'chat_encrypted', 'incident_management'],
      isRecommended: true,
    },
  });

  const expertPlan = await prisma.subscriptionPlan.upsert({
    where: { code: 'expert' },
    update: {
      name: 'Expert / Agence',
      description: 'Multi-Parcs & Agences Immobilières (Biens illimités)',
      priceMonthlyXof: 79900,
      yearlyDiscountPercent: 20,
      maxProperties: 9999,
      maxTenants: 9999,
      features: ['email_reminders', 'sms_whatsapp', 'mobile_money_autovalidate', 'qr_code_verification', 'excel_export', 'ged_vault', 'chat_encrypted', 'incident_management', 'multi_users', 'agency_mandates', 'dgi_accounting_export', 'api_webhooks', 'priority_support_sla'],
      isRecommended: false,
    },
    create: {
      name: 'Expert / Agence',
      code: 'expert',
      description: 'Multi-Parcs & Agences Immobilières (Biens illimités)',
      priceMonthlyXof: 79900,
      yearlyDiscountPercent: 20,
      maxProperties: 9999,
      maxTenants: 9999,
      features: ['email_reminders', 'sms_whatsapp', 'mobile_money_autovalidate', 'qr_code_verification', 'excel_export', 'ged_vault', 'chat_encrypted', 'incident_management', 'multi_users', 'agency_mandates', 'dgi_accounting_export', 'api_webhooks', 'priority_support_sla'],
      isRecommended: false,
    },
  });

  // Create active subscription for the default organization
  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

  await prisma.subscription.upsert({
    where: { id: `sub-demo-active` }, // we can upsert by finding or creating
    update: {},
    create: {
      id: `sub-demo-active`,
      organizationId: organization.id,
      planId: proPlan.id,
      startDate: new Date(),
      endDate: oneYearFromNow,
      status: 'active',
    },
  });

  console.log('Seeded Subscription plans and organization active subscription.');

  // 2. Hash password for super_admin
  const salt = await bcrypt.genSalt(12);
  const passwordHash = await bcrypt.hash(superAdminPassword, salt);

  // 3. Create super_admin user
  const user = await prisma.user.upsert({
    where: { email: superAdminEmail },
    update: {
      passwordHash,
      organizationId: organization.id,
    },
    create: {
      email: superAdminEmail,
      firstName: 'Super',
      lastName: 'Admin',
      passwordHash,
      role: 'super_admin',
      isActive: true,
      isEmailVerified: true,
      organizationId: organization.id,
    },
  });

  console.log(`Created Super Admin User: ${user.firstName} ${user.lastName} (${user.email})`);

  // 4. Create default notification preferences for the user
  await prisma.notificationPreference.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      emailEnabled: true,
      smsEnabled: true,
      pushEnabled: true,
      reminderEnabled: true,
    },
  });

  console.log('Notification preferences created/updated.');

  // 5. Seed Countries and Cities (Données Géographiques Maîtres)
  console.log('Seeding Master Data: Countries & Cities...');
  const countriesData = [
    {
      code: 'CI',
      name: 'Côte d\'Ivoire',
      phoneCode: '+225',
      currency: 'XOF',
      flag: '🇨🇮',
      order: 1,
      cities: [
        'Abidjan', 'Bouaké', 'Yamoussoukro', 'San-Pédro', 'Daloa', 'Korhogo', 'Man', 
        'Gagnoa', 'Grand-Bassam', 'Assinie', 'Bingerville', 'Anyama', 'Dabou', 'Soubré', 'Divo'
      ]
    },
    {
      code: 'SN',
      name: 'Sénégal',
      phoneCode: '+221',
      currency: 'XOF',
      flag: '🇸🇳',
      order: 2,
      cities: ['Dakar', 'Thiès', 'Saint-Louis', 'Ziguinchor', 'Touba', 'Kaolack', 'Mbour', 'Rufisque', 'Diourbel']
    },
    {
      code: 'ML',
      name: 'Mali',
      phoneCode: '+223',
      currency: 'XOF',
      flag: '🇲🇱',
      order: 3,
      cities: ['Bamako', 'Sikasso', 'Mopti', 'Koutiala', 'Kayes', 'Ségou', 'Gao']
    },
    {
      code: 'BF',
      name: 'Burkina Faso',
      phoneCode: '+226',
      currency: 'XOF',
      flag: '🇧🇫',
      order: 4,
      cities: ['Ouagadougou', 'Bobo-Dioulasso', 'Koudougou', 'Banfora', 'Ouahigouya']
    },
    {
      code: 'GN',
      name: 'Guinée',
      phoneCode: '+224',
      currency: 'GNF',
      flag: '🇬🇳',
      order: 5,
      cities: ['Conakry', 'Kankan', 'Kindia', 'Labé', 'Nzérékoré', 'Boké']
    },
    {
      code: 'BJ',
      name: 'Bénin',
      phoneCode: '+229',
      currency: 'XOF',
      flag: '🇧🇯',
      order: 6,
      cities: ['Cotonou', 'Porto-Novo', 'Parakou', 'Abomey-Calavi', 'Djougou']
    },
    {
      code: 'TG',
      name: 'Togo',
      phoneCode: '+228',
      currency: 'XOF',
      flag: '🇹🇬',
      order: 7,
      cities: ['Lomé', 'Sokodé', 'Kara', 'Kpalimé', 'Atakpamé']
    },
    {
      code: 'CM',
      name: 'Cameroun',
      phoneCode: '+237',
      currency: 'XAF',
      flag: '🇨🇲',
      order: 8,
      cities: ['Douala', 'Yaoundé', 'Garoua', 'Bafoussam', 'Bamenda', 'Maroua']
    },
    {
      code: 'GA',
      name: 'Gabon',
      phoneCode: '+241',
      currency: 'XAF',
      flag: '🇬🇦',
      order: 9,
      cities: ['Libreville', 'Port-Gentil', 'Franceville', 'Oyem']
    },
    {
      code: 'CG',
      name: 'Congo',
      phoneCode: '+242',
      currency: 'XAF',
      flag: '🇨🇬',
      order: 10,
      cities: ['Brazzaville', 'Pointe-Noire', 'Dolisie']
    },
    {
      code: 'FR',
      name: 'France',
      phoneCode: '+33',
      currency: 'EUR',
      flag: '🇫🇷',
      order: 11,
      cities: ['Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Toulouse', 'Nice', 'Nantes', 'Strasbourg', 'Montpellier', 'Lille']
    }
  ];

  for (const c of countriesData) {
    const country = await prisma.country.upsert({
      where: { code: c.code },
      update: {
        name: c.name,
        phoneCode: c.phoneCode,
        currency: c.currency,
        flag: c.flag,
        order: c.order,
        isActive: true,
      },
      create: {
        code: c.code,
        name: c.name,
        phoneCode: c.phoneCode,
        currency: c.currency,
        flag: c.flag,
        order: c.order,
        isActive: true,
      }
    });

    for (let i = 0; i < c.cities.length; i++) {
      const cityName = c.cities[i];
      await prisma.city.upsert({
        where: {
          countryId_name: {
            countryId: country.id,
            name: cityName
          }
        },
        update: {
          order: i + 1,
          isActive: true
        },
        create: {
          name: cityName,
          countryId: country.id,
          order: i + 1,
          isActive: true
        }
      });
    }
  }

  console.log(`Seeded ${countriesData.length} countries and all their associated cities.`);
  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
