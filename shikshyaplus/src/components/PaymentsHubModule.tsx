import React, { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  Building2,
  CheckCircle2,
  CreditCard,
  Download,
  Landmark,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { apiGet, apiMutate } from '../lib/api';
import { formatCurrency, formatDateByCalendar } from '../lib/domainRules';
import type { AuthUser } from '../types';

interface InvoiceItem {
  id: string;
  student_id: string;
  student_name: string;
  student_code: string;
  title: string;
  fee_type: string;
  amount: number;
  discount: number;
  due_date: string;
  status: string;
  gateway: string | null;
  receipt_number: string | null;
  paid_at: string | null;
}

interface BankAccountItem {
  id: string;
  bank_name: string;
  branch_name: string;
  account_holder_name: string;
  account_number_masked: string;
  swift_code: string;
  currency: string;
  purpose: string;
  verification_status: string;
  is_primary: number;
  settlement_active: number;
}

interface MerchantItem {
  id: string;
  provider: 'ESEWA' | 'KHALTI' | 'BANK_TRANSFER';
  merchant_code: string;
  public_key: string;
  mode: 'TEST' | 'PRODUCTION';
  display_label: string;
  is_active: number;
  has_secret: number;
}

interface PaymentOrderItem {
  id: string;
  invoice_id: string;
  invoice_title: string;
  student_name: string;
  student_code: string;
  payer_name: string;
  provider: string;
  order_uuid: string;
  amount: number;
  status: string;
  bank_reference: string | null;
  payer_note: string | null;
  created_at: string;
}

interface PaymentTransactionItem {
  id: string;
  invoice_id: string;
  invoice_title: string;
  student_name: string;
  student_code: string;
  provider: string;
  provider_txn_id: string;
  amount: number;
  fee_deducted: number;
  net_amount: number;
  refunded_amount: number;
  status: string;
  verified_at: string;
}

interface PaymentsOverviewData {
  isFinanceAdmin: boolean;
  kpis: {
    totalReceivable: number;
    totalPaid: number;
    pendingBankReviews: number;
    settledTransactionsCount: number;
  };
  invoices: InvoiceItem[];
  orders: PaymentOrderItem[];
  transactions: PaymentTransactionItem[];
  bankAccounts: BankAccountItem[];
  merchants: MerchantItem[];
}

interface LedgerData {
  accounts: Array<{ id: string; code: string; name: string; account_type: string; balance: number }>;
  journalEntries: Array<{
    id: string;
    entry_date: string;
    reference_type: string;
    description: string;
    lines: Array<{ account_code: string; account_name: string; debit: number; credit: number }>;
  }>;
  refunds: Array<{ id: string; transaction_id: string; amount: number; reason: string; status: string; created_at: string }>;
  vendors: Array<{ id: string; name: string; category: string; contact_phone: string; pan_vat_number: string }>;
  purchaseOrders: Array<{ id: string; vendor_name: string; title: string; amount: number; status: string }>;
}

interface PlatformPlansData {
  plans: Array<{ id: string; name: string; target_audience: string; monthly_npr: number; student_limit: number; features_summary: string }>;
  subscription: { plan_id: string; plan_name: string; status: string; renews_at: string; monthly_npr: number } | null;
}

export const PaymentsHubModule: React.FC<{ user: AuthUser; calendar: 'AD' | 'BS' }> = ({ user, calendar }) => {
  const [data, setData] = useState<PaymentsOverviewData | null>(null);
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [plansData, setPlansData] = useState<PlatformPlansData | null>(null);
  const [subTab, setSubTab] = useState<'overview' | 'banks' | 'gateways' | 'accounting' | 'platform'>('overview');
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Checkout Modal State (eSewa / Khalti / Direct Bank Transfer)
  const [checkoutInvoice, setCheckoutInvoice] = useState<InvoiceItem | null>(null);
  const [checkoutProvider, setCheckoutProvider] = useState<'ESEWA' | 'KHALTI' | 'BANK_TRANSFER'>('ESEWA');
  const [activeOrder, setActiveOrder] = useState<{
    orderUuid: string;
    amount: number;
    provider: 'ESEWA' | 'KHALTI' | 'BANK_TRANSFER';
    mode: string;
    instructions: string;
    signature?: string;
  } | null>(null);
  const [bankRefInput, setBankRefInput] = useState('');
  const [bankNoteInput, setBankNoteInput] = useState('');
  const [sandboxTxnInput, setSandboxTxnInput] = useState('');

  // Add Bank Account Modal
  const [showAddBank, setShowAddBank] = useState(false);
  const [bankForm, setBankForm] = useState({
    bankName: '',
    branchName: '',
    accountHolderName: '',
    accountNumber: '',
    swiftCode: '',
    purpose: 'TUITION_FEES',
    isPrimary: true,
  });

  // Merchant Form
  const [merchantForm, setMerchantForm] = useState({
    provider: 'ESEWA' as 'ESEWA' | 'KHALTI',
    merchantCode: '',
    publicKey: '',
    secretKey: '',
    mode: 'TEST' as 'TEST' | 'PRODUCTION',
    displayLabel: '',
  });

  // Refund Form
  const [refundTarget, setRefundTarget] = useState<PaymentTransactionItem | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');

  // Vendor & Purchase Order Forms
  const [vendorForm, setVendorForm] = useState({ name: '', category: 'Academic Supplies', contactPhone: '', panVatNumber: '' });
  const [poForm, setPoForm] = useState({ vendorId: '', title: '', amount: '' });

  const loadAll = async () => {
    const res = await apiGet<PaymentsOverviewData>('/payments/overview', `pay:${user.activeSchoolId}:${user.userId}`);
    if (res.success && res.data) {
      setData(res.data);
      if (res.data.isFinanceAdmin) {
        const [ledRes, planRes] = await Promise.all([
          apiGet<LedgerData>('/finance/accounting/ledger', `led:${user.activeSchoolId}`),
          apiGet<PlatformPlansData>('/finance/platform-subscriptions', 'plat:plans'),
        ]);
        if (ledRes.success && ledRes.data) setLedger(ledRes.data);
        if (planRes.success && planRes.data) setPlansData(planRes.data);
      }
    }
  };

  useEffect(() => {
    loadAll();
  }, [user.activeSchoolId, user.activeRole]);

  const handleDownloadReceiptPdf = (inv: InvoiceItem) => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    doc.setFontSize(14);
    doc.text(user.activeSchoolName || 'ShikshyaPlus Verified School', 30, 40);
    doc.setFontSize(10);
    doc.text('OFFICIAL FEE SETTLEMENT RECEIPT', 30, 58);
    doc.line(30, 68, 390, 68);
    doc.text(`Receipt No: ${inv.receipt_number || inv.id}`, 30, 92);
    doc.text(`Student: ${inv.student_name} (${inv.student_code})`, 30, 110);
    doc.text(`Particulars: ${inv.title} · ${inv.fee_type}`, 30, 128);
    doc.text(`Payment Channel: ${inv.gateway || 'VERIFIED'}`, 30, 146);
    doc.text(`Settled On: ${inv.paid_at ? formatDateByCalendar(inv.paid_at, calendar) : 'Confirmed'}`, 30, 164);
    doc.setFontSize(12);
    const net = Math.max(0, Number(inv.amount) - Number(inv.discount));
    doc.text(`Total Paid: ${formatCurrency(net, 'NPR')}`, 30, 198);
    doc.setFontSize(8);
    doc.text('Nepal-First · Multi-Tenant SaaS · digital PWA by chandra prasad prasain', 30, 238);
    doc.save(`receipt-${inv.receipt_number || inv.id}.pdf`);
  };

  const handleInitiateCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutInvoice) return;
    setStatusMsg(null);
    const res = await apiMutate<{
      orderUuid: string;
      amount: number;
      initiation: {
        provider: 'ESEWA' | 'KHALTI' | 'BANK_TRANSFER';
        mode: string;
        instructions: string;
        formFields?: Record<string, string>;
      };
    }>('/payments/orders/initiate', 'POST', {
      invoiceId: checkoutInvoice.id,
      provider: checkoutProvider,
    });
    if (!res.success || !res.data) {
      setStatusMsg({ kind: 'err', text: res.message || 'Could not initiate checkout.' });
      return;
    }
    setActiveOrder({
      orderUuid: res.data.orderUuid,
      amount: res.data.amount,
      provider: res.data.initiation.provider,
      mode: res.data.initiation.mode,
      instructions: res.data.initiation.instructions,
      signature: res.data.initiation.formFields?.signature,
    });
    setSandboxTxnInput(`${res.data.initiation.provider}-${res.data.orderUuid.slice(-6)}`);
  };

  const handleConfirmGatewayVerification = async () => {
    if (!activeOrder) return;
    const res = await apiMutate('/payments/verify', 'POST', {
      orderUuid: activeOrder.orderUuid,
      providerTxnId: sandboxTxnInput.trim(),
      callbackSignature: activeOrder.signature,
    });
    setStatusMsg({ kind: res.success ? 'ok' : 'err', text: res.message || 'Verification completed.' });
    if (res.success) {
      setCheckoutInvoice(null);
      setActiveOrder(null);
      await loadAll();
    }
  };

  const handleSubmitBankProof = async () => {
    if (!activeOrder || !bankRefInput.trim()) return;
    const res = await apiMutate(`/payments/orders/${activeOrder.orderUuid}/submit-bank-proof`, 'POST', {
      bankReference: bankRefInput.trim(),
      payerNote: bankNoteInput.trim(),
    });
    setStatusMsg({ kind: res.success ? 'ok' : 'err', text: res.message || 'Bank proof submitted.' });
    if (res.success) {
      setCheckoutInvoice(null);
      setActiveOrder(null);
      setBankRefInput('');
      setBankNoteInput('');
      await loadAll();
    }
  };

  const handleReviewBankProof = async (orderUuid: string, decision: 'VERIFIED' | 'REJECTED') => {
    const res = await apiMutate(`/payments/orders/${orderUuid}/review-bank-proof`, 'POST', { decision });
    setStatusMsg({ kind: res.success ? 'ok' : 'err', text: res.message || `Transfer ${decision.toLowerCase()}.` });
    if (res.success) await loadAll();
  };

  const handleCreateBankAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/finance/bank-accounts', 'POST', bankForm);
    setStatusMsg({ kind: res.success ? 'ok' : 'err', text: res.message || 'Bank account registered.' });
    if (res.success) {
      setShowAddBank(false);
      setBankForm({ bankName: '', branchName: '', accountHolderName: '', accountNumber: '', swiftCode: '', purpose: 'TUITION_FEES', isPrimary: true });
      await loadAll();
    }
  };

  const handleVerifyBankAccount = async (id: string, status: 'VERIFIED' | 'REJECTED') => {
    const res = await apiMutate(`/finance/bank-accounts/${id}/verify`, 'POST', { status });
    setStatusMsg({ kind: res.success ? 'ok' : 'err', text: res.message || 'Verification updated.' });
    if (res.success) await loadAll();
  };

  const handleSaveMerchant = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/finance/merchants', 'POST', merchantForm);
    setStatusMsg({ kind: res.success ? 'ok' : 'err', text: res.message || 'Merchant gateway saved.' });
    if (res.success) {
      setMerchantForm((prev) => ({ ...prev, secretKey: '' }));
      await loadAll();
    }
  };

  const handleIssueRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundTarget) return;
    const res = await apiMutate('/finance/refunds', 'POST', {
      transactionId: refundTarget.id,
      amount: Number(refundAmount),
      reason: refundReason,
    });
    setStatusMsg({ kind: res.success ? 'ok' : 'err', text: res.message || 'Refund processed.' });
    if (res.success) {
      setRefundTarget(null);
      setRefundAmount('');
      setRefundReason('');
      await loadAll();
    }
  };

  if (!data) {
    return <div className="p-8 text-sm text-slate-500">Loading Financial & Payment Hub...</div>;
  }

  const isFinanceAdmin = data.isFinanceAdmin;
  const primaryVerifiedBank = data.bankAccounts.find((b) => b.verification_status === 'VERIFIED') || data.bankAccounts[0];

  return (
    <div className="space-y-6">
      {/* Header Banner — eSewa-inspired crisp Digital Payment Hub */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              {isFinanceAdmin ? 'SCHOOL FINANCE, BANKING & ACCOUNTING HUB' : 'MY DIGITAL FEE PAYMENTS'}
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
              {isFinanceAdmin ? 'School Treasury, Gateways & Ledger' : 'School Fee Checkout & Official Receipts'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Direct invoice settlement via configured eSewa, Khalti, or verified school bank transfer · Double-entry audited · No synthetic wallet balances
            </p>
          </div>
          {isFinanceAdmin && (
            <button
              type="button"
              onClick={() => setShowAddBank(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3.5 py-2.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 min-h-[40px]"
            >
              <Plus className="h-4 w-4" />
              <span>Add Bank Account</span>
            </button>
          )}
        </div>

        {/* KPI Row */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-[11px] font-medium text-slate-500">Outstanding Dues</div>
            <div className="mt-1 text-lg font-bold text-amber-700 dark:text-amber-400 tabular-nums whitespace-nowrap">
              {formatCurrency(data.kpis.totalReceivable, 'NPR')}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-[11px] font-medium text-slate-500">Settled & Verified</div>
            <div className="mt-1 text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums whitespace-nowrap">
              {formatCurrency(data.kpis.totalPaid, 'NPR')}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-[11px] font-medium text-slate-500">Pending Bank Reviews</div>
            <div className="mt-1 text-lg font-bold text-slate-900 dark:text-white tabular-nums">{data.kpis.pendingBankReviews}</div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-[11px] font-medium text-slate-500">Verified Primary Bank</div>
            <div className="mt-1 text-xs font-semibold text-slate-900 dark:text-white break-words">
              {primaryVerifiedBank ? `${primaryVerifiedBank.bank_name} · ${primaryVerifiedBank.account_number_masked}` : 'Unlinked'}
            </div>
          </div>
        </div>
      </div>

      {statusMsg && (
        <div
          role="status"
          className={`rounded-xl border p-3.5 text-xs font-medium ${
            statusMsg.kind === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      {/* Admin Sub-tabs */}
      {isFinanceAdmin && (
        <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          {(
            [
              ['overview', 'Invoices & Bank Reviews'],
              ['banks', 'School Bank Accounts'],
              ['gateways', 'Gateway Merchants (eSewa/Khalti)'],
              ['accounting', 'Double-Entry Ledger & Refunds'],
              ['platform', 'Platform Subscriptions'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`rounded-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 min-h-[40px] ${
                subTab === id
                  ? 'bg-[#0F1E36] text-white dark:bg-blue-600'
                  : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* SUBTAB 1: INVOICES, PARENT CHECKOUT & MANUAL REVIEWS */}
      {(!isFinanceAdmin || subTab === 'overview') && (
        <div className="space-y-6">
          {/* Finance Admin Pending Direct Bank Transfers */}
          {isFinanceAdmin && data.orders.some((o) => o.status === 'PENDING_MANUAL_REVIEW') && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-white dark:bg-slate-900 p-5">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Pending Direct Bank Transfer Verification Queue</h2>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.orders
                  .filter((o) => o.status === 'PENDING_MANUAL_REVIEW')
                  .map((ord) => (
                    <div key={ord.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          {ord.student_name} · {ord.invoice_title}
                        </div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5 tabular-nums">
                          {formatCurrency(ord.amount, 'NPR')} · Bank Ref: {ord.bank_reference} · Payer: {ord.payer_name}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleReviewBankProof(ord.order_uuid, 'VERIFIED')}
                          className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
                        >
                          Verify & Post Journal
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReviewBankProof(ord.order_uuid, 'REJECTED')}
                          className="rounded-lg border border-red-300 text-red-700 px-3 py-2 text-xs font-semibold hover:bg-red-50 whitespace-nowrap"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Fee Invoices Grid */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Fee Invoices & Direct Settlement</h2>
              <span className="text-xs text-slate-500 tabular-nums">{data.invoices.length} invoice(s)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Student</th>
                    <th className="px-4 py-3 font-semibold">Invoice Particulars</th>
                    <th className="px-4 py-3 font-semibold text-right">Net Amount</th>
                    <th className="px-4 py-3 font-semibold">Due Date</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.invoices.map((inv) => {
                    const net = Math.max(0, Number(inv.amount) - Number(inv.discount));
                    return (
                      <tr key={inv.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                          {inv.student_name} <span className="font-mono text-slate-500">· {inv.student_code}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900 dark:text-white">{inv.title}</div>
                          <div className="text-[11px] text-slate-500">{inv.fee_type}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">{formatCurrency(net, 'NPR')}</td>
                        <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                          {formatDateByCalendar(inv.due_date, calendar)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`font-mono font-semibold ${
                              inv.status === 'PAID'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : inv.status === 'REFUNDED'
                                ? 'text-slate-500'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {inv.status}
                          </span>
                          {inv.receipt_number && <div className="text-[10px] text-slate-500 font-mono">{inv.receipt_number}</div>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {inv.status === 'PAID' ? (
                            <button
                              type="button"
                              onClick={() => handleDownloadReceiptPdf(inv)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                            >
                              <Download className="h-3.5 w-3.5" />
                              <span>PDF Receipt</span>
                            </button>
                          ) : inv.status !== 'REFUNDED' ? (
                            <button
                              type="button"
                              onClick={() => {
                                setCheckoutInvoice(inv);
                                setActiveOrder(null);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
                            >
                              <CreditCard className="h-3.5 w-3.5" />
                              <span>Pay Now</span>
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Transaction History */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Verified Settlement History</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Provider & Ref</th>
                    <th className="px-4 py-3 font-semibold">Invoice</th>
                    <th className="px-4 py-3 font-semibold text-right">Gross</th>
                    <th className="px-4 py-3 font-semibold text-right">Net Settled</th>
                    <th className="px-4 py-3 font-semibold">Verified At</th>
                    {isFinanceAdmin && <th className="px-4 py-3 font-semibold text-right">Refund</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.transactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                        No settled transactions yet.
                      </td>
                    </tr>
                  ) : (
                    data.transactions.map((txn) => (
                      <tr key={txn.id}>
                        <td className="px-4 py-3 font-mono">
                          <span className="font-semibold text-slate-900 dark:text-white">{txn.provider}</span> · {txn.provider_txn_id}
                        </td>
                        <td className="px-4 py-3">
                          {txn.student_name} · {txn.invoice_title}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{formatCurrency(txn.amount, 'NPR')}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                          {formatCurrency(txn.net_amount, 'NPR')}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-500 tabular-nums">{formatDateByCalendar(txn.verified_at, calendar)}</td>
                        {isFinanceAdmin && (
                          <td className="px-4 py-3 text-right">
                            {txn.refunded_amount < txn.amount ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setRefundTarget(txn);
                                  setRefundAmount(String(txn.amount - txn.refunded_amount));
                                }}
                                className="rounded border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                Refund
                              </button>
                            ) : (
                              <span className="text-slate-400 font-mono">Refunded</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 2: SCHOOL BANK ACCOUNTS (MASKED + VERIFICATION) */}
      {isFinanceAdmin && subTab === 'banks' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Verified School Bank Accounts</h2>
              <p className="text-xs text-slate-500">Account numbers are encrypted at rest (AES-256-GCM) and always masked in UI views.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddBank(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
            >
              <Plus className="h-4 w-4" />
              <span>Add Bank Account</span>
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.bankAccounts.map((acc) => (
              <div key={acc.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                    <Landmark className="h-4 w-4 text-emerald-700" />
                    <span>{acc.bank_name}</span>
                    {acc.is_primary === 1 && <span className="text-[11px] font-mono text-blue-700 dark:text-cyan-400">PRIMARY</span>}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 font-mono">
                    {acc.account_holder_name} · {acc.account_number_masked} · {acc.branch_name} · {acc.currency}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-mono font-semibold ${
                      acc.verification_status === 'VERIFIED' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {acc.verification_status}
                  </span>
                  {acc.verification_status !== 'VERIFIED' && (
                    <button
                      type="button"
                      onClick={() => handleVerifyBankAccount(acc.id, 'VERIFIED')}
                      className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                    >
                      Verify Account
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUBTAB 3: PAYMENT GATEWAYS (ESEWA / KHALTI MERCHANTS) */}
      {isFinanceAdmin && subTab === 'gateways' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Active Gateway Configurations</h2>
            <div className="space-y-3">
              {data.merchants.map((m) => (
                <div key={m.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">{m.display_label || m.provider}</span>
                    <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">
                      {m.mode} · {m.is_active ? 'ACTIVE' : 'DISABLED'}
                    </span>
                  </div>
                  <div className="mt-1 text-xs font-mono text-slate-500">
                    Provider: {m.provider} · Merchant Code: {m.merchant_code} · Secret: {m.has_secret ? 'Encrypted on Server' : 'Not set'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={handleSaveMerchant} className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Configure / Rotate Gateway Credentials</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Provider</label>
                <select
                  value={merchantForm.provider}
                  onChange={(e) => setMerchantForm({ ...merchantForm, provider: e.target.value as 'ESEWA' | 'KHALTI' })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="ESEWA">eSewa ePay v2</option>
                  <option value="KHALTI">Khalti ePayment v2</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Environment Mode</label>
                <select
                  value={merchantForm.mode}
                  onChange={(e) => setMerchantForm({ ...merchantForm, mode: e.target.value as 'TEST' | 'PRODUCTION' })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="TEST">TEST Sandbox</option>
                  <option value="PRODUCTION">PRODUCTION Live</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Display Label</label>
              <input
                required
                value={merchantForm.displayLabel}
                onChange={(e) => setMerchantForm({ ...merchantForm, displayLabel: e.target.value })}
                placeholder="Sunrise eSewa Tuition Gateway"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Merchant / Product Code</label>
                <input
                  required
                  value={merchantForm.merchantCode}
                  onChange={(e) => setMerchantForm({ ...merchantForm, merchantCode: e.target.value })}
                  placeholder="EPAYTEST"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Server Secret Key</label>
                <input
                  type="password"
                  value={merchantForm.secretKey}
                  onChange={(e) => setMerchantForm({ ...merchantForm, secretKey: e.target.value })}
                  placeholder="Stored AES-256-GCM encrypted"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <button type="submit" className="rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white">
              Save Encrypted Merchant Settings
            </button>
          </form>
        </div>
      )}

      {/* SUBTAB 4: DOUBLE-ENTRY CHART OF ACCOUNTS, JOURNAL LEDGER & VENDORS/POs */}
      {isFinanceAdmin && subTab === 'accounting' && ledger && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Chart of Accounts</h2>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {ledger.accounts.map((a) => (
                  <div key={a.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-mono text-slate-500">{a.code}</span> · <span className="font-semibold">{a.name}</span>
                      <div className="text-[10px] text-slate-400">{a.account_type}</div>
                    </div>
                    <div className="font-mono font-bold tabular-nums">{formatCurrency(a.balance, 'NPR')}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Balanced Double-Entry Journal Ledger</h2>
              <div className="space-y-3">
                {ledger.journalEntries.map((je) => (
                  <div key={je.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 text-xs">
                    <div className="flex items-center justify-between font-semibold text-slate-900 dark:text-white">
                      <span>{je.description}</span>
                      <span className="font-mono text-slate-500 tabular-nums">{formatDateByCalendar(je.entry_date, calendar)}</span>
                    </div>
                    <div className="mt-2 space-y-1 font-mono text-[11px]">
                      {je.lines.map((l, idx) => (
                        <div key={idx} className="flex justify-between text-slate-600 dark:text-slate-300">
                          <span>
                            {l.account_code} {l.account_name}
                          </span>
                          <span className="tabular-nums">
                            {l.debit > 0 ? `DR ${formatCurrency(l.debit, 'NPR')}` : `CR ${formatCurrency(l.credit, 'NPR')}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const res = await apiMutate('/finance/vendors', 'POST', vendorForm);
                setStatusMsg({ kind: res.success ? 'ok' : 'err', text: res.message || 'Vendor saved.' });
                if (res.success) {
                  setVendorForm({ name: '', category: 'Academic Supplies', contactPhone: '', panVatNumber: '' });
                  await loadAll();
                }
              }}
              className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs"
            >
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Register School Vendor</h2>
              <input
                required
                value={vendorForm.name}
                onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })}
                placeholder="Vendor / Supplier Name *"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  required
                  value={vendorForm.category}
                  onChange={(e) => setVendorForm({ ...vendorForm, category: e.target.value })}
                  placeholder="Category *"
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                />
                <input
                  required
                  value={vendorForm.contactPhone}
                  onChange={(e) => setVendorForm({ ...vendorForm, contactPhone: e.target.value })}
                  placeholder="Contact Phone *"
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono"
                />
              </div>
              <input
                value={vendorForm.panVatNumber}
                onChange={(e) => setVendorForm({ ...vendorForm, panVatNumber: e.target.value })}
                placeholder="PAN / VAT Number (Optional)"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono"
              />
              <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white">
                Add Approved Vendor
              </button>
            </form>

            <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 text-xs">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Vendors & Approved Purchase Orders</h2>
              {ledger.vendors.length > 0 && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const res = await apiMutate('/finance/purchase-orders', 'POST', {
                      vendorId: poForm.vendorId || ledger.vendors[0].id,
                      title: poForm.title,
                      amount: Number(poForm.amount),
                    });
                    setStatusMsg({ kind: res.success ? 'ok' : 'err', text: res.message || 'Purchase order issued.' });
                    if (res.success) {
                      setPoForm({ vendorId: '', title: '', amount: '' });
                      await loadAll();
                    }
                  }}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 border-b border-slate-100 dark:border-slate-800 pb-4"
                >
                  <select
                    value={poForm.vendorId || ledger.vendors[0]?.id || ''}
                    onChange={(e) => setPoForm({ ...poForm, vendorId: e.target.value })}
                    className="sm:col-span-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs"
                  >
                    {ledger.vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <input
                    required
                    value={poForm.title}
                    onChange={(e) => setPoForm({ ...poForm, title: e.target.value })}
                    placeholder="PO Description *"
                    className="sm:col-span-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs"
                  />
                  <input
                    required
                    type="number"
                    min="1"
                    value={poForm.amount}
                    onChange={(e) => setPoForm({ ...poForm, amount: e.target.value })}
                    placeholder="NPR *"
                    className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs font-mono"
                  />
                  <button type="submit" className="sm:col-span-2 rounded-lg bg-emerald-700 text-white font-semibold py-2 px-2">
                    Issue PO
                  </button>
                </form>
              )}
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {ledger.purchaseOrders.length === 0 ? (
                  <p className="py-3 text-slate-500">No purchase orders recorded yet. Registered vendors: {ledger.vendors.length}.</p>
                ) : (
                  ledger.purchaseOrders.map((po) => (
                    <div key={po.id} className="py-2.5 flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-slate-900 dark:text-white">{po.title}</span>
                        <span className="text-slate-500"> · {po.vendor_name}</span>
                      </div>
                      <span className="font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                        {formatCurrency(po.amount, 'NPR')} · {po.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 5: PLATFORM SAAS SUBSCRIPTIONS (SEPARATED FROM SCHOOL FEES) */}
      {isFinanceAdmin && subTab === 'platform' && plansData && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Platform SaaS Subscription Billing</h2>
            <p className="text-xs text-slate-500">
              Platform subscription licensing is strictly segregated from student tuition fee accounts and merchant settlements.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plansData.plans.map((p) => {
              const isCurrent = plansData.subscription?.plan_id === p.id;
              return (
                <div key={p.id} className={`rounded-xl border p-4 ${isCurrent ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/20' : 'border-slate-200 dark:border-slate-800'}`}>
                  <div className="text-xs font-mono text-slate-500">{p.target_audience}</div>
                  <div className="text-base font-bold text-slate-900 dark:text-white mt-0.5">{p.name}</div>
                  <div className="text-lg font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-2 tabular-nums">
                    {formatCurrency(p.monthly_npr, 'NPR')}/mo
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-2">{p.features_summary}</p>
                  <button
                    type="button"
                    disabled={isCurrent}
                    onClick={async () => {
                      const res = await apiMutate('/finance/platform-subscriptions', 'POST', { planId: p.id });
                      setStatusMsg({ kind: res.success ? 'ok' : 'err', text: res.message || 'Plan updated.' });
                      if (res.success) await loadAll();
                    }}
                    className="mt-4 w-full rounded-lg border border-slate-300 dark:border-slate-700 py-2 text-xs font-semibold disabled:opacity-50"
                  >
                    {isCurrent ? 'Active Plan' : 'Switch Plan'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CHECKOUT MODAL */}
      {checkoutInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Settle School Fee Invoice</h2>
              <button type="button" onClick={() => setCheckoutInvoice(null)} aria-label="Close checkout" className="p-1.5 text-slate-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 text-xs space-y-1">
              <div className="font-semibold text-slate-900 dark:text-white">{checkoutInvoice.title}</div>
              <div className="text-slate-500">
                {checkoutInvoice.student_name} ({checkoutInvoice.student_code})
              </div>
              <div className="text-base font-bold font-mono text-emerald-700 dark:text-emerald-400 tabular-nums pt-1">
                Payable: {formatCurrency(Math.max(0, checkoutInvoice.amount - checkoutInvoice.discount), 'NPR')}
              </div>
            </div>

            {!activeOrder ? (
              <form onSubmit={handleInitiateCheckout} className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-xs font-semibold">Select Payment Channel</label>
                  {(
                    [
                      ['ESEWA', 'eSewa Digital Payment', 'Instant verification via school merchant gateway'],
                      ['KHALTI', 'Khalti Digital Payment', 'Pay via Khalti ePayment v2 gateway'],
                      ['BANK_TRANSFER', 'Direct Verified School Bank Transfer', 'Deposit to official school bank A/C & submit reference'],
                    ] as const
                  ).map(([val, title, sub]) => (
                    <label
                      key={val}
                      className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer ${
                        checkoutProvider === val ? 'border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <input
                        type="radio"
                        name="provider"
                        checked={checkoutProvider === val}
                        onChange={() => setCheckoutProvider(val)}
                        className="mt-1"
                      />
                      <div>
                        <div className="text-xs font-bold text-slate-900 dark:text-white">{title}</div>
                        <div className="text-[11px] text-slate-500">{sub}</div>
                      </div>
                    </label>
                  ))}
                </div>
                <button type="submit" className="w-full rounded-lg bg-emerald-700 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800">
                  Continue to Checkout
                </button>
              </form>
            ) : activeOrder.provider === 'BANK_TRANSFER' ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 text-xs space-y-1 bg-slate-50 dark:bg-slate-950">
                  <div className="font-semibold">Official School Bank Details (Masked Security Display)</div>
                  {primaryVerifiedBank ? (
                    <div className="font-mono text-[11px]">
                      {primaryVerifiedBank.bank_name} · {primaryVerifiedBank.branch_name}
                      <br />
                      A/C: {primaryVerifiedBank.account_holder_name} ({primaryVerifiedBank.account_number_masked})
                    </div>
                  ) : (
                    <div className="text-amber-700">Contact school finance desk for active bank account details.</div>
                  )}
                </div>
                <input
                  required
                  value={bankRefInput}
                  onChange={(e) => setBankRefInput(e.target.value)}
                  placeholder="Enter Bank Voucher / IPS Transaction Reference *"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono"
                />
                <input
                  value={bankNoteInput}
                  onChange={(e) => setBankNoteInput(e.target.value)}
                  placeholder="Optional depositor note"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={handleSubmitBankProof}
                  className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white"
                >
                  Submit Transfer Reference for Verification
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 text-xs space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-emerald-700">
                    <ShieldCheck className="h-4 w-4" />
                    <span>
                      {activeOrder.provider} Order {activeOrder.orderUuid} ({activeOrder.mode})
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">{activeOrder.instructions}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Provider Transaction Reference / Sandbox Token</label>
                  <input
                    value={sandboxTxnInput}
                    onChange={(e) => setSandboxTxnInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleConfirmGatewayVerification}
                  className="w-full rounded-lg bg-emerald-700 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800"
                >
                  Verify Settlement Server-Side & Issue Receipt
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ADD BANK ACCOUNT MODAL */}
      {showAddBank && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleCreateBankAccount}
            className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Lock className="h-4 w-4 text-emerald-600" />
                <span>Register School Bank Account</span>
              </h2>
              <button type="button" onClick={() => setShowAddBank(false)} className="p-1 text-slate-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <input
              required
              value={bankForm.bankName}
              onChange={(e) => setBankForm({ ...bankForm, bankName: e.target.value })}
              placeholder="Bank Name (e.g. Nabil Bank Limited) *"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
            <input
              required
              value={bankForm.branchName}
              onChange={(e) => setBankForm({ ...bankForm, branchName: e.target.value })}
              placeholder="Branch Name *"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
            <input
              required
              value={bankForm.accountHolderName}
              onChange={(e) => setBankForm({ ...bankForm, accountHolderName: e.target.value })}
              placeholder="Official Account Holder Name *"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
            <input
              required
              value={bankForm.accountNumber}
              onChange={(e) => setBankForm({ ...bankForm, accountNumber: e.target.value })}
              placeholder="Account Number (AES-256-GCM encrypted & masked) *"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                value={bankForm.swiftCode}
                onChange={(e) => setBankForm({ ...bankForm, swiftCode: e.target.value })}
                placeholder="SWIFT / BIC"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono"
              />
              <select
                value={bankForm.purpose}
                onChange={(e) => setBankForm({ ...bankForm, purpose: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="TUITION_FEES">Tuition Fees</option>
                <option value="GENERAL_SETTLEMENT">General Settlement</option>
                <option value="EXAMS">Exam Fees</option>
              </select>
            </div>
            <button type="submit" className="w-full rounded-lg bg-emerald-700 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800">
              Save & Queue Verification
            </button>
          </form>
        </div>
      )}

      {/* REFUND MODAL */}
      {refundTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form onSubmit={handleIssueRefund} className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">Issue Settlement Refund</h2>
              <button type="button" onClick={() => setRefundTarget(null)} className="p-1 text-slate-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Transaction {refundTarget.provider_txn_id} · Max refundable: {formatCurrency(refundTarget.amount - refundTarget.refunded_amount, 'NPR')}
            </p>
            <input
              type="number"
              required
              min="1"
              max={refundTarget.amount - refundTarget.refunded_amount}
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono"
            />
            <input
              required
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="Audit reason for refund *"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
            <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white">
              Process Refund & Post Reversal Journal
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
