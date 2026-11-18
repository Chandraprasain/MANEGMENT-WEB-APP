import crypto from 'node:crypto';
import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { validateRefundAmount } from '../../src/lib/v4Rules';
import { logAuditEvent, requireAuth, requireRoles, requireSchoolTenant } from '../security';
import { encryptSensitiveField, maskAccountDisplay } from '../services/encryption';
import {
  ensureSchoolDefaultAccounts,
  initiateProviderCheckout,
  postDoubleEntryJournal,
  verifyProviderSettlement,
  type MerchantRecord,
} from '../services/paymentAdapters';

function getLinkedStudentIds(db: DatabaseSync, userId: string, schoolId: string): Set<string> {
  const rows = db
    .prepare(`SELECT student_id FROM student_guardians WHERE parent_user_id = ? AND school_id = ?`)
    .all(userId, schoolId) as Array<{ student_id: string }>;
  return new Set(rows.map((r) => r.student_id));
}

export function createFinanceHubRouter(db: DatabaseSync) {
  const router = Router();

  // ======================== V4.1 UNIFIED PAYMENTS OVERVIEW ========================
  router.get('/payments/overview', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;
    const isFinanceAdmin = ['PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'STAFF_ACCOUNTANT', 'STAFF_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(
      auth.activeRole
    );

    ensureSchoolDefaultAccounts(db, schoolId);

    let invoices = db
      .prepare(
        `SELECT f.*, s.full_name as student_name, s.student_code, s.class_id
         FROM fee_invoices f JOIN students s ON s.id = f.student_id
         WHERE f.school_id = ? ORDER BY f.created_at DESC`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    let orders = db
      .prepare(
        `SELECT po.*, s.full_name as student_name, s.student_code, f.title as invoice_title, u.full_name as payer_name
         FROM payment_orders po
         JOIN students s ON s.id = po.student_id
         JOIN fee_invoices f ON f.id = po.invoice_id
         JOIN global_users u ON u.id = po.payer_user_id
         WHERE po.school_id = ? ORDER BY po.created_at DESC LIMIT 80`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    let transactions = db
      .prepare(
        `SELECT pt.*, f.title as invoice_title, s.full_name as student_name, s.student_code,
                COALESCE((SELECT SUM(pr.amount) FROM payment_refunds pr WHERE pr.transaction_id = pt.id AND pr.status = 'COMPLETED'), 0) as refunded_amount
         FROM payment_transactions pt
         JOIN fee_invoices f ON f.id = pt.invoice_id
         JOIN students s ON s.id = f.student_id
         WHERE pt.school_id = ? ORDER BY pt.created_at DESC LIMIT 80`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    if (auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN') {
      const childIds = getLinkedStudentIds(db, auth.userId, schoolId);
      invoices = invoices.filter((i) => childIds.has(String(i.student_id)));
      orders = orders.filter((o) => childIds.has(String(o.student_id)));
      const invIds = new Set(invoices.map((i) => String(i.id)));
      transactions = transactions.filter((t) => invIds.has(String(t.invoice_id)));
    } else if (auth.activeRole === 'STUDENT') {
      const stu = db.prepare(`SELECT id FROM students WHERE user_id = ? AND school_id = ?`).get(auth.userId, schoolId) as { id: string } | undefined;
      invoices = stu ? invoices.filter((i) => String(i.student_id) === stu.id) : [];
      orders = stu ? orders.filter((o) => String(o.student_id) === stu.id) : [];
      const invIds = new Set(invoices.map((i) => String(i.id)));
      transactions = transactions.filter((t) => invIds.has(String(t.invoice_id)));
    } else if (!isFinanceAdmin) {
      return res.status(403).json({ success: false, message: 'Role not authorized for school finance workspace.', error: { code: 'FORBIDDEN', details: null } });
    }

    // Masked bank accounts only (never return encrypted or raw account number!)
    const bankAccounts = db
      .prepare(
        `SELECT id, school_id, bank_name, branch_name, account_holder_name, account_number_masked, swift_code, currency, purpose, verification_status, is_primary, settlement_active, verified_at, created_at
         FROM school_bank_accounts
         WHERE school_id = ? ${isFinanceAdmin ? '' : "AND verification_status = 'VERIFIED' AND settlement_active = 1"}
         ORDER BY is_primary DESC, created_at DESC`
      )
      .all(schoolId);

    // Gateways without leaking secret keys
    const merchants = db
      .prepare(
        `SELECT id, school_id, provider, merchant_code, public_key, mode, display_label, is_active, verified_status,
                CASE WHEN secret_key_enc IS NOT NULL AND LENGTH(secret_key_enc) > 0 THEN 1 ELSE 0 END as has_secret,
                updated_at
         FROM payment_merchants WHERE school_id = ?`
      )
      .all(schoolId);

    const kpis = {
      totalReceivable: invoices
        .filter((i) => i.status !== 'PAID' && i.status !== 'REFUNDED')
        .reduce((sum, i) => sum + Math.max(0, Number(i.amount || 0) - Number(i.discount || 0)), 0),
      totalPaid: invoices
        .filter((i) => i.status === 'PAID')
        .reduce((sum, i) => sum + Math.max(0, Number(i.amount || 0) - Number(i.discount || 0)), 0),
      pendingBankReviews: orders.filter((o) => o.status === 'PENDING_MANUAL_REVIEW').length,
      settledTransactionsCount: transactions.filter((t) => t.status === 'SETTLED').length,
    };

    return res.json({
      success: true,
      data: {
        isFinanceAdmin,
        kpis,
        invoices,
        orders,
        transactions,
        bankAccounts,
        merchants,
      },
    });
  });

  // ======================== BANK ACCOUNT MANAGEMENT (MASKED + AES-256-GCM) ========================
  router.get(
    '/finance/bank-accounts',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'STAFF_ACCOUNTANT', 'STAFF_ADMIN', 'PLATFORM_SUPER_ADMIN'),
    (req, res) => {
      const accounts = db
        .prepare(
          `SELECT id, school_id, bank_name, branch_name, account_holder_name, account_number_masked, swift_code, iban, routing_code, currency, purpose, verification_status, is_primary, settlement_active, verified_at, created_at
           FROM school_bank_accounts WHERE school_id = ? ORDER BY is_primary DESC, created_at DESC`
        )
        .all(req.auth!.activeSchoolId!);
      return res.json({ success: true, data: { bankAccounts: accounts } });
    }
  );

  router.post(
    '/finance/bank-accounts',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'SCHOOL_ORG', 'STAFF_ACCOUNTANT'),
    (req, res) => {
      const schema = z.object({
        bankName: z.string().trim().min(2),
        branchName: z.string().trim().min(2),
        accountHolderName: z.string().trim().min(2),
        accountNumber: z.string().trim().min(6).max(34),
        swiftCode: z.string().trim().optional().default(''),
        iban: z.string().trim().optional().default(''),
        routingCode: z.string().trim().optional().default(''),
        currency: z.enum(['NPR', 'USD', 'INR']).default('NPR'),
        purpose: z.enum(['TUITION_FEES', 'GENERAL_SETTLEMENT', 'EXAMS', 'TRANSPORT']).default('TUITION_FEES'),
        isPrimary: z.boolean().default(false),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Valid bank account details (min 6 digits) required.', error: { code: 'VALIDATION_ERROR', details: null } });
      }

      const d = parsed.data;
      const schoolId = req.auth!.activeSchoolId!;
      const id = `bnk-${crypto.randomUUID().slice(0, 8)}`;
      const masked = maskAccountDisplay(d.accountNumber);
      const encrypted = encryptSensitiveField(d.accountNumber);
      const now = new Date().toISOString();

      db.exec('BEGIN');
      try {
        if (d.isPrimary) {
          db.prepare(`UPDATE school_bank_accounts SET is_primary = 0 WHERE school_id = ?`).run(schoolId);
        }
        db.prepare(
          `INSERT INTO school_bank_accounts (id, school_id, bank_name, branch_name, account_holder_name, account_number_enc, account_number_masked, swift_code, iban, routing_code, currency, purpose, verification_status, is_primary, settlement_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_VERIFICATION', ?, 0, ?)`
        ).run(
          id,
          schoolId,
          d.bankName,
          d.branchName,
          d.accountHolderName,
          encrypted,
          masked,
          d.swiftCode,
          d.iban,
          d.routingCode,
          d.currency,
          d.purpose,
          d.isPrimary ? 1 : 0,
          now
        );
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      logAuditEvent(db, {
        schoolId,
        actorUserId: req.auth!.userId,
        action: 'BANK_ACCOUNT_ADDED',
        resourceType: 'BANK_ACCOUNT',
        resourceId: id,
        metadata: { bankName: d.bankName, maskedAccount: masked },
      });

      return res.status(201).json({
        success: true,
        message: `Bank account ${masked} registered and queued for verification.`,
        data: { id, accountNumberMasked: masked, verificationStatus: 'PENDING_VERIFICATION' },
      });
    }
  );

  router.post(
    '/finance/bank-accounts/:id/verify',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'SCHOOL_ORG', 'PLATFORM_SUPER_ADMIN'),
    (req, res) => {
      const schema = z.object({
        status: z.enum(['VERIFIED', 'REJECTED', 'SUSPENDED']),
        isPrimary: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid verification decision.', error: { code: 'VALIDATION_ERROR', details: null } });

      const schoolId = req.auth!.activeSchoolId!;
      const existing = db.prepare(`SELECT id FROM school_bank_accounts WHERE id = ? AND school_id = ?`).get(req.params.id, schoolId);
      if (!existing) return res.status(404).json({ success: false, message: 'Bank account not found for school.', error: { code: 'NOT_FOUND', details: null } });

      const now = new Date().toISOString();
      const settlementActive = parsed.data.status === 'VERIFIED' ? 1 : 0;

      db.exec('BEGIN');
      try {
        if (parsed.data.isPrimary && parsed.data.status === 'VERIFIED') {
          db.prepare(`UPDATE school_bank_accounts SET is_primary = 0 WHERE school_id = ?`).run(schoolId);
        }
        db.prepare(
          `UPDATE school_bank_accounts SET verification_status = ?, settlement_active = ?, is_primary = COALESCE(?, is_primary), verified_by_user_id = ?, verified_at = ?
           WHERE id = ? AND school_id = ?`
        ).run(
          parsed.data.status,
          settlementActive,
          parsed.data.isPrimary === undefined ? null : parsed.data.isPrimary ? 1 : 0,
          req.auth!.userId,
          now,
          req.params.id,
          schoolId
        );
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      logAuditEvent(db, {
        schoolId,
        actorUserId: req.auth!.userId,
        action: `BANK_ACCOUNT_${parsed.data.status}`,
        resourceType: 'BANK_ACCOUNT',
        resourceId: req.params.id,
      });

      return res.json({ success: true, message: `Bank account marked ${parsed.data.status}.` });
    }
  );

  // ======================== PAYMENT MERCHANTS (SERVER-ENCRYPTED SECRETS) ========================
  router.post(
    '/finance/merchants',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'SCHOOL_ORG', 'STAFF_ACCOUNTANT'),
    (req, res) => {
      const schema = z.object({
        provider: z.enum(['ESEWA', 'KHALTI', 'BANK_TRANSFER']),
        merchantCode: z.string().trim().min(2),
        publicKey: z.string().trim().optional().default(''),
        secretKey: z.string().trim().optional(),
        mode: z.enum(['TEST', 'PRODUCTION']).default('TEST'),
        displayLabel: z.string().trim().min(2),
        isActive: z.boolean().default(true),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid merchant config.', error: { code: 'VALIDATION_ERROR', details: null } });

      const d = parsed.data;
      const schoolId = req.auth!.activeSchoolId!;
      const existing = db
        .prepare(`SELECT id, secret_key_enc FROM payment_merchants WHERE school_id = ? AND provider = ?`)
        .get(schoolId, d.provider) as { id: string; secret_key_enc: string } | undefined;

      const secretEnc = d.secretKey && d.secretKey.length > 0 ? encryptSensitiveField(d.secretKey) : existing?.secret_key_enc || '';
      const now = new Date().toISOString();

      if (existing) {
        db.prepare(
          `UPDATE payment_merchants SET merchant_code = ?, public_key = ?, secret_key_enc = ?, mode = ?, display_label = ?, is_active = ?, updated_at = ?
           WHERE id = ?`
        ).run(d.merchantCode, d.publicKey, secretEnc, d.mode, d.displayLabel, d.isActive ? 1 : 0, now, existing.id);
      } else {
        db.prepare(
          `INSERT INTO payment_merchants (id, school_id, provider, merchant_code, public_key, secret_key_enc, mode, display_label, is_active, verified_status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIGURED', ?, ?)`
        ).run(
          `mrc-${crypto.randomUUID().slice(0, 8)}`,
          schoolId,
          d.provider,
          d.merchantCode,
          d.publicKey,
          secretEnc,
          d.mode,
          d.displayLabel,
          d.isActive ? 1 : 0,
          now,
          now
        );
      }

      logAuditEvent(db, {
        schoolId,
        actorUserId: req.auth!.userId,
        action: 'PAYMENT_MERCHANT_SAVED',
        resourceType: 'PAYMENT_MERCHANT',
        metadata: { provider: d.provider, mode: d.mode, active: d.isActive },
      });

      return res.json({ success: true, message: `${d.provider} gateway settings saved (${d.mode} mode).` });
    }
  );

  // ======================== PARENT CHECKOUT & PAYMENT VERIFICATION ========================
  router.post('/payments/orders/initiate', requireAuth, requireSchoolTenant, async (req, res) => {
    const schema = z.object({
      invoiceId: z.string().min(1),
      provider: z.enum(['ESEWA', 'KHALTI', 'BANK_TRANSFER']),
      idempotencyKey: z.string().min(6).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invoice ID and provider are required.', error: { code: 'VALIDATION_ERROR', details: null } });

    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;
    const invoice = db
      .prepare(`SELECT * FROM fee_invoices WHERE id = ? AND school_id = ?`)
      .get(parsed.data.invoiceId, schoolId) as Record<string, unknown> | undefined;

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Fee invoice not found in your active school.', error: { code: 'NOT_FOUND', details: null } });
    }
    if (String(invoice.status) === 'PAID') {
      return res.status(409).json({ success: false, message: 'This fee invoice has already been settled.', error: { code: 'ALREADY_PAID', details: null } });
    }

    // Strict ownership check for Parent/Student
    if (auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN') {
      const childIds = getLinkedStudentIds(db, auth.userId, schoolId);
      if (!childIds.has(String(invoice.student_id))) {
        return res.status(403).json({ success: false, message: 'You can only pay fees for your verified linked children.', error: { code: 'FORBIDDEN', details: null } });
      }
    } else if (auth.activeRole === 'STUDENT') {
      const stu = db.prepare(`SELECT id FROM students WHERE user_id = ? AND school_id = ?`).get(auth.userId, schoolId) as { id: string } | undefined;
      if (!stu || stu.id !== String(invoice.student_id)) {
        return res.status(403).json({ success: false, message: 'Students can only initiate payment for their own invoices.', error: { code: 'FORBIDDEN', details: null } });
      }
    }

    const idempotencyKey = parsed.data.idempotencyKey || `ord-${invoice.id}-${parsed.data.provider}-${crypto.randomUUID().slice(0, 8)}`;
    const existingOrder = db.prepare(`SELECT * FROM payment_orders WHERE idempotency_key = ?`).get(idempotencyKey) as Record<string, unknown> | undefined;
    if (existingOrder) {
      return res.json({ success: true, message: 'Existing payment order reused idempotently.', data: { order: existingOrder } });
    }

    const netAmount = Math.max(0, Number(invoice.amount || 0) - Number(invoice.discount || 0));
    const merchant = db
      .prepare(`SELECT * FROM payment_merchants WHERE school_id = ? AND provider = ?`)
      .get(schoolId, parsed.data.provider) as MerchantRecord | undefined;

    const orderUuid = `ORD-${Date.now().toString().slice(-6)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
    const origin = `${req.protocol}://${req.get('host') || 'localhost:3000'}`;

    try {
      const initiation = await initiateProviderCheckout({
        merchant,
        provider: parsed.data.provider,
        orderUuid,
        amount: netAmount,
        invoiceTitle: String(invoice.title),
        appOrigin: origin,
      });

      const orderId = `po-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO payment_orders (id, school_id, invoice_id, student_id, payer_user_id, provider, order_uuid, amount, currency, status, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NPR', 'INITIATED', ?, ?, ?)`
      ).run(orderId, schoolId, String(invoice.id), String(invoice.student_id), auth.userId, parsed.data.provider, orderUuid, netAmount, idempotencyKey, now, now);

      return res.status(201).json({
        success: true,
        message: initiation.instructions,
        data: {
          orderId,
          orderUuid,
          amount: netAmount,
          initiation,
        },
      });
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode || 500;
      const code = (err as { code?: string }).code || 'GATEWAY_ERROR';
      return res.status(status).json({
        success: false,
        message: err instanceof Error ? err.message : 'Payment initiation failed.',
        error: { code, details: null },
      });
    }
  });

  router.post('/payments/orders/:orderUuid/submit-bank-proof', requireAuth, requireSchoolTenant, (req, res) => {
    const schema = z.object({
      bankReference: z.string().trim().min(4),
      proofAttachmentUrl: z.string().trim().optional().default(''),
      payerNote: z.string().trim().optional().default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Valid bank transaction reference is required.', error: { code: 'VALIDATION_ERROR', details: null } });

    const order = db
      .prepare(`SELECT * FROM payment_orders WHERE order_uuid = ? AND school_id = ?`)
      .get(req.params.orderUuid, req.auth!.activeSchoolId!) as Record<string, unknown> | undefined;
    if (!order) return res.status(404).json({ success: false, message: 'Payment order not found.', error: { code: 'NOT_FOUND', details: null } });
    if (String(order.payer_user_id) !== req.auth!.userId && !['PRINCIPAL', 'STAFF_ACCOUNTANT'].includes(req.auth!.activeRole)) {
      return res.status(403).json({ success: false, message: 'Only the payer can upload transfer proof.', error: { code: 'FORBIDDEN', details: null } });
    }

    db.prepare(
      `UPDATE payment_orders SET status = 'PENDING_MANUAL_REVIEW', bank_reference = ?, proof_attachment_url = ?, payer_note = ?, updated_at = ?
       WHERE id = ?`
    ).run(parsed.data.bankReference, parsed.data.proofAttachmentUrl, parsed.data.payerNote, new Date().toISOString(), String(order.id));

    return res.json({ success: true, message: 'Bank transfer reference submitted for Finance team verification.' });
  });

  router.post(
    '/payments/orders/:orderUuid/review-bank-proof',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'SCHOOL_ORG', 'STAFF_ACCOUNTANT', 'STAFF_ADMIN'),
    (req, res) => {
      const schema = z.object({
        decision: z.enum(['VERIFIED', 'REJECTED']),
        reviewNote: z.string().trim().optional().default(''),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid verification review.', error: { code: 'VALIDATION_ERROR', details: null } });

      const schoolId = req.auth!.activeSchoolId!;
      const order = db
        .prepare(`SELECT * FROM payment_orders WHERE order_uuid = ? AND school_id = ?`)
        .get(req.params.orderUuid, schoolId) as Record<string, unknown> | undefined;
      if (!order) return res.status(404).json({ success: false, message: 'Payment order not found.', error: { code: 'NOT_FOUND', details: null } });
      if (String(order.status) === 'VERIFIED') {
        return res.json({ success: true, message: 'Bank transfer was already verified idempotently.' });
      }

      const now = new Date().toISOString();
      if (parsed.data.decision === 'REJECTED') {
        db.prepare(
          `UPDATE payment_orders SET status = 'REJECTED', reviewed_by_user_id = ?, review_note = ?, updated_at = ? WHERE id = ?`
        ).run(req.auth!.userId, parsed.data.reviewNote || 'Transfer voucher could not be reconciled.', now, String(order.id));
        return res.json({ success: true, message: 'Bank transfer proof rejected.' });
      }

      const amount = Number(order.amount);
      const receipt = `RCP-BNK-${Date.now().toString().slice(-6)}`;
      const txnId = `txn-${crypto.randomUUID().slice(0, 8)}`;

      db.exec('BEGIN');
      try {
        db.prepare(
          `UPDATE payment_orders SET status = 'VERIFIED', reviewed_by_user_id = ?, review_note = ?, updated_at = ? WHERE id = ?`
        ).run(req.auth!.userId, parsed.data.reviewNote || 'Matched with bank statement', now, String(order.id));

        db.prepare(
          `UPDATE fee_invoices SET status = 'PAID', gateway = 'BANK_TRANSFER', receipt_number = ?, paid_at = ? WHERE id = ? AND school_id = ?`
        ).run(receipt, now, String(order.invoice_id), schoolId);

        db.prepare(
          `INSERT INTO payment_transactions (id, school_id, order_id, invoice_id, provider, provider_txn_id, amount, fee_deducted, net_amount, currency, status, idempotency_key, raw_status_note, verified_at, created_at)
           VALUES (?, ?, ?, ?, 'BANK_TRANSFER', ?, ?, 0, ?, 'NPR', 'SETTLED', ?, 'Verified by Finance Team', ?, ?)`
        ).run(
          txnId,
          schoolId,
          String(order.id),
          String(order.invoice_id),
          String(order.bank_reference || order.order_uuid),
          amount,
          amount,
          `bnk-settle-${order.order_uuid}`,
          now,
          now
        );

        postDoubleEntryJournal(db, {
          schoolId,
          entryDate: now.slice(0, 10),
          referenceType: 'BANK_TRANSFER_VERIFIED',
          referenceId: txnId,
          description: `Verified direct bank fee transfer (${receipt})`,
          actorUserId: req.auth!.userId,
          lines: [
            { accountId: `coa-${schoolId}-1010`, debit: amount, credit: 0, memo: `Bank deposit ${order.bank_reference || order.order_uuid}` },
            { accountId: `coa-${schoolId}-4010`, debit: 0, credit: amount, memo: `Fee invoice ${order.invoice_id}` },
          ],
        });

        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      logAuditEvent(db, {
        schoolId,
        actorUserId: req.auth!.userId,
        action: 'BANK_TRANSFER_VERIFIED',
        resourceType: 'PAYMENT_ORDER',
        resourceId: String(order.id),
        metadata: { amount, receipt },
      });

      return res.json({ success: true, message: `Bank transfer verified and receipt ${receipt} issued.`, data: { receiptNumber: receipt, transactionId: txnId } });
    }
  );

  // Server-Side Payment Verification & Webhook Idempotency Endpoint
  router.post('/payments/verify', requireAuth, requireSchoolTenant, async (req, res) => {
    const schema = z.object({
      orderUuid: z.string().min(3),
      providerTxnId: z.string().trim().min(4),
      callbackSignature: z.string().optional(),
      idempotencyKey: z.string().trim().min(6).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Valid order UUID and transaction ID required.', error: { code: 'VALIDATION_ERROR', details: null } });

    const schoolId = req.auth!.activeSchoolId!;
    const idemKey = parsed.data.idempotencyKey || `verify-${parsed.data.orderUuid}-${parsed.data.providerTxnId}`;

    // Idempotency guard: never double-count settlement or duplicate journal entry!
    const existingTxn = db
      .prepare(`SELECT * FROM payment_transactions WHERE (idempotency_key = ? OR order_id = (SELECT id FROM payment_orders WHERE order_uuid = ? AND school_id = ?)) AND status = 'SETTLED'`)
      .get(idemKey, parsed.data.orderUuid, schoolId) as Record<string, unknown> | undefined;

    if (existingTxn) {
      return res.json({
        success: true,
        idempotentReplay: true,
        message: 'Payment already verified and settled (duplicate callback suppressed).',
        data: { transaction: existingTxn },
      });
    }

    const order = db
      .prepare(`SELECT * FROM payment_orders WHERE order_uuid = ? AND school_id = ?`)
      .get(parsed.data.orderUuid, schoolId) as Record<string, unknown> | undefined;
    if (!order) return res.status(404).json({ success: false, message: 'Payment order not found.', error: { code: 'NOT_FOUND', details: null } });
    if (order.provider === 'BANK_TRANSFER') {
      return res.status(400).json({ success: false, message: 'Bank transfers require manual Finance review.', error: { code: 'INVALID_PROVIDER', details: null } });
    }

    const merchant = db
      .prepare(`SELECT * FROM payment_merchants WHERE school_id = ? AND provider = ?`)
      .get(schoolId, String(order.provider)) as MerchantRecord | undefined;

    const amount = Number(order.amount);
    const verification = await verifyProviderSettlement({
      merchant,
      provider: String(order.provider) as 'ESEWA' | 'KHALTI',
      orderUuid: String(order.order_uuid),
      amount,
      providerTxnId: parsed.data.providerTxnId,
      callbackSignature: parsed.data.callbackSignature,
    });

    if (!verification.verified) {
      return res.status(400).json({
        success: false,
        message: `Gateway verification failed: ${verification.note}`,
        error: { code: 'VERIFICATION_FAILED', details: null },
      });
    }

    const now = new Date().toISOString();
    const receipt = `RCP-${String(order.provider).slice(0, 3)}-${Date.now().toString().slice(-6)}`;
    const txnId = `txn-${crypto.randomUUID().slice(0, 8)}`;
    const netAmount = Math.round((amount - verification.gatewayFee) * 100) / 100;

    db.exec('BEGIN');
    try {
      db.prepare(`UPDATE payment_orders SET status = 'VERIFIED', updated_at = ? WHERE id = ?`).run(now, String(order.id));
      db.prepare(
        `UPDATE fee_invoices SET status = 'PAID', gateway = ?, receipt_number = ?, paid_at = ? WHERE id = ? AND school_id = ?`
      ).run(String(order.provider), receipt, now, String(order.invoice_id), schoolId);

      db.prepare(
        `INSERT INTO payment_transactions (id, school_id, order_id, invoice_id, provider, provider_txn_id, amount, fee_deducted, net_amount, currency, status, idempotency_key, raw_status_note, verified_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NPR', 'SETTLED', ?, ?, ?, ?)`
      ).run(
        txnId,
        schoolId,
        String(order.id),
        String(order.invoice_id),
        String(order.provider),
        parsed.data.providerTxnId,
        amount,
        verification.gatewayFee,
        netAmount,
        idemKey,
        verification.note,
        now,
        now
      );

      const journalLines = [
        { accountId: `coa-${schoolId}-1020`, debit: netAmount, credit: 0, memo: `${order.provider} clearing ${receipt}` },
        ...(verification.gatewayFee > 0
          ? [{ accountId: `coa-${schoolId}-5010`, debit: verification.gatewayFee, credit: 0, memo: 'Gateway processing fee' }]
          : []),
        { accountId: `coa-${schoolId}-4010`, debit: 0, credit: amount, memo: `Fee settlement ${order.invoice_id}` },
      ];

      postDoubleEntryJournal(db, {
        schoolId,
        entryDate: now.slice(0, 10),
        referenceType: 'GATEWAY_PAYMENT',
        referenceId: txnId,
        description: `${order.provider} settlement for invoice ${order.invoice_id} (${receipt})`,
        actorUserId: req.auth!.userId,
        lines: journalLines,
      });

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    return res.json({
      success: true,
      message: `${verification.note} Receipt ${receipt} generated.`,
      data: { transactionId: txnId, receiptNumber: receipt, netAmount },
    });
  });

  // ======================== REFUNDS, DOUBLE-ENTRY LEDGER, VENDORS & PLATFORM PLANS ========================
  router.post(
    '/finance/refunds',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'SCHOOL_ORG', 'STAFF_ACCOUNTANT'),
    (req, res) => {
      const schema = z.object({
        transactionId: z.string().min(1),
        amount: z.coerce.number().positive(),
        reason: z.string().trim().min(3),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Valid refund amount and reason required.', error: { code: 'VALIDATION_ERROR', details: null } });

      const schoolId = req.auth!.activeSchoolId!;
      const txn = db
        .prepare(`SELECT * FROM payment_transactions WHERE id = ? AND school_id = ?`)
        .get(parsed.data.transactionId, schoolId) as Record<string, unknown> | undefined;
      if (!txn) return res.status(404).json({ success: false, message: 'Payment transaction not found.', error: { code: 'NOT_FOUND', details: null } });

      const alreadyRefunded = Number(
        (
          db
            .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM payment_refunds WHERE transaction_id = ? AND status = 'COMPLETED'`)
            .get(txn.id as string) as { total: number }
        ).total || 0
      );

      const check = validateRefundAmount({
        settledAmount: Number(txn.amount),
        alreadyRefunded,
        requestedRefund: parsed.data.amount,
      });
      if (!check.allowed) {
        return res.status(400).json({ success: false, message: check.reason, error: { code: 'REFUND_EXCEEDS_SETTLED', details: null } });
      }

      const refundId = `rfd-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();

      db.exec('BEGIN');
      try {
        db.prepare(
          `INSERT INTO payment_refunds (id, school_id, transaction_id, invoice_id, amount, reason, status, initiated_by_user_id, approved_by_user_id, created_at, processed_at)
           VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?)`
        ).run(refundId, schoolId, String(txn.id), String(txn.invoice_id), parsed.data.amount, parsed.data.reason, req.auth!.userId, req.auth!.userId, now, now);

        if (alreadyRefunded + parsed.data.amount >= Number(txn.amount) - 0.01) {
          db.prepare(`UPDATE fee_invoices SET status = 'REFUNDED' WHERE id = ? AND school_id = ?`).run(String(txn.invoice_id), schoolId);
        }

        postDoubleEntryJournal(db, {
          schoolId,
          entryDate: now.slice(0, 10),
          referenceType: 'PAYMENT_REFUND',
          referenceId: refundId,
          description: `Refund issued for txn ${txn.id}: ${parsed.data.reason}`,
          actorUserId: req.auth!.userId,
          lines: [
            { accountId: `coa-${schoolId}-5020`, debit: parsed.data.amount, credit: 0, memo: 'Fee refund reversal' },
            { accountId: `coa-${schoolId}-1010`, debit: 0, credit: parsed.data.amount, memo: `Refund payout ${refundId}` },
          ],
        });

        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      return res.status(201).json({ success: true, message: 'Refund processed and reversal journal posted.', data: { refundId } });
    }
  );

  router.get(
    '/finance/accounting/ledger',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'STAFF_ACCOUNTANT', 'PLATFORM_SUPER_ADMIN'),
    (req, res) => {
      const schoolId = req.auth!.activeSchoolId!;
      ensureSchoolDefaultAccounts(db, schoolId);

      const accounts = db
        .prepare(`SELECT * FROM chart_of_accounts WHERE school_id = ? ORDER BY code ASC`)
        .all(schoolId);
      const entries = db
        .prepare(`SELECT * FROM journal_entries WHERE school_id = ? ORDER BY created_at DESC LIMIT 50`)
        .all(schoolId) as Array<Record<string, unknown>>;
      const lines = db
        .prepare(
          `SELECT jl.*, coa.code as account_code, coa.name as account_name
           FROM journal_entry_lines jl JOIN chart_of_accounts coa ON coa.id = jl.account_id
           WHERE jl.school_id = ?`
        )
        .all(schoolId) as Array<Record<string, unknown>>;

      const refunds = db
        .prepare(`SELECT * FROM payment_refunds WHERE school_id = ? ORDER BY created_at DESC LIMIT 30`)
        .all(schoolId);

      const vendors = db.prepare(`SELECT * FROM vendors WHERE school_id = ? ORDER BY created_at DESC`).all(schoolId);
      const purchaseOrders = db
        .prepare(
          `SELECT po.*, v.name as vendor_name
           FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id
           WHERE po.school_id = ? ORDER BY po.created_at DESC`
        )
        .all(schoolId);

      return res.json({
        success: true,
        data: {
          accounts,
          journalEntries: entries.map((e) => ({
            ...e,
            lines: lines.filter((l) => String(l.entry_id) === String(e.id)),
          })),
          refunds,
          vendors,
          purchaseOrders,
        },
      });
    }
  );

  router.post(
    '/finance/accounting/journals',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'SCHOOL_ORG', 'STAFF_ACCOUNTANT'),
    (req, res) => {
      const schema = z.object({
        entryDate: z.string().min(4),
        description: z.string().trim().min(3),
        lines: z.array(
          z.object({
            accountId: z.string().min(1),
            debit: z.coerce.number().min(0).default(0),
            credit: z.coerce.number().min(0).default(0),
            memo: z.string().optional().default(''),
          })
        ),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid journal payload.', error: { code: 'VALIDATION_ERROR', details: null } });

      try {
        const result = postDoubleEntryJournal(db, {
          schoolId: req.auth!.activeSchoolId!,
          entryDate: parsed.data.entryDate,
          referenceType: 'MANUAL_JOURNAL',
          referenceId: `MNL-${Date.now().toString().slice(-6)}`,
          description: parsed.data.description,
          actorUserId: req.auth!.userId,
          lines: parsed.data.lines,
        });
        return res.status(201).json({ success: true, message: 'Balanced journal entry posted.', data: result });
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode || 400;
        const code = (err as { code?: string }).code || 'UNBALANCED_JOURNAL';
        return res.status(status).json({
          success: false,
          message: err instanceof Error ? err.message : 'Journal posting failed.',
          error: { code, details: null },
        });
      }
    }
  );

  router.post(
    '/finance/vendors',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'SCHOOL_ORG', 'STAFF_ACCOUNTANT', 'STAFF_ADMIN'),
    (req, res) => {
      const schema = z.object({
        name: z.string().trim().min(2),
        category: z.string().trim().min(2),
        contactPhone: z.string().trim().min(5),
        panVatNumber: z.string().trim().optional().default(''),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid vendor details.', error: { code: 'VALIDATION_ERROR', details: null } });
      const id = `vnd-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO vendors (id, school_id, name, category, contact_phone, pan_vat_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, req.auth!.activeSchoolId!, parsed.data.name, parsed.data.category, parsed.data.contactPhone, parsed.data.panVatNumber, new Date().toISOString());
      return res.status(201).json({ success: true, message: 'Vendor registered.', data: { id } });
    }
  );

  router.post(
    '/finance/purchase-orders',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'SCHOOL_ORG', 'STAFF_ACCOUNTANT'),
    (req, res) => {
      const schema = z.object({
        vendorId: z.string().min(1),
        title: z.string().trim().min(3),
        amount: z.coerce.number().positive(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid purchase order.', error: { code: 'VALIDATION_ERROR', details: null } });
      const id = `po-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO purchase_orders (id, school_id, vendor_id, title, amount, status, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'APPROVED', ?, ?)`
      ).run(id, req.auth!.activeSchoolId!, parsed.data.vendorId, parsed.data.title, parsed.data.amount, req.auth!.userId, new Date().toISOString());
      return res.status(201).json({ success: true, message: 'Purchase order approved.', data: { id } });
    }
  );

  router.get('/finance/platform-subscriptions', requireAuth, (req, res) => {
    const plans = db.prepare(`SELECT * FROM platform_subscription_plans ORDER BY monthly_npr ASC`).all();
    const active = req.auth!.activeSchoolId
      ? db
          .prepare(
            `SELECT ss.*, p.name as plan_name, p.monthly_npr, p.student_limit
             FROM school_subscriptions ss JOIN platform_subscription_plans p ON p.id = ss.plan_id
             WHERE ss.school_id = ?`
          )
          .get(req.auth!.activeSchoolId)
      : null;
    return res.json({ success: true, data: { plans, subscription: active } });
  });

  router.post(
    '/finance/platform-subscriptions',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'SCHOOL_ORG', 'PLATFORM_SUPER_ADMIN'),
    (req, res) => {
      const planId = z.string().min(1).parse(req.body?.planId);
      const plan = db.prepare(`SELECT id, name FROM platform_subscription_plans WHERE id = ?`).get(planId) as { id: string; name: string } | undefined;
      if (!plan) return res.status(404).json({ success: false, message: 'Subscription plan not found.', error: { code: 'NOT_FOUND', details: null } });
      const renew = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      db.prepare(
        `INSERT INTO school_subscriptions (id, school_id, plan_id, status, renews_at, updated_at)
         VALUES (?, ?, ?, 'ACTIVE', ?, ?)
         ON CONFLICT(school_id) DO UPDATE SET plan_id = excluded.plan_id, updated_at = excluded.updated_at`
      ).run(`sub-${crypto.randomUUID().slice(0, 8)}`, req.auth!.activeSchoolId!, plan.id, renew, new Date().toISOString());
      return res.json({ success: true, message: `Platform subscription updated to ${plan.name}.` });
    }
  );

  return router;
}
