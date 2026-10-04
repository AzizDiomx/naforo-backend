import crypto from 'crypto';
import { env } from '@/config/env';

const ALGORITHM = 'aes-256-gcm';
// Derive a 32-byte key from JWT_ACCESS_SECRET
const ENCRYPTION_KEY = crypto.createHash('sha256').update(env.JWT_ACCESS_SECRET || 'naforo_secret_key_32_bytes_len').digest();

/**
 * Encrypt chat message content using AES-256-GCM for security at rest
 */
export function encryptChatMessage(text: string): string {
  if (!text) return '';
  try {
    const iv = crypto.randomBytes(12); // 12-byte IV for GCM
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('Chat encryption failed:', err);
    return text; // Fallback
  }
}

/**
 * Decrypt AES-256-GCM chat message payload
 */
export function decryptChatMessage(encryptedPayload: string): string {
  if (!encryptedPayload) return '';
  if (!encryptedPayload.includes(':')) return encryptedPayload; // Raw text fallback

  try {
    const parts = encryptedPayload.split(':');
    if (parts.length !== 3) return encryptedPayload;

    const [ivHex, authTagHex, encryptedTextHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedTextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (err) {
    // If payload was stored unencrypted or error decoding
    return encryptedPayload;
  }
}

