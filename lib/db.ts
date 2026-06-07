import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DEFAULT_DB = path.join(DATA_DIR, "career-nav.db");
const DB_PATH = process.env.DB_PATH ?? DEFAULT_DB;

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "reports"), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "resumes"), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "temp"), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("busy_timeout = 5000");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      uuid TEXT UNIQUE,
      user_identity TEXT,
      target_position TEXT NOT NULL,
      target_education TEXT,
      target_company TEXT,
      target_city_tier TEXT,
      has_resume INTEGER DEFAULT 0,
      resume_filename TEXT,
      resume_storage_path TEXT,
      report_storage_path TEXT,
      sections_status TEXT,
      ip TEXT,
      user_agent TEXT,
      duration_ms INTEGER,
      form_data_json TEXT,
      quiz_answers_json TEXT,
      scoring_json TEXT,
      interview_q1q2_json TEXT,
      interview_q3q4_json TEXT,
      report_json TEXT,
      dynamic_questions_json TEXT,
      interview_questions_json TEXT,
      status TEXT DEFAULT 'completed'
    )
  `);
  // 老库补列：SQLite 不支持 ADD COLUMN IF NOT EXISTS，所以查表先
  const existingCols = new Set(
    (_db.prepare("PRAGMA table_info(reports)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );
  if (!existingCols.has("dynamic_questions_json")) {
    _db.exec("ALTER TABLE reports ADD COLUMN dynamic_questions_json TEXT");
  }
  if (!existingCols.has("interview_questions_json")) {
    _db.exec("ALTER TABLE reports ADD COLUMN interview_questions_json TEXT");
  }
  if (!existingCols.has("interview_q3q4_json")) {
    _db.exec("ALTER TABLE reports ADD COLUMN interview_q3q4_json TEXT");
  }
  _db.exec(
    `CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC)`
  );
  _db.exec(
    `CREATE INDEX IF NOT EXISTS idx_reports_uuid ON reports(uuid)`
  );
  return _db;
}
