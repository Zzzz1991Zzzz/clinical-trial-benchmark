const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

const dataDir = path.join(__dirname, 'data');
const filesDir = path.join(__dirname, 'seed', 'benchmark-files');
const primaryDbPath = path.join(dataDir, 'benchmark.db');
const fallbackDbPath = path.join('/tmp', 'clinical-trial-arena.db');
const databaseUrl = process.env.DATABASE_URL;
const runningOnCloudRun = !!process.env.K_SERVICE;
const driver = databaseUrl ? 'postgres' : 'sqlite';

if (runningOnCloudRun && !databaseUrl) {
  throw new Error('DATABASE_URL is required when running on Cloud Run. Configure Cloud SQL/PostgreSQL to persist user data.');
}

let sqliteDb = null;
let usingFallback = false;
let pool = null;
let initPromise = null;

function toPgParams(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function openSqliteDatabase() {
  try {
    sqliteDb = new Database(primaryDbPath);
    usingFallback = false;
  } catch (error) {
    console.warn(`[database] Primary database open failed, falling back to ${fallbackDbPath}: ${error.message}`);
    sqliteDb = new Database(fallbackDbPath);
    usingFallback = true;
  }

  try {
    sqliteDb.pragma('journal_mode = WAL');
  } catch (error) {
    console.warn(`[database] WAL mode unavailable, continuing with default journal mode: ${error.message}`);
  }

  try {
    sqliteDb.pragma('foreign_keys = ON');
  } catch (error) {
    console.warn(`[database] Could not enable foreign_keys pragma: ${error.message}`);
  }
}

function hasTable(name) {
  return !!sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function getColumnNames(tableName) {
  if (!hasTable(tableName)) return [];
  return sqliteDb.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function ensureSqliteColumn(tableName, columnName, definition) {
  const columns = getColumnNames(tableName);
  if (!columns.includes(columnName)) {
    sqliteDb.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function initializeSqliteSchema() {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      affiliation TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      email_verified INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'signup',
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      event_type TEXT NOT NULL,
      success INTEGER NOT NULL,
      ip_address TEXT,
      metadata TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS benchmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      benchmark_cycle_label TEXT NOT NULL,
      state TEXT NOT NULL,
      submission_open_at DATETIME,
      submission_close_at DATETIME,
      result_publish_at DATETIME,
      download_file_path TEXT,
      manifest_file_path TEXT NOT NULL,
      has_ground_truth INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      benchmark_id INTEGER NOT NULL,
      model_name TEXT NOT NULL,
      benchmark_version TEXT NOT NULL,
      raw_payload TEXT NOT NULL,
      total_cost REAL NOT NULL,
      status TEXT NOT NULL,
      validation_summary TEXT,
      submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (benchmark_id) REFERENCES benchmarks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS submission_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER,
      benchmark_id INTEGER NOT NULL,
      display_username TEXT NOT NULL,
      model_name TEXT NOT NULL,
      average_f1_macro REAL,
      average_cross_entropy REAL,
      cost REAL,
      arm2arm_superiority_f1 REAL,
      arm2arm_superiority_cross_entropy REAL,
      arm2arm_noninferiority_f1 REAL,
      arm2arm_noninferiority_cross_entropy REAL,
      endpoint_prediction_f1 REAL,
      endpoint_prediction_cross_entropy REAL,
      status TEXT NOT NULL DEFAULT 'pending_results',
      is_public INTEGER NOT NULL DEFAULT 0,
      published_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
      FOREIGN KEY (benchmark_id) REFERENCES benchmarks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      metadata TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  ensureSqliteColumn('users', 'full_name', "TEXT DEFAULT ''");
  ensureSqliteColumn('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
  ensureSqliteColumn('users', 'updated_at', 'DATETIME');
  ensureSqliteColumn('submissions', 'benchmark_id', 'INTEGER');
  ensureSqliteColumn('submissions', 'model_name', 'TEXT');
  ensureSqliteColumn('submissions', 'benchmark_version', 'TEXT');
  ensureSqliteColumn('submissions', 'raw_payload', 'TEXT');
  ensureSqliteColumn('submissions', 'total_cost', 'REAL DEFAULT 0');
  ensureSqliteColumn('submissions', 'status', "TEXT DEFAULT 'pending_results'");
  ensureSqliteColumn('submissions', 'validation_summary', 'TEXT');

  sqliteDb.exec(`
    UPDATE users
    SET
      username = lower(trim(username)),
      full_name = COALESCE(NULLIF(trim(full_name), ''), username),
      email = lower(trim(COALESCE(NULLIF(email, ''), username || '@example.local'))),
      affiliation = COALESCE(NULLIF(trim(affiliation), ''), 'Independent Researcher'),
      updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
  `);

  sqliteDb.exec(`
    UPDATE submissions
    SET
      model_name = COALESCE(model_name, submission_name, 'Legacy Submission'),
      benchmark_version = COALESCE(benchmark_version, 'Legacy Benchmark'),
      raw_payload = COALESCE(raw_payload, predictions, '{}'),
      status = COALESCE(status, CASE WHEN score IS NULL THEN 'pending_results' ELSE 'published' END),
      total_cost = COALESCE(total_cost, 0)
  `);

  sqliteDb.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_normalized ON users(lower(trim(username)));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized ON users(lower(trim(email)));
  `);
}

async function initializePostgresSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      affiliation TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      email_verified INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_verifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'signup',
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_events (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      success INTEGER NOT NULL,
      ip_address TEXT,
      metadata TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS benchmarks (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      benchmark_cycle_label TEXT NOT NULL,
      state TEXT NOT NULL,
      submission_open_at TIMESTAMPTZ,
      submission_close_at TIMESTAMPTZ,
      result_publish_at TIMESTAMPTZ,
      download_file_path TEXT,
      manifest_file_path TEXT NOT NULL,
      has_ground_truth INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      benchmark_id INTEGER NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
      model_name TEXT NOT NULL,
      benchmark_version TEXT NOT NULL,
      raw_payload TEXT NOT NULL,
      total_cost DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL,
      validation_summary TEXT,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS submission_evaluations (
      id SERIAL PRIMARY KEY,
      submission_id INTEGER REFERENCES submissions(id) ON DELETE CASCADE,
      benchmark_id INTEGER NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
      display_username TEXT NOT NULL,
      model_name TEXT NOT NULL,
      average_f1_macro DOUBLE PRECISION,
      average_cross_entropy DOUBLE PRECISION,
      cost DOUBLE PRECISION,
      arm2arm_superiority_f1 DOUBLE PRECISION,
      arm2arm_superiority_cross_entropy DOUBLE PRECISION,
      arm2arm_noninferiority_f1 DOUBLE PRECISION,
      arm2arm_noninferiority_cross_entropy DOUBLE PRECISION,
      endpoint_prediction_f1 DOUBLE PRECISION,
      endpoint_prediction_cross_entropy DOUBLE PRECISION,
      status TEXT NOT NULL DEFAULT 'pending_results',
      is_public INTEGER NOT NULL DEFAULT 0,
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      metadata TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_normalized ON users((lower(trim(username))));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized ON users((lower(trim(email))));
  `);
}

const benchmarkSeeds = [
  {
    slug: '25-02',
    display_name: 'Winter 2025',
    benchmark_cycle_label: '25/02',
    state: 'results_published',
    submission_open_at: '2025-02-01T00:00:00Z',
    submission_close_at: '2025-02-28T23:59:59Z',
    result_publish_at: '2025-03-20T00:00:00Z',
    download_file_path: path.join(filesDir, '25-02-download.json'),
    manifest_file_path: path.join(filesDir, '25-02-manifest.json'),
    has_ground_truth: 1,
    description: 'Historical benchmark with published leaderboard metrics.'
  },
  {
    slug: '25-09',
    display_name: 'Summer 2025',
    benchmark_cycle_label: '25/09',
    state: 'results_published',
    submission_open_at: '2025-09-01T00:00:00Z',
    submission_close_at: '2025-09-30T23:59:59Z',
    result_publish_at: '2025-10-20T00:00:00Z',
    download_file_path: path.join(filesDir, '25-09-download.json'),
    manifest_file_path: path.join(filesDir, '25-09-manifest.json'),
    has_ground_truth: 1,
    description: 'Historical benchmark with published leaderboard metrics.'
  },
  {
    slug: '26-06',
    display_name: '26/06 Benchmark',
    benchmark_cycle_label: '26/06',
    state: 'open_for_submission',
    submission_open_at: '2026-01-01T00:00:00Z',
    submission_close_at: '2026-05-31T23:59:59Z',
    result_publish_at: '2026-07-20T00:00:00Z',
    download_file_path: path.join(filesDir, '26-06-download.json'),
    manifest_file_path: path.join(filesDir, '26-06-manifest.json'),
    has_ground_truth: 0,
    description: 'Current benchmark window that accepts new submissions.'
  }
];

const evaluationSeedRows = [
  {
    benchmark_slug: '25-02',
    display_username: 'Traditional Baselines',
    model_name: 'Traditional Baselines'
  },
  {
    benchmark_slug: '25-02',
    display_username: 'Random Forest',
    model_name: 'Random Forest',
    endpoint_prediction_f1: 66.60,
    endpoint_prediction_cross_entropy: 71.54,
    arm2arm_superiority_f1: 55.39,
    arm2arm_superiority_cross_entropy: 63.76,
    arm2arm_noninferiority_f1: 80.70,
    arm2arm_noninferiority_cross_entropy: 79.12
  },
  {
    benchmark_slug: '25-02',
    display_username: 'Feed-Forward NN',
    model_name: 'Feed-Forward NN',
    endpoint_prediction_f1: 67.74,
    endpoint_prediction_cross_entropy: 72.29,
    arm2arm_superiority_f1: 54.23,
    arm2arm_superiority_cross_entropy: 57.91,
    arm2arm_noninferiority_f1: 58.87,
    arm2arm_noninferiority_cross_entropy: 74.60
  },
  {
    benchmark_slug: '25-02',
    display_username: 'KNN + Random Forest',
    model_name: 'KNN + Random Forest',
    endpoint_prediction_f1: 65.49,
    endpoint_prediction_cross_entropy: 70.78,
    arm2arm_superiority_f1: 54.87,
    arm2arm_superiority_cross_entropy: 63.55,
    arm2arm_noninferiority_f1: 75.45,
    arm2arm_noninferiority_cross_entropy: 72.87
  },
  {
    benchmark_slug: '25-02',
    display_username: 'L2 Logistic Regression',
    model_name: 'L2 Logistic Regression',
    endpoint_prediction_f1: 62.38,
    endpoint_prediction_cross_entropy: 70.56,
    arm2arm_superiority_f1: 54.46,
    arm2arm_superiority_cross_entropy: 58.58,
    arm2arm_noninferiority_f1: 65.01,
    arm2arm_noninferiority_cross_entropy: 67.55
  },
  {
    benchmark_slug: '25-02',
    display_username: 'HINT',
    model_name: 'HINT',
    endpoint_prediction_f1: 57.28,
    endpoint_prediction_cross_entropy: 64.72,
    arm2arm_superiority_f1: 51.87,
    arm2arm_superiority_cross_entropy: 62.33,
    arm2arm_noninferiority_f1: 46.08,
    arm2arm_noninferiority_cross_entropy: 50.00
  },
  {
    benchmark_slug: '25-02',
    display_username: 'Large Language Models',
    model_name: 'Large Language Models'
  },
  {
    benchmark_slug: '25-02',
    display_username: 'Gemini-3.1-Pro Preview',
    model_name: 'Gemini-3.1-Pro Preview',
    endpoint_prediction_f1: 78.42,
    endpoint_prediction_cross_entropy: 87.59,
    arm2arm_superiority_f1: 68.05,
    arm2arm_superiority_cross_entropy: 71.52,
    arm2arm_noninferiority_f1: 52.02,
    arm2arm_noninferiority_cross_entropy: 51.99
  },
  {
    benchmark_slug: '25-02',
    display_username: 'O3-mini',
    model_name: 'O3-mini',
    endpoint_prediction_f1: 69.30,
    endpoint_prediction_cross_entropy: 68.02,
    arm2arm_superiority_f1: 68.70,
    arm2arm_superiority_cross_entropy: 68.50,
    arm2arm_noninferiority_f1: 50.54,
    arm2arm_noninferiority_cross_entropy: 50.86
  },
  {
    benchmark_slug: '25-02',
    display_username: 'O3-mini + RAG',
    model_name: '+ RAG',
    endpoint_prediction_f1: 76.88,
    endpoint_prediction_cross_entropy: 73.48,
    arm2arm_superiority_f1: 69.21,
    arm2arm_superiority_cross_entropy: 69.18,
    arm2arm_noninferiority_f1: 56.81,
    arm2arm_noninferiority_cross_entropy: 57.14
  },
  {
    benchmark_slug: '25-02',
    display_username: 'O3-mini + Agent',
    model_name: '+ Agent',
    endpoint_prediction_f1: 64.83,
    endpoint_prediction_cross_entropy: 66.67,
    arm2arm_superiority_f1: 67.46,
    arm2arm_superiority_cross_entropy: 68.06,
    arm2arm_noninferiority_f1: 54.74,
    arm2arm_noninferiority_cross_entropy: 55.72
  },
  {
    benchmark_slug: '25-02',
    display_username: 'GPT-5',
    model_name: 'GPT-5',
    endpoint_prediction_f1: 65.29,
    endpoint_prediction_cross_entropy: 77.63,
    arm2arm_superiority_f1: 66.17,
    arm2arm_superiority_cross_entropy: 71.20,
    arm2arm_noninferiority_f1: 54.25,
    arm2arm_noninferiority_cross_entropy: 54.70
  },
  {
    benchmark_slug: '25-02',
    display_username: 'GPT-5 + RAG',
    model_name: '+ RAG',
    endpoint_prediction_f1: 67.98,
    endpoint_prediction_cross_entropy: 78.03,
    arm2arm_superiority_f1: 67.54,
    arm2arm_superiority_cross_entropy: 71.86,
    arm2arm_noninferiority_f1: 56.96,
    arm2arm_noninferiority_cross_entropy: 57.49
  },
  {
    benchmark_slug: '25-02',
    display_username: 'Claude Opus 4.5',
    model_name: 'Claude Opus 4.5',
    endpoint_prediction_f1: 70.17,
    endpoint_prediction_cross_entropy: 80.23,
    arm2arm_superiority_f1: 62.31,
    arm2arm_superiority_cross_entropy: 68.91,
    arm2arm_noninferiority_f1: 55.52,
    arm2arm_noninferiority_cross_entropy: 54.83
  },
  {
    benchmark_slug: '25-02',
    display_username: 'Claude Opus 4.5 + RAG',
    model_name: '+ RAG',
    endpoint_prediction_f1: 70.36,
    endpoint_prediction_cross_entropy: 81.85,
    arm2arm_superiority_f1: 63.43,
    arm2arm_superiority_cross_entropy: 69.62,
    arm2arm_noninferiority_f1: 56.00,
    arm2arm_noninferiority_cross_entropy: 55.19
  },
  {
    benchmark_slug: '25-09',
    display_username: 'Traditional Baselines',
    model_name: 'Traditional Baselines'
  },
  {
    benchmark_slug: '25-09',
    display_username: 'Random Forest',
    model_name: 'Random Forest',
    endpoint_prediction_f1: 65.57,
    endpoint_prediction_cross_entropy: 66.48,
    arm2arm_superiority_f1: 55.88,
    arm2arm_superiority_cross_entropy: 61.63,
    arm2arm_noninferiority_f1: 46.15,
    arm2arm_noninferiority_cross_entropy: 45.65
  },
  {
    benchmark_slug: '25-09',
    display_username: 'Feed-Forward NN',
    model_name: 'Feed-Forward NN',
    endpoint_prediction_f1: 65.25,
    endpoint_prediction_cross_entropy: 67.78,
    arm2arm_superiority_f1: 64.95,
    arm2arm_superiority_cross_entropy: 67.58,
    arm2arm_noninferiority_f1: 57.56,
    arm2arm_noninferiority_cross_entropy: 85.87
  },
  {
    benchmark_slug: '25-09',
    display_username: 'L2 Logistic Regression',
    model_name: 'L2 Logistic Regression',
    endpoint_prediction_f1: 60.62,
    endpoint_prediction_cross_entropy: 67.20,
    arm2arm_superiority_f1: 70.92,
    arm2arm_superiority_cross_entropy: 73.10,
    arm2arm_noninferiority_f1: 43.46,
    arm2arm_noninferiority_cross_entropy: 49.28
  },
  {
    benchmark_slug: '25-09',
    display_username: 'KNN + Random Forest',
    model_name: 'KNN + Random Forest',
    endpoint_prediction_f1: 62.13,
    endpoint_prediction_cross_entropy: 63.29,
    arm2arm_superiority_f1: 57.56,
    arm2arm_superiority_cross_entropy: 62.88,
    arm2arm_noninferiority_f1: 46.74,
    arm2arm_noninferiority_cross_entropy: 46.74
  },
  {
    benchmark_slug: '25-09',
    display_username: 'HINT',
    model_name: 'HINT',
    endpoint_prediction_f1: 64.08,
    endpoint_prediction_cross_entropy: 66.86,
    arm2arm_superiority_f1: 56.28,
    arm2arm_superiority_cross_entropy: 63.89,
    arm2arm_noninferiority_f1: 46.15,
    arm2arm_noninferiority_cross_entropy: 45.65
  },
  {
    benchmark_slug: '25-09',
    display_username: 'Large Language Models',
    model_name: 'Large Language Models'
  },
  {
    benchmark_slug: '25-09',
    display_username: 'Gemini-3.1-Pro Preview',
    model_name: 'Gemini-3.1-Pro Preview',
    endpoint_prediction_f1: 68.02,
    endpoint_prediction_cross_entropy: 71.24,
    arm2arm_superiority_f1: 78.00,
    arm2arm_superiority_cross_entropy: 80.56,
    arm2arm_noninferiority_f1: 76.71,
    arm2arm_noninferiority_cross_entropy: 71.86
  },
  {
    benchmark_slug: '25-09',
    display_username: 'O3-mini',
    model_name: 'O3-mini',
    endpoint_prediction_f1: 59.83,
    endpoint_prediction_cross_entropy: 59.46,
    arm2arm_superiority_f1: 72.48,
    arm2arm_superiority_cross_entropy: 71.93,
    arm2arm_noninferiority_f1: 54.94,
    arm2arm_noninferiority_cross_entropy: 59.78
  },
  {
    benchmark_slug: '25-09',
    display_username: 'O3-mini + RAG',
    model_name: '+ RAG',
    endpoint_prediction_f1: 59.07,
    endpoint_prediction_cross_entropy: 58.98,
    arm2arm_superiority_f1: 73.15,
    arm2arm_superiority_cross_entropy: 72.94,
    arm2arm_noninferiority_f1: 56.75,
    arm2arm_noninferiority_cross_entropy: 60.87
  },
  {
    benchmark_slug: '25-09',
    display_username: 'O3-mini + Agent',
    model_name: '+ Agent',
    endpoint_prediction_f1: 61.75,
    endpoint_prediction_cross_entropy: 62.84,
    arm2arm_superiority_f1: 73.33,
    arm2arm_superiority_cross_entropy: 73.96,
    arm2arm_noninferiority_f1: 69.81,
    arm2arm_noninferiority_cross_entropy: 92.75
  },
  {
    benchmark_slug: '25-09',
    display_username: 'GPT-5',
    model_name: 'GPT-5',
    endpoint_prediction_f1: 51.54,
    endpoint_prediction_cross_entropy: 58.24,
    arm2arm_superiority_f1: 70.23,
    arm2arm_superiority_cross_entropy: 73.71,
    arm2arm_noninferiority_f1: 64.81,
    arm2arm_noninferiority_cross_entropy: 64.49
  },
  {
    benchmark_slug: '25-09',
    display_username: 'GPT-5 + RAG',
    model_name: '+ RAG',
    endpoint_prediction_f1: 50.13,
    endpoint_prediction_cross_entropy: 55.55,
    arm2arm_superiority_f1: 70.18,
    arm2arm_superiority_cross_entropy: 73.78,
    arm2arm_noninferiority_f1: 68.95,
    arm2arm_noninferiority_cross_entropy: 70.05
  },
  {
    benchmark_slug: '25-09',
    display_username: 'Claude Opus 4.5',
    model_name: 'Claude Opus 4.5',
    endpoint_prediction_f1: 53.71,
    endpoint_prediction_cross_entropy: 57.86,
    arm2arm_superiority_f1: 68.76,
    arm2arm_superiority_cross_entropy: 73.68,
    arm2arm_noninferiority_f1: 48.24,
    arm2arm_noninferiority_cross_entropy: 49.64
  },
  {
    benchmark_slug: '25-09',
    display_username: 'Claude Opus 4.5 + RAG',
    model_name: '+ RAG',
    endpoint_prediction_f1: 58.69,
    endpoint_prediction_cross_entropy: 62.72,
    arm2arm_superiority_f1: 69.59,
    arm2arm_superiority_cross_entropy: 74.10,
    arm2arm_noninferiority_f1: 48.42,
    arm2arm_noninferiority_cross_entropy: 50.00
  }
];

async function seedBenchmarks() {
  for (const benchmark of benchmarkSeeds) {
    const existing = await rawGet('SELECT id FROM benchmarks WHERE slug = ?', [benchmark.slug]);
    if (!existing) {
      await rawInsert(`
        INSERT INTO benchmarks (
          slug, display_name, benchmark_cycle_label, state, submission_open_at, submission_close_at,
          result_publish_at, download_file_path, manifest_file_path, has_ground_truth, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        benchmark.slug,
        benchmark.display_name,
        benchmark.benchmark_cycle_label,
        benchmark.state,
        benchmark.submission_open_at,
        benchmark.submission_close_at,
        benchmark.result_publish_at,
        benchmark.download_file_path,
        benchmark.manifest_file_path,
        benchmark.has_ground_truth,
        benchmark.description
      ]);
    } else {
      await rawRun(`
        UPDATE benchmarks
        SET display_name = ?, benchmark_cycle_label = ?, state = ?, submission_open_at = ?, submission_close_at = ?,
            result_publish_at = ?, download_file_path = ?, manifest_file_path = ?, has_ground_truth = ?, description = ?
        WHERE slug = ?
      `, [
        benchmark.display_name,
        benchmark.benchmark_cycle_label,
        benchmark.state,
        benchmark.submission_open_at,
        benchmark.submission_close_at,
        benchmark.result_publish_at,
        benchmark.download_file_path,
        benchmark.manifest_file_path,
        benchmark.has_ground_truth,
        benchmark.description,
        benchmark.slug
      ]);
    }
  }
}

async function seedEvaluations() {
  const historicalSeedSlugs = ['25-02', '25-09'];
  for (const slug of historicalSeedSlugs) {
    const benchmark = await rawGet('SELECT id FROM benchmarks WHERE slug = ?', [slug]);
    if (!benchmark) continue;
    await rawRun('DELETE FROM submission_evaluations WHERE benchmark_id = ?', [benchmark.id]);
  }

  for (const row of evaluationSeedRows) {
    const benchmark = await rawGet('SELECT id FROM benchmarks WHERE slug = ?', [row.benchmark_slug]);
    if (!benchmark) continue;

    await rawInsert(`
      INSERT INTO submission_evaluations (
        submission_id, benchmark_id, display_username, model_name, average_f1_macro, average_cross_entropy,
        cost, arm2arm_superiority_f1, arm2arm_superiority_cross_entropy, arm2arm_noninferiority_f1,
        arm2arm_noninferiority_cross_entropy, endpoint_prediction_f1, endpoint_prediction_cross_entropy,
        status, is_public, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 1, CURRENT_TIMESTAMP)
    `, [
      null,
      benchmark.id,
      row.display_username,
      row.model_name,
      row.average_f1_macro,
      row.average_cross_entropy,
      row.cost,
      row.arm2arm_superiority_f1,
      row.arm2arm_superiority_cross_entropy,
      row.arm2arm_noninferiority_f1,
      row.arm2arm_noninferiority_cross_entropy,
      row.endpoint_prediction_f1,
      row.endpoint_prediction_cross_entropy
    ]);
  }
}

async function rawGet(sql, params = []) {
  if (driver === 'postgres') {
    const result = await pool.query(toPgParams(sql), params);
    return result.rows[0] || null;
  }
  return sqliteDb.prepare(sql).get(...params) || null;
}

async function rawAll(sql, params = []) {
  if (driver === 'postgres') {
    const result = await pool.query(toPgParams(sql), params);
    return result.rows;
  }
  return sqliteDb.prepare(sql).all(...params);
}

async function rawRun(sql, params = []) {
  if (driver === 'postgres') {
    const result = await pool.query(toPgParams(sql), params);
    return { changes: result.rowCount };
  }
  const result = sqliteDb.prepare(sql).run(...params);
  return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
}

async function rawInsert(sql, params = []) {
  if (driver === 'postgres') {
    const result = await pool.query(`${toPgParams(sql)} RETURNING id`, params);
    return { lastInsertRowid: result.rows[0]?.id ?? null, changes: result.rowCount };
  }
  const result = sqliteDb.prepare(sql).run(...params);
  return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
}

async function init() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (driver === 'postgres') {
      pool = new Pool({
        connectionString: databaseUrl,
        ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
      });
      await initializePostgresSchema();
    } else {
      openSqliteDatabase();
      try {
        initializeSqliteSchema();
      } catch (error) {
        if (usingFallback) throw error;
        console.warn(`[database] Primary database initialization failed, retrying with ${fallbackDbPath}: ${error.message}`);
        sqliteDb.close();
        sqliteDb = new Database(fallbackDbPath);
        usingFallback = true;
        initializeSqliteSchema();
      }
    }

    await seedBenchmarks();
    await seedEvaluations();
  })();

  return initPromise;
}

async function get(sql, params = []) {
  await init();
  return rawGet(sql, params);
}

async function all(sql, params = []) {
  await init();
  return rawAll(sql, params);
}

async function run(sql, params = []) {
  await init();
  return rawRun(sql, params);
}

async function insert(sql, params = []) {
  await init();
  return rawInsert(sql, params);
}

async function exec(sql) {
  await init();
  if (driver === 'postgres') {
    await pool.query(sql);
    return;
  }
  sqliteDb.exec(sql);
}

module.exports = {
  driver,
  init,
  get,
  all,
  run,
  insert,
  exec
};
