/**
 * Suite de tests automatisés — Intégration Agrégateur SasPay (https://docs.saspay.me/)
 * Exécution : npx ts-node -r tsconfig-paths/register src/modules/subscriptions/__tests__/saspay.integration.test.ts
 */
import assert from 'assert';
import crypto from 'crypto';

// Injecter les variables de test AVANT de charger env.ts
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test_access_secret_key_for_saspay_suite_123456';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret_key_for_saspay_suite_123456';
process.env.SASPAY_API_URL = 'https://api.saspay.me/api/v1';
process.env.SASPAY_SECRET_KEY = 'sk_test_naforo_unit_testing_key_001';
process.env.SASPAY_WEBHOOK_SECRET = 'whsec_naforo_unit_testing_secret_001';
process.env.SASPAY_WEBHOOK_TOLERANCE_SECONDS = '300';

import {
  formatSaspayAmount,
  mapSaspayStatus,
  parseWebhookTimestampMs,
  verifySaspayWebhookSignature,
  saspayClient,
} from '../saspay.client';
import { SubscriptionsService } from '../subscriptions.service';
import { subscriptionsRepository } from '../subscriptions.repository';
import { prisma } from '@/config/database';
import * as mailer from '@/config/mailer';
import * as pdfGen from '../pdf.generator';
import * as accountingRepo from '@/modules/accounting/accounting.repository';

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed += 1;
    console.error(`  ❌ ${name}`);
    console.error(`     ${err?.stack || err}`);
  }
}

function signWebhook(rawBody: string, timestamp: string, secret = process.env.SASPAY_WEBHOOK_SECRET!) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

