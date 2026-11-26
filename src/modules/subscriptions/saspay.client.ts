import crypto from 'crypto';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { BadRequestError } from '@/shared/errors/AppError';

export type SaspayNormalizedStatus = 'pending' | 'success' | 'failed';

export interface SaspayCheckoutSessionParams {
  amountXof: number;
  currency?: string;
  description: string;
  customerEmail?: string | null;
  customerName?: string | null;
  returnUrl: string;
  idempotencyKey: string;
}

export interface SaspayCheckoutSessionResult {
  id: string;
  slug?: string;
  checkoutUrl: string;
  amount: string;
  currency: string;
  status: SaspayNormalizedStatus;
  rawStatus: string;
  raw: any;
}

export interface SaspaySoftpayParams {
  amountXof: number;
  currency?: string;
  country: string;
  network: string;
  description: string;
  customer: {
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
  };
  idempotencyKey: string;
}

export interface SaspaySoftpayResult {
  id: string;
  status: SaspayNormalizedStatus;
  rawStatus: string;
  checkoutUrl?: string;
  instructions?: string;
  message?: string;
  raw: any;
}

export interface SaspayVerifyResult {
  id: string;
  status: SaspayNormalizedStatus;
  rawStatus: string;
  amount?: number;
  currency?: string;
  transactionId?: string;
  raw: any;
}

export interface SaspayWebhookVerificationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Normalise les différents statuts retournés par la passerelle SasPay
 * (PENDING, SUCCESS, SUCCEEDED, COMPLETED, PAID, FAILED, CANCELLED, EXPIRED...)
 */
export function mapSaspayStatus(rawStatus: unknown): SaspayNormalizedStatus {
  const normalized = String(rawStatus || '').trim().toUpperCase();
  if (['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'PAID', 'APPROVED'].includes(normalized)) {
    return 'success';
  }
  if (['FAILED', 'FAILURE', 'CANCELLED', 'CANCELED', 'EXPIRED', 'DECLINED', 'REJECTED'].includes(normalized)) {
    return 'failed';
  }
  return 'pending';
}

/**
 * Formate un montant entier XOF au format décimal string attendu par SasPay ("24900.00")
 */
export function formatSaspayAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new BadRequestError('Le montant SasPay doit être strictement positif.');
  }
  return amount.toFixed(2);
}

/**
 * Parse un horodatage webhook (Unix seconds, Unix ms, ou ISO-8601) en millisecondes epoch
 */
export function parseWebhookTimestampMs(timestampHeader: string): number {
  const trimmed = String(timestampHeader || '').trim();
  if (!trimmed) return NaN;

  // Unix timestamp numérique (secondes ou millisecondes)
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return NaN;
    // Si < 1e12, ce sont des secondes Unix ; sinon des millisecondes
    return num < 1e12 ? Math.round(num * 1000) : Math.round(num);
  }

  // ISO-8601 date string
  return Date.parse(trimmed);
}

/**
 * Vérification cryptographique HMAC-SHA256 d'un webhook SasPay (avec protection anti-rejeu <= 300s)
 * Conforme à https://docs.saspay.me/
 */
