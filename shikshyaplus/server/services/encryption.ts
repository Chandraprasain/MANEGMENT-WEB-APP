import crypto from 'node:crypto';
import { maskBankAccountNumber } from '../../src/lib/v4Rules';

function getAesKey(): Buffer {
  const raw =
    process.env.FINANCE_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET ||
    process.env.GEMINI_API_KEY ||
    'shikshyaplus-v4-dev-finance-key-2026';
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptSensitiveField(plaintext: string): string {
  const key = getAesKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSensitiveField(stored: string): string {
  if (!stored) return '';
  if (!stored.startsWith('enc:v1:')) return stored;
  const parts = stored.split(':');
  if (parts.length !== 5) return '';
  const [, , ivHex, tagHex, dataHex] = parts;
  const key = getAesKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

export function maskAccountDisplay(accountNumber: string): string {
  return maskBankAccountNumber(accountNumber);
}

function getBadgeSigningKey(): string {
  return (
    process.env.OPEN_BADGES_SIGNING_SECRET ||
    process.env.SESSION_SECRET ||
    'shikshyaplus-open-badge-hmac-key-2026'
  );
}

export function signOpenBadgePayload(credentialSubject: Record<string, unknown>): {
  credentialJson: string;
  signatureHex: string;
  verificationHash: string;
} {
  const canonicalPayload = JSON.stringify({
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json'],
    type: ['VerifiableCredential', 'OpenBadgeCredential'],
    issuanceDate: new Date().toISOString(),
    credentialSubject,
  });
  const signatureHex = crypto.createHmac('sha256', getBadgeSigningKey()).update(canonicalPayload).digest('hex');
  const verificationHash = crypto.createHash('sha256').update(`${canonicalPayload}.${signatureHex}`).digest('hex').slice(0, 16).toUpperCase();
  return { credentialJson: canonicalPayload, signatureHex, verificationHash };
}

export function verifyOpenBadgeSignature(credentialJson: string, signatureHex: string): boolean {
  if (!credentialJson || !signatureHex) return false;
  const expected = crypto.createHmac('sha256', getBadgeSigningKey()).update(credentialJson).digest('hex');
  const a = Buffer.from(signatureHex, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function signWebhookPayload(secret: string, bodyJson: string): string {
  return crypto.createHmac('sha256', secret).update(bodyJson).digest('hex');
}
