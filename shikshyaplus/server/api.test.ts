import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server';

async function startTestServer() {
  const { app } = createApp(':memory:');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
  return { server, baseUrl };
}

async function login(baseUrl: string, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, cookie, json };
}

test('API integration: School A vs School B multi-tenant isolation & security checks', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    // 1. Unauthenticated access denied
    const unauth = await fetch(`${baseUrl}/students`);
    assert.equal(unauth.status, 401);

    // 2. School A Principal signs in
    const sunPri = await login(baseUrl, {
      mode: 'SCHOOL_ID',
      schoolCode: 'SUNRISE-2026',
      userCode: 'PRI-001',
      password: 'School@2026!',
    });
    assert.equal(sunPri.status, 200);
    assert.ok(sunPri.cookie.includes('sp_session='));

    // 3. School A Principal attempts to read School B members -> 403 Forbidden
    const crossTenant = await fetch(`${baseUrl}/schools/sch-everest-2026/members`, {
      headers: { Cookie: sunPri.cookie },
    });
    assert.equal(crossTenant.status, 403);

    // 4. School A Principal reads School A students -> only Sunrise students appear (never Maya Pun from Everest)
    const stuRes = await fetch(`${baseUrl}/students`, {
      headers: { Cookie: sunPri.cookie },
    });
    const stuJson = (await stuRes.json()) as { data: { students: Array<{ full_name: string }> } };
    assert.equal(stuRes.status, 200);
    assert.ok(stuJson.data.students.some((s) => s.full_name === 'Aarav Sharma'));
    assert.ok(!stuJson.data.students.some((s) => s.full_name === 'Maya Pun'));

    // 5. Teacher creates new student -> receives one-time password -> Student logs in & changes password
    const sunTch = await login(baseUrl, {
      mode: 'SCHOOL_ID',
      schoolCode: 'SUNRISE-2026',
      userCode: 'TCH-001',
      password: 'School@2026!',
    });
    const createStuRes = await fetch(`${baseUrl}/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunTch.cookie },
      body: JSON.stringify({
        fullName: 'Kiran Adhikari',
        classId: 'cls-sun-10a',
        rollNumber: 9,
        admissionNumber: 'ADM-2026-099',
        guardianName: 'Hari Adhikari',
        guardianPhone: '+9779841999888',
      }),
    });
    assert.equal(createStuRes.status, 201);
    const createStuJson = (await createStuRes.json()) as {
      data: { loginCard: { studentCode: string; temporaryPassword: string } };
    };
    const { studentCode, temporaryPassword } = createStuJson.data.loginCard;

    const newStuLogin = await login(baseUrl, {
      mode: 'SCHOOL_ID',
      schoolCode: 'SUNRISE-2026',
      userCode: studentCode,
      password: temporaryPassword,
    });
    assert.equal(newStuLogin.status, 200);

    // Student cannot create another student -> 403 Forbidden
    const stuPrivEsc = await fetch(`${baseUrl}/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: newStuLogin.cookie },
      body: JSON.stringify({
        fullName: 'Hack',
        classId: 'cls-sun-10a',
        rollNumber: 12,
        admissionNumber: 'HACK-1',
        guardianName: 'Hack',
        guardianPhone: '+9779841000000',
      }),
    });
    assert.equal(stuPrivEsc.status, 403);

    // 6. Parent links child with invitation code & cannot see unrelated student
    const parLogin = await login(baseUrl, {
      mode: 'GLOBAL',
      email: 'parent@sunrise.edu.np',
      password: 'Parent@2026!',
    });
    assert.equal(parLogin.status, 200);

    const badInvite = await fetch(`${baseUrl}/parents/link-child`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: parLogin.cookie },
      body: JSON.stringify({ invitationCode: 'WRONG-CODE' }),
    });
    assert.equal(badInvite.status, 400);

    const goodInvite = await fetch(`${baseUrl}/parents/link-child`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: parLogin.cookie },
      body: JSON.stringify({ invitationCode: 'INV-SUN-102', relationship: 'Guardian' }),
    });
    assert.equal(goodInvite.status, 200);

    // 7. Social Feed Isolation: Everest private notice/school post never leaks into Sunrise My School feed
    const mySchoolFeed = await fetch(`${baseUrl}/social/my-school-feed`, {
      headers: { Cookie: sunPri.cookie },
    });
    const mySchoolJson = (await mySchoolFeed.json()) as { data: { posts: Array<{ school_id: string }> } };
    assert.ok(mySchoolJson.data.posts.every((p) => p.school_id === 'sch-sunrise-2026'));

    // 8. Global Feed includes public approved posts from both schools
    const globalFeed = await fetch(`${baseUrl}/social/global-feed`, {
      headers: { Cookie: sunPri.cookie },
    });
    const globalJson = (await globalFeed.json()) as { data: { posts: Array<{ school_id: string }> } };
    assert.ok(globalJson.data.posts.some((p) => p.school_id === 'sch-everest-2026'));

    // 9. AI Homework Scanner returns honest 503 if GEMINI_API_KEY is unset/placeholder
    const prevKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'MY_GEMINI_API_KEY';
    const aiNoKey = await fetch(`${baseUrl}/ai/homework-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: newStuLogin.cookie },
      body: JSON.stringify({ questionText: 'Solve x^2 - 5x + 6 = 0', subject: 'Math', learningMode: 'STEP_BY_STEP' }),
    });
    assert.equal(aiNoKey.status, 503);
    process.env.GEMINI_API_KEY = prevKey;

    // 10. Parent submits leave request & Sunrise Principal approves it (Everest Principal cannot touch it)
    const reqCreate = await fetch(`${baseUrl}/parents/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: parLogin.cookie },
      body: JSON.stringify({
        studentId: 'stu-sun-1',
        requestType: 'LEAVE',
        subject: 'Medical appointment leave',
        details: 'Aarav has a dental checkup tomorrow morning.',
      }),
    });
    assert.equal(reqCreate.status, 201);

    const reqList = await fetch(`${baseUrl}/parents/requests`, { headers: { Cookie: sunPri.cookie } });
    const reqListJson = (await reqList.json()) as { data: { requests: Array<{ id: string; subject: string }> } };
    const createdReq = reqListJson.data.requests.find((r) => r.subject === 'Medical appointment leave');
    assert.ok(createdReq);

    const evPri = await login(baseUrl, {
      mode: 'SCHOOL_ID',
      schoolCode: 'EVEREST-2026',
      userCode: 'PRI-001',
      password: 'School@2026!',
    });
    const crossApprove = await fetch(`${baseUrl}/parents/requests/${createdReq.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: evPri.cookie },
      body: JSON.stringify({ status: 'APPROVED' }),
    });
    assert.equal(crossApprove.status, 404);

    const sunApprove = await fetch(`${baseUrl}/parents/requests/${createdReq.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({ status: 'APPROVED' }),
    });
    assert.equal(sunApprove.status, 200);

    // 11. Library Issue & Return decrements & restores available_copies
    const libBeforeRes = await fetch(`${baseUrl}/operations/library`, { headers: { Cookie: sunPri.cookie } });
    const libBefore = (await libBeforeRes.json()) as { data: { books: Array<{ id: string; available_copies: number }> } };
    const bk1Before = libBefore.data.books.find((b) => b.id === 'bk-1')!;

    const issueRes = await fetch(`${baseUrl}/operations/library/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({ bookId: 'bk-1', studentId: 'stu-sun-1', dueDate: '2026-12-01' }),
    });
    assert.equal(issueRes.status, 201);
    const issueJson = (await issueRes.json()) as { data: { id: string } };

    const libMidRes = await fetch(`${baseUrl}/operations/library`, { headers: { Cookie: sunPri.cookie } });
    const libMid = (await libMidRes.json()) as { data: { books: Array<{ id: string; available_copies: number }> } };
    assert.equal(libMid.data.books.find((b) => b.id === 'bk-1')!.available_copies, bk1Before.available_copies - 1);

    const returnRes = await fetch(`${baseUrl}/operations/library/issues/${issueJson.data.id}/return`, {
      method: 'POST',
      headers: { Cookie: sunPri.cookie },
    });
    assert.equal(returnRes.status, 200);

    const libAfterRes = await fetch(`${baseUrl}/operations/library`, { headers: { Cookie: sunPri.cookie } });
    const libAfter = (await libAfterRes.json()) as { data: { books: Array<{ id: string; available_copies: number }> } };
    assert.equal(libAfter.data.books.find((b) => b.id === 'bk-1')!.available_copies, bk1Before.available_copies);

    // 12. Admissions create & review + Social group creation
    const admRes = await fetch(`${baseUrl}/operations/admissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: parLogin.cookie },
      body: JSON.stringify({
        applicantName: 'Nisha Gurung',
        applyingClass: 'Class 8',
        guardianName: 'Bikram Gurung',
        guardianPhone: '+9779841222333',
      }),
    });
    assert.equal(admRes.status, 201);
    const admJson = (await admRes.json()) as { data: { id: string } };

    const admPatch = await fetch(`${baseUrl}/operations/admissions/${admJson.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({ status: 'APPROVED' }),
    });
    assert.equal(admPatch.status, 200);

    const grpCreate = await fetch(`${baseUrl}/social/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunTch.cookie },
      body: JSON.stringify({
        name: 'Kathmandu Olympiad Circle',
        category: 'Mathematics',
        description: 'Weekly problem-solving group moderated by faculty.',
      }),
    });
    assert.equal(grpCreate.status, 201);

    // 13. Student & Fee CSV exports obey RBAC
    const stuCsvOk = await fetch(`${baseUrl}/students/export`, { headers: { Cookie: sunPri.cookie } });
    assert.equal(stuCsvOk.status, 200);
    const stuCsvText = await stuCsvOk.text();
    assert.ok(stuCsvText.includes('Aarav Sharma'));
    assert.ok(!stuCsvText.includes('Maya Pun'));

    const stuCsvForbidden = await fetch(`${baseUrl}/students/export`, { headers: { Cookie: newStuLogin.cookie } });
    assert.equal(stuCsvForbidden.status, 403);

    const feeCsvOk = await fetch(`${baseUrl}/operations/fees/export`, { headers: { Cookie: sunPri.cookie } });
    assert.equal(feeCsvOk.status, 200);
    assert.ok((await feeCsvOk.text()).includes('Student ID,Student Name'));

    const feeCsvForbidden = await fetch(`${baseUrl}/operations/fees/export`, { headers: { Cookie: newStuLogin.cookie } });
    assert.equal(feeCsvForbidden.status, 403);

    // 14. Post edit/delete & user blocking
    const createPost = await fetch(`${baseUrl}/social/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunTch.cookie },
      body: JSON.stringify({
        audience: 'GLOBAL_COMMUNITY',
        postType: 'RESOURCE',
        content: 'Olympiad Geometry Notes: Practice set 1 uploaded for Grade 10 students.',
      }),
    });
    assert.equal(createPost.status, 201);
    const createdPostJson = (await createPost.json()) as { data: { id: string } };

    const editPost = await fetch(`${baseUrl}/social/posts/${createdPostJson.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: sunTch.cookie },
      body: JSON.stringify({ content: 'Olympiad Geometry Notes Revised: Updated set 1 with solutions.' }),
    });
    assert.equal(editPost.status, 200);

    // Student cannot delete Teacher post -> 403
    const badDelPost = await fetch(`${baseUrl}/social/posts/${createdPostJson.data.id}`, {
      method: 'DELETE',
      headers: { Cookie: newStuLogin.cookie },
    });
    assert.equal(badDelPost.status, 403);

    // Parent blocks Teacher -> Teacher's post disappears from Global Feed
    const teacherUserId = ((sunTch.json.data as { user: { userId: string } }).user).userId;
    const blockRes = await fetch(`${baseUrl}/social/blocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: parLogin.cookie },
      body: JSON.stringify({ blockedUserId: teacherUserId, reason: 'Mute updates' }),
    });
    assert.equal(blockRes.status, 201);

    const blockedFeedRes = await fetch(`${baseUrl}/social/global-feed`, { headers: { Cookie: parLogin.cookie } });
    const blockedFeedJson = (await blockedFeedRes.json()) as { data: { posts: Array<{ id: string }> } };
    assert.ok(!blockedFeedJson.data.posts.some((p) => p.id === createdPostJson.data.id));

    const unblockRes = await fetch(`${baseUrl}/social/blocks/${teacherUserId}`, {
      method: 'DELETE',
      headers: { Cookie: parLogin.cookie },
    });
    assert.equal(unblockRes.status, 200);

    const delPost = await fetch(`${baseUrl}/social/posts/${createdPostJson.data.id}`, {
      method: 'DELETE',
      headers: { Cookie: sunTch.cookie },
    });
    assert.equal(delPost.status, 200);

    // 15. Expenses, Inventory, Visitors & Certificates
    const expCreate = await fetch(`${baseUrl}/operations/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({
        title: 'Physics Lab Oscilloscope Calibration',
        category: 'Laboratory',
        amount: 6500,
        expenseDate: '2026-11-17',
        paidTo: 'Kathmandu Scientific Co.',
      }),
    });
    assert.equal(expCreate.status, 201);

    const expForbidden = await fetch(`${baseUrl}/operations/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: newStuLogin.cookie },
      body: JSON.stringify({
        title: 'Unauthorized',
        category: 'Other',
        amount: 100,
        expenseDate: '2026-11-17',
        paidTo: 'Self',
      }),
    });
    assert.equal(expForbidden.status, 403);

    const invCreate = await fetch(`${baseUrl}/operations/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({
        itemName: 'Digital Oscilloscope',
        category: 'Physics Lab',
        quantity: 4,
        conditionStatus: 'GOOD',
        location: 'Lab 2',
      }),
    });
    assert.equal(invCreate.status, 201);
    const invJson = (await invCreate.json()) as { data: { id: string } };

    const invPatch = await fetch(`${baseUrl}/operations/inventory/${invJson.data.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({ conditionStatus: 'MAINTENANCE' }),
    });
    assert.equal(invPatch.status, 200);

    const visCreate = await fetch(`${baseUrl}/operations/visitors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({
        visitorName: 'Ramesh Thapa',
        visitorPhone: '+9779841009988',
        purpose: 'Textbooks Delivery',
        visitingPerson: 'School Library',
      }),
    });
    assert.equal(visCreate.status, 201);
    const visJson = (await visCreate.json()) as { data: { id: string } };

    const visOut = await fetch(`${baseUrl}/operations/visitors/${visJson.data.id}/checkout`, {
      method: 'PATCH',
      headers: { Cookie: sunPri.cookie },
    });
    assert.equal(visOut.status, 200);

    const certCreate = await fetch(`${baseUrl}/operations/certificates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({
        studentId: 'stu-sun-1',
        certificateType: 'STEM_MERIT',
        remarks: 'First place in regional mathematics symposium.',
      }),
    });
    assert.equal(certCreate.status, 201);

    const parCerts = await fetch(`${baseUrl}/operations/certificates`, { headers: { Cookie: parLogin.cookie } });
    const parCertsJson = (await parCerts.json()) as { data: { certificates: Array<{ student_id: string }> } };
    assert.equal(parCerts.status, 200);
    assert.ok(parCertsJson.data.certificates.some((c) => c.student_id === 'stu-sun-1'));

    // 16. V2.1 Student 360 Profile + cross-tenant/RBAC denial + dashboard analytics
    const profRes = await fetch(`${baseUrl}/students/stu-sun-1/profile`, { headers: { Cookie: sunPri.cookie } });
    assert.equal(profRes.status, 200);
    const profJson = (await profRes.json()) as {
      data: { student: { student_code: string }; overallGpa: { averageGpa: number }; certificates: unknown[] };
    };
    assert.equal(profJson.data.student.student_code, 'STU-001');
    assert.ok(Array.isArray(profJson.data.certificates));

    // Everest Principal cannot view Sunrise student profile -> 404
    const crossProf = await fetch(`${baseUrl}/students/stu-sun-1/profile`, { headers: { Cookie: evPri.cookie } });
    assert.equal(crossProf.status, 404);

    // Kiran (newly created student) cannot view Aarav's 360 profile -> 403
    const stuForbiddenProf = await fetch(`${baseUrl}/students/stu-sun-1/profile`, { headers: { Cookie: newStuLogin.cookie } });
    assert.equal(stuForbiddenProf.status, 403);

    const dashRes = await fetch(`${baseUrl}/dashboard`, { headers: { Cookie: sunPri.cookie } });
    const dashJson = (await dashRes.json()) as {
      data: { stats: { attendanceRate: number; feeCollectionRate: number; totalExpenses: number } };
    };
    assert.equal(dashRes.status, 200);
    assert.equal(typeof dashJson.data.stats.attendanceRate, 'number');
    assert.equal(typeof dashJson.data.stats.feeCollectionRate, 'number');

    // 17. V2.1 QR Attendance Check-In (valid + cross-school rejection + student RBAC denial)
    const qrOk = await fetch(`${baseUrl}/academics/attendance/qr-checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunTch.cookie },
      body: JSON.stringify({ qrPayload: 'SHIKSHYAPLUS|SUNRISE-2026|STU-001|Aarav Sharma', sessionDate: '2026-11-18' }),
    });
    assert.equal(qrOk.status, 200);

    const qrCrossSchool = await fetch(`${baseUrl}/academics/attendance/qr-checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunTch.cookie },
      body: JSON.stringify({ qrPayload: 'SHIKSHYAPLUS|EVEREST-2026|STU-001' }),
    });
    assert.equal(qrCrossSchool.status, 403);

    const qrStuForbidden = await fetch(`${baseUrl}/academics/attendance/qr-checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: newStuLogin.cookie },
      body: JSON.stringify({ qrPayload: 'STU-001' }),
    });
    assert.equal(qrStuForbidden.status, 403);

    // 18. V2.1 Post Pinning & Messaging Attachment + Read Receipts
    const pinTargetRes = await fetch(`${baseUrl}/social/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({
        audience: 'MY_SCHOOL',
        postType: 'ANNOUNCEMENT',
        content: 'Winter term schedule notice for Sunrise Academy families.',
      }),
    });
    assert.equal(pinTargetRes.status, 201);
    const pinTargetId = ((await pinTargetRes.json()) as { data: { id: string } }).data.id;

    const pinRes = await fetch(`${baseUrl}/social/posts/${pinTargetId}/pin`, {
      method: 'PATCH',
      headers: { Cookie: sunPri.cookie },
    });
    assert.equal(pinRes.status, 200);
    const pinJson = (await pinRes.json()) as { data: { isPinned: boolean } };
    assert.equal(pinJson.data.isPinned, true);

    const teacherUid = ((sunTch.json.data as { user: { userId: string } }).user).userId;
    const convCreate = await fetch(`${baseUrl}/communications/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({ recipientUserId: teacherUid }),
    });
    assert.ok(convCreate.status === 200 || convCreate.status === 201);
    const convId = ((await convCreate.json()) as { data: { id: string } }).data.id;

    const msgSend = await fetch(`${baseUrl}/communications/conversations/${convId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({ body: 'Please review the attached timetable.', attachmentPath: '/api/v1/files/sample-timetable.pdf' }),
    });
    assert.equal(msgSend.status, 201);
    const sentMsg = ((await msgSend.json()) as { data: { message: { id: string; attachment_path: string } } }).data.message;
    assert.equal(sentMsg.attachment_path, '/api/v1/files/sample-timetable.pdf');

    // Teacher reads conversation -> read_at populated on sent message
    const teacherRead = await fetch(`${baseUrl}/communications/conversations/${convId}/messages`, {
      headers: { Cookie: sunTch.cookie },
    });
    assert.equal(teacherRead.status, 200);
    const teacherMsgs = ((await teacherRead.json()) as { data: { messages: Array<{ id: string; read_at: string | null }> } }).data.messages;
    const foundMsg = teacherMsgs.find((m) => m.id === sentMsg.id);
    assert.ok(foundMsg && foundMsg.read_at);
  } finally {
    server.close();
  }
});

test('API integration V4.0 & V4.1: Finance Hub, Bank Masking, Idempotent Checkout, Double-Entry Ledger, Safeguarding Isolation & Automation', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const sunPri = await login(baseUrl, {
      mode: 'SCHOOL_ID',
      schoolCode: 'SUNRISE-2026',
      userCode: 'PRI-001',
      password: 'School@2026!',
    });
    const sunTch = await login(baseUrl, {
      mode: 'SCHOOL_ID',
      schoolCode: 'SUNRISE-2026',
      userCode: 'TCH-001',
      password: 'School@2026!',
    });
    const evPri = await login(baseUrl, {
      mode: 'SCHOOL_ID',
      schoolCode: 'EVEREST-2026',
      userCode: 'PRI-001',
      password: 'School@2026!',
    });
    const parLogin = await login(baseUrl, {
      mode: 'GLOBAL',
      email: 'parent@sunrise.edu.np',
      password: 'Parent@2026!',
    });
    const stuLogin = await login(baseUrl, {
      mode: 'SCHOOL_ID',
      schoolCode: 'SUNRISE-2026',
      userCode: 'STU-001',
      password: 'School@2026!',
    });

    // V4.1 Test 1: Add School Bank Account -> stored masked & encrypted, raw account number NEVER returned
    const addBank = await fetch(`${baseUrl}/finance/bank-accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({
        bankName: 'Himalayan Bank Limited',
        branchName: 'Thamel Kathmandu',
        accountHolderName: 'Sunrise Reserve A/C',
        accountNumber: '019008877665544',
        swiftCode: 'HIMANPKA',
        purpose: 'GENERAL_SETTLEMENT',
      }),
    });
    assert.equal(addBank.status, 201);
    const addBankJson = (await addBank.json()) as { data: { id: string; accountNumberMasked: string } };
    assert.ok(addBankJson.data.accountNumberMasked.endsWith('5544'));
    assert.ok(!addBankJson.data.accountNumberMasked.includes('019008877'));

    const listBanks = await fetch(`${baseUrl}/finance/bank-accounts`, { headers: { Cookie: sunPri.cookie } });
    const listBanksText = await listBanks.text();
    assert.ok(!listBanksText.includes('019008877665544'));
    assert.ok(!listBanksText.includes('account_number_enc'));

    // Cross-tenant bank verification denied (Everest Principal cannot verify Sunrise bank account -> 404)
    const crossVerifyBank = await fetch(`${baseUrl}/finance/bank-accounts/${addBankJson.data.id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: evPri.cookie },
      body: JSON.stringify({ status: 'VERIFIED' }),
    });
    assert.equal(crossVerifyBank.status, 404);

    // Sunrise Principal verifies bank account
    const verifyBank = await fetch(`${baseUrl}/finance/bank-accounts/${addBankJson.data.id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({ status: 'VERIFIED' }),
    });
    assert.equal(verifyBank.status, 200);

    // V4.1 Test 2: Merchant secret keys are never returned over GET /payments/overview
    const payOverview = await fetch(`${baseUrl}/payments/overview`, { headers: { Cookie: sunPri.cookie } });
    const payOverviewText = await payOverview.text();
    assert.equal(payOverview.status, 200);
    assert.ok(!payOverviewText.includes('8gBm/:&EnhH.1/q'));
    assert.ok(!payOverviewText.includes('test_secret_key_sunrise_v4'));

    // V4.1 Test 3: Parent initiates eSewa payment on child invoice inv-sun-1, verifies, and duplicate callback is idempotent
    const initPay = await fetch(`${baseUrl}/payments/orders/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: parLogin.cookie },
      body: JSON.stringify({ invoiceId: 'inv-sun-1', provider: 'ESEWA' }),
    });
    assert.equal(initPay.status, 201);
    const initPayJson = (await initPay.json()) as {
      data: { orderUuid: string; initiation: { formFields?: { signature?: string } } };
    };

    const verify1 = await fetch(`${baseUrl}/payments/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: parLogin.cookie },
      body: JSON.stringify({
        orderUuid: initPayJson.data.orderUuid,
        providerTxnId: 'ESW-SANDBOX-9011',
        callbackSignature: initPayJson.data.initiation.formFields?.signature,
      }),
    });
    assert.equal(verify1.status, 200);

    // Replay same verify -> must be idempotently suppressed without error or duplicate entry!
    const verifyReplay = await fetch(`${baseUrl}/payments/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: parLogin.cookie },
      body: JSON.stringify({
        orderUuid: initPayJson.data.orderUuid,
        providerTxnId: 'ESW-SANDBOX-9011',
        callbackSignature: initPayJson.data.initiation.formFields?.signature,
      }),
    });
    assert.equal(verifyReplay.status, 200);
    const verifyReplayJson = (await verifyReplay.json()) as { idempotentReplay?: boolean };
    assert.equal(verifyReplayJson.idempotentReplay, true);

    // V4.1 Test 4: Direct Bank Transfer submission + Finance verification + Balanced Double-Entry Ledger + Refund validation
    const createInv = await fetch(`${baseUrl}/operations/fees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({
        studentId: 'stu-sun-1',
        title: 'Annual Robotics Lab Fee',
        feeType: 'TUITION',
        amount: 3000,
        discount: 0,
        dueDate: '2026-12-15',
      }),
    });
    assert.equal(createInv.status, 201);

    const parPayRes = await fetch(`${baseUrl}/payments/overview`, { headers: { Cookie: parLogin.cookie } });
    const parPayJson = (await parPayRes.json()) as { data: { invoices: Array<{ id: string; title: string; status: string }> } };
    const labInv = parPayJson.data.invoices.find((i) => i.title === 'Annual Robotics Lab Fee')!;
    assert.ok(labInv);

    const bankInit = await fetch(`${baseUrl}/payments/orders/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: parLogin.cookie },
      body: JSON.stringify({ invoiceId: labInv.id, provider: 'BANK_TRANSFER' }),
    });
    assert.equal(bankInit.status, 201);
    const bankOrderUuid = ((await bankInit.json()) as { data: { orderUuid: string } }).data.orderUuid;

    const proofSubmit = await fetch(`${baseUrl}/payments/orders/${bankOrderUuid}/submit-bank-proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: parLogin.cookie },
      body: JSON.stringify({ bankReference: 'NABIL-IPS-88221', payerNote: 'Paid via Nabil ConnectIPS' }),
    });
    assert.equal(proofSubmit.status, 200);

    // Student cannot approve bank proof -> 403 Forbidden
    const badReview = await fetch(`${baseUrl}/payments/orders/${bankOrderUuid}/review-bank-proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: stuLogin.cookie },
      body: JSON.stringify({ decision: 'VERIFIED' }),
    });
    assert.equal(badReview.status, 403);

    const goodReview = await fetch(`${baseUrl}/payments/orders/${bankOrderUuid}/review-bank-proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({ decision: 'VERIFIED' }),
    });
    assert.equal(goodReview.status, 200);
    const txnId = ((await goodReview.json()) as { data: { transactionId: string } }).data.transactionId;

    // Excess refund rejected -> 400
    const badRefund = await fetch(`${baseUrl}/finance/refunds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({ transactionId: txnId, amount: 9000, reason: 'Excess test' }),
    });
    assert.equal(badRefund.status, 400);

    // Valid partial refund succeeds & posts reversal journal
    const goodRefund = await fetch(`${baseUrl}/finance/refunds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({ transactionId: txnId, amount: 1000, reason: 'Scholarship fee waiver applied' }),
    });
    assert.equal(goodRefund.status, 201);

    // Verify all Double-Entry Journal Entries are strictly balanced (sum debit == sum credit)
    const ledgerRes = await fetch(`${baseUrl}/finance/accounting/ledger`, { headers: { Cookie: sunPri.cookie } });
    assert.equal(ledgerRes.status, 200);
    const ledgerJson = (await ledgerRes.json()) as {
      data: { journalEntries: Array<{ lines: Array<{ debit: number; credit: number }> }> };
    };
    for (const je of ledgerJson.data.journalEntries) {
      const dr = je.lines.reduce((s, l) => s + Number(l.debit), 0);
      const cr = je.lines.reduce((s, l) => s + Number(l.credit), 0);
      assert.ok(Math.abs(dr - cr) < 0.01);
    }

    // V4.0 Test 5: Confidential Safeguarding Cases Isolation (Teacher CANNOT view Principal/Parent safeguarding cases)
    const sgResParent = await fetch(`${baseUrl}/safeguarding/cases`, { headers: { Cookie: parLogin.cookie } });
    const sgJsonParent = (await sgResParent.json()) as { data: { isSafeguardingLead: boolean; cases: Array<{ id: string }> } };
    assert.equal(sgJsonParent.data.isSafeguardingLead, false);
    assert.ok(sgJsonParent.data.cases.some((c) => c.id === 'sg-1'));

    const sgResTeacher = await fetch(`${baseUrl}/safeguarding/cases`, { headers: { Cookie: sunTch.cookie } });
    const sgJsonTeacher = (await sgResTeacher.json()) as { data: { isSafeguardingLead: boolean; cases: Array<{ id: string }> } };
    assert.equal(sgJsonTeacher.data.isSafeguardingLead, false);
    // Teacher did not report sg-1, so sg-1 MUST NOT appear in teacher view!
    assert.ok(!sgJsonTeacher.data.cases.some((c) => c.id === 'sg-1'));

    // Principal DOES see restricted cases
    const sgResPri = await fetch(`${baseUrl}/safeguarding/cases`, { headers: { Cookie: sunPri.cookie } });
    const sgJsonPri = (await sgResPri.json()) as { data: { isSafeguardingLead: boolean; cases: Array<{ id: string }> } };
    assert.equal(sgJsonPri.data.isSafeguardingLead, true);
    assert.ok(sgJsonPri.data.cases.some((c) => c.id === 'sg-1'));

    // V4.0 Test 6: Workflow loop guard blocks recursion depth > 3 & CBT Assessment Auto-Grading
    const wfLoopTest = await fetch(`${baseUrl}/workflows/wf-1/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sunPri.cookie },
      body: JSON.stringify({ depth: 4, eventId: 'loop-test-1' }),
    });
    assert.equal(wfLoopTest.status, 200);
    const wfLoopJson = (await wfLoopTest.json()) as { data: { runs: Array<{ status: string }> } };
    assert.equal(wfLoopJson.data.runs[0].status, 'BLOCKED');

    const cbtSubmit = await fetch(`${baseUrl}/assessments/asmt-1/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: stuLogin.cookie },
      body: JSON.stringify({ answers: { 'qst-1': '0', 'qst-2': 'Ohm', 'qst-3': 'True' } }),
    });
    assert.equal(cbtSubmit.status, 201);
    const cbtJson = (await cbtSubmit.json()) as { data: { objectiveScore: number; maxScore: number } };
    assert.equal(cbtJson.data.objectiveScore, 6);
    assert.equal(cbtJson.data.maxScore, 6);

    // OneRoster CSV & Open Badge cryptographic verification
    const orCsv = await fetch(`${baseUrl}/interoperability/oneroster/users`, { headers: { Cookie: sunPri.cookie } });
    assert.equal(orCsv.status, 200);
    assert.ok((await orCsv.text()).includes('sourcedId,status,dateLastModified'));

    const badgesList = await fetch(`${baseUrl}/interoperability/badges`, { headers: { Cookie: stuLogin.cookie } });
    const badgesJson = (await badgesList.json()) as { data: { badges: Array<{ verification_code: string }> } };
    const code = badgesJson.data.badges[0].verification_code;
    const verifyBadge = await fetch(`${baseUrl}/interoperability/badges/verify/${code}`);
    assert.equal(verifyBadge.status, 200);
    const verifyBadgeJson = (await verifyBadge.json()) as { data: { verified: boolean } };
    assert.equal(verifyBadgeJson.data.verified, true);
  } finally {
    server.close();
  }
});

