const Database = require('better-sqlite3');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const filesDir = path.join(__dirname, 'seed', 'benchmark-files');
const primaryDbPath = path.join(dataDir, 'benchmark.db');
const fallbackDbPath = path.join('/tmp', 'clinical-trial-arena.db');

function openDatabase() {
  try {
    return {
      db: new Database(primaryDbPath),
      dbPath: primaryDbPath,
      usingFallback: false
    };
  } catch (error) {
    console.warn(`[database] Primary database open failed, falling back to ${fallbackDbPath}: ${error.message}`);
    return {
      db: new Database(fallbackDbPath),
      dbPath: fallbackDbPath,
      usingFallback: true
    };
  }
}

const dbState = openDatabase();
let db = dbState.db;
let usingFallback = dbState.usingFallback;

try {
  db.pragma('journal_mode = WAL');
} catch (error) {
  console.warn(`[database] WAL mode unavailable, continuing with default journal mode: ${error.message}`);
}

try {
  db.pragma('foreign_keys = ON');
} catch (error) {
  console.warn(`[database] Could not enable foreign_keys pragma: ${error.message}`);
}

function hasTable(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function getColumnNames(tableName) {
  if (!hasTable(tableName)) return [];
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function ensureColumn(tableName, columnName, definition) {
  const columns = getColumnNames(tableName);
  if (!columns.includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function initializeSchema() {
  db.exec(`
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

  ensureColumn('users', 'full_name', "TEXT DEFAULT ''");
  ensureColumn('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'updated_at', 'DATETIME');

  db.exec(`
    UPDATE users
    SET
      full_name = COALESCE(NULLIF(full_name, ''), username),
      email = COALESCE(NULLIF(email, ''), username || '@example.local'),
      affiliation = COALESCE(NULLIF(affiliation, ''), 'Independent Researcher'),
      updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
  `);

  ensureColumn('submissions', 'benchmark_id', 'INTEGER');
  ensureColumn('submissions', 'model_name', 'TEXT');
  ensureColumn('submissions', 'benchmark_version', 'TEXT');
  ensureColumn('submissions', 'raw_payload', 'TEXT');
  ensureColumn('submissions', 'total_cost', 'REAL DEFAULT 0');
  ensureColumn('submissions', 'status', "TEXT DEFAULT 'pending_results'");
  ensureColumn('submissions', 'validation_summary', 'TEXT');

  db.exec(`
    UPDATE submissions
    SET
      model_name = COALESCE(model_name, submission_name, 'Legacy Submission'),
      benchmark_version = COALESCE(benchmark_version, 'Legacy Benchmark'),
      raw_payload = COALESCE(raw_payload, predictions, '{}'),
      status = COALESCE(status, CASE WHEN score IS NULL THEN 'pending_results' ELSE 'published' END),
      total_cost = COALESCE(total_cost, 0)
  `);
}

try {
  initializeSchema();
} catch (error) {
  if (usingFallback) {
    throw error;
  }

  console.warn(`[database] Primary database initialization failed, retrying with ${fallbackDbPath}: ${error.message}`);
  db.close();

  const fallbackDb = new Database(fallbackDbPath);
  try {
    fallbackDb.pragma('journal_mode = WAL');
  } catch {}
  try {
    fallbackDb.pragma('foreign_keys = ON');
  } catch {}
  db = fallbackDb;
  usingFallback = true;
  initializeSchema();
}

const benchmarkSeeds = [
  {
    slug: '25-02',
    display_name: '25/02 Benchmark',
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
    display_name: '25/09 Benchmark',
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
    submission_open_at: '2026-06-01T00:00:00Z',
    submission_close_at: '2026-06-30T23:59:59Z',
    result_publish_at: '2026-07-20T00:00:00Z',
    download_file_path: path.join(filesDir, '26-06-download.json'),
    manifest_file_path: path.join(filesDir, '26-06-manifest.json'),
    has_ground_truth: 0,
    description: 'Current benchmark window that accepts new submissions.'
  }
];

const insertBenchmark = db.prepare(`
  INSERT INTO benchmarks (
    slug, display_name, benchmark_cycle_label, state, submission_open_at, submission_close_at,
    result_publish_at, download_file_path, manifest_file_path, has_ground_truth, description
  ) VALUES (
    @slug, @display_name, @benchmark_cycle_label, @state, @submission_open_at, @submission_close_at,
    @result_publish_at, @download_file_path, @manifest_file_path, @has_ground_truth, @description
  )
`);

const updateBenchmarkSeed = db.prepare(`
  UPDATE benchmarks
  SET
    display_name = @display_name,
    benchmark_cycle_label = @benchmark_cycle_label,
    state = @state,
    submission_open_at = @submission_open_at,
    submission_close_at = @submission_close_at,
    result_publish_at = @result_publish_at,
    download_file_path = @download_file_path,
    manifest_file_path = @manifest_file_path,
    has_ground_truth = @has_ground_truth,
    description = @description
  WHERE slug = @slug
`);

for (const benchmark of benchmarkSeeds) {
  const existing = db.prepare('SELECT id FROM benchmarks WHERE slug = ?').get(benchmark.slug);
  if (!existing) {
    insertBenchmark.run(benchmark);
  } else {
    updateBenchmarkSeed.run(benchmark);
  }
}

const evaluationSeedRows = [
  {
    benchmark_slug: '25-02',
    display_username: 'MedCoPilot',
    model_name: 'MedCoPilot v1',
    average_f1_macro: 0.842,
    average_cross_entropy: 0.382,
    cost: 148.42,
    arm2arm_superiority_f1: 0.861,
    arm2arm_superiority_cross_entropy: 0.341,
    arm2arm_noninferiority_f1: 0.826,
    arm2arm_noninferiority_cross_entropy: 0.397,
    endpoint_prediction_f1: 0.839,
    endpoint_prediction_cross_entropy: 0.408
  },
  {
    benchmark_slug: '25-02',
    display_username: 'TrialLens',
    model_name: 'TrialLens XL',
    average_f1_macro: 0.817,
    average_cross_entropy: 0.421,
    cost: 97.15,
    arm2arm_superiority_f1: 0.834,
    arm2arm_superiority_cross_entropy: 0.394,
    arm2arm_noninferiority_f1: 0.805,
    arm2arm_noninferiority_cross_entropy: 0.432,
    endpoint_prediction_f1: 0.811,
    endpoint_prediction_cross_entropy: 0.437
  },
  {
    benchmark_slug: '25-09',
    display_username: 'ArenaLab',
    model_name: 'ArenaLab Hybrid',
    average_f1_macro: 0.854,
    average_cross_entropy: 0.365,
    cost: 183.50,
    arm2arm_superiority_f1: 0.879,
    arm2arm_superiority_cross_entropy: 0.332,
    arm2arm_noninferiority_f1: 0.836,
    arm2arm_noninferiority_cross_entropy: 0.388,
    endpoint_prediction_f1: 0.847,
    endpoint_prediction_cross_entropy: 0.375
  },
  {
    benchmark_slug: '25-09',
    display_username: 'ClinicReasoner',
    model_name: 'ClinicReasoner R2',
    average_f1_macro: 0.829,
    average_cross_entropy: 0.402,
    cost: 120.10,
    arm2arm_superiority_f1: 0.845,
    arm2arm_superiority_cross_entropy: 0.377,
    arm2arm_noninferiority_f1: 0.821,
    arm2arm_noninferiority_cross_entropy: 0.414,
    endpoint_prediction_f1: 0.822,
    endpoint_prediction_cross_entropy: 0.414
  }
];

const insertEval = db.prepare(`
  INSERT INTO submission_evaluations (
    submission_id, benchmark_id, display_username, model_name, average_f1_macro, average_cross_entropy,
    cost, arm2arm_superiority_f1, arm2arm_superiority_cross_entropy, arm2arm_noninferiority_f1,
    arm2arm_noninferiority_cross_entropy, endpoint_prediction_f1, endpoint_prediction_cross_entropy,
    status, is_public, published_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 1, CURRENT_TIMESTAMP)
`);

for (const row of evaluationSeedRows) {
  const benchmark = db.prepare('SELECT id FROM benchmarks WHERE slug = ?').get(row.benchmark_slug);
  const existing = db.prepare(
    'SELECT id FROM submission_evaluations WHERE benchmark_id = ? AND display_username = ? AND model_name = ?'
  ).get(benchmark.id, row.display_username, row.model_name);
  if (!existing) {
    insertEval.run(
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
    );
  }
}

module.exports = db;
