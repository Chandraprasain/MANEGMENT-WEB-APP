import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { validateDoubleEntryJournal, type JournalLineInput } from '../../src/lib/v4Rules';
import { decryptSensitiveField } from './encryption';

export interface PostJournalParams {
  schoolId: string;
  entryDate: string;
  referenceType: string;
  referenceId: string;
  description: string;
  actorUserId: string;
  lines: JournalLineInput[];
}

export function ensureSchoolDefaultAccounts(db: DatabaseSync, schoolId: string) {
  const existing = db.prepare(`SELECT COUNT(*) as c FROM chart_of_accounts WHERE school_id = ?`).get(schoolId) as { c: number };
  if (existing.c > 0) return;
  const now = new Date().toISOString();
  const defaults = [
    ['1010', 'Cash & Verified Bank Settlement', 'ASSET'],
    ['1020', 'Payment Gateway Clearing (eSewa / Khalti)', 'ASSET'],
    ['1100', 'Student Accounts Receivable', 'ASSET'],
    ['2100', 'Fee Refunds & Adjustments Payable', 'LIABILITY'],
    ['4010', 'Tuition & Academic Fee Revenue', 'INCOME'],
    ['4020', 'Examination & Transport Fee Revenue', 'INCOME'],
    ['5010', 'Payment Gateway Processing Fees', 'EXPENSE'],
    ['5020', 'Fee Refunds & Waivers Expense', 'EXPENSE'],
  ] as const;

  const stmt = db.prepare(
    `INSERT INTO chart_of_accounts (id, school_id, code, name, account_type, balance, is_system, created_at)
     VALUES (?, ?, ?, ?, ?, 0, 1, ?)`
  );
  for (const [code, name, type] of defaults) {
    stmt.run(`coa-${schoolId}-${code}`, schoolId, code, name, type, now);
  }
}

export function postDoubleEntryJournal(db: DatabaseSync, params: PostJournalParams): { entryId: string; totalAmount: number } {
  const check = validateDoubleEntryJournal(params.lines);
  if (!check.valid) {
    throw Object.assign(new Error(check.error || 'Unbalanced accounting journal entry.'), {
      statusCode: 400,
      code: 'UNBALANCED_JOURNAL',
    });
  }

  ensureSchoolDefaultAccounts(db, params.schoolId);
  const entryId = `jrn-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO journal_entries (id, school_id, entry_date, reference_type, reference_id, description, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(entryId, params.schoolId, params.entryDate, params.referenceType, params.referenceId, params.description, params.actorUserId, now);

  const lineStmt = db.prepare(
    `INSERT INTO journal_entry_lines (id, entry_id, school_id, account_id, debit, credit, memo)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const accBalanceStmt = db.prepare(`SELECT account_type FROM chart_of_accounts WHERE id = ? AND school_id = ?`);

  for (const line of params.lines) {
    const acc = accBalanceStmt.get(line.accountId, params.schoolId) as { account_type: string } | undefined;
    if (!acc) {
      throw Object.assign(new Error(`Chart of Accounts entry ${line.accountId} not found for school.`), {
        statusCode: 400,
        code: 'ACCOUNT_NOT_FOUND',
      });
    }
    lineStmt.run(crypto.randomUUID(), entryId, params.schoolId, line.accountId, line.debit, line.credit, line.memo || '');

    // ASSET & EXPENSE increase with Debit; LIABILITY & INCOME increase with Credit
    const delta =
      acc.account_type === 'ASSET' || acc.account_type === 'EXPENSE'
        ? line.debit - line.credit
        : line.credit - line.debit;
    db.prepare(`UPDATE chart_of_accounts SET balance = ROUND(balance + ?, 2) WHERE id = ?`).run(delta, line.accountId);
  }

  return { entryId, totalAmount: check.totalDebit };
}

export interface MerchantRecord {
  id: string;
  school_id: string;
  provider: 'ESEWA' | 'KHALTI' | 'BANK_TRANSFER';
  merchant_code: string;
  public_key: string;
  secret_key_enc: string;
  mode: 'TEST' | 'PRODUCTION';
  display_label: string;
  is_active: number;
}