export function verifySaspayWebhookSignature(params: {
  rawBody: string;
  signatureHeader?: string;
  timestampHeader?: string;
  secret?: string;
  toleranceSeconds?: number;
  nowMs?: number;
}): SaspayWebhookVerificationResult {
  const secret = params.secret ?? env.SASPAY_WEBHOOK_SECRET;
  const toleranceSeconds = params.toleranceSeconds ?? Number(env.SASPAY_WEBHOOK_TOLERANCE_SECONDS || 300);
  const nowMs = params.nowMs ?? Date.now();

  if (!secret) {
    return { valid: false, reason: 'SASPAY_WEBHOOK_SECRET non configuré sur le serveur.' };
  }

  if (!params.signatureHeader || !params.timestampHeader) {
    return { valid: false, reason: 'En-têtes X-Webhook-Signature ou X-Webhook-Timestamp manquants.' };
  }

  const timestampMs = parseWebhookTimestampMs(params.timestampHeader);
  if (Number.isNaN(timestampMs)) {
    return { valid: false, reason: 'Format X-Webhook-Timestamp invalide.' };
  }

  const ageMs = Math.abs(nowMs - timestampMs);
  if (ageMs > toleranceSeconds * 1000) {
    return {
      valid: false,
      reason: `Horodatage webhook expiré (${Math.round(ageMs / 1000)}s > tolérance ${toleranceSeconds}s).`,
    };
  }

  const cleanReceived = params.signatureHeader
    .trim()
    .replace(/^sha256=/i, '')
    .toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(cleanReceived)) {
    return { valid: false, reason: 'Format de signature HMAC-SHA256 invalide.' };
  }

  const receivedBuf = Buffer.from(cleanReceived, 'hex');

  // 1. Format principal SasPay : HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
  const expectedWithTimestamp = crypto
    .createHmac('sha256', secret)
    .update(`${params.timestampHeader}.${params.rawBody}`)
    .digest('hex');

  const expectedWithTsBuf = Buffer.from(expectedWithTimestamp, 'hex');
  if (
    expectedWithTsBuf.length === receivedBuf.length &&
    crypto.timingSafeEqual(expectedWithTsBuf, receivedBuf)
  ) {
    return { valid: true };
  }

  // 2. Compatibilité éventuelle : HMAC-SHA256(secret, rawBody)
  const expectedRawOnly = crypto
    .createHmac('sha256', secret)
    .update(params.rawBody)
    .digest('hex');

  const expectedRawBuf = Buffer.from(expectedRawOnly, 'hex');
  if (
    expectedRawBuf.length === receivedBuf.length &&
    crypto.timingSafeEqual(expectedRawBuf, receivedBuf)
  ) {
    return { valid: true };
  }

  return { valid: false, reason: 'Signature webhook SasPay invalide.' };
}

export class SaspayClient {
  private get baseUrl(): string {
    return (env.SASPAY_API_URL || 'https://api.saspay.me/api/v1').replace(/\/$/, '');
  }

  private get secretKey(): string {
    return (env.SASPAY_SECRET_KEY || '').trim();
  }

  isConfigured(): boolean {
    return this.secretKey.length > 0;
  }

