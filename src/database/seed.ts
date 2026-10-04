import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';

dotenv.config();

import { prisma } from '@/config/database';
import { logger } from '@/config/logger';

async function seed(): Promise<void> {
  console.log('🌱 Naforo Database Seeder (Prisma)');
  console.log('============================');

  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD;

  if (!superAdminEmail || !superAdminPassword) {
    console.error('❌ SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set in .env');
    process.exit(1);
  }

  try {
    console.log('📡 Connected to database via Prisma');

    // 1. Create or get Subscription Plans (Starter, Pro / Sérénité, Expert / Agence)
    console.log('\n[1/3] Creating/Updating subscription plans matching landing page...');
    
    const plansData = [
      {
        code: 'starter',
        name: 'Starter',
        description: 'Formule Gratuite — Idéale pour démarrer (1 à 2 logements)',
        priceMonthlyXof: 0,
        maxProperties: 2,
        maxTenants: 2,
        features: JSON.stringify([
          'Suivi jusqu\'à 2 logements',
          'Relances Email automatiques',
          'Quittances PDF standard',
          'Support communautaire'
        ])
      },
      {
        code: 'pro',
        name: 'Pro / Sérénité',
        description: 'Formule Recommandée — Jusqu\'à 15 biens immobiliers',
        priceMonthlyXof: 19900,
        maxProperties: 15,
        maxTenants: 15,
        features: JSON.stringify([
          'Gestion jusqu\'à 15 logements',
          'Relances SMS & WhatsApp automatiques',
          'Encaissements Mobile Money (Wave, Orange, MTN, Moov)',
          'Quittances certifiées par QR Code infalsifiable',
          'Tchat locataire chiffré AES-256',
          'Coffre-fort GED & Exports comptables Excel'
        ])
      },
      {
        code: 'expert',
        name: 'Expert / Agence',
        description: 'Multi-Parcs & Agences Immobilières (Biens illimités)',
        priceMonthlyXof: 64900,
        maxProperties: 9999,
        maxTenants: 9999,
        features: JSON.stringify([
          'Logements & locataires illimités',
          'Multi-gestionnaires & permissions RBAC',
          'Gestion des mandats de gérance agence',
          'Exports comptables avancés DGI & bilans',
          'API d\'intégration & Webhooks',
          'Gestionnaire de compte dédié & SLA 99.9%'
        ])
      }
    ];

    const seededPlans: Record<string, any> = {};
    for (const planItem of plansData) {
      const plan = await prisma.subscriptionPlan.upsert({
        where: { code: planItem.code },
        update: planItem,
        create: planItem
      });
      seededPlans[planItem.code] = plan;
      console.log(`     ✅ Plan "${plan.name}" (Code: ${plan.code}) - ${plan.priceMonthlyXof} FCFA / m (Max Biens: ${plan.maxProperties})`);
    }

    // 2. Create or get demo organization
    console.log('\n[2/3] Creating/Verifying demo organization...');
    let organization = await prisma.organization.findUnique({
      where: { email: 'demo@naforo.ci' },
    });

    if (!organization) {
      organization = await prisma.organization.create({
        data: {
          name: 'Naforo Demo',
          email: 'demo@naforo.ci',
          phone: '+225 07 00 00 00 00',
          city: 'Abidjan',
          country: 'CI',
          plan: 'pro',
          isActive: true,
          settings: {
            currency: 'XOF',
            locale: 'fr-CI',
            timezone: 'Africa/Abidjan',
          },
        },
      });

      // Attach active subscription to Pro Plan
      const proPlan = seededPlans['pro'];
      if (proPlan) {
        await prisma.subscription.create({
          data: {
            organizationId: organization.id,
            planId: proPlan.id,
            startDate: new Date(),
            endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            status: 'active'
          }
        });
      }
      console.log(`     ✅ Organization created (id: ${organization.id}) with Pro Plan`);
    } else {
      console.log(`     ⚠️  Organization already exists (id: ${organization.id})`);
    }

    // 2. Create or get super_admin user
    console.log('\n[2/2] Creating/Verifying super_admin user...');
    let user = await prisma.user.findUnique({
      where: { email: superAdminEmail },
    });

    if (!user) {
      const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
      const passwordHash = await bcrypt.hash(superAdminPassword, rounds);

      user = await prisma.user.create({
        data: {
          organizationId: organization.id,
          email: superAdminEmail,
          passwordHash,
          firstName: 'Super',
          lastName: 'Admin',
          role: 'super_admin' as any,
          isActive: true,
          isEmailVerified: true,
        },
      });
      console.log(`     ✅ Super admin created (id: ${user.id})`);

      // Create default notification preferences
      await prisma.notificationPreference.create({
        data: {
          userId: user.id,
          emailEnabled: true,
          smsEnabled: false,
          pushEnabled: true,
        },
      });
      console.log(`     ✅ Notification preferences created`);
    } else {
      console.log(`     ⚠️  Super admin already exists (id: ${user.id})`);
    }

    console.log('\n========================================');
    console.log('🎉 Seed completed successfully!');
    console.log('========================================');
    console.log(`📌 Organization ID : ${organization.id}`);
    console.log(`📌 Super Admin ID  : ${user.id}`);
    console.log(`📌 Email           : ${superAdminEmail}`);
    console.log(`📌 Role            : super_admin`);
    console.log('========================================\n');
  } catch (error) {
    console.error('\n❌ Seed failed!');
    console.error('Error:', error instanceof Error ? error.message : error);
    logger.error('Seed failed', { error });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seed();