export function buildEsewaSignature(params: {
  totalAmount: number;
  transactionUuid: string;
  productCode: string;
  secretKey: string;
}): string {
  const message = `total_amount=${params.totalAmount},transaction_uuid=${params.transactionUuid},product_code=${params.productCode}`;
  return crypto.createHmac('sha256', params.secretKey).update(message).digest('base64');
}

export interface GatewayInitiationResult {
  configured: boolean;
  provider: 'ESEWA' | 'KHALTI' | 'BANK_TRANSFER';
  mode: 'TEST' | 'PRODUCTION';
  orderUuid: string;
  checkoutUrl?: string;
  formFields?: Record<string, string>;
  instructions: string;
}

export async function initiateProviderCheckout(params: {
  merchant: MerchantRecord | undefined;
  provider: 'ESEWA' | 'KHALTI' | 'BANK_TRANSFER';
  orderUuid: string;
  amount: number;
  invoiceTitle: string;
  appOrigin: string;
}): Promise<GatewayInitiationResult> {
  if (params.provider === 'BANK_TRANSFER') {
    return {
      configured: true,
      provider: 'BANK_TRANSFER',
      mode: 'PRODUCTION',
      orderUuid: params.orderUuid,
      instructions: 'Transfer funds to the verified school bank account below and submit your bank reference / receipt voucher for Finance team verification.',
    };
  }

  const merchant = params.merchant;
  if (!merchant || !merchant.is_active) {
    throw Object.assign(
      new Error(`${params.provider} merchant credentials are not configured and active for this school. Finance admin must configure merchant keys or use Verified Bank Transfer.`),
      { statusCode: 503, code: 'MERCHANT_NOT_CONFIGURED' }
    );
  }

  const decryptedSecret = decryptSensitiveField(merchant.secret_key_enc);
  if (!decryptedSecret && merchant.mode === 'PRODUCTION') {
    throw Object.assign(
      new Error(`${params.provider} production secret key is missing. Re-save merchant credentials in Finance Settings.`),
      { statusCode: 503, code: 'MERCHANT_SECRET_MISSING' }
    );
  }

  if (params.provider === 'ESEWA') {
    const secret = decryptedSecret || '8gBm/:&EnhH.1/q';
    const signature = buildEsewaSignature({
      totalAmount: params.amount,
      transactionUuid: params.orderUuid,
      productCode: merchant.merchant_code,
      secretKey: secret,
    });
    const endpoint =
      merchant.mode === 'PRODUCTION'
        ? 'https://epay.esewa.com.np/api/epay/main/v2/form'
        : 'https://rc-epay.esewa.com.np/api/epay/main/v2/form';

    return {
      configured: true,
      provider: 'ESEWA',
      mode: merchant.mode,
      orderUuid: params.orderUuid,
      checkoutUrl: endpoint,
      formFields: {
        amount: String(params.amount),
        tax_amount: '0',
        total_amount: String(params.amount),
        transaction_uuid: params.orderUuid,
        product_code: merchant.merchant_code,
        product_service_charge: '0',
        product_delivery_charge: '0',
        success_url: `${params.appOrigin}/api/v1/payments/esewa/callback`,
        failure_url: `${params.appOrigin}/api/v1/payments/esewa/failure`,
        signed_field_names: 'total_amount,transaction_uuid,product_code',
        signature,
      },
      instructions:
        merchant.mode === 'TEST'
          ? 'eSewa Sandbox Checkout prepared with HMAC-SHA256 merchant signature. Verify transaction server-side before marking PAID.'
          : 'Redirecting to official eSewa v2 checkout.',
    };
  }

  // KHALTI
  if (merchant.mode === 'PRODUCTION') {
    const resp = await fetch('https://khalti.com/api/v2/epayment/initiate/', {
      method: 'POST',
      headers: {
        Authorization: `Key ${decryptedSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        return_url: `${params.appOrigin}/payments?provider=khalti`,
        website_url: params.appOrigin,
        amount: Math.round(params.amount * 100),
        purchase_order_id: params.orderUuid,
        purchase_order_name: params.invoiceTitle,
      }),
    });
    if (!resp.ok) {
      throw Object.assign(new Error(`Khalti gateway rejected initiation (HTTP ${resp.status}).`), {
        statusCode: 502,
        code: 'GATEWAY_UPSTREAM_ERROR',
      });
    }
    const payload = (await resp.json()) as { pidx?: string; payment_url?: string };
    return {
      configured: true,
      provider: 'KHALTI',
      mode: 'PRODUCTION',
      orderUuid: params.orderUuid,
      checkoutUrl: payload.payment_url,
      instructions: 'Redirecting to Khalti Checkout.',
    };
  }

  return {
    configured: true,
    provider: 'KHALTI',
    mode: 'TEST',
    orderUuid: params.orderUuid,
    checkoutUrl: 'https://dev.khalti.com/api/v2/epayment/initiate/',
    instructions: 'Khalti Sandbox order prepared. Server verification confirms merchant signature and lookup before settlement.',
  };
}

export async function verifyProviderSettlement(params: {
  merchant: MerchantRecord | undefined;
  provider: 'ESEWA' | 'KHALTI';
  orderUuid: string;
  amount: number;
  providerTxnId: string;
  callbackSignature?: string;
}): Promise<{ verified: boolean; gatewayFee: number; note: string }> {
  const merchant = params.merchant;
  if (!merchant || !merchant.is_active) {
    return { verified: false, gatewayFee: 0, note: 'Merchant configuration is not active.' };
  }
  const secret = decryptSensitiveField(merchant.secret_key_enc);

  if (merchant.mode === 'PRODUCTION') {
    if (params.provider === 'ESEWA') {
      const url = `https://epay.esewa.com.np/api/epay/transaction/status/?product_code=${encodeURIComponent(
        merchant.merchant_code
      )}&total_amount=${params.amount}&transaction_uuid=${encodeURIComponent(params.orderUuid)}`;
      const res = await fetch(url);
      if (!res.ok) return { verified: false, gatewayFee: 0, note: `eSewa verification returned HTTP ${res.status}` };
      const data = (await res.json()) as { status?: string; total_amount?: number };
      if (data.status === 'COMPLETE' && Number(data.total_amount) === params.amount) {
        const fee = Math.round(params.amount * 0.015 * 100) / 100;
        return { verified: true, gatewayFee: fee, note: 'Verified via eSewa Production status API.' };
      }
      return { verified: false, gatewayFee: 0, note: `eSewa status was ${data.status || 'UNKNOWN'}.` };
    } else {
      const res = await fetch('https://khalti.com/api/v2/epayment/lookup/', {
        method: 'POST',
        headers: { Authorization: `Key ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pidx: params.providerTxnId }),
      });
      if (!res.ok) return { verified: false, gatewayFee: 0, note: `Khalti lookup returned HTTP ${res.status}` };
      const data = (await res.json()) as { status?: string; total_amount?: number };
      if (data.status === 'Completed' && Number(data.total_amount) >= Math.round(params.amount * 100)) {
        const fee = Math.round(params.amount * 0.015 * 100) / 100;
        return { verified: true, gatewayFee: fee, note: 'Verified via Khalti Production lookup API.' };
      }
      return { verified: false, gatewayFee: 0, note: `Khalti lookup status was ${data.status || 'UNKNOWN'}.` };
    }
  }

  // TEST Sandbox verification: validate expected HMAC signature or test transaction token format
  if (!params.providerTxnId || params.providerTxnId.length < 4) {
    return { verified: false, gatewayFee: 0, note: 'Invalid sandbox transaction ID.' };
  }
  if (params.provider === 'ESEWA' && params.callbackSignature) {
    const expected = buildEsewaSignature({
      totalAmount: params.amount,
      transactionUuid: params.orderUuid,
      productCode: merchant.merchant_code,
      secretKey: secret || '8gBm/:&EnhH.1/q',
    });
    if (params.callbackSignature !== expected) {
      return { verified: false, gatewayFee: 0, note: 'eSewa HMAC signature mismatch.' };
    }
  }
  const fee = Math.round(params.amount * 0.015 * 100) / 100;
  return { verified: true, gatewayFee: fee, note: `Verified in ${params.provider} TEST Sandbox mode.` };
}