  getMode(): 'sandbox' | 'live' | 'unconfigured' {
    if (!this.isConfigured()) return 'unconfigured';
    if (this.secretKey.startsWith('sk_live_')) return 'live';
    return 'sandbox';
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new BadRequestError(
        'Passerelle SasPay non configurée sur le serveur (variable SASPAY_SECRET_KEY manquante).'
      );
    }
  }

  private async request<T = any>(
    method: 'GET' | 'POST',
    endpoint: string,
    body?: Record<string, any>,
    idempotencyKey?: string
  ): Promise<T> {
    this.assertConfigured();

    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      Accept: 'application/json',
    };

    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { rawText: text };
      }

      if (!response.ok) {
        const apiMessage =
          json?.message ||
          json?.detail ||
          json?.error?.message ||
          (typeof json?.error === 'string' ? json.error : null) ||
          `Erreur passerelle SasPay (HTTP ${response.status})`;
        logger.error(`[SasPay] ${method} ${endpoint} failed (${response.status}): ${apiMessage}`, {
          response: json,
        });
        throw new BadRequestError(`SasPay : ${apiMessage}`);
      }

      return json as T;
    } catch (err: any) {
      if (err instanceof BadRequestError) throw err;
      if (err?.name === 'AbortError') {
        throw new BadRequestError('Délai de connexion dépassé avec la passerelle SasPay. Veuillez réessayer.');
      }
      logger.error(`[SasPay] Erreur réseau sur ${method} ${endpoint}: ${err?.message || err}`);
      throw new BadRequestError(`Impossible de joindre la passerelle SasPay : ${err?.message || 'Erreur réseau'}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Crée une session de Checkout hébergée SasPay (POST /checkout-sessions/)
   */
  async createCheckoutSession(params: SaspayCheckoutSessionParams): Promise<SaspayCheckoutSessionResult> {
    const payload: Record<string, any> = {
      amount: formatSaspayAmount(params.amountXof),
      currency: params.currency || 'XOF',
      description: params.description,
      return_url: params.returnUrl,
    };

    if (params.customerEmail) payload.customer_email = params.customerEmail;
    if (params.customerName) payload.customer_name = params.customerName;

    const res = await this.request<any>('POST', '/checkout-sessions/', payload, params.idempotencyKey);
    const data = res?.data || res;

    if (!data?.id || !data?.checkout_url) {
      logger.error('[SasPay] Réponse createCheckoutSession incomplète', { res });
      throw new BadRequestError('Réponse incomplète reçue de SasPay lors de la création du checkout.');
    }

    const rawStatus = String(data.status || 'PENDING');
    return {
      id: String(data.id),
      slug: data.slug ? String(data.slug) : undefined,
      checkoutUrl: String(data.checkout_url),
      amount: String(data.amount || payload.amount),
      currency: String(data.currency || payload.currency),
      status: mapSaspayStatus(rawStatus),
      rawStatus,
      raw: res,
    };
  }

  /**
   * Initie un paiement Mobile Money direct (Push Softpay — POST /payments/softpay/)
   */
  async initiateSoftpay(params: SaspaySoftpayParams): Promise<SaspaySoftpayResult> {
    const payload = {
      amount: formatSaspayAmount(params.amountXof),
      currency: params.currency || 'XOF',
      country: params.country.toUpperCase(),
      network: params.network.toLowerCase(),
      description: params.description,
      customer: {
        email: params.customer.email,
        first_name: params.customer.firstName,
        last_name: params.customer.lastName,
        phone: params.customer.phone,
      },
    };

    const res = await this.request<any>('POST', '/payments/softpay/', payload, params.idempotencyKey);
    const data = res?.data || res;

    if (!data?.id) {
      logger.error('[SasPay] Réponse initiateSoftpay incomplète', { res });
      throw new BadRequestError('Réponse incomplète reçue de SasPay lors de l’initiation Softpay.');
    }

    const rawStatus = String(data.status || 'PENDING');
    return {
      id: String(data.id),
      status: mapSaspayStatus(rawStatus),
      rawStatus,
      checkoutUrl: data.checkout_url ? String(data.checkout_url) : undefined,
      instructions: data.instructions ? String(data.instructions) : undefined,
      message: data.message ? String(data.message) : undefined,
      raw: res,
    };
  }

  /**
   * Consulte le détail d'une session de checkout (GET /checkout-sessions/{id}/)
   */
  async getCheckoutSession(sessionId: string): Promise<SaspayVerifyResult> {
    const res = await this.request<any>('GET', `/checkout-sessions/${encodeURIComponent(sessionId)}/`);
    const data = res?.data || res;
    const tx = data?.transaction || null;
    const rawStatus = String(tx?.status || data?.status || 'PENDING');

    return {
      id: String(data?.id || sessionId),
      status: mapSaspayStatus(rawStatus),
      rawStatus,
      amount: data?.amount !== undefined ? Number(data.amount) : undefined,
      currency: data?.currency ? String(data.currency) : undefined,
      transactionId: tx?.id ? String(tx.id) : (data?.payment_id ? String(data.payment_id) : undefined),
      raw: res,
    };
  }

  /**
   * Vérifie l'état réel d'un paiement auprès de la passerelle (GET /payments/{payment_id}/verify/)
   */
  async verifyPayment(paymentId: string): Promise<SaspayVerifyResult> {
    const res = await this.request<any>('GET', `/payments/${encodeURIComponent(paymentId)}/verify/`);
    const data = res?.data || res;
    const rawStatus = String(data?.status || data?.transaction?.status || 'PENDING');

    return {
      id: String(data?.id || paymentId),
      status: mapSaspayStatus(rawStatus),
      rawStatus,
      amount: data?.amount !== undefined ? Number(data.amount) : undefined,
      currency: data?.currency ? String(data.currency) : undefined,
      transactionId: data?.id ? String(data.id) : paymentId,
      raw: res,
    };
  }
}

export const saspayClient = new SaspayClient();