async function main() {
  console.log('\n🧪 Tests SasPay — Client, Sécurité Webhook & Cycle Abonnement Naforo\n');

  // ---------------------------------------------------------------------------
  // 1. Helpers purs
  // ---------------------------------------------------------------------------
  await runTest('formatSaspayAmount formate correctement en chaîne décimale 2 décimales', () => {
    assert.strictEqual(formatSaspayAmount(24900), '24900.00');
    assert.strictEqual(formatSaspayAmount(239040), '239040.00');
    assert.strictEqual(formatSaspayAmount(79900), '79900.00');
    assert.throws(() => formatSaspayAmount(0));
    assert.throws(() => formatSaspayAmount(-500));
  });

  await runTest('mapSaspayStatus normalise tous les statuts passerelle', () => {
    assert.strictEqual(mapSaspayStatus('SUCCESS'), 'success');
    assert.strictEqual(mapSaspayStatus('completed'), 'success');
    assert.strictEqual(mapSaspayStatus('PAID'), 'success');
    assert.strictEqual(mapSaspayStatus('FAILED'), 'failed');
    assert.strictEqual(mapSaspayStatus('CANCELLED'), 'failed');
    assert.strictEqual(mapSaspayStatus('EXPIRED'), 'failed');
    assert.strictEqual(mapSaspayStatus('PENDING'), 'pending');
    assert.strictEqual(mapSaspayStatus(undefined), 'pending');
  });

  await runTest('parseWebhookTimestampMs accepte Unix secondes, Unix ms et ISO-8601', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    assert.strictEqual(parseWebhookTimestampMs(String(nowSec)), nowSec * 1000);
    const nowMs = Date.now();
    assert.strictEqual(parseWebhookTimestampMs(String(nowMs)), nowMs);
    const iso = '2026-11-26T07:00:00.000Z';
    assert.strictEqual(parseWebhookTimestampMs(iso), Date.parse(iso));
    assert.ok(Number.isNaN(parseWebhookTimestampMs('invalid-date')));
  });

  // ---------------------------------------------------------------------------
  // 2. Sécurité Webhook HMAC-SHA256 & Anti-Rejeu
  // ---------------------------------------------------------------------------
  await runTest('verifySaspayWebhookSignature valide une signature HMAC-SHA256 conforme', () => {
    const nowMs = Date.now();
    const ts = String(Math.floor(nowMs / 1000));
    const body = JSON.stringify({ event: 'transaction.success', data: { id: 'tx_123', status: 'SUCCESS' } });
    const sig = signWebhook(body, ts);

    const res1 = verifySaspayWebhookSignature({ rawBody: body, signatureHeader: sig, timestampHeader: ts, nowMs });
    assert.strictEqual(res1.valid, true);

    const res2 = verifySaspayWebhookSignature({ rawBody: body, signatureHeader: `sha256=${sig}`, timestampHeader: ts, nowMs });
    assert.strictEqual(res2.valid, true);
  });

  await runTest('verifySaspayWebhookSignature rejette une charge utile altérée ou une mauvaise signature', () => {
    const nowMs = Date.now();
    const ts = String(Math.floor(nowMs / 1000));
    const body = JSON.stringify({ event: 'transaction.success', data: { id: 'tx_123', amount: '24900.00' } });
    const sig = signWebhook(body, ts);

    const tampered = JSON.stringify({ event: 'transaction.success', data: { id: 'tx_123', amount: '100.00' } });
    const res = verifySaspayWebhookSignature({ rawBody: tampered, signatureHeader: sig, timestampHeader: ts, nowMs });
    assert.strictEqual(res.valid, false);
  });

  await runTest('verifySaspayWebhookSignature rejette une attaque par rejeu (> 300s)', () => {
    const nowMs = Date.now();
    const expiredTs = String(Math.floor((nowMs - 360 * 1000) / 1000)); // 6 minutes dans le passé
    const body = JSON.stringify({ event: 'transaction.success', data: { id: 'tx_old' } });
    const sig = signWebhook(body, expiredTs);

    const res = verifySaspayWebhookSignature({ rawBody: body, signatureHeader: sig, timestampHeader: expiredTs, nowMs });
    assert.strictEqual(res.valid, false);
    assert.ok(res.reason?.includes('expiré'));
  });

  // ---------------------------------------------------------------------------
  // 3. Client HTTP SasPay (Checkout, Softpay, Verify) avec fetch mocké
  // ---------------------------------------------------------------------------
  const originalFetch = global.fetch;
  const fetchCalls: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = [];

  (global as any).fetch = async (url: string, init?: any) => {
    const method = init?.method || 'GET';
    const headers = init?.headers || {};
    const body = init?.body ? JSON.parse(init.body) : undefined;
    fetchCalls.push({ url, method, headers, body });

    if (url.endsWith('/checkout-sessions/') && method === 'POST') {
      return {
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            success: true,
            code: 201,
            data: {
              id: 'sess_saspay_999',
              slug: 'abcXYZ',
              checkout_url: 'https://pay.saspay.me/checkout/abcXYZ',
              amount: body.amount,
              currency: body.currency,
              status: 'PENDING',
            },
          }),
      };
    }

    if (url.endsWith('/payments/softpay/') && method === 'POST') {
      return {
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            success: true,
            code: 201,
            data: {
              id: 'pay_softpay_777',
              status: 'PENDING',
              message: 'Payment pushed successfully',
              instructions: 'Composez #144# pour confirmer',
            },
          }),
      };
    }

    if (url.includes('/checkout-sessions/sess_saspay_999/') && method === 'GET') {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            success: true,
            data: {
              id: 'sess_saspay_999',
              status: 'SUCCESS',
              transaction: { id: 'tx_saspay_final_999', status: 'SUCCESS' },
            },
          }),
      };
    }

    if (url.includes('/payments/') && url.endsWith('/verify/') && method === 'GET') {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            success: true,
            data: {
              id: 'tx_saspay_final_999',
              status: 'SUCCESS',
              amount: '24900.00',
              currency: 'XOF',
            },
          }),
      };
    }

    return { ok: false, status: 404, text: async () => JSON.stringify({ message: 'Not found' }) };
  };

  await runTest('saspayClient.createCheckoutSession envoie Bearer, Idempotency-Key et retourne checkoutUrl', async () => {
    const res = await saspayClient.createCheckoutSession({
      amountXof: 24900,
      currency: 'XOF',
      description: 'Abonnement Naforo Pro (Mensuel) - SUB-TEST-001',
      customerEmail: 'owner@agence.ci',
      customerName: 'Ismaël Diomandé',
      returnUrl: 'https://backoffice.naforo.company/subscription?saspay_ref=SUB-TEST-001',
      idempotencyKey: 'SUB-TEST-001',
    });

    assert.strictEqual(res.id, 'sess_saspay_999');
    assert.strictEqual(res.checkoutUrl, 'https://pay.saspay.me/checkout/abcXYZ');
    assert.strictEqual(res.status, 'pending');

    const lastCall = fetchCalls[fetchCalls.length - 1];
    assert.strictEqual(lastCall.headers.Authorization, 'Bearer sk_test_naforo_unit_testing_key_001');
    assert.strictEqual(lastCall.headers['Idempotency-Key'], 'SUB-TEST-001');
    assert.strictEqual(lastCall.body.amount, '24900.00');
    assert.strictEqual(lastCall.body.currency, 'XOF');
  });

  await runTest('saspayClient.initiateSoftpay envoie country, network et customer phone', async () => {
    const res = await saspayClient.initiateSoftpay({
      amountXof: 24900,
      country: 'CI',
      network: 'wave_ci',
      description: 'Abonnement Naforo Pro - SUB-TEST-002',
      customer: {
        email: 'owner@agence.ci',
        firstName: 'Ismaël',
        lastName: 'Diomandé',
        phone: '+2250700000000',
      },
      idempotencyKey: 'SUB-TEST-002',
    });

    assert.strictEqual(res.id, 'pay_softpay_777');
    assert.strictEqual(res.status, 'pending');
    assert.strictEqual(res.instructions, 'Composez #144# pour confirmer');
  });

  // ---------------------------------------------------------------------------
  // 4. Flux Complet SubscriptionsService (Webhook + Verify + Idempotence)
  // ---------------------------------------------------------------------------
  const service = new SubscriptionsService();
  const mockPaymentState: any = {
    id: 'pay-db-uuid-1',
    paymentReference: 'SUB-TEST-999',
    organizationId: 'org-uuid-1',
    subscriptionId: 'sub-uuid-1',
    targetPlanId: 'plan-pro-uuid',
    billingCycle: 'monthly',
    amountXof: 24900,
    paymentMethod: 'saspay',
    transactionNumber: 'sess_saspay_999',
    paymentDate: new Date(),
    status: 'pending',
    subscription: {
      id: 'sub-uuid-1',
      status: 'active',
      endDate: new Date(Date.now() - 86400000), // expiré
      plan: {
        id: 'plan-starter-uuid',
        name: 'Starter',
        code: 'starter',
        priceMonthlyXof: 0,
        maxProperties: 2,
        maxTenants: 2,
        features: '[]',
      },
    },
  };

  let subscriptionUpdateCalls = 0;
  let orgUpdateCalls = 0;
  let pdfGeneratedCount = 0;

  // Stubs sur repository, prisma, pdfGen, accountingRepo et mailer pour test isolé sans DB
  (subscriptionsRepository as any).findPaymentByReferenceOrTransaction = async (ref: string) => {
    if (ref === 'SUB-TEST-999' || ref === 'sess_saspay_999' || ref === 'tx_saspay_final_999') {
      return mockPaymentState;
    }
    return null;
  };
  (subscriptionsRepository as any).findPlanById = async () => ({
    id: 'plan-pro-uuid',
    name: 'Pro / Sérénité',
    code: 'pro',
    description: 'Formule Recommandée',
    priceMonthlyXof: 24900,
    yearlyDiscountPercent: 20,
    maxProperties: 15,
    maxLots: 5,
    maxTenants: 15,
    features: JSON.stringify(['email_reminders', 'qr_code_verification']),
    isActive: true,
  });
  (subscriptionsRepository as any).updatePaymentTransactionNumber = async (_id: string, tx: string) => {
    mockPaymentState.transactionNumber = tx;
    return mockPaymentState;
  };
  (subscriptionsRepository as any).validatePayment = async (_id: string, by: string, pdfUrl: string) => {
    mockPaymentState.status = 'validated';
    mockPaymentState.validatedBy = by;
    mockPaymentState.pdfUrl = pdfUrl;
    return mockPaymentState;
  };
  (subscriptionsRepository as any).rejectPayment = async (_id: string, reason: string) => {
    mockPaymentState.status = 'rejected';
    mockPaymentState.rejectionReason = reason;
    return mockPaymentState;
  };

  (prisma as any).subscription = {
    update: async () => {
      subscriptionUpdateCalls += 1;
      return {};
    },
  };
  (prisma as any).organization = {
    update: async () => {
      orgUpdateCalls += 1;
      return {};
    },
    findUnique: async () => ({
      name: 'Agence Test Abidjan',
      email: 'owner@agence.ci',
      phone: '+2250700000000',
      address: 'Cocody',
      city: 'Abidjan',
    }),
  };
  (prisma as any).user = {
    findMany: async () => [{ id: 'u1', email: 'owner@agence.ci', firstName: 'Ismaël', lastName: 'Diomandé' }],
  };
  (prisma as any).notification = {
    create: async () => ({}),
  };
  (prisma as any).auditLog = {
    findFirst: async () => ({ newData: { mode: 'checkout' } }),
    create: async () => ({}),
  };
  (accountingRepo as any).convertAmountXof = async (amount: number) => ({
    XOF: amount,
    EUR: Number((amount / 655.957).toFixed(2)),
    USD: Number((amount / 600).toFixed(2)),
  });
  (pdfGen as any).generateSubscriptionInvoicePdf = async () => {
    pdfGeneratedCount += 1;
    return 'uploads/invoices/Facture-SUB-TEST-999.pdf';
  };
  (mailer as any).sendMail = async () => ({ messageId: 'mock-msg-id' });

  await runTest('getSaspayConfig retourne mode sandbox et liste opérateurs', () => {
    const cfg = service.getSaspayConfig();
    assert.strictEqual(cfg.configured, true);
    assert.strictEqual(cfg.mode, 'sandbox');
    assert.strictEqual(cfg.webhookConfigured, true);
    assert.ok(cfg.supportedNetworks.some((n) => n.code === 'wave_ci'));
  });

  await runTest('handleSaspayWebhook acquitte webhook.test avec signature valide', async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const payload = { event: 'webhook.test', data: { ping: true } };
    const rawBody = JSON.stringify(payload);
    const sig = signWebhook(rawBody, ts);

    const res = await service.handleSaspayWebhook({
      rawBody,
      signatureHeader: sig,
      timestampHeader: ts,
      payload,
    });
    assert.strictEqual(res.received, true);
    assert.strictEqual(res.event, 'webhook.test');
  });

  await runTest('handleSaspayWebhook rejette un webhook sans signature valide (UnauthorizedError)', async () => {
    const payload = { event: 'transaction.success', data: { id: 'tx_saspay_final_999' } };
    const rawBody = JSON.stringify(payload);
    await assert.rejects(
      () =>
        service.handleSaspayWebhook({
          rawBody,
          signatureHeader: 'deadbeef'.repeat(8),
          timestampHeader: String(Math.floor(Date.now() / 1000)),
          payload,
        }),
      /invalide/i
    );
  });

  await runTest('handleSaspayWebhook (transaction.success) revérifie côté serveur, active l’abonnement et est idempotent', async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const payload = {
      event: 'transaction.success',
      data: {
        id: 'tx_saspay_final_999',
        checkout_session_id: 'sess_saspay_999',
        status: 'SUCCESS',
        amount: '24900.00',
        currency: 'XOF',
        description: 'Abonnement Naforo Pro (Mensuel) - SUB-TEST-999',
      },
    };
    const rawBody = JSON.stringify(payload);
    const sig = signWebhook(rawBody, ts);

    // 1er appel : activation complète
    const res1 = await service.handleSaspayWebhook({
      rawBody,
      signatureHeader: sig,
      timestampHeader: ts,
      payload,
    });
    assert.strictEqual(res1.activated, true);
    assert.strictEqual(mockPaymentState.status, 'validated');
    assert.strictEqual(subscriptionUpdateCalls, 1);
    assert.strictEqual(orgUpdateCalls, 1);
    assert.strictEqual(pdfGeneratedCount, 1);

    // 2e appel (doublon webhook) : idempotent, aucune double prolongation !
    const res2 = await service.handleSaspayWebhook({
      rawBody,
      signatureHeader: sig,
      timestampHeader: ts,
      payload,
    });
    assert.strictEqual(res2.alreadyValidated, true);
    assert.strictEqual(subscriptionUpdateCalls, 1);
    assert.strictEqual(pdfGeneratedCount, 1);
  });

  await runTest('verifySaspayPayment vérifie la session + la transaction et active un paiement pending', async () => {
    mockPaymentState.status = 'pending';
    mockPaymentState.transactionNumber = 'sess_saspay_999';
    subscriptionUpdateCalls = 0;

    const res = await service.verifySaspayPayment('SUB-TEST-999', 'org-uuid-1');
    assert.strictEqual(res.status, 'validated');
    assert.strictEqual(res.activated, true);
    assert.strictEqual(subscriptionUpdateCalls, 1);
  });

  global.fetch = originalFetch;

  console.log(`\n📊 Résultat : ${passed} test(s) réussi(s), ${failed} échec(s).\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
