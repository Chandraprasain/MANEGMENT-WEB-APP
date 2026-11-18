import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { calculateStudentOverallGpa, formatCurrency, formatDateByCalendar } from './domainRules';

export interface PdfSchoolMeta {
  name: string;
  schoolCode: string;
  address?: string;
  district?: string;
  province?: string;
  telephone?: string;
  officialEmail?: string;
}

export async function generateQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    width: 240,
    margin: 1,
    color: { dark: '#0F1E36', light: '#FFFFFF' },
  });
}

export async function generateStudentIdCardPdf(params: {
  school: PdfSchoolMeta;
  student: {
    studentCode: string;
    fullName: string;
    className: string;
    rollNumber: string | number;
    admissionNumber: string;
    guardianName?: string;
    guardianPhone?: string;
    address?: string;
  };
}): Promise<void> {
  const { school, student } = params;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [86, 54] });

  // Top Navy Header Band
  doc.setFillColor(15, 30, 54);
  doc.rect(0, 0, 86, 14, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(school.name.slice(0, 34), 4, 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.text(`${school.schoolCode} · OFFICIAL STUDENT IDENTITY CARD`, 4, 10.8);

  // Student Details
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(student.fullName.slice(0, 26), 4, 21);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(71, 85, 105);
  doc.text(`Student ID: ${student.studentCode}`, 4, 26.5);
  doc.text(`Class: ${student.className} · Roll #${student.rollNumber}`, 4, 31);
  doc.text(`Admission: ${student.admissionNumber}`, 4, 35.5);
  if (student.guardianName) {
    doc.text(`Guardian: ${student.guardianName.slice(0, 24)}`, 4, 40);
  }
  if (student.guardianPhone) {
    doc.text(`Contact: ${student.guardianPhone}`, 4, 44.5);
  }

  // QR Verification Code
  const qrPayload = `SHIKSHYAPLUS|${school.schoolCode}|${student.studentCode}|${student.fullName}`;
  const qrDataUrl = await generateQrDataUrl(qrPayload);
  doc.addImage(qrDataUrl, 'PNG', 59, 17, 22, 22);
  doc.setFontSize(5.5);
  doc.setTextColor(100, 116, 139);
  doc.text('SCAN FOR ATTENDANCE', 70, 42, { align: 'center' });

  // Footer stripe
  doc.setFillColor(241, 245, 249);
  doc.rect(0, 48, 86, 6, 'F');
  doc.setFontSize(5.5);
  doc.setTextColor(51, 65, 85);
  doc.text(`${school.district || 'Nepal'} · Verified by ShikshyaPlus`, 4, 52);

  doc.save(`ID-Card-${school.schoolCode}-${student.studentCode}.pdf`);
}

export async function generateReportCardPdf(params: {
  school: PdfSchoolMeta;
  examName: string;
  examDate: string;
  calendar: 'AD' | 'BS';
  studentName: string;
  studentCode: string;
  className: string;
  marks: Array<{
    subject_name: string;
    theory_marks: number;
    practical_marks: number;
    full_marks: number;
    grade: string;
    gpa: number;
  }>;
}): Promise<void> {
  const { school, examName, examDate, calendar, studentName, studentCode, className, marks } = params;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const summary = calculateStudentOverallGpa(marks);

  // Outer Frame
  doc.setDrawColor(15, 30, 54);
  doc.setLineWidth(0.7);
  doc.rect(12, 12, 186, 273);

  // School Header
  doc.setFillColor(15, 30, 54);
  doc.rect(12, 12, 186, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(school.name, 105, 23, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${school.schoolCode} · ${school.district || 'Nepal'} · OFFICIAL ACADEMIC GRADE SHEET`, 105, 31, { align: 'center' });

  // Exam Title
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(examName, 105, 50, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`Issued Date: ${formatDateByCalendar(examDate, calendar)}`, 105, 56, { align: 'center' });

  // Student Info Box
  doc.setFillColor(248, 250, 252);
  doc.rect(20, 63, 170, 22, 'FD');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`Student Name: ${studentName}`, 25, 71);
  doc.setFont('helvetica', 'normal');
  doc.text(`Student ID: ${studentCode}`, 25, 78);
  doc.text(`Class & Section: ${className}`, 120, 71);
  doc.text(`Result Status: ${summary.allPassed ? 'PASSED' : 'NEEDS IMPROVEMENT'}`, 120, 78);

  // Table Header
  let y = 96;
  doc.setFillColor(226, 232, 240);
  doc.rect(20, y, 170, 9, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Subject', 24, y + 6);
  doc.text('Theory', 100, y + 6, { align: 'right' });
  doc.text('Practical', 124, y + 6, { align: 'right' });
  doc.text('Total', 146, y + 6, { align: 'right' });
  doc.text('Grade', 166, y + 6, { align: 'right' });
  doc.text('GPA', 186, y + 6, { align: 'right' });

  y += 12;
  doc.setFont('helvetica', 'normal');
  for (const m of marks) {
    const total = Number(m.theory_marks) + Number(m.practical_marks);
    doc.text(String(m.subject_name).slice(0, 36), 24, y + 4);
    doc.text(String(m.theory_marks), 100, y + 4, { align: 'right' });
    doc.text(String(m.practical_marks), 124, y + 4, { align: 'right' });
    doc.text(`${total}/${m.full_marks}`, 146, y + 4, { align: 'right' });
    doc.text(String(m.grade), 166, y + 4, { align: 'right' });
    doc.text(Number(m.gpa).toFixed(2), 186, y + 4, { align: 'right' });
    doc.setDrawColor(226, 232, 240);
    doc.line(20, y + 7, 190, y + 7);
    y += 10;
    if (y > 235) break;
  }

  // Summary Box + QR
  y += 8;
  doc.setFillColor(240, 249, 255);
  doc.rect(20, y, 115, 24, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Overall Grade Point Average (GPA): ${summary.averageGpa.toFixed(2)}`, 25, y + 10);
  doc.text(`Final Aggregate Grade: ${summary.overallGrade}`, 25, y + 18);

  const qrUrl = await generateQrDataUrl(`SHIKSHYAPLUS-RESULT|${school.schoolCode}|${studentCode}|${examName}|GPA:${summary.averageGpa}`);
  doc.addImage(qrUrl, 'PNG', 155, y - 2, 32, 32);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('Verify Transcript QR', 171, y + 33, { align: 'center' });

  // Signatures
  doc.setDrawColor(100, 116, 139);
  doc.line(24, 266, 74, 266);
  doc.line(136, 266, 186, 266);
  doc.setFontSize(9);
  doc.text('Class Teacher / Exam Officer', 49, 272, { align: 'center' });
  doc.text('School Principal Seal', 161, 272, { align: 'center' });

  doc.save(`Marksheet-${studentCode}-${examName.replace(/[^a-zA-Z0-9]+/g, '-')}.pdf`);
}

export async function generateFeeReceiptPdf(params: {
  school: PdfSchoolMeta;
  invoice: {
    receipt_number: string;
    student_name: string;
    student_code: string;
    title: string;
    fee_type: string;
    amount: number;
    discount: number;
    gateway: string;
    paid_at?: string;
  };
  calendar: 'AD' | 'BS';
}): Promise<void> {
  const { school, invoice, calendar } = params;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const net = Number(invoice.amount) - Number(invoice.discount || 0);

  doc.setFillColor(15, 30, 54);
  doc.rect(0, 0, 148, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(school.name, 74, 12, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`${school.schoolCode} · OFFICIAL FEE PAYMENT RECEIPT`, 74, 20, { align: 'center' });

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  let y = 42;
  const rows: Array<[string, string]> = [
    ['Receipt Number', String(invoice.receipt_number)],
    ['Student Name', `${invoice.student_name} (${invoice.student_code})`],
    ['Fee Description', `${invoice.title} (${invoice.fee_type})`],
    ['Gross Amount', formatCurrency(Number(invoice.amount), 'NPR')],
    ['Scholarship / Discount', formatCurrency(Number(invoice.discount || 0), 'NPR')],
    ['Net Amount Paid', formatCurrency(net, 'NPR')],
    ['Payment Channel', String(invoice.gateway || 'SCHOOL_OFFICE')],
    ['Payment Date', formatDateByCalendar(String(invoice.paid_at || new Date().toISOString()), calendar)],
  ];

  for (const [k, v] of rows) {
    doc.setFont('helvetica', 'bold');
    doc.text(k, 14, y);
    doc.setFont('helvetica', 'normal');
    doc.text(v, 134, y, { align: 'right' });
    doc.setDrawColor(226, 232, 240);
    doc.line(14, y + 3, 134, y + 3);
    y += 10;
  }

  const qrUrl = await generateQrDataUrl(`SHIKSHYAPLUS-RECEIPT|${school.schoolCode}|${invoice.receipt_number}|NPR:${net}`);
  doc.addImage(qrUrl, 'PNG', 59, 134, 30, 30);
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Verified Digital Receipt · ShikshyaPlus', 74, 170, { align: 'center' });

  doc.save(`Receipt-${invoice.receipt_number}.pdf`);
}

export async function generateCertificatePdf(params: {
  school: PdfSchoolMeta;
  cert: {
    certificate_number: string;
    certificate_type: string;
    student_name: string;
    student_code: string;
    class_name: string;
    section: string;
    remarks: string;
    issued_at: string;
  };
  calendar: 'AD' | 'BS';
}): Promise<void> {
  const { school, cert, calendar } = params;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Double border frame
  doc.setDrawColor(15, 30, 54);
  doc.setLineWidth(1.4);
  doc.rect(10, 10, 277, 190);
  doc.setDrawColor(6, 182, 212);
  doc.setLineWidth(0.5);
  doc.rect(14, 14, 269, 182);

  doc.setTextColor(15, 30, 54);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(school.name.toUpperCase(), 148.5, 34, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(`${school.schoolCode} · ${school.district || 'Nepal'}`, 148.5, 42, { align: 'center' });

  doc.setTextColor(15, 30, 54);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text(`${String(cert.certificate_type).replace(/_/g, ' ')} CERTIFICATE`, 148.5, 64, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.text('This is proudly certified that', 148.5, 82, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(29, 78, 216);
  doc.text(cert.student_name, 148.5, 96, { align: 'center' });

  doc.setTextColor(51, 65, 85);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Student ID: ${cert.student_code} · Class ${cert.class_name}-${cert.section}`, 148.5, 106, { align: 'center' });

  const splitRemarks = doc.splitTextToSize(cert.remarks, 210);
  doc.setFontSize(11.5);
  doc.text(splitRemarks, 148.5, 122, { align: 'center' });

  const qrUrl = await generateQrDataUrl(`SHIKSHYAPLUS-CERT|${school.schoolCode}|${cert.certificate_number}|${cert.student_code}`);
  doc.addImage(qrUrl, 'PNG', 134, 144, 28, 28);
  doc.setFontSize(7.5);
  doc.text(`Cert #: ${cert.certificate_number}`, 148.5, 177, { align: 'center' });

  doc.setDrawColor(100, 116, 139);
  doc.line(30, 172, 88, 172);
  doc.line(208, 172, 266, 172);
  doc.setFontSize(9.5);
  doc.text(`Issued: ${formatDateByCalendar(cert.issued_at, calendar)}`, 59, 178, { align: 'center' });
  doc.text('Principal Signature & School Seal', 237, 178, { align: 'center' });

  doc.save(`Certificate-${cert.certificate_number}.pdf`);
}
