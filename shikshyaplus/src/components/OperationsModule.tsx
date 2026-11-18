import React, { useEffect, useState } from 'react';
import {
  Award,
  Bell,
  BookOpen,
  Bus,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Download,
  LifeBuoy,
  Package,
  Phone,
  Printer,
  QrCode,
  Receipt,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { apiGet, apiMutate } from '../lib/api';
import { formatCurrency, formatDateByCalendar } from '../lib/domainRules';
import { generateCertificatePdf, generateFeeReceiptPdf, generateQrDataUrl } from '../lib/pdfGenerator';
import type { AuthUser } from '../types';

export type OpsSection =
  | 'notices'
  | 'fees'
  | 'expenses'
  | 'inventory'
  | 'visitors'
  | 'certificates'
  | 'library'
  | 'transport'
  | 'admissions'
  | 'staff'
  | 'contacts'
  | 'tickets'
  | 'audit';

interface OperationsModuleProps {
  user: AuthUser;
  calendar: 'AD' | 'BS';
  initialSection?: OpsSection;
}

type OpsTab = OpsSection;

export const OperationsModule: React.FC<OperationsModuleProps> = ({ user, calendar, initialSection }) => {
  const isStaffManager = ['PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG'].includes(user.activeRole);
  const canAudit = ['PRINCIPAL', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR', 'PLATFORM_SUPER_ADMIN'].includes(user.activeRole);
  const canCreateNotice = ['PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'STAFF_ADMIN'].includes(user.activeRole);
  const canCreateInvoice = ['PRINCIPAL', 'STAFF_ACCOUNTANT', 'STAFF_ADMIN'].includes(user.activeRole);
  const canManageLibrary = ['PRINCIPAL', 'STAFF_LIBRARIAN'].includes(user.activeRole);
  const canManageTransport = ['PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_TRANSPORT', 'STAFF_ADMIN', 'SCHOOL_ORG'].includes(user.activeRole);
  const canReviewAdmissions = ['PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_ADMIN', 'SCHOOL_ORG'].includes(user.activeRole);
  const canResolveTickets = ['PRINCIPAL', 'VICE_PRINCIPAL', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR', 'STAFF_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(user.activeRole);
  const canViewExpenses = ['PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_ACCOUNTANT', 'STAFF_ADMIN', 'SCHOOL_ORG'].includes(user.activeRole);
  const canRecordExpense = ['PRINCIPAL', 'STAFF_ACCOUNTANT', 'STAFF_ADMIN'].includes(user.activeRole);
  const canManageInventory = ['PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_ADMIN', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR', 'SCHOOL_ORG'].includes(user.activeRole);
  const canManageVisitors = ['PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_RECEPTION', 'STAFF_ADMIN', 'SCHOOL_ORG'].includes(user.activeRole);
  const canIssueCertificates = ['PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_ADMIN', 'TECHNICAL_DEPT', 'SCHOOL_ORG'].includes(user.activeRole);

  const [tab, setTab] = useState<OpsTab>(initialSection || 'notices');
  const [notices, setNotices] = useState<Array<Record<string, unknown>>>([]);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [invoices, setInvoices] = useState<Array<Record<string, unknown>>>([]);
  const [gateways, setGateways] = useState<{ esewa: boolean; khalti: boolean }>({ esewa: false, khalti: false });
  const [expenses, setExpenses] = useState<Array<Record<string, unknown>>>([]);
  const [inventoryItems, setInventoryItems] = useState<Array<Record<string, unknown>>>([]);
  const [visitors, setVisitors] = useState<Array<Record<string, unknown>>>([]);
  const [certificates, setCertificates] = useState<Array<Record<string, unknown>>>([]);
  const [students, setStudents] = useState<Array<Record<string, unknown>>>([]);
  const [books, setBooks] = useState<Array<Record<string, unknown>>>([]);
  const [issues, setIssues] = useState<Array<Record<string, unknown>>>([]);
  const [routes, setRoutes] = useState<Array<Record<string, unknown>>>([]);
  const [admissions, setAdmissions] = useState<Array<Record<string, unknown>>>([]);
  const [members, setMembers] = useState<Array<Record<string, unknown>>>([]);
  const [contacts, setContacts] = useState<Array<Record<string, unknown>>>([]);
  const [tickets, setTickets] = useState<Array<Record<string, unknown>>>([]);
  const [auditLogs, setAuditLogs] = useState<Array<Record<string, unknown>>>([]);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [receiptInvoice, setReceiptInvoice] = useState<Record<string, unknown> | null>(null);
  const [selectedCertificate, setSelectedCertificate] = useState<Record<string, unknown> | null>(null);
  const [certQrUrl, setCertQrUrl] = useState<string | null>(null);
  const [newStaffCredentials, setNewStaffCredentials] = useState<{ userCode: string; temporaryPassword?: string } | null>(null);

  // Forms
  const [noticeForm, setNoticeForm] = useState({ title: '', body: '', noticeType: 'GENERAL', audience: 'ALL', priority: 'NORMAL' });
  const [eventForm, setEventForm] = useState({ title: '', description: '', category: 'Academic', eventDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), location: 'Main Campus Hall' });
  const [feeForm, setFeeForm] = useState({ studentId: '', title: 'Monthly Tuition Fee', feeType: 'TUITION', amount: '4500', discount: '0', dueDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) });
  const [expenseForm, setExpenseForm] = useState({ title: '', category: 'Utilities', amount: '2500', expenseDate: new Date().toISOString().slice(0, 10), paidTo: '' });
  const [inventoryForm, setInventoryForm] = useState({ itemName: '', category: 'Lab Equipment', quantity: '10', conditionStatus: 'GOOD', location: 'Science Wing' });
  const [visitorForm, setVisitorForm] = useState({ visitorName: '', visitorPhone: '+97798', purpose: 'Parent Inquiry', visitingPerson: 'Principal Office' });
  const [certForm, setCertForm] = useState({ studentId: '', certificateType: 'CHARACTER', remarks: 'Demonstrated exemplary conduct, discipline, and academic consistency.' });
  const [bookForm, setBookForm] = useState({ title: '', author: '', category: 'Science', isbn: '', totalCopies: '5' });
  const [issueForm, setIssueForm] = useState({ bookId: '', studentId: '', dueDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) });
  const [routeForm, setRouteForm] = useState({ routeName: '', vehicleNumber: '', driverName: '', driverPhone: '+97798', stops: '' });
  const [admForm, setAdmForm] = useState({ applicantName: '', applyingClass: 'Class 6', guardianName: '', guardianPhone: '' });
  const [ticketForm, setTicketForm] = useState({ category: 'IT & Accounts', subject: '', description: '' });
  const [staffForm, setStaffForm] = useState({
    fullName: '',
    email: '',
    phone: '+97798',
    role: 'TEACHER',
    department: 'Academics',
    designation: 'Subject Teacher',
  });

  useEffect(() => {
    if (initialSection) setTab(initialSection);
  }, [initialSection]);

  const loadAll = async () => {
    const sid = user.activeSchoolId;
    if (!sid) return;
    const reqs = await Promise.all([
      apiGet<{ notices: Array<Record<string, unknown>> }>('/operations/notices', `ops:notices:${sid}`),
      apiGet<{ events: Array<Record<string, unknown>> }>('/operations/events', `ops:events:${sid}`),
      apiGet<{ invoices: Array<Record<string, unknown>>; gatewaysConfigured: { esewa: boolean; khalti: boolean } }>('/operations/fees', `ops:fees:${sid}`),
      apiGet<{ students: Array<Record<string, unknown>> }>('/students', `students:${sid}`),
      apiGet<{ books: Array<Record<string, unknown>>; issues: Array<Record<string, unknown>> }>('/operations/library', `ops:lib:${sid}`),
      apiGet<{ routes: Array<Record<string, unknown>> }>('/operations/transport', `ops:trans:${sid}`),
      apiGet<{ admissions: Array<Record<string, unknown>> }>('/operations/admissions', `ops:adm:${sid}`),
      apiGet<{ contacts: Array<Record<string, unknown>> }>('/operations/school-contacts', `ops:contacts:${sid}`),
      apiGet<{ tickets: Array<Record<string, unknown>> }>('/operations/tickets', `ops:tickets:${sid}`),
      isStaffManager || canAudit ? apiGet<{ members: Array<Record<string, unknown>> }>(`/schools/${sid}/members`, `ops:members:${sid}`) : Promise.resolve({ success: false, data: undefined }),
      canAudit ? apiGet<{ logs: Array<Record<string, unknown>> }>('/operations/audit-logs', `ops:audit:${sid}`) : Promise.resolve({ success: false, data: undefined }),
      canViewExpenses ? apiGet<{ expenses: Array<Record<string, unknown>> }>('/operations/expenses', `ops:expenses:${sid}`) : Promise.resolve({ success: false, data: undefined }),
      apiGet<{ items: Array<Record<string, unknown>> }>('/operations/inventory', `ops:inventory:${sid}`),
      canManageVisitors ? apiGet<{ visitors: Array<Record<string, unknown>> }>('/operations/visitors', `ops:visitors:${sid}`) : Promise.resolve({ success: false, data: undefined }),
      apiGet<{ certificates: Array<Record<string, unknown>> }>('/operations/certificates', `ops:certs:${sid}`),
    ]);

    if (reqs[0].success && reqs[0].data) setNotices(reqs[0].data.notices);
    if (reqs[1].success && reqs[1].data) setEvents(reqs[1].data.events);
    if (reqs[2].success && reqs[2].data) {
      setInvoices(reqs[2].data.invoices);
      setGateways(reqs[2].data.gatewaysConfigured);
    }
    if (reqs[3].success && reqs[3].data) {
      setStudents(reqs[3].data.students);
      if (reqs[3].data.students[0]) {
        const sid0 = String(reqs[3].data.students[0].id);
        setFeeForm((p) => ({ ...p, studentId: p.studentId || sid0 }));
        setIssueForm((p) => ({ ...p, studentId: p.studentId || sid0 }));
        setCertForm((p) => ({ ...p, studentId: p.studentId || sid0 }));
      }
    }
    if (reqs[4].success && reqs[4].data) {
      setBooks(reqs[4].data.books);
      setIssues(reqs[4].data.issues);
      if (reqs[4].data.books[0]) {
        setIssueForm((p) => ({ ...p, bookId: p.bookId || String(reqs[4].data!.books[0].id) }));
      }
    }
    if (reqs[5].success && reqs[5].data) setRoutes(reqs[5].data.routes);
    if (reqs[6].success && reqs[6].data) setAdmissions(reqs[6].data.admissions);
    if (reqs[7].success && reqs[7].data) setContacts(reqs[7].data.contacts);
    if (reqs[8].success && reqs[8].data) setTickets(reqs[8].data.tickets);
    if (reqs[9].success && reqs[9].data) setMembers(reqs[9].data.members);
    if (reqs[10].success && reqs[10].data) setAuditLogs(reqs[10].data.logs);
    if (reqs[11].success && reqs[11].data) setExpenses(reqs[11].data.expenses);
    if (reqs[12].success && reqs[12].data) setInventoryItems(reqs[12].data.items);
    if (reqs[13].success && reqs[13].data) setVisitors(reqs[13].data.visitors);
    if (reqs[14].success && reqs[14].data) setCertificates(reqs[14].data.certificates);
  };

  useEffect(() => {
    loadAll();
  }, [user.activeSchoolId]);

  useEffect(() => {
    if (!selectedCertificate) {
      setCertQrUrl(null);
      return;
    }
    const payload = `SHIKSHYAPLUS-CERT|${user.activeSchoolCode || ''}|${String(selectedCertificate.certificate_number)}|${String(selectedCertificate.student_code)}`;
    generateQrDataUrl(payload)
      .then(setCertQrUrl)
      .catch(() => setCertQrUrl(null));
  }, [selectedCertificate, user.activeSchoolCode]);

  const schoolMeta = {
    name: user.activeSchoolName || 'ShikshyaPlus School',
    schoolCode: user.activeSchoolCode || '',
  };

  const downloadInvoicePdf = (inv: Record<string, unknown>) =>
    generateFeeReceiptPdf({
      school: schoolMeta,
      invoice: {
        receipt_number: String(inv.receipt_number || ''),
        student_name: String(inv.student_name || ''),
        student_code: String(inv.student_code || ''),
        title: String(inv.title || ''),
        fee_type: String(inv.fee_type || ''),
        amount: Number(inv.amount || 0),
        discount: Number(inv.discount || 0),
        gateway: String(inv.gateway || 'SCHOOL_OFFICE'),
        paid_at: inv.paid_at ? String(inv.paid_at) : undefined,
      },
      calendar,
    });

  const downloadCertPdf = (cert: Record<string, unknown>) =>
    generateCertificatePdf({
      school: schoolMeta,
      cert: {
        certificate_number: String(cert.certificate_number || ''),
        certificate_type: String(cert.certificate_type || ''),
        student_name: String(cert.student_name || ''),
        student_code: String(cert.student_code || ''),
        class_name: String(cert.class_name || ''),
        section: String(cert.section || ''),
        remarks: String(cert.remarks || ''),
        issued_at: String(cert.issued_at || new Date().toISOString()),
      },
      calendar,
    });

  const handlePublishNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/operations/notices', 'POST', noticeForm, { queueIfOffline: true, offlineLabel: 'Publish Notice' });
    setFeedback({ ok: res.success, msg: res.message || (res.success ? 'Notice published.' : 'Failed to publish.') });
    if (res.success) {
      setNoticeForm({ title: '', body: '', noticeType: 'GENERAL', audience: 'ALL', priority: 'NORMAL' });
      loadAll();
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/operations/events', 'POST', { ...eventForm, isPublic: true }, { queueIfOffline: true, offlineLabel: 'Schedule Event' });
    setFeedback({ ok: res.success, msg: res.message || 'Event updated.' });
    if (res.success) {
      setEventForm((p) => ({ ...p, title: '', description: '' }));
      loadAll();
    }
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/operations/fees', 'POST', feeForm);
    setFeedback({ ok: res.success, msg: res.message || 'Invoice created.' });
    if (res.success) loadAll();
  };

  const handlePayInvoice = async (invoiceId: string, gateway: 'ESEWA' | 'KHALTI' | 'BANK_CASH_OFFICE') => {
    const res = await apiMutate<{ receiptNumber: string }>(`/operations/fees/${invoiceId}/pay`, 'POST', { gateway });
    setFeedback({ ok: res.success, msg: res.message || 'Payment processed.' });
    if (res.success) loadAll();
  };

  const handleAddBook = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/operations/library', 'POST', bookForm);
    setFeedback({ ok: res.success, msg: res.message || 'Book added.' });
    if (res.success) {
      setBookForm({ title: '', author: '', category: 'Science', isbn: '', totalCopies: '5' });
      loadAll();
    }
  };

  const handleIssueBook = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/operations/library/issue', 'POST', issueForm);
    setFeedback({ ok: res.success, msg: res.message || 'Book issued.' });
    if (res.success) loadAll();
  };

  const handleReturnBook = async (issueId: string) => {
    const res = await apiMutate(`/operations/library/issues/${issueId}/return`, 'POST', {});
    setFeedback({ ok: res.success, msg: res.message || 'Book returned.' });
    if (res.success) loadAll();
  };

  const handleAddRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/operations/transport', 'POST', routeForm);
    setFeedback({ ok: res.success, msg: res.message || 'Route added.' });
    if (res.success) {
      setRouteForm({ routeName: '', vehicleNumber: '', driverName: '', driverPhone: '+97798', stops: '' });
      loadAll();
    }
  };

  const handleSubmitAdmission = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/operations/admissions', 'POST', admForm, { queueIfOffline: true, offlineLabel: 'Admission Inquiry' });
    setFeedback({ ok: res.success, msg: res.message || 'Submitted.' });
    if (res.success) {
      setAdmForm({ applicantName: '', applyingClass: 'Class 6', guardianName: '', guardianPhone: '' });
      loadAll();
    }
  };

  const handleReviewAdmission = async (admissionId: string, status: 'APPROVED' | 'REJECTED') => {
    const res = await apiMutate(`/operations/admissions/${admissionId}`, 'PATCH', { status });
    setFeedback({ ok: res.success, msg: res.message || 'Admission status updated.' });
    if (res.success) loadAll();
  };

  const handleSubmitTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/operations/tickets', 'POST', ticketForm, { queueIfOffline: true, offlineLabel: 'Support Ticket' });
    setFeedback({ ok: res.success, msg: res.message || 'Ticket submitted.' });
    if (res.success) {
      setTicketForm({ category: 'IT & Accounts', subject: '', description: '' });
      loadAll();
    }
  };

  const handleUpdateTicketStatus = async (ticketId: string, status: 'IN_PROGRESS' | 'RESOLVED' | 'OPEN') => {
    const res = await apiMutate(`/operations/tickets/${ticketId}`, 'PATCH', { status });
    setFeedback({ ok: res.success, msg: res.message || 'Ticket updated.' });
    if (res.success) loadAll();
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewStaffCredentials(null);
    const res = await apiMutate<{ userCode: string; temporaryPassword?: string }>(`/schools/${user.activeSchoolId}/staff`, 'POST', staffForm);
    setFeedback({ ok: res.success, msg: res.message || 'Staff creation failed.' });
    if (res.success && res.data) {
      setNewStaffCredentials(res.data);
      setStaffForm({ fullName: '', email: '', phone: '+97798', role: 'TEACHER', department: 'Academics', designation: 'Subject Teacher' });
      loadAll();
    }
  };

  const handleToggleMemberStatus = async (membershipId: string, nextStatus: 'ACTIVE' | 'SUSPENDED') => {
    const res = await apiMutate(`/schools/${user.activeSchoolId}/members/${membershipId}`, 'PATCH', { status: nextStatus });
    setFeedback({ ok: res.success, msg: res.message || 'Membership updated.' });
    if (res.success) loadAll();
  };

  const handleRecordExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/operations/expenses', 'POST', expenseForm, { queueIfOffline: true, offlineLabel: 'Record Expense' });
    setFeedback({ ok: res.success, msg: res.message || 'Expense updated.' });
    if (res.success) {
      setExpenseForm({ title: '', category: 'Utilities', amount: '2500', expenseDate: new Date().toISOString().slice(0, 10), paidTo: '' });
      loadAll();
    }
  };

  const handleAddInventoryAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/operations/inventory', 'POST', inventoryForm);
    setFeedback({ ok: res.success, msg: res.message || 'Asset added.' });
    if (res.success) {
      setInventoryForm({ itemName: '', category: 'Lab Equipment', quantity: '10', conditionStatus: 'GOOD', location: 'Science Wing' });
      loadAll();
    }
  };

  const handleUpdateAssetCondition = async (assetId: string, conditionStatus: string) => {
    const res = await apiMutate(`/operations/inventory/${assetId}`, 'PATCH', { conditionStatus });
    setFeedback({ ok: res.success, msg: res.message || 'Asset condition updated.' });
    if (res.success) loadAll();
  };

  const handleCheckInVisitor = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/operations/visitors', 'POST', visitorForm);
    setFeedback({ ok: res.success, msg: res.message || 'Visitor logged.' });
    if (res.success) {
      setVisitorForm({ visitorName: '', visitorPhone: '+97798', purpose: 'Parent Inquiry', visitingPerson: 'Principal Office' });
      loadAll();
    }
  };

  const handleCheckoutVisitor = async (visitorId: string) => {
    const res = await apiMutate(`/operations/visitors/${visitorId}/checkout`, 'PATCH', {});
    setFeedback({ ok: res.success, msg: res.message || 'Visitor checked out.' });
    if (res.success) loadAll();
  };

  const handleIssueCertificate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/operations/certificates', 'POST', certForm);
    setFeedback({ ok: res.success, msg: res.message || 'Certificate issued.' });
    if (res.success) loadAll();
  };

  const totalFeesCollected = invoices
    .filter((i) => String(i.status) === 'PAID')
    .reduce((sum, i) => sum + (Number(i.amount) - Number(i.discount || 0)), 0);
  const totalExpenses = expenses.reduce((sum, ex) => sum + Number(ex.amount || 0), 0);

  const navButtons: Array<{ id: OpsTab; label: string; icon: React.ReactNode; show: boolean }> = [
    { id: 'notices', label: 'Notices & Events', icon: <Bell className="h-3.5 w-3.5" />, show: true },
    { id: 'fees', label: 'Fees & Receipts', icon: <CreditCard className="h-3.5 w-3.5" />, show: true },
    { id: 'expenses', label: 'Expenses', icon: <Receipt className="h-3.5 w-3.5" />, show: canViewExpenses },
    { id: 'inventory', label: 'Inventory', icon: <Package className="h-3.5 w-3.5" />, show: true },
    { id: 'visitors', label: 'Visitors', icon: <UserCheck className="h-3.5 w-3.5" />, show: canManageVisitors },
    { id: 'certificates', label: 'Certificates', icon: <Award className="h-3.5 w-3.5" />, show: true },
    { id: 'library', label: 'Library', icon: <BookOpen className="h-3.5 w-3.5" />, show: true },
    { id: 'transport', label: 'Transport', icon: <Bus className="h-3.5 w-3.5" />, show: true },
    { id: 'admissions', label: 'Admissions', icon: <UserPlus className="h-3.5 w-3.5" />, show: true },
    { id: 'staff', label: 'Teachers & Staff', icon: <Users className="h-3.5 w-3.5" />, show: isStaffManager || canAudit },
    { id: 'contacts', label: 'Contacts', icon: <Phone className="h-3.5 w-3.5" />, show: true },
    { id: 'tickets', label: 'Support Tickets', icon: <LifeBuoy className="h-3.5 w-3.5" />, show: true },
    { id: 'audit', label: 'Audit Logs', icon: <ClipboardList className="h-3.5 w-3.5" />, show: canAudit },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        {navButtons
          .filter((b) => b.show)
          .map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setTab(b.id);
                setFeedback(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors min-h-[40px] ${
                tab === b.id
                  ? 'bg-[#0F1E36] text-white dark:bg-blue-600'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {b.icon}
              <span>{b.label}</span>
            </button>
          ))}
      </div>

      {feedback && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-medium ${
            feedback.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
          }`}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{feedback.msg}</span>
        </div>
      )}

      {/* Notices & Events */}
      {tab === 'notices' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">Official School Notice Board</h2>
              {notices.length === 0 ? (
                <p className="text-sm text-slate-500">No school notices published yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {notices.map((n) => (
                    <div key={String(n.id)} className="py-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{String(n.title)}</h3>
                        <span className="text-[11px] font-mono text-slate-500 shrink-0">{formatDateByCalendar(String(n.created_at), calendar)}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line">{String(n.body)}</p>
                      <p className="mt-1.5 text-[11px] text-slate-500">
                        {String(n.notice_type)} · Audience: {String(n.audience)} · Priority: {String(n.priority)} · By {String(n.author_name || 'School Admin')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">Scheduled School Events</h2>
              {events.length === 0 ? (
                <p className="text-sm text-slate-500">No events scheduled.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {events.map((ev) => (
                    <div key={String(ev.id)} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                      <div className="text-[11px] font-mono text-blue-600 dark:text-cyan-400">
                        {formatDateByCalendar(String(ev.event_date), calendar)} · {String(ev.category)}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{String(ev.title)}</div>
                      <p className="mt-1 text-xs text-slate-500">{String(ev.description)}</p>
                      <div className="mt-1 text-[11px] text-slate-500">Location: {String(ev.location)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {canCreateNotice && (
            <div className="lg:col-span-5 space-y-5">
              <form onSubmit={handlePublishNotice} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Publish Official Notice</h3>
                <input
                  required
                  placeholder="Notice Title"
                  value={noticeForm.title}
                  onChange={(e) => setNoticeForm({ ...noticeForm, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]"
                />
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={noticeForm.noticeType}
                    onChange={(e) => setNoticeForm({ ...noticeForm, noticeType: e.target.value })}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-xs"
                  >
                    <option value="GENERAL">General</option>
                    <option value="HOLIDAY">Holiday</option>
                    <option value="EXAMINATION">Exam</option>
                    <option value="FEE">Fee</option>
                    <option value="MEETING">Meeting</option>
                    <option value="EMERGENCY">Emergency</option>
                  </select>
                  <select
                    value={noticeForm.audience}
                    onChange={(e) => setNoticeForm({ ...noticeForm, audience: e.target.value })}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-xs"
                  >
                    <option value="ALL">All School</option>
                    <option value="PARENTS">Parents</option>
                    <option value="STUDENTS">Students</option>
                    <option value="TEACHERS">Teachers</option>
                  </select>
                  <select
                    value={noticeForm.priority}
                    onChange={(e) => setNoticeForm({ ...noticeForm, priority: e.target.value })}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-xs"
                  >
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
                <textarea
                  required
                  rows={3}
                  placeholder="Notice body..."
                  value={noticeForm.body}
                  onChange={(e) => setNoticeForm({ ...noticeForm, body: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
                <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white hover:bg-[#193054] min-h-[42px]">
                  Publish Notice
                </button>
              </form>

              <form onSubmit={handleCreateEvent} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Schedule School Event</h3>
                <input
                  required
                  placeholder="Event Title"
                  value={eventForm.title}
                  onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    required
                    value={eventForm.eventDate}
                    onChange={(e) => setEventForm({ ...eventForm, eventDate: e.target.value })}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                  />
                  <input
                    required
                    placeholder="Category"
                    value={eventForm.category}
                    onChange={(e) => setEventForm({ ...eventForm, category: e.target.value })}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                  />
                </div>
                <input
                  required
                  placeholder="Location"
                  value={eventForm.location}
                  onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                />
                <textarea
                  required
                  rows={2}
                  placeholder="Description..."
                  value={eventForm.description}
                  onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                />
                <button type="submit" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 py-2.5 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[42px]">
                  Schedule Event
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Fees & Receipts */}
      {tab === 'fees' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-3">
            <div>
              <strong>Nepal Payment Gateways:</strong> eSewa ({gateways.esewa ? 'Configured' : 'Merchant code not set'}) · Khalti ({gateways.khalti ? 'Configured' : 'Secret key not set'}). Offline verified bank/cash receipts are supported by school Accounts Staff.
            </div>
            {canCreateInvoice && (
              <a
                href="/api/v1/operations/fees/export"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[40px]"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Export Ledger CSV</span>
              </a>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className={canCreateInvoice ? 'lg:col-span-8' : 'lg:col-span-12'}>
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Student</th>
                      <th className="px-4 py-3 font-semibold">Invoice</th>
                      <th className="px-4 py-3 font-semibold">Net Amount</th>
                      <th className="px-4 py-3 font-semibold">Due Date</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {invoices.map((inv) => {
                      const net = Number(inv.amount) - Number(inv.discount || 0);
                      const isPaid = String(inv.status) === 'PAID';
                      return (
                        <tr key={String(inv.id)}>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900 dark:text-white">{String(inv.student_name)}</div>
                            <div className="text-[11px] font-mono text-slate-500">{String(inv.student_code)}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium">{String(inv.title)}</div>
                            <div className="text-[11px] text-slate-500">{String(inv.fee_type)}</div>
                          </td>
                          <td className="px-4 py-3 font-mono tabular-nums font-semibold">{formatCurrency(net, 'NPR')}</td>
                          <td className="px-4 py-3 font-mono">{formatDateByCalendar(String(inv.due_date), calendar)}</td>
                          <td className="px-4 py-3 font-medium">
                            {isPaid ? (
                              <span className="text-emerald-600 dark:text-emerald-400">PAID · {String(inv.receipt_number)}</span>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400">{String(inv.status)}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                            {isPaid ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setReceiptInvoice(inv)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-[11px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                  <Printer className="h-3 w-3" />
                                  <span>Receipt</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => downloadInvoicePdf(inv)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 dark:text-cyan-300 hover:bg-blue-100"
                                >
                                  <Download className="h-3 w-3" />
                                  <span>PDF</span>
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handlePayInvoice(String(inv.id), 'ESEWA')}
                                  className="rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-[11px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                  eSewa
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handlePayInvoice(String(inv.id), 'KHALTI')}
                                  className="rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-[11px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                  Khalti
                                </button>
                                {canCreateInvoice && (
                                  <button
                                    type="button"
                                    onClick={() => handlePayInvoice(String(inv.id), 'BANK_CASH_OFFICE')}
                                    className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
                                  >
                                    Record Cash/Bank
                                  </button>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {canCreateInvoice && (
              <form onSubmit={handleCreateInvoice} className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Generate Fee Invoice</h3>
                <select
                  value={feeForm.studentId}
                  onChange={(e) => setFeeForm({ ...feeForm, studentId: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]"
                >
                  {students.map((s) => (
                    <option key={String(s.id)} value={String(s.id)}>
                      {String(s.full_name)} ({String(s.student_code)})
                    </option>
                  ))}
                </select>
                <input
                  required
                  placeholder="Invoice Title"
                  value={feeForm.title}
                  onChange={(e) => setFeeForm({ ...feeForm, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    required
                    placeholder="Amount NPR"
                    value={feeForm.amount}
                    onChange={(e) => setFeeForm({ ...feeForm, amount: e.target.value })}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono"
                  />
                  <input
                    type="number"
                    placeholder="Discount NPR"
                    value={feeForm.discount}
                    onChange={(e) => setFeeForm({ ...feeForm, discount: e.target.value })}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono"
                  />
                </div>
                <input
                  type="date"
                  required
                  value={feeForm.dueDate}
                  onChange={(e) => setFeeForm({ ...feeForm, dueDate: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                />
                <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white min-h-[42px]">
                  Create Invoice
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Expenses Ledger */}
      {tab === 'expenses' && canViewExpenses && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Collected Fee Revenue</div>
              <div className="mt-1 text-lg font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatCurrency(totalFeesCollected, 'NPR')}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Recorded Expenses</div>
              <div className="mt-1 text-lg font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                {formatCurrency(totalExpenses, 'NPR')}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Net Balance</div>
              <div className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {formatCurrency(totalFeesCollected - totalExpenses, 'NPR')}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className={canRecordExpense ? 'lg:col-span-8' : 'lg:col-span-12'}>
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">School Expenses Ledger</h2>
                {expenses.length === 0 ? (
                  <p className="text-sm text-slate-500">No school expenses recorded yet.</p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {expenses.map((ex) => (
                      <div key={String(ex.id)} className="py-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">{String(ex.title)}</div>
                          <div className="text-slate-500">
                            {String(ex.category)} · Paid to {String(ex.paid_to)} · Recorded by {String(ex.recorded_by_name)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                            {formatCurrency(Number(ex.amount), 'NPR')}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {formatDateByCalendar(String(ex.expense_date), calendar)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {canRecordExpense && (
              <form onSubmit={handleRecordExpense} className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Record Operational Expense</h3>
                <input
                  required
                  placeholder="Expense Title (e.g. Science Lab Reagents)"
                  value={expenseForm.title}
                  onChange={(e) => setExpenseForm({ ...expenseForm, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={expenseForm.category}
                    onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-xs min-h-[40px]"
                  >
                    <option value="Utilities">Utilities</option>
                    <option value="Laboratory">Laboratory</option>
                    <option value="Maintenance">Maintenance</option>
                    <option value="Stationery">Stationery</option>
                    <option value="Transport Fuel">Transport Fuel</option>
                    <option value="Staff Welfare">Staff Welfare</option>
                  </select>
                  <input
                    type="number"
                    min={1}
                    required
                    placeholder="Amount NPR"
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono min-h-[40px]"
                  />
                </div>
                <input
                  required
                  placeholder="Paid To (Vendor / Payee)"
                  value={expenseForm.paidTo}
                  onChange={(e) => setExpenseForm({ ...expenseForm, paidTo: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]"
                />
                <input
                  type="date"
                  required
                  value={expenseForm.expenseDate}
                  onChange={(e) => setExpenseForm({ ...expenseForm, expenseDate: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]"
                />
                <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white min-h-[42px]">
                  Record Expense
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Campus Inventory & Assets */}
      {tab === 'inventory' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className={canManageInventory ? 'lg:col-span-8' : 'lg:col-span-12'}>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">Campus Equipment & Asset Inventory</h2>
              {inventoryItems.length === 0 ? (
                <p className="text-sm text-slate-500">No campus inventory assets registered yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {inventoryItems.map((item) => (
                    <div key={String(item.id)} className="py-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">{String(item.item_name)}</div>
                        <div className="text-slate-500">
                          {String(item.category)} · Qty <span className="font-mono font-semibold">{String(item.quantity)}</span> · Location: {String(item.location)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {canManageInventory ? (
                          <select
                            aria-label={`Condition for ${String(item.item_name)}`}
                            value={String(item.condition_status)}
                            onChange={(e) => handleUpdateAssetCondition(String(item.id), e.target.value)}
                            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono min-h-[40px]"
                          >
                            <option value="GOOD">GOOD</option>
                            <option value="FAIR">FAIR</option>
                            <option value="MAINTENANCE">MAINTENANCE</option>
                            <option value="RETIRED">RETIRED</option>
                          </select>
                        ) : (
                          <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                            {String(item.condition_status)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {canManageInventory && (
            <form onSubmit={handleAddInventoryAsset} className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Register Campus Asset</h3>
              <input
                required
                placeholder="Asset / Equipment Name"
                value={inventoryForm.itemName}
                onChange={(e) => setInventoryForm({ ...inventoryForm, itemName: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  required
                  placeholder="Category"
                  value={inventoryForm.category}
                  onChange={(e) => setInventoryForm({ ...inventoryForm, category: e.target.value })}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]"
                />
                <input
                  type="number"
                  min={1}
                  required
                  placeholder="Quantity"
                  value={inventoryForm.quantity}
                  onChange={(e) => setInventoryForm({ ...inventoryForm, quantity: e.target.value })}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono min-h-[40px]"
                />
              </div>
              <input
                required
                placeholder="Campus Location (e.g. Lab 2)"
                value={inventoryForm.location}
                onChange={(e) => setInventoryForm({ ...inventoryForm, location: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]"
              />
              <select
                value={inventoryForm.conditionStatus}
                onChange={(e) => setInventoryForm({ ...inventoryForm, conditionStatus: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]"
              >
                <option value="GOOD">Condition: GOOD</option>
                <option value="FAIR">Condition: FAIR</option>
                <option value="MAINTENANCE">Condition: MAINTENANCE</option>
              </select>
              <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white min-h-[42px]">
                Add to Inventory
              </button>
            </form>
          )}
        </div>
      )}

      {/* Reception Visitor Logs */}
      {tab === 'visitors' && canManageVisitors && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">Reception & Campus Visitor Register</h2>
            {visitors.length === 0 ? (
              <p className="text-sm text-slate-500">No visitor check-ins logged yet.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {visitors.map((v) => (
                  <div key={String(v.id)} className="py-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">{String(v.visitor_name)}</div>
                      <div className="text-slate-500">
                        <span className="font-mono">{String(v.visitor_phone)}</span> · {String(v.purpose)} · Meeting: {String(v.visiting_person)}
                      </div>
                      <div className="mt-0.5 text-[11px] font-mono text-slate-500">
                        In: {formatDateByCalendar(String(v.check_in_at), calendar)}
                        {v.check_out_at ? ` · Out: ${formatDateByCalendar(String(v.check_out_at), calendar)}` : ' · On Campus'}
                      </div>
                    </div>
                    {!v.check_out_at ? (
                      <button
                        type="button"
                        onClick={() => handleCheckoutVisitor(String(v.id))}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[40px]"
                      >
                        Check Out
                      </button>
                    ) : (
                      <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">Checked Out</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleCheckInVisitor} className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Check In Campus Visitor</h3>
            <input
              required
              placeholder="Visitor Full Name"
              value={visitorForm.visitorName}
              onChange={(e) => setVisitorForm({ ...visitorForm, visitorName: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]"
            />
            <input
              required
              placeholder="Phone (+97798...)"
              value={visitorForm.visitorPhone}
              onChange={(e) => setVisitorForm({ ...visitorForm, visitorPhone: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono min-h-[40px]"
            />
            <input
              required
              placeholder="Purpose of Visit"
              value={visitorForm.purpose}
              onChange={(e) => setVisitorForm({ ...visitorForm, purpose: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]"
            />
            <input
              required
              placeholder="Visiting Staff / Office"
              value={visitorForm.visitingPerson}
              onChange={(e) => setVisitorForm({ ...visitorForm, visitingPerson: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]"
            />
            <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white min-h-[42px]">
              Record Check-In
            </button>
          </form>
        </div>
      )}

      {/* Official Student Certificates */}
      {tab === 'certificates' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className={canIssueCertificates ? 'lg:col-span-8' : 'lg:col-span-12'}>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">Official Student Certificates</h2>
              {certificates.length === 0 ? (
                <p className="text-sm text-slate-500">No certificates issued for this account scope yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {certificates.map((cert) => (
                    <div key={String(cert.id)} className="py-3.5 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          {String(cert.student_name)} · {String(cert.certificate_type).replace(/_/g, ' ')}
                        </div>
                        <div className="text-slate-500">
                          <span className="font-mono">{String(cert.certificate_number)}</span> · {String(cert.class_name)} ({String(cert.section)}) · Issued {formatDateByCalendar(String(cert.issued_at), calendar)}
                        </div>
                        <p className="mt-1 text-slate-600 dark:text-slate-300">{String(cert.remarks)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedCertificate(cert)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[40px]"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          <span>View / Print</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadCertPdf(cert)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs font-semibold text-blue-700 dark:text-cyan-300 hover:bg-blue-100 min-h-[40px]"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>PDF</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {canIssueCertificates && (
            <form onSubmit={handleIssueCertificate} className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Issue Official Certificate</h3>
              <select
                value={certForm.studentId}
                onChange={(e) => setCertForm({ ...certForm, studentId: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]"
              >
                {students.map((s) => (
                  <option key={String(s.id)} value={String(s.id)}>
                    {String(s.full_name)} ({String(s.student_code)})
                  </option>
                ))}
              </select>
              <select
                value={certForm.certificateType}
                onChange={(e) => setCertForm({ ...certForm, certificateType: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]"
              >
                <option value="CHARACTER">Character Certificate</option>
                <option value="TRANSFER">Transfer Certificate (TC)</option>
                <option value="STEM_MERIT">STEM & Olympiad Merit</option>
                <option value="ATTENDANCE_HONOR">Full Attendance Honor</option>
              </select>
              <textarea
                required
                rows={3}
                placeholder="Official Principal / Registrar citation remarks..."
                value={certForm.remarks}
                onChange={(e) => setCertForm({ ...certForm, remarks: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
              />
              <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white min-h-[42px]">
                Issue & Register Certificate
              </button>
            </form>
          )}
        </div>
      )}

      {/* Library */}
      {tab === 'library' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className={canManageLibrary ? 'lg:col-span-8 space-y-5' : 'lg:col-span-12 space-y-5'}>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">School Library Catalog</h2>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {books.map((b) => (
                  <div key={String(b.id)} className="py-3 flex items-center justify-between text-xs">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">{String(b.title)}</div>
                      <div className="text-slate-500">{String(b.author)} · {String(b.category)} · ISBN {String(b.isbn)}</div>
                    </div>
                    <div className="font-mono tabular-nums font-semibold">
                      {String(b.available_copies)}/{String(b.total_copies)} available
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {issues.length > 0 && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Issued Books</h3>
                {issues.map((i) => (
                  <div key={String(i.id)} className="py-2.5 text-xs flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <div>
                      <span className="font-semibold text-slate-900 dark:text-white">{String(i.book_title)}</span>
                      <span className="text-slate-500"> · {String(i.student_name)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-slate-500">
                        Due {formatDateByCalendar(String(i.due_date || i.issued_at), calendar)}
                      </span>
                      {i.returned_at ? (
                        <span className="font-mono text-emerald-600 dark:text-emerald-400">Returned</span>
                      ) : (
                        canManageLibrary && (
                          <button
                            type="button"
                            onClick={() => handleReturnBook(String(i.id))}
                            className="rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            Mark Returned
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {canManageLibrary && (
            <div className="lg:col-span-4 space-y-5">
              <form onSubmit={handleIssueBook} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Issue Book to Student</h3>
                <select value={issueForm.bookId} onChange={(e) => setIssueForm({ ...issueForm, bookId: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]">
                  {books.map((b) => (
                    <option key={String(b.id)} value={String(b.id)}>
                      {String(b.title)} ({String(b.available_copies)} avail)
                    </option>
                  ))}
                </select>
                <select value={issueForm.studentId} onChange={(e) => setIssueForm({ ...issueForm, studentId: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]">
                  {students.map((s) => (
                    <option key={String(s.id)} value={String(s.id)}>
                      {String(s.full_name)} ({String(s.student_code)})
                    </option>
                  ))}
                </select>
                <input required type="date" value={issueForm.dueDate} onChange={(e) => setIssueForm({ ...issueForm, dueDate: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
                <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white min-h-[40px]">Issue Book</button>
              </form>

              <form onSubmit={handleAddBook} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add Book to Catalog</h3>
                <input required placeholder="Book Title" value={bookForm.title} onChange={(e) => setBookForm({ ...bookForm, title: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs" />
                <input required placeholder="Author" value={bookForm.author} onChange={(e) => setBookForm({ ...bookForm, author: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs" />
                <input required placeholder="Category" value={bookForm.category} onChange={(e) => setBookForm({ ...bookForm, category: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs" />
                <div className="grid grid-cols-2 gap-2">
                  <input required placeholder="ISBN" value={bookForm.isbn} onChange={(e) => setBookForm({ ...bookForm, isbn: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono" />
                  <input required type="number" min={1} placeholder="Copies" value={bookForm.totalCopies} onChange={(e) => setBookForm({ ...bookForm, totalCopies: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono" />
                </div>
                <button type="submit" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 py-2.5 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800">Add Book</button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Transport */}
      {tab === 'transport' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className={`${canManageTransport ? 'lg:col-span-8' : 'lg:col-span-12'} rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5`}>
            <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">School Transport Routes</h2>
            {routes.length === 0 ? (
              <p className="text-sm text-slate-500">No bus routes configured yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {routes.map((r) => (
                  <div key={String(r.id)} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                    <div className="text-sm font-bold text-slate-900 dark:text-white">{String(r.route_name)}</div>
                    <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      Vehicle: <span className="font-mono">{String(r.vehicle_number)}</span> · Driver: {String(r.driver_name)} ({String(r.driver_phone)})
                    </div>
                    <div className="mt-1 text-xs text-slate-500">Stops: {String(r.stops || r.stops_json || '')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {canManageTransport && (
            <form onSubmit={handleAddRoute} className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add Bus Route</h3>
              <input required placeholder="Route Name (e.g. Route B — Patan)" value={routeForm.routeName} onChange={(e) => setRouteForm({ ...routeForm, routeName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
              <input required placeholder="Vehicle Number (e.g. BA 3 KHA 1122)" value={routeForm.vehicleNumber} onChange={(e) => setRouteForm({ ...routeForm, vehicleNumber: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono min-h-[40px]" />
              <input required placeholder="Driver Full Name" value={routeForm.driverName} onChange={(e) => setRouteForm({ ...routeForm, driverName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
              <input required placeholder="Driver Phone" value={routeForm.driverPhone} onChange={(e) => setRouteForm({ ...routeForm, driverPhone: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono min-h-[40px]" />
              <textarea required rows={2} placeholder="Stops (e.g. Lagankhel -> Jawalakhel -> Kupondole -> School)" value={routeForm.stops} onChange={(e) => setRouteForm({ ...routeForm, stops: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs" />
              <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white min-h-[42px]">Add Transport Route</button>
            </form>
          )}
        </div>
      )}

      {/* Admissions */}
      {tab === 'admissions' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">Admission Applications</h2>
            {admissions.length === 0 ? (
              <p className="text-sm text-slate-500">No admission applications recorded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {admissions.map((a) => (
                  <div key={String(a.id)} className="py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">{String(a.applicant_name)}</div>
                      <div className="text-slate-500">{String(a.applying_class)} · Guardian: {String(a.guardian_name)} ({String(a.guardian_phone)})</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`font-mono font-semibold ${String(a.status) === 'APPROVED' ? 'text-emerald-600' : String(a.status) === 'REJECTED' ? 'text-red-600' : 'text-blue-600 dark:text-cyan-400'}`}>
                        {String(a.status)}
                      </span>
                      {canReviewAdmissions && String(a.status) === 'PENDING' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleReviewAdmission(String(a.id), 'APPROVED')}
                            className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReviewAdmission(String(a.id), 'REJECTED')}
                            className="rounded-lg border border-red-300 dark:border-red-800 px-2.5 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                          >
                            Decline
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <form onSubmit={handleSubmitAdmission} className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Submit Admission Inquiry</h3>
            <input required placeholder="Applicant Full Name" value={admForm.applicantName} onChange={(e) => setAdmForm({ ...admForm, applicantName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
            <input required placeholder="Applying Class (e.g. Grade 8)" value={admForm.applyingClass} onChange={(e) => setAdmForm({ ...admForm, applyingClass: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
            <input required placeholder="Guardian Name" value={admForm.guardianName} onChange={(e) => setAdmForm({ ...admForm, guardianName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
            <input required placeholder="Guardian Phone (+977...)" value={admForm.guardianPhone} onChange={(e) => setAdmForm({ ...admForm, guardianPhone: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
            <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white min-h-[42px]">Submit Application</button>
          </form>
        </div>
      )}

      {/* Staff & Teachers Management (Principal) */}
      {tab === 'staff' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className={isStaffManager ? 'lg:col-span-7' : 'lg:col-span-12'}>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">School Memberships & Staff Directory</h2>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {members.map((m) => (
                  <div key={String(m.id)} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">{String(m.full_name)}</div>
                      <div className="text-slate-500 font-mono">
                        {String(m.user_code)} · {String(m.role)} · {String(m.department || 'General')} · {String(m.status)}
                      </div>
                    </div>
                    {isStaffManager && String(m.user_id) !== user.userId && (
                      <button
                        type="button"
                        onClick={() => handleToggleMemberStatus(String(m.id), String(m.status) === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 self-start sm:self-auto"
                      >
                        {String(m.status) === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {isStaffManager && (
            <div className="lg:col-span-5 space-y-4">
              <form onSubmit={handleCreateStaff} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Create Teacher / Tech / Staff Account</h3>
                <input required placeholder="Full Name" value={staffForm.fullName} onChange={(e) => setStaffForm({ ...staffForm, fullName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
                <input required type="email" placeholder="Official Email" value={staffForm.email} onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
                <input required placeholder="Phone (+97798...)" value={staffForm.phone} onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
                <select value={staffForm.role} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]">
                  <option value="TEACHER">Teacher</option>
                  <option value="CLASS_TEACHER">Class Teacher</option>
                  <option value="VICE_PRINCIPAL">Vice Principal</option>
                  <option value="EXAM_OFFICER">Exam Officer</option>
                  <option value="TECHNICAL_DEPT">Technical Department</option>
                  <option value="STAFF_ACCOUNTANT">Accounts Officer</option>
                  <option value="STAFF_LIBRARIAN">Librarian</option>
                  <option value="STAFF_TRANSPORT">Transport Officer</option>
                  <option value="STAFF_ADMIN">Administrative Officer</option>
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <input required placeholder="Department" value={staffForm.department} onChange={(e) => setStaffForm({ ...staffForm, department: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs" />
                  <input required placeholder="Designation" value={staffForm.designation} onChange={(e) => setStaffForm({ ...staffForm, designation: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs" />
                </div>
                <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white min-h-[42px]">
                  Generate School Login Account
                </button>
              </form>

              {newStaffCredentials && (
                <div className="rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-xs space-y-1">
                  <div className="font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4" />
                    <span>Generated Login Credentials</span>
                  </div>
                  <div>School ID: <span className="font-mono font-bold">{user.activeSchoolCode}</span></div>
                  <div>User ID: <span className="font-mono font-bold">{newStaffCredentials.userCode}</span></div>
                  {newStaffCredentials.temporaryPassword && (
                    <div>One-Time Temp Password: <span className="font-mono font-bold">{newStaffCredentials.temporaryPassword}</span></div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Contacts */}
      {tab === 'contacts' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">Official School Department Contacts</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {contacts.map((c) => (
              <div key={String(c.id)} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-xs space-y-1">
                <div className="text-sm font-bold text-slate-900 dark:text-white">{String(c.department)}</div>
                <div className="text-slate-600 dark:text-slate-300">{String(c.contact_name)}</div>
                <div className="font-mono text-blue-600 dark:text-cyan-400">{String(c.official_phone || c.phone || '')}</div>
                <div className="text-slate-500">{String(c.official_email || c.email || '')}</div>
                <div className="text-slate-500">{String(c.working_hours || c.office_hours || '')}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Support Tickets */}
      {tab === 'tickets' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">School Helpdesk & Support Tickets</h2>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {tickets.length === 0 ? (
                <p className="text-sm text-slate-500">No open support tickets.</p>
              ) : (
                tickets.map((t) => (
                  <div key={String(t.id)} className="py-3 text-xs space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">{String(t.subject)}</span>
                      <span className={`font-mono font-semibold ${String(t.status) === 'RESOLVED' ? 'text-emerald-600' : 'text-blue-600 dark:text-cyan-400'}`}>
                        {String(t.status)}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300">{String(t.description)}</p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-slate-500">{String(t.category)} · By {String(t.reporter_name)}</span>
                      {canResolveTickets && String(t.status) !== 'RESOLVED' && (
                        <div className="flex gap-1.5">
                          {String(t.status) === 'OPEN' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateTicketStatus(String(t.id), 'IN_PROGRESS')}
                              className="rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              In Progress
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleUpdateTicketStatus(String(t.id), 'RESOLVED')}
                            className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                          >
                            Mark Resolved
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <form onSubmit={handleSubmitTicket} className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Open Support Ticket</h3>
            <input required placeholder="Category (e.g. Transport, IT, Fees)" value={ticketForm.category} onChange={(e) => setTicketForm({ ...ticketForm, category: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
            <input required placeholder="Subject" value={ticketForm.subject} onChange={(e) => setTicketForm({ ...ticketForm, subject: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
            <textarea required rows={3} placeholder="Describe your issue..." value={ticketForm.description} onChange={(e) => setTicketForm({ ...ticketForm, description: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs" />
            <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white min-h-[42px]">Submit Ticket</button>
          </form>
        </div>
      )}

      {/* Audit Logs */}
      {tab === 'audit' && canAudit && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">Security & Administrative Audit Logs</h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {auditLogs.map((l) => (
              <div key={String(l.id)} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <div>
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">{String(l.action)}</span>
                  <span className="text-slate-500"> · {String(l.resource_type)} {l.resource_id ? `(${String(l.resource_id)})` : ''} · Actor: {String(l.actor_name || 'System')}</span>
                </div>
                <span className="font-mono text-slate-500">{formatDateByCalendar(String(l.created_at), calendar)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Printable Fee Receipt Modal */}
      {receiptInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="text-center border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="text-xs font-mono text-slate-500">{user.activeSchoolCode}</div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{user.activeSchoolName}</h3>
              <div className="text-xs text-emerald-600 font-semibold">OFFICIAL PAYMENT RECEIPT</div>
            </div>
            <div className="text-xs space-y-2">
              <div className="flex justify-between"><span className="text-slate-500">Receipt No:</span><span className="font-mono font-bold">{String(receiptInvoice.receipt_number)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Student:</span><span className="font-semibold">{String(receiptInvoice.student_name)} ({String(receiptInvoice.student_code)})</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Fee Item:</span><span>{String(receiptInvoice.title)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Gateway:</span><span className="font-mono">{String(receiptInvoice.gateway)}</span></div>
              <div className="flex justify-between text-sm font-bold pt-2 border-t border-slate-200 dark:border-slate-800">
                <span>Total Paid</span>
                <span className="font-mono tabular-nums">{formatCurrency(Number(receiptInvoice.amount) - Number(receiptInvoice.discount || 0), 'NPR')}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => downloadInvoicePdf(receiptInvoice)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 py-2.5 px-3 text-xs font-semibold text-blue-700 dark:text-cyan-300 hover:bg-blue-100"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download PDF</span>
              </button>
              <button type="button" onClick={() => window.print()} className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 py-2.5 text-xs font-semibold">
                Print Receipt
              </button>
              <button type="button" onClick={() => setReceiptInvoice(null)} className="flex-1 rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Official Certificate Modal */}
      {selectedCertificate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-7 shadow-2xl space-y-5">
            <div className="text-center border-b border-slate-200 dark:border-slate-800 pb-4">
              <div className="text-[11px] font-mono uppercase tracking-widest text-slate-500">
                {user.activeSchoolCode} · Certificate No. {String(selectedCertificate.certificate_number)}
              </div>
              <h3 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{user.activeSchoolName}</h3>
              <div className="mt-1 text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-cyan-400">
                OFFICIAL {String(selectedCertificate.certificate_type).replace(/_/g, ' ')} CERTIFICATE
              </div>
            </div>
            <div className="space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
              <p>
                This is to certify that <strong>{String(selectedCertificate.student_name)}</strong> (Student ID:{' '}
                <span className="font-mono font-semibold">{String(selectedCertificate.student_code)}</span>), enrolled in{' '}
                <strong>
                  {String(selectedCertificate.class_name)} ({String(selectedCertificate.section)})
                </strong>
                , is officially awarded this recognition on{' '}
                <span className="font-mono">{formatDateByCalendar(String(selectedCertificate.issued_at), calendar)}</span>.
              </p>
              <blockquote className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5 text-xs italic text-slate-600 dark:text-slate-300">
                "{String(selectedCertificate.remarks)}"
              </blockquote>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-4 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs">
              <div className="flex items-center gap-3">
                {certQrUrl ? (
                  <img
                    src={certQrUrl}
                    alt={`Verification QR for certificate ${String(selectedCertificate.certificate_number)}`}
                    className="h-16 w-16 rounded-lg border border-slate-200 dark:border-slate-700 bg-white p-1"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400">
                    <QrCode className="h-6 w-6" />
                  </div>
                )}
                <div>
                  <div className="font-semibold text-slate-900 dark:text-white">Office of the Principal</div>
                  <div className="text-slate-500">Verified Tenant Ledger Record</div>
                  <div className="text-[11px] font-mono text-blue-600 dark:text-cyan-400 mt-0.5">Scan QR to Verify</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => downloadCertPdf(selectedCertificate)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3.5 py-2 text-xs font-semibold text-blue-700 dark:text-cyan-300 hover:bg-blue-100 min-h-[40px]"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download PDF</span>
                </button>
                <button type="button" onClick={() => window.print()} className="rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold min-h-[40px]">
                  Print Certificate
                </button>
                <button type="button" onClick={() => setSelectedCertificate(null)} className="rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white min-h-[40px]">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
