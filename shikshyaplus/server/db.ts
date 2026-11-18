import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './security';
import { createV4Schema, ensureV4Seeds } from './dbV4Migrations';

let dbInstance: DatabaseSync | null = null;

export function getDb(customPath?: string): DatabaseSync {
  if (dbInstance && !customPath) return dbInstance;

  const dbPath = customPath || path.resolve(process.cwd(), 'data', 'shikshyaplus.sqlite');
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  createSchema(db);
  seedDatabase(db);
  ensureSupplementarySeeds(db);

  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

export function createSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS global_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      full_name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      global_role TEXT,
      avatar_url TEXT,
      cover_url TEXT,
      bio TEXT DEFAULT '',
      address TEXT DEFAULT '',
      account_status TEXT NOT NULL DEFAULT 'ACTIVE',
      strike_count INTEGER NOT NULL DEFAULT 0,
      restriction_until TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      privacy_profile_visibility TEXT NOT NULL DEFAULT 'PUBLIC',
      privacy_message_policy TEXT NOT NULL DEFAULT 'SCHOOL_ONLY',
      preferred_language TEXT NOT NULL DEFAULT 'en',
      preferred_calendar TEXT NOT NULL DEFAULT 'AD',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      active_membership_id TEXT,
      device_label TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      token_code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schools (
      id TEXT PRIMARY KEY,
      school_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      school_type TEXT NOT NULL,
      category TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'Nepal',
      province TEXT NOT NULL,
      district TEXT NOT NULL,
      municipality TEXT NOT NULL,
      ward TEXT DEFAULT '1',
      address TEXT NOT NULL,
      telephone TEXT NOT NULL,
      official_email TEXT NOT NULL,
      website TEXT DEFAULT '',
      established_year INTEGER NOT NULL,
      registration_number TEXT UNIQUE NOT NULL,
      education_board TEXT NOT NULL,
      principal_name TEXT NOT NULL,
      principal_email TEXT NOT NULL,
      principal_phone TEXT NOT NULL,
      logo_url TEXT,
      cover_url TEXT,
      about TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      rejection_reason TEXT,
      currency TEXT NOT NULL DEFAULT 'NPR',
      timezone TEXT NOT NULL DEFAULT 'Asia/Kathmandu',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS school_memberships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      user_code TEXT NOT NULL,
      department TEXT,
      designation TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      UNIQUE(school_id, user_code),
      UNIQUE(user_id, school_id, role)
    );

    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      section TEXT NOT NULL,
      room TEXT NOT NULL,
      class_teacher_user_id TEXT REFERENCES global_users(id),
      academic_session TEXT NOT NULL DEFAULT '2026',
      UNIQUE(school_id, name, section, academic_session)
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      class_id TEXT REFERENCES classes(id) ON DELETE CASCADE,
      teacher_user_id TEXT REFERENCES global_users(id)
    );

    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES global_users(id) ON DELETE SET NULL,
      student_code TEXT NOT NULL,
      admission_number TEXT NOT NULL,
      full_name TEXT NOT NULL,
      class_id TEXT NOT NULL REFERENCES classes(id),
      roll_number INTEGER NOT NULL,
      joining_year INTEGER NOT NULL DEFAULT 2026,
      date_of_birth TEXT DEFAULT '2011-05-15',
      guardian_name TEXT NOT NULL,
      guardian_phone TEXT NOT NULL,
      guardian_email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      enrollment_status TEXT NOT NULL DEFAULT 'VERIFIED',
      provisional INTEGER NOT NULL DEFAULT 0,
      created_by_user_id TEXT REFERENCES global_users(id),
      created_at TEXT NOT NULL,
      UNIQUE(school_id, student_code),
      UNIQUE(school_id, admission_number),
      UNIQUE(school_id, class_id, roll_number)
    );

    CREATE TABLE IF NOT EXISTS student_guardians (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      parent_user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL DEFAULT 'Parent',
      guardian_type TEXT NOT NULL DEFAULT 'PRIMARY',
      verified_at TEXT NOT NULL,
      UNIQUE(student_id, parent_user_id)
    );

    CREATE TABLE IF NOT EXISTS parent_invitations (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      invitation_code TEXT UNIQUE NOT NULL,
      created_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      used_by_user_id TEXT REFERENCES global_users(id),
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS homework (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      subject_id TEXT REFERENCES subjects(id),
      subject_name TEXT NOT NULL,
      teacher_user_id TEXT NOT NULL REFERENCES global_users(id),
      title TEXT NOT NULL,
      instructions TEXT NOT NULL,
      due_date TEXT NOT NULL,
      attachment_path TEXT,
      status TEXT NOT NULL DEFAULT 'PUBLISHED',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS homework_submissions (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      homework_id TEXT NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      submission_text TEXT NOT NULL,
      attachment_path TEXT,
      status TEXT NOT NULL DEFAULT 'SUBMITTED',
      marks INTEGER,
      feedback TEXT,
      submitted_at TEXT NOT NULL,
      reviewed_at TEXT,
      UNIQUE(homework_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      session_date TEXT NOT NULL,
      marked_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      created_at TEXT NOT NULL,
      UNIQUE(school_id, class_id, session_date)
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      remarks TEXT DEFAULT '',
      UNIQUE(session_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS examinations (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      academic_session TEXT NOT NULL DEFAULT '2026',
      class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      exam_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      created_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      approved_by_user_id TEXT REFERENCES global_users(id),
      published_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS student_marks (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      exam_id TEXT NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      subject_name TEXT NOT NULL,
      theory_marks REAL NOT NULL DEFAULT 0,
      practical_marks REAL NOT NULL DEFAULT 0,
      full_marks REAL NOT NULL DEFAULT 100,
      pass_marks REAL NOT NULL DEFAULT 40,
      grade TEXT NOT NULL,
      gpa REAL NOT NULL,
      remarks TEXT DEFAULT '',
      UNIQUE(exam_id, student_id, subject_name)
    );

    CREATE TABLE IF NOT EXISTS daily_diary_entries (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      entry_date TEXT NOT NULL,
      subject_name TEXT NOT NULL,
      topic TEXT NOT NULL,
      classwork TEXT NOT NULL,
      homework_summary TEXT NOT NULL,
      next_day_prep TEXT DEFAULT '',
      remarks TEXT DEFAULT '',
      teacher_user_id TEXT NOT NULL REFERENCES global_users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS timetables (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      day_of_week TEXT NOT NULL,
      period_number INTEGER NOT NULL,
      time_slot TEXT NOT NULL,
      subject_name TEXT NOT NULL,
      teacher_user_id TEXT NOT NULL REFERENCES global_users(id),
      room TEXT NOT NULL,
      UNIQUE(school_id, class_id, day_of_week, period_number)
    );

    CREATE TABLE IF NOT EXISTS school_notices (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      notice_type TEXT NOT NULL,
      audience TEXT NOT NULL DEFAULT 'ALL',
      priority TEXT NOT NULL DEFAULT 'NORMAL',
      author_user_id TEXT NOT NULL REFERENCES global_users(id),
      expires_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS school_events (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      event_date TEXT NOT NULL,
      location TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 1,
      author_user_id TEXT NOT NULL REFERENCES global_users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS social_posts (
      id TEXT PRIMARY KEY,
      school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
      author_user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      post_type TEXT NOT NULL DEFAULT 'UPDATE',
      audience TEXT NOT NULL DEFAULT 'MY_SCHOOL',
      media_url TEXT,
      moderation_status TEXT NOT NULL DEFAULT 'APPROVED',
      likes_count INTEGER NOT NULL DEFAULT 0,
      comments_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS post_reactions (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      reaction_type TEXT NOT NULL DEFAULT 'LIKE',
      created_at TEXT NOT NULL,
      UNIQUE(post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS post_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS post_saves (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE(post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS school_follows (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE(school_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS social_connections (
      id TEXT PRIMARY KEY,
      requester_user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      recipient_user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL,
      UNIQUE(requester_user_id, recipient_user_id)
    );

    CREATE TABLE IF NOT EXISTS global_groups (
      id TEXT PRIMARY KEY,
      school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 1,
      moderator_user_id TEXT NOT NULL REFERENCES global_users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES global_groups(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL,
      UNIQUE(group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      title TEXT,
      is_group INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      UNIQUE(conversation_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      attachment_path TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_requests (
      id TEXT PRIMARY KEY,
      school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      learning_mode TEXT NOT NULL,
      prompt_summary TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moderation_cases (
      id TEXT PRIMARY KEY,
      school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
      target_user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      reporter_user_id TEXT REFERENCES global_users(id),
      content_type TEXT NOT NULL,
      content_id TEXT,
      content_excerpt TEXT NOT NULL,
      reason TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'STANDARD',
      status TEXT NOT NULL DEFAULT 'OPEN',
      decision_note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moderation_strikes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      case_id TEXT NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
      strike_number INTEGER NOT NULL,
      action_taken TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS moderation_appeals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      case_id TEXT NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
      explanation TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      reviewer_note TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS fee_invoices (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      fee_type TEXT NOT NULL,
      amount REAL NOT NULL,
      discount REAL NOT NULL DEFAULT 0,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'UNPAID',
      gateway TEXT,
      receipt_number TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_books (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category TEXT NOT NULL,
      isbn TEXT NOT NULL,
      total_copies INTEGER NOT NULL DEFAULT 1,
      available_copies INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS book_issues (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      issued_at TEXT NOT NULL,
      due_date TEXT NOT NULL,
      returned_at TEXT
    );

    CREATE TABLE IF NOT EXISTS transport_routes (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      route_name TEXT NOT NULL,
      vehicle_number TEXT NOT NULL,
      driver_name TEXT NOT NULL,
      driver_phone TEXT NOT NULL,
      stops TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admissions (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      applicant_name TEXT NOT NULL,
      applying_class TEXT NOT NULL,
      guardian_name TEXT NOT NULL,
      guardian_phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parent_requests (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      parent_user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      request_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      details TEXT NOT NULL,
      requested_date TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS school_contacts (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      department TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      official_email TEXT NOT NULL,
      official_phone TEXT NOT NULL,
      working_hours TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'SCHOOL_MEMBERS'
    );

    CREATE TABLE IF NOT EXISTS uploaded_files (
      id TEXT PRIMARY KEY,
      school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
      uploader_user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'SCHOOL_PRIVATE',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
      actor_user_id TEXT REFERENCES global_users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS school_expenses (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      expense_date TEXT NOT NULL,
      paid_to TEXT NOT NULL,
      recorded_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_assets (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      category TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      condition_status TEXT NOT NULL DEFAULT 'GOOD',
      location TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS visitor_logs (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      visitor_name TEXT NOT NULL,
      visitor_phone TEXT NOT NULL,
      purpose TEXT NOT NULL,
      visiting_person TEXT NOT NULL,
      check_in_at TEXT NOT NULL,
      check_out_at TEXT,
      recorded_by_user_id TEXT NOT NULL REFERENCES global_users(id)
    );

    CREATE TABLE IF NOT EXISTS student_certificates (
      id TEXT PRIMARY KEY,
      school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      certificate_type TEXT NOT NULL,
      certificate_number TEXT NOT NULL,
      remarks TEXT DEFAULT '',
      issued_by_user_id TEXT NOT NULL REFERENCES global_users(id),
      issued_at TEXT NOT NULL,
      UNIQUE(school_id, certificate_number)
    );

    CREATE TABLE IF NOT EXISTS user_blocks (
      id TEXT PRIMARY KEY,
      blocker_user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      blocked_user_id TEXT NOT NULL REFERENCES global_users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE(blocker_user_id, blocked_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_memberships_user ON school_memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
    CREATE INDEX IF NOT EXISTS idx_homework_school ON homework(school_id);
    CREATE INDEX IF NOT EXISTS idx_notices_school ON school_notices(school_id);
    CREATE INDEX IF NOT EXISTS idx_posts_audience ON social_posts(audience, school_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_audit_school ON audit_logs(school_id, created_at);
  `);

  try {
    db.exec(`ALTER TABLE social_posts ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;`);
  } catch {
    // Column already exists
  }
  createV4Schema(db);
}

export function seedDatabase(db: DatabaseSync) {
  const existing = db.prepare('SELECT COUNT(*) as c FROM schools').get() as { c: number };
  if (existing.c > 0) return;

  const now = new Date().toISOString();
  const adminPw = hashPassword('Admin@2026!');
  const schoolPw = hashPassword('School@2026!');
  const parentPw = hashPassword('Parent@2026!');

  // Schools
  const schoolA = 'sch-sunrise-2026';
  const schoolB = 'sch-everest-2026';
  const schoolC = 'sch-lumbini-2026';

  db.prepare(
    `INSERT INTO schools (id, school_code, name, school_type, category, country, province, district, municipality, ward, address, telephone, official_email, website, established_year, registration_number, education_board, principal_name, principal_email, principal_phone, logo_url, cover_url, about, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    schoolA,
    'SUNRISE-2026',
    'Sunrise English School',
    'Private Secondary',
    'K-12 STEM & Humanities',
    'Nepal',
    'Bagmati Province',
    'Kathmandu',
    'Kathmandu Metropolitan',
    '10',
    'Baneshwor Heights, Kathmandu',
    '+977-1-4482100',
    'info@sunrise.edu.np',
    'https://sunrise.edu.np',
    2004,
    'REG-KTM-2004-881',
    'NEB Nepal',
    'Dr. Ramesh Adhikari',
    'principal@sunrise.edu.np',
    '+9779841001001',
    '/src/assets/images/school_logo_sunrise_1794923107163.jpg',
    '/src/assets/images/school_hero_campus_1794923107830.jpg',
    'Leading STEM and holistic education institution in Kathmandu since 2004, empowering curious learners with digital literacy and global collaboration.',
    'APPROVED',
    now,
    now
  );

  db.prepare(
    `INSERT INTO schools (id, school_code, name, school_type, category, country, province, district, municipality, ward, address, telephone, official_email, website, established_year, registration_number, education_board, principal_name, principal_email, principal_phone, logo_url, cover_url, about, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    schoolB,
    'EVEREST-2026',
    'Everest Secondary School',
    'Community Model School',
    'Secondary Science',
    'Nepal',
    'Gandaki Province',
    'Kaski',
    'Pokhara Metropolitan',
    '6',
    'Lakeside Road, Pokhara',
    '+977-61-462900',
    'contact@everest.edu.np',
    'https://everest.edu.np',
    1998,
    'REG-KSK-1998-412',
    'NEB Nepal',
    'Saraswati Gurung',
    'principal@everest.edu.np',
    '+9779856002002',
    '/src/assets/images/school_logo_everest_1794923107360.jpg',
    '/src/assets/images/school_hero_campus_1794923107830.jpg',
    'Pokhara based mountain-view secondary institution focused on environmental science, robotics, and inclusive community education.',
    'APPROVED',
    now,
    now
  );

  db.prepare(
    `INSERT INTO schools (id, school_code, name, school_type, category, country, province, district, municipality, ward, address, telephone, official_email, website, established_year, registration_number, education_board, principal_name, principal_email, principal_phone, logo_url, cover_url, about, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    schoolC,
    'LUMBINI-2026',
    'Lumbini Model Academy',
    'Private Secondary',
    'General Education',
    'Nepal',
    'Lumbini Province',
    'Rupandehi',
    'Butwal Sub-Metropolitan',
    '4',
    'Traffic Chowk, Butwal',
    '+977-71-541122',
    'admin@lumbiniacademy.edu.np',
    '',
    2016,
    'REG-RPD-2016-905',
    'NEB Nepal',
    'Bikash Pandey',
    'principal@lumbiniacademy.edu.np',
    '+9779847003003',
    '/src/assets/images/school_logo_sunrise_1794923107163.jpg',
    '/src/assets/images/school_hero_campus_1794923107830.jpg',
    'Application submitted for platform verification.',
    'PENDING',
    now,
    now
  );

  // Global Users
  const users = [
    { id: 'usr-superadmin', email: 'superadmin@shikshyaplus.edu.np', phone: '+9779800000001', name: 'Nabin Koirala', username: 'nabin_superadmin', pw: adminPw, globalRole: 'PLATFORM_SUPER_ADMIN', bio: 'Platform Trust & School Verification Lead.' },
    { id: 'usr-sun-pri', email: 'principal@sunrise.edu.np', phone: '+9779841001001', name: 'Dr. Ramesh Adhikari', username: 'ramesh_sunrise', pw: schoolPw, globalRole: null, bio: 'Principal at Sunrise English School · 20 years in STEM pedagogy.' },
    { id: 'usr-sun-tch', email: 'teacher@sunrise.edu.np', phone: '+9779841001002', name: 'Anjali Shrestha', username: 'anjali_math', pw: schoolPw, globalRole: null, bio: 'Senior Mathematics & Robotics Educator · Class 10-A Advisor.' },
    { id: 'usr-sun-tec', email: 'tech@sunrise.edu.np', phone: '+9779841001003', name: 'Prakash Basnet', username: 'prakash_tech', pw: schoolPw, globalRole: null, bio: 'Technical Data Officer & Student Information Systems Lead.' },
    { id: 'usr-sun-acc', email: 'accounts@sunrise.edu.np', phone: '+9779841001004', name: 'Sunita Maharjan', username: 'sunita_accounts', pw: schoolPw, globalRole: null, bio: 'Senior School Accountant & Scholarship Coordinator.' },
    { id: 'usr-sun-lib', email: 'library@sunrise.edu.np', phone: '+9779841001005', name: 'Dipendra Rai', username: 'dipendra_lib', pw: schoolPw, globalRole: null, bio: 'Head Librarian & Digital Archive Curator.' },
    { id: 'usr-sun-trn', email: 'transport@sunrise.edu.np', phone: '+9779841001006', name: 'Hari Bahadur Tamang', username: 'hari_transport', pw: schoolPw, globalRole: null, bio: 'Fleet & Student Safety Transport Coordinator.' },
    { id: 'usr-sun-stu1', email: 'aarav.sharma@sunrise.edu.np', phone: '+9779841001010', name: 'Aarav Sharma', username: 'aarav_10a', pw: schoolPw, globalRole: null, bio: 'Grade 10 Science & Robotics Club member.' },
    { id: 'usr-sun-stu2', email: 'sita.gurung@sunrise.edu.np', phone: '+9779841001011', name: 'Sita Gurung', username: 'sita_10a', pw: schoolPw, globalRole: null, bio: 'Grade 10 Debate & Environmental Science.' },
    { id: 'usr-sun-stu3', email: 'rohan.thapa@sunrise.edu.np', phone: '+9779841001012', name: 'Rohan Thapa', username: 'rohan_9b', pw: schoolPw, globalRole: null, bio: 'Grade 9 Programming Club.' },
    { id: 'usr-sun-par1', email: 'parent@sunrise.edu.np', phone: '+9779841555123', name: 'Kavita Sharma', username: 'kavita_parent', pw: parentPw, globalRole: null, bio: 'Parent representative at Sunrise English School.' },
    // School B users
    { id: 'usr-ev-pri', email: 'principal@everest.edu.np', phone: '+9779856002002', name: 'Saraswati Gurung', username: 'saraswati_everest', pw: schoolPw, globalRole: null, bio: 'Principal at Everest Secondary School, Pokhara.' },
    { id: 'usr-ev-tch', email: 'teacher@everest.edu.np', phone: '+9779856002003', name: 'Bimal Poudel', username: 'bimal_everest', pw: schoolPw, globalRole: null, bio: 'Physics & Astronomy Educator.' },
    { id: 'usr-ev-stu1', email: 'maya.pun@everest.edu.np', phone: '+9779856002010', name: 'Maya Pun', username: 'maya_everest', pw: schoolPw, globalRole: null, bio: 'Grade 10 Physics Olympiad participant.' },
  ];

  const insertUser = db.prepare(
    `INSERT INTO global_users (id, email, phone, full_name, username, password_hash, global_role, bio, account_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
  );
  for (const u of users) {
    insertUser.run(u.id, u.email, u.phone, u.name, u.username, u.pw, u.globalRole, u.bio, now, now);
  }

  // School Memberships
  const memberships = [
    ['mem-sun-pri', 'usr-sun-pri', schoolA, 'PRINCIPAL', 'PRI-001', 'Administration', 'Principal'],
    ['mem-sun-tch', 'usr-sun-tch', schoolA, 'CLASS_TEACHER', 'TCH-001', 'Mathematics & STEM', 'Senior Teacher'],
    ['mem-sun-tec', 'usr-sun-tec', schoolA, 'TECHNICAL_DEPT', 'TEC-001', 'Technical & SIS', 'Data Officer'],
    ['mem-sun-acc', 'usr-sun-acc', schoolA, 'STAFF_ACCOUNTANT', 'STF-001', 'Accounts', 'Senior Accountant'],
    ['mem-sun-lib', 'usr-sun-lib', schoolA, 'STAFF_LIBRARIAN', 'LIB-001', 'Library', 'Head Librarian'],
    ['mem-sun-trn', 'usr-sun-trn', schoolA, 'STAFF_TRANSPORT', 'TRN-001', 'Transport', 'Fleet Coordinator'],
    ['mem-sun-stu1', 'usr-sun-stu1', schoolA, 'STUDENT', 'STU-001', 'Class 10-A', 'Student'],
    ['mem-sun-stu2', 'usr-sun-stu2', schoolA, 'STUDENT', 'STU-002', 'Class 10-A', 'Student'],
    ['mem-sun-stu3', 'usr-sun-stu3', schoolA, 'STUDENT', 'STU-003', 'Class 9-B', 'Student'],
    ['mem-sun-par1', 'usr-sun-par1', schoolA, 'PARENT', 'PAR-001', 'Guardians', 'Parent'],
    // Everest School B
    ['mem-ev-pri', 'usr-ev-pri', schoolB, 'PRINCIPAL', 'PRI-001', 'Administration', 'Principal'],
    ['mem-ev-tch', 'usr-ev-tch', schoolB, 'TEACHER', 'TCH-001', 'Science', 'Physics Teacher'],
    ['mem-ev-stu1', 'usr-ev-stu1', schoolB, 'STUDENT', 'STU-001', 'Class 10-A', 'Student'],
  ];

  const insertMem = db.prepare(
    `INSERT INTO school_memberships (id, user_id, school_id, role, user_code, department, designation, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`
  );
  for (const m of memberships) {
    insertMem.run(m[0], m[1], m[2], m[3], m[4], m[5], m[6], now);
  }

  // Classes & Subjects
  db.prepare(`INSERT INTO classes (id, school_id, name, section, room, class_teacher_user_id) VALUES (?, ?, ?, ?, ?, ?)`).run(
    'cls-sun-10a', schoolA, 'Class 10', 'A', 'Room 204', 'usr-sun-tch'
  );
  db.prepare(`INSERT INTO classes (id, school_id, name, section, room, class_teacher_user_id) VALUES (?, ?, ?, ?, ?, ?)`).run(
    'cls-sun-9b', schoolA, 'Class 9', 'B', 'Room 108', 'usr-sun-tch'
  );
  db.prepare(`INSERT INTO classes (id, school_id, name, section, room, class_teacher_user_id) VALUES (?, ?, ?, ?, ?, ?)`).run(
    'cls-ev-10a', schoolB, 'Class 10', 'A', 'Lab Block 1', 'usr-ev-tch'
  );

  db.prepare(`INSERT INTO subjects (id, school_id, name, code, class_id, teacher_user_id) VALUES (?, ?, ?, ?, ?, ?)`).run(
    'sub-sun-math', schoolA, 'Compulsory Mathematics', 'MTH-101', 'cls-sun-10a', 'usr-sun-tch'
  );
  db.prepare(`INSERT INTO subjects (id, school_id, name, code, class_id, teacher_user_id) VALUES (?, ?, ?, ?, ?, ?)`).run(
    'sub-sun-sci', schoolA, 'Science & Technology', 'SCI-102', 'cls-sun-10a', 'usr-sun-tch'
  );
  db.prepare(`INSERT INTO subjects (id, school_id, name, code, class_id, teacher_user_id) VALUES (?, ?, ?, ?, ?, ?)`).run(
    'sub-ev-phy', schoolB, 'Physics', 'PHY-101', 'cls-ev-10a', 'usr-ev-tch'
  );

  // Students
  db.prepare(
    `INSERT INTO students (id, school_id, user_id, student_code, admission_number, full_name, class_id, roll_number, guardian_name, guardian_phone, guardian_email, address, enrollment_status, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED', ?, ?)`
  ).run('stu-sun-1', schoolA, 'usr-sun-stu1', 'STU-001', 'ADM-2026-001', 'Aarav Sharma', 'cls-sun-10a', 1, 'Kavita Sharma', '+9779841555123', 'parent@sunrise.edu.np', 'New Baneshwor, Kathmandu', 'usr-sun-tec', now);

  db.prepare(
    `INSERT INTO students (id, school_id, user_id, student_code, admission_number, full_name, class_id, roll_number, guardian_name, guardian_phone, guardian_email, address, enrollment_status, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED', ?, ?)`
  ).run('stu-sun-2', schoolA, 'usr-sun-stu2', 'STU-002', 'ADM-2026-002', 'Sita Gurung', 'cls-sun-10a', 2, 'Manoj Gurung', '+9779841666234', 'manoj.g@example.com', 'Koteshwor, Kathmandu', 'usr-sun-tec', now);

  db.prepare(
    `INSERT INTO students (id, school_id, user_id, student_code, admission_number, full_name, class_id, roll_number, guardian_name, guardian_phone, guardian_email, address, enrollment_status, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED', ?, ?)`
  ).run('stu-sun-3', schoolA, 'usr-sun-stu3', 'STU-003', 'ADM-2026-003', 'Rohan Thapa', 'cls-sun-9b', 4, 'Gita Thapa', '+9779841777345', '', 'Patan, Lalitpur', 'usr-sun-tch', now);

  db.prepare(
    `INSERT INTO students (id, school_id, user_id, student_code, admission_number, full_name, class_id, roll_number, guardian_name, guardian_phone, guardian_email, address, enrollment_status, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED', ?, ?)`
  ).run('stu-ev-1', schoolB, 'usr-ev-stu1', 'STU-001', 'EV-2026-001', 'Maya Pun', 'cls-ev-10a', 1, 'Dhan Bahadur Pun', '+9779856111222', '', 'Lakeside, Pokhara', 'usr-ev-pri', now);

  // Verified Guardian Link + Unused Invitation Code for testing
  db.prepare(
    `INSERT INTO student_guardians (id, school_id, student_id, parent_user_id, relationship, guardian_type, verified_at)
     VALUES (?, ?, ?, ?, 'Mother', 'PRIMARY', ?)`
  ).run('grd-1', schoolA, 'stu-sun-1', 'usr-sun-par1', now);

  const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString();
  db.prepare(
    `INSERT INTO parent_invitations (id, school_id, student_id, invitation_code, created_by_user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('pinv-1', schoolA, 'stu-sun-2', 'INV-SUN-102', 'usr-sun-tec', nextMonth, now);

  // Homework
  const inThreeDays = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO homework (id, school_id, class_id, subject_id, subject_name, teacher_user_id, title, instructions, due_date, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHED', ?)`
  ).run(
    'hw-sun-1',
    schoolA,
    'cls-sun-10a',
    'sub-sun-math',
    'Compulsory Mathematics',
    'usr-sun-tch',
    'Quadratic Equations & Discriminant Analysis',
    'Solve Exercise 5.2 Questions 1 through 6 showing full discriminant verification steps.',
    inThreeDays,
    now
  );
  db.prepare(
    `INSERT INTO homework (id, school_id, class_id, subject_id, subject_name, teacher_user_id, title, instructions, due_date, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHED', ?)`
  ).run(
    'hw-sun-2',
    schoolA,
    'cls-sun-10a',
    'sub-sun-sci',
    'Science & Technology',
    'usr-sun-tch',
    'Solar Energy & Ohm Law Lab Worksheet',
    'Document the voltage-current curve from today’s photovoltaic cell experiment and write two real-world applications in Nepal.',
    inThreeDays,
    now
  );
  db.prepare(
    `INSERT INTO homework (id, school_id, class_id, subject_id, subject_name, teacher_user_id, title, instructions, due_date, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHED', ?)`
  ).run(
    'hw-ev-1',
    schoolB,
    'cls-ev-10a',
    'sub-ev-phy',
    'Physics',
    'usr-ev-tch',
    'Everest Private Physics Problem Set',
    'Complete chapter 3 kinematics derivation (confidential to Everest Secondary School).',
    inThreeDays,
    now
  );

  // Attendance
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO attendance_sessions (id, school_id, class_id, session_date, marked_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    'att-sun-1', schoolA, 'cls-sun-10a', today, 'usr-sun-tch', now
  );
  db.prepare(`INSERT INTO attendance_records (id, school_id, session_id, student_id, status, remarks) VALUES (?, ?, ?, ?, 'PRESENT', '')`).run(
    'attr-1', schoolA, 'att-sun-1', 'stu-sun-1'
  );
  db.prepare(`INSERT INTO attendance_records (id, school_id, session_id, student_id, status, remarks) VALUES (?, ?, ?, ?, 'PRESENT', '')`).run(
    'attr-2', schoolA, 'att-sun-1', 'stu-sun-2'
  );

  // Examinations & Published Results
  db.prepare(
    `INSERT INTO examinations (id, school_id, name, academic_session, class_id, exam_date, status, created_by_user_id, approved_by_user_id, published_at, created_at)
     VALUES (?, ?, ?, '2026', ?, ?, 'PUBLISHED', ?, ?, ?, ?)`
  ).run('exm-sun-1', schoolA, 'First Terminal Examination 2083', 'cls-sun-10a', today, 'usr-sun-tch', 'usr-sun-pri', now, now);

  db.prepare(
    `INSERT INTO student_marks (id, school_id, exam_id, student_id, subject_name, theory_marks, practical_marks, full_marks, pass_marks, grade, gpa, remarks)
     VALUES (?, ?, ?, ?, ?, 68, 24, 100, 40, 'A+', 4.0, 'Excellent analytical reasoning')`
  ).run('mrk-1', schoolA, 'exm-sun-1', 'stu-sun-1', 'Compulsory Mathematics');

  db.prepare(
    `INSERT INTO student_marks (id, school_id, exam_id, student_id, subject_name, theory_marks, practical_marks, full_marks, pass_marks, grade, gpa, remarks)
     VALUES (?, ?, ?, ?, ?, 62, 23, 100, 40, 'A', 3.6, 'Strong practical lab work')`
  ).run('mrk-2', schoolA, 'exm-sun-1', 'stu-sun-1', 'Science & Technology');

  // Daily Diary
  db.prepare(
    `INSERT INTO daily_diary_entries (id, school_id, class_id, entry_date, subject_name, topic, classwork, homework_summary, next_day_prep, remarks, teacher_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'dry-1',
    schoolA,
    'cls-sun-10a',
    today,
    'Compulsory Mathematics',
    'Quadratic Roots & Real-World Modelling',
    'Derived quadratic formula and solved 4 word problems on projectile motion.',
    'Complete Exercise 5.2 Q1–Q6.',
    'Bring graph paper for parabola plotting tomorrow.',
    'Class showed great engagement.',
    'usr-sun-tch',
    now
  );

  // Timetable
  const slots = [
    ['Monday', 1, '09:30 - 10:15', 'Compulsory Mathematics', 'usr-sun-tch', 'Room 204'],
    ['Monday', 2, '10:15 - 11:00', 'Science & Technology', 'usr-sun-tch', 'Science Lab'],
    ['Tuesday', 1, '09:30 - 10:15', 'Science & Technology', 'usr-sun-tch', 'Room 204'],
    ['Wednesday', 1, '09:30 - 10:15', 'Compulsory Mathematics', 'usr-sun-tch', 'Room 204'],
  ] as const;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    db.prepare(
      `INSERT INTO timetables (id, school_id, class_id, day_of_week, period_number, time_slot, subject_name, teacher_user_id, room)
       VALUES (?, ?, 'cls-sun-10a', ?, ?, ?, ?, ?, ?)`
    ).run(`tt-sun-${i + 1}`, schoolA, s[0], s[1], s[2], s[3], s[4], s[5]);
  }

  // Notices & Events
  db.prepare(
    `INSERT INTO school_notices (id, school_id, title, body, notice_type, audience, priority, author_user_id, created_at)
     VALUES (?, ?, ?, ?, 'EVENT', 'ALL', 'HIGH', ?, ?)`
  ).run(
    'ntc-sun-1',
    schoolA,
    'Annual Himalayan STEM & Robotics Exhibition 2026',
    'All Class 9 and 10 parents are invited to the Main Auditorium this Friday at 10:30 AM to review student solar-robotics prototypes.',
    'usr-sun-pri',
    now
  );
  db.prepare(
    `INSERT INTO school_notices (id, school_id, title, body, notice_type, audience, priority, author_user_id, created_at)
     VALUES (?, ?, ?, ?, 'GENERAL', 'ALL', 'NORMAL', ?, ?)`
  ).run(
    'ntc-ev-1',
    schoolB,
    'Everest Internal Faculty Meeting',
    'Confidential internal faculty notice for Everest Secondary School only.',
    'usr-ev-pri',
    now
  );

  db.prepare(
    `INSERT INTO school_events (id, school_id, title, description, category, event_date, location, is_public, author_user_id, created_at)
     VALUES (?, ?, ?, ?, 'EXHIBITION', ?, ?, 1, ?, ?)`
  ).run(
    'evt-sun-1',
    schoolA,
    'National Inter-School Solar Robotics Showcase',
    'Collaborative science exhibition hosting teams from Kathmandu and Pokhara.',
    inThreeDays,
    'Sunrise Main Courtyard, Kathmandu',
    'usr-sun-pri',
    now
  );

  // Social Posts (Global + My School)
  db.prepare(
    `INSERT INTO social_posts (id, school_id, author_user_id, content, post_type, audience, media_url, moderation_status, likes_count, comments_count, created_at)
     VALUES (?, ?, ?, ?, 'PROJECT', 'PUBLIC', ?, 'APPROVED', 24, 1, ?)`
  ).run(
    'pst-global-1',
    schoolA,
    'usr-sun-tch',
    'Our Grade 10 Robotics & Physics team completed their solar-tracking rover prototype ahead of the Inter-School STEM Exhibition! Proud of their persistence and teamwork.',
    '/src/assets/images/science_fair_activity_1794923109202.jpg',
    now
  );
  db.prepare(
    `INSERT INTO social_posts (id, school_id, author_user_id, content, post_type, audience, media_url, moderation_status, likes_count, comments_count, created_at)
     VALUES (?, ?, ?, ?, 'ANNOUNCEMENT', 'GLOBAL_COMMUNITY', ?, 'APPROVED', 18, 0, ?)`
  ).run(
    'pst-global-2',
    schoolB,
    'usr-ev-pri',
    'Everest Secondary School Pokhara is welcoming partner schools for our annual Himalayan Climate & Astronomy Symposium next month.',
    '/src/assets/images/school_hero_campus_1794923107830.jpg',
    now
  );
  db.prepare(
    `INSERT INTO social_posts (id, school_id, author_user_id, content, post_type, audience, media_url, moderation_status, likes_count, comments_count, created_at)
     VALUES (?, ?, ?, ?, 'UPDATE', 'MY_SCHOOL', NULL, 'APPROVED', 11, 0, ?)`
  ).run(
    'pst-school-1',
    schoolA,
    'usr-sun-pri',
    'Reminder for Sunrise parents and teachers: First Terminal report cards are now published in the Results portal. Thank you for partnering in our students’ growth.',
    now
  );

  db.prepare(
    `INSERT INTO post_comments (id, post_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run('cmt-1', 'pst-global-1', 'usr-ev-pri', 'Inspiring work by Sunrise students! Looking forward to seeing the rover in Pokhara too.', now);

  // Educational Groups
  db.prepare(
    `INSERT INTO global_groups (id, school_id, name, category, description, is_public, moderator_user_id, created_at)
     VALUES (?, ?, ?, 'Science Club', ?, 1, ?, ?)`
  ).run(
    'grp-1',
    schoolA,
    'Nepal Secondary STEM & Robotics Network',
    'Moderated inter-school engineering and science project showcase supervised by verified faculty.',
    'usr-sun-tch',
    now
  );
  db.prepare(`INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES ('gm-1', 'grp-1', 'usr-sun-tch', ?)`).run(now);
  db.prepare(`INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES ('gm-2', 'grp-1', 'usr-sun-stu1', ?)`).run(now);

  // Conversations & Messages (Parent <-> Teacher in School A)
  db.prepare(`INSERT INTO conversations (id, school_id, title, is_group, created_at) VALUES ('conv-sun-1', ?, 'Parent-Teacher: Aarav Sharma', 0, ?)`).run(
    schoolA, now
  );
  db.prepare(`INSERT INTO conversation_members (id, conversation_id, user_id) VALUES ('cm-1', 'conv-sun-1', 'usr-sun-par1')`).run();
  db.prepare(`INSERT INTO conversation_members (id, conversation_id, user_id) VALUES ('cm-2', 'conv-sun-1', 'usr-sun-tch')`).run();
  db.prepare(
    `INSERT INTO messages (id, school_id, conversation_id, sender_user_id, body, created_at)
     VALUES ('msg-1', ?, 'conv-sun-1', 'usr-sun-tch', 'Namaste Kavita ji, Aarav performed exceptionally well in today’s quadratic equations lab.', ?)`
  ).run(schoolA, now);

  // Fee Invoices
  db.prepare(
    `INSERT INTO fee_invoices (id, school_id, student_id, title, fee_type, amount, discount, due_date, status, created_at)
     VALUES (?, ?, 'stu-sun-1', 'Kartik-Mangsir Monthly Tuition & Lab Fee', 'TUITION', 8500, 500, ?, 'UNPAID', ?)`
  ).run('inv-sun-1', schoolA, inThreeDays, now);
  db.prepare(
    `INSERT INTO fee_invoices (id, school_id, student_id, title, fee_type, amount, discount, due_date, status, gateway, receipt_number, paid_at, created_at)
     VALUES (?, ?, 'stu-sun-1', 'First Terminal Examination Fee', 'EXAMINATION', 1500, 0, ?, 'PAID', 'ESEWA', 'RCP-SUN-2026-019', ?, ?)`
  ).run('inv-sun-2', schoolA, today, now, now);

  // Library Books & Transport
  db.prepare(
    `INSERT INTO library_books (id, school_id, title, author, category, isbn, total_copies, available_copies)
     VALUES ('bk-1', ?, 'Conceptual Physics (13th Ed)', 'Paul G. Hewitt', 'Science', '978-0134092508', 6, 5)`
  ).run(schoolA);
  db.prepare(
    `INSERT INTO library_books (id, school_id, title, author, category, isbn, total_copies, available_copies)
     VALUES ('bk-2', ?, 'Muna Madan (Annotated Edition)', 'Laxmi Prasad Devkota', 'Nepali Literature', '978-9993310112', 12, 11)`
  ).run(schoolA);

  db.prepare(
    `INSERT INTO transport_routes (id, school_id, route_name, vehicle_number, driver_name, driver_phone, stops)
     VALUES ('trn-1', ?, 'Route A — Ring Road East', 'BA 2 KHA 4821', 'Hari Tamang', '+9779841001006', 'Chabahil -> Gaushala -> Tinkune -> New Baneshwor -> School')`
  ).run(schoolA);

  // School Contacts
  db.prepare(
    `INSERT INTO school_contacts (id, school_id, department, contact_name, official_email, official_phone, working_hours, visibility)
     VALUES ('cnt-1', ?, 'Principal Office', 'Dr. Ramesh Adhikari', 'principal@sunrise.edu.np', '+977-1-4482101', 'Sun–Fri 08:30–16:00', 'ALL')`
  ).run(schoolA);
  db.prepare(
    `INSERT INTO school_contacts (id, school_id, department, contact_name, official_email, official_phone, working_hours, visibility)
     VALUES ('cnt-2', ?, 'Technical Department', 'Prakash Basnet', 'tech@sunrise.edu.np', '+977-1-4482105', 'Sun–Fri 08:00–16:30', 'SCHOOL_MEMBERS')`
  ).run(schoolA);

  // Sample Moderation Case for review
  db.prepare(
    `INSERT INTO moderation_cases (id, school_id, target_user_id, reporter_user_id, content_type, content_excerpt, reason, severity, status, created_at)
     VALUES ('mod-1', ?, 'usr-sun-stu3', 'usr-sun-tch', 'COMMENT', 'Check out this unverified external giveaway link...', 'Automated link safety review flagged promotional URL', 'STANDARD', 'OPEN', ?)`
  ).run(schoolA, now);

  // Notifications
  db.prepare(
    `INSERT INTO notifications (id, school_id, user_id, category, title, body, created_at)
     VALUES ('not-1', ?, 'usr-sun-par1', 'RESULTS', 'First Terminal Report Card Published', 'Aarav Sharma’s First Terminal Examination results are now available.', ?)`
  ).run(schoolA, now);
  db.prepare(
    `INSERT INTO notifications (id, school_id, user_id, category, title, body, created_at)
     VALUES ('not-2', ?, 'usr-sun-stu1', 'HOMEWORK', 'New Homework Assigned', 'Quadratic Equations & Discriminant Analysis is due in 3 days.', ?)`
  ).run(schoolA, now);
}

export function ensureSupplementarySeeds(db: DatabaseSync) {
  const sunrise = db.prepare(`SELECT id FROM schools WHERE id = 'sch-sunrise-2026'`).get() as { id: string } | undefined;
  const student1 = db.prepare(`SELECT id FROM students WHERE id = 'stu-sun-1'`).get() as { id: string } | undefined;
  if (!sunrise || !student1) return;

  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  if ((db.prepare(`SELECT COUNT(*) as c FROM school_expenses`).get() as { c: number }).c === 0) {
    db.prepare(
      `INSERT INTO school_expenses (id, school_id, title, category, amount, expense_date, paid_to, recorded_by_user_id, created_at)
       VALUES ('exp-1', 'sch-sunrise-2026', 'Physics Lab Oscilloscope Calibration', 'Laboratory', 14500, ?, 'Himalayan Scientific Supplies', 'usr-sun-acc', ?)`
    ).run(today, now);
  }
  if ((db.prepare(`SELECT COUNT(*) as c FROM inventory_assets`).get() as { c: number }).c === 0) {
    db.prepare(
      `INSERT INTO inventory_assets (id, school_id, item_name, category, quantity, condition_status, location, updated_at)
       VALUES ('invt-1', 'sch-sunrise-2026', 'Arduino Solar Robotics Kits', 'STEM Lab', 18, 'GOOD', 'Physics & Robotics Lab', ?)`
    ).run(now);
  }
  if ((db.prepare(`SELECT COUNT(*) as c FROM visitor_logs`).get() as { c: number }).c === 0) {
    db.prepare(
      `INSERT INTO visitor_logs (id, school_id, visitor_name, visitor_phone, purpose, visiting_person, check_in_at, recorded_by_user_id)
       VALUES ('vis-1', 'sch-sunrise-2026', 'Manoj Gurung', '+9779841666234', 'Parent Consultation & Fee Verification', 'Dr. Ramesh Adhikari', ?, 'usr-sun-pri')`
    ).run(now);
  }
  if ((db.prepare(`SELECT COUNT(*) as c FROM student_certificates`).get() as { c: number }).c === 0) {
    db.prepare(
      `INSERT INTO student_certificates (id, school_id, student_id, certificate_type, certificate_number, remarks, issued_by_user_id, issued_at)
       VALUES ('cert-1', 'sch-sunrise-2026', 'stu-sun-1', 'STEM_MERIT', 'CERT-SUN-2026-001', 'First Place in Inter-School Solar Robotics Prototype Showcase 2083', 'usr-sun-pri', ?)`
    ).run(now);
  }
  ensureV4Seeds(db);
}
