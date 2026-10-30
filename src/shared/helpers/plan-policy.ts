import { prisma } from '@/config/database';
import type { Subscription, SubscriptionPlan } from '@prisma/client';

/**
 * ============================================================================
 * POLITIQUE CENTRALE DES FORFAITS (Source unique de vérité)
 * ----------------------------------------------------------------------------
 * - Durée de l'essai Starter
 * - Distinction LOT / BIEN pour les quotas
 * - Catalogue des fonctionnalités par forfait
 * - Résolution du forfait actif d'une organisation
 * ============================================================================
 */

/** L'offre Starter est un essai gratuit limité à 3 mois calendaires. */
export const STARTER_TRIAL_MONTHS = 3;

/** Types de propriétés qui constituent un LOT (regroupement de biens). */
export const LOT_PROPERTY_TYPES = ['building', 'residence', 'lot'] as const;

/** Un 'bien' est toute unité locative autonome (appartement, villa, boutique, bureau, parking...). */
export function isLotType(type?: string | null): boolean {
  return !!type && (LOT_PROPERTY_TYPES as readonly string[]).includes(type);
}

/** Codes de fonctionnalités premium pilotées par le forfait. */
export const PLAN_FEATURE_CODES = {
  // Fonctionnalités historiques
  SMS_WHATSAPP: 'sms_whatsapp',
  EXCEL_EXPORT: 'excel_export',
  GED_VAULT: 'ged_vault',
  CHAT_ENCRYPTED: 'chat_encrypted',
  MULTI_USERS: 'multi_users',
  // Modules Entreprise / Expert
  MANAGERS_PORTFOLIO: 'managers_portfolio',
  LANDLORDS_CRG: 'landlords_crg',
  EXPENSE_WORKFLOW: 'expense_workflow',
  RISK_SCORING: 'risk_scoring',
  ADVANCED_STATS: 'advanced_stats',
  WHITE_LABEL: 'white_label',
  E_SIGNATURE: 'e_signature',
} as const;

export type PlanFeatureCode = (typeof PLAN_FEATURE_CODES)[keyof typeof PLAN_FEATURE_CODES];

/** Fonctionnalités incluses par défaut selon le code du forfait (utilisé pour la migration & le seed). */
export const DEFAULT_PLAN_FEATURES: Record<string, string[]> = {
  starter: ['dashboard', 'standard_pdf', 'email_reminders', 'incident_management'],
  pro: [
    'dashboard',
    'standard_pdf',
    'email_reminders',
    'incident_management',
    'sms_whatsapp',
    'mobile_money_autovalidate',
    'qr_code_verification',
    'excel_export',
    'ged_vault',
    'chat_encrypted',
    'expense_workflow',
    'risk_scoring',
    'advanced_stats',
  ],
  expert: [
    'dashboard',
    'standard_pdf',
    'email_reminders',
    'incident_management',
    'sms_whatsapp',
    'mobile_money_autovalidate',
    'qr_code_verification',
    'excel_export',
    'ged_vault',
    'chat_encrypted',
    'multi_users',
    'managers_portfolio',
    'landlords_crg',
    'expense_workflow',
    'risk_scoring',
    'advanced_stats',
    'white_label',
    'e_signature',
    'agency_mandates',
    'api_webhooks',
    'priority_support_sla',
  ],
};

/** Quotas par défaut selon le forfait. */
export const DEFAULT_PLAN_QUOTAS: Record<string, { maxProperties: number; maxLots: number; maxTenants: number }> = {
  starter: { maxProperties: 2, maxLots: 1, maxTenants: 2 },
  pro: { maxProperties: 15, maxLots: 5, maxTenants: 15 },
  expert: { maxProperties: 9999, maxLots: 9999, maxTenants: 9999 },
};

/** Ajoute des mois calendaires (gère les fins de mois : 31 nov → 30 nov). */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getDate();
  result.setMonth(result.getMonth() + months);
  if (result.getDate() < day) {
    result.setDate(0);
  }
  return result;
}

/** Date de fin de l'essai Starter (3 mois à partir de la date de départ). */
export function computeStarterTrialEnd(start: Date = new Date()): Date {
  return addMonths(start, STARTER_TRIAL_MONTHS);
}

/** Décode le champ JSON `features` d'un plan (tableau, chaîne JSON, ou null). */
export function parsePlanFeatures(raw: unknown): string[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Le forfait Expert / Agence inclut automatiquement l'ensemble des modules. */
export function planIncludesFeature(planCode: string | undefined | null, features: string[], featureCode: string): boolean {
  const code = (planCode || '').toLowerCase();
  if (code.includes('expert') || code.includes('agency')) return true;
  if (features.includes(featureCode)) return true;
  if (code.includes('pro') && DEFAULT_PLAN_FEATURES.pro.includes(featureCode)) return true;
  if (code.includes('starter') && DEFAULT_PLAN_FEATURES.starter.includes(featureCode)) return true;
  return false;
}

export interface OrganizationPlanContext {
  subscription: (Subscription & { plan: SubscriptionPlan }) | null;
  plan: SubscriptionPlan | null;
  planCode: string;
  planName: string;
  features: string[];
}

/** Résout le forfait (plan + features) actuellement associé à une organisation. */
export async function getOrganizationPlanContext(organizationId: string): Promise<OrganizationPlanContext> {
  const subscription = await prisma.subscription.findFirst({
    where: { organizationId },
    include: { plan: true },
    orderBy: { endDate: 'desc' },
  });

  let plan: SubscriptionPlan | null = subscription?.plan || null;
  if (!plan) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true },
    });
    plan = await prisma.subscriptionPlan.findUnique({ where: { code: org?.plan || 'starter' } });
  }

  return {
    subscription,
    plan,
    planCode: (plan?.code || 'starter').toLowerCase(),
    planName: plan?.name || 'Starter',
    features: parsePlanFeatures(plan?.features),
  };
}

/** Vérifie si l'organisation dispose d'une fonctionnalité donnée via son forfait. */
export async function organizationHasFeature(organizationId: string, featureCode: string): Promise<boolean> {
  const ctx = await getOrganizationPlanContext(organizationId);
  return planIncludesFeature(ctx.planCode, ctx.features, featureCode);
}

/** Consommation actuelle des quotas : lots, biens, locataires. */
export async function getOrganizationUsage(organizationId: string) {
  const [lots, properties, tenants] = await Promise.all([
    prisma.property.count({ where: { organizationId, type: { in: [...LOT_PROPERTY_TYPES] } } }),
    prisma.property.count({ where: { organizationId, type: { notIn: [...LOT_PROPERTY_TYPES] } } }),
    prisma.tenantProfile.count({ where: { organizationId, isActive: true } }),
  ]);
  return { lots, properties, tenants };
}
