const db = require('../database');
const { getBenchmarkRecord, getCurrentOpenBenchmark, deriveState, getManifestForBenchmark } = require('./benchmarks');

function validationError(errorCode, message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.errorCode = errorCode;
  return error;
}

async function validateSubmissionPayload({ benchmark, payload }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw validationError('INVALID_SCHEMA', 'Submission payload must be a JSON object.');
  }

  if (!Array.isArray(payload.answers)) {
    throw validationError('INVALID_SCHEMA', 'answers must be a list.');
  }

  if (payload.total_cost !== undefined && (typeof payload.total_cost !== 'number' || Number.isNaN(payload.total_cost))) {
    throw validationError('INVALID_SCHEMA', 'total_cost must be numeric when provided.');
  }

  if (payload.total_cost !== undefined && payload.total_cost < 0) {
    throw validationError('INVALID_SEMANTIC', 'total_cost must be greater than or equal to 0.');
  }

  const manifest = await getManifestForBenchmark(benchmark.id);
  const validIds = new Set(manifest.map((item) => Number(item.problem_id)));
  const seen = new Set();

  for (let index = 0; index < payload.answers.length; index += 1) {
    const item = payload.answers[index];
    if (!item || typeof item !== 'object') {
      throw validationError('INVALID_SCHEMA', `answers[${index}] must be an object.`);
    }
    if (item.problem_id === undefined || item.problem_id === null || item.problem_id === '') {
      throw validationError('INVALID_SCHEMA', `answers[${index}].problem_id is missing.`);
    }
    if (item.answer == null) {
      throw validationError('INVALID_SCHEMA', `answers[${index}].answer is missing.`);
    }
    const normalizedProblemId = Number(item.problem_id);
    if (!Number.isInteger(normalizedProblemId) || normalizedProblemId < 0 || normalizedProblemId > 9999) {
      throw validationError('INVALID_SEMANTIC', `answers[${index}].problem_id must be an integer between 0 and 9999.`);
    }
    const normalizedAnswer = String(item.answer).trim().toUpperCase();
    if (!['A', 'B', 'C'].includes(normalizedAnswer)) {
      throw validationError('INVALID_SEMANTIC', `answers[${index}].answer must be A, B, or C.`);
    }
    if (seen.has(normalizedProblemId)) {
      throw validationError('INVALID_SEMANTIC', `Duplicate problem_id found: ${normalizedProblemId}.`);
    }
    if (!validIds.has(normalizedProblemId)) {
      throw validationError('INVALID_SEMANTIC', `${normalizedProblemId} does not belong to ${benchmark.display_name}.`);
    }
    seen.add(normalizedProblemId);
    item.problem_id = normalizedProblemId;
    item.answer = normalizedAnswer;
  }

  const missingIds = manifest.map((item) => Number(item.problem_id)).filter((problemId) => !seen.has(problemId));
  if (missingIds.length) {
    throw validationError('INVALID_SEMANTIC', `Missing required problem ids: ${missingIds.join(', ')}.`);
  }

  return {
    manifestCount: manifest.length,
    answerCount: payload.answers.length,
    missingIds,
    acceptedIds: [...seen]
  };
}

async function createSubmission({ user, payload }) {
  const benchmark = await getCurrentOpenBenchmark();
  if (!benchmark) {
    throw validationError('BENCHMARK_CLOSED', 'There is no open benchmark accepting submissions right now.', 409);
  }

  const benchmarkState = deriveState(benchmark);
  if (benchmarkState !== 'open_for_submission') {
    throw validationError('BENCHMARK_CLOSED', 'Only open benchmarks may accept new submissions.', 409);
  }

  const summary = await validateSubmissionPayload({ benchmark, payload });
  const normalizedTotalCost = typeof payload.total_cost === 'number' ? payload.total_cost : 0;
  const benchmarkVersion = payload.benchmark_version || benchmark.display_name;

  const result = await db.insert(`
    INSERT INTO submissions (
      user_id, benchmark_id, model_name, benchmark_version, raw_payload,
      total_cost, status, validation_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    user.id,
    benchmark.id,
    user.username,
    benchmarkVersion,
    JSON.stringify(payload),
    normalizedTotalCost,
    'pending_results',
    JSON.stringify(summary)
  ]);

  await db.insert(`
    INSERT INTO submission_evaluations (
      submission_id, benchmark_id, display_username, model_name, cost, status, is_public
    ) VALUES (?, ?, ?, ?, ?, 'pending_results', 0)
  `, [result.lastInsertRowid, benchmark.id, user.username, user.username, normalizedTotalCost]);

  return {
    id: result.lastInsertRowid,
    benchmark: {
      id: benchmark.id,
      slug: benchmark.slug,
      display_name: benchmark.display_name
    },
    status: 'pending_results',
    validation_summary: summary
  };
}

async function listUserSubmissions(userId) {
  const rows = await db.all(`
    SELECT s.id, s.model_name, s.benchmark_version, s.total_cost, s.status, s.submitted_at,
      b.display_name, b.slug, e.average_f1_macro, e.average_cross_entropy, e.is_public
    FROM submissions s
    JOIN benchmarks b ON b.id = s.benchmark_id
    LEFT JOIN submission_evaluations e ON e.submission_id = s.id
    WHERE s.user_id = ?
    ORDER BY s.submitted_at DESC
    LIMIT 50
  `, [userId]);

  return rows.map((row) => ({
    id: row.id,
    model_name: row.model_name,
    benchmark_name: row.display_name,
    benchmark_slug: row.slug,
    benchmark_version: row.benchmark_version,
    total_cost: row.total_cost,
    status: row.status,
    average_f1_macro: row.average_f1_macro,
    average_cross_entropy: row.average_cross_entropy,
    results_published: !!row.is_public,
    submitted_at: row.submitted_at
  }));
}

async function listAllSubmissions() {
  const rows = await db.all(`
    SELECT s.id, s.user_id, u.username, u.email, s.model_name, s.benchmark_version, s.total_cost,
      s.status, s.submitted_at, b.display_name, b.slug, e.average_f1_macro,
      e.average_cross_entropy, e.is_public
    FROM submissions s
    JOIN users u ON u.id = s.user_id
    JOIN benchmarks b ON b.id = s.benchmark_id
    LEFT JOIN submission_evaluations e ON e.submission_id = s.id
    WHERE NOT EXISTS (
      SELECT 1
      FROM submissions newer
      WHERE newer.user_id = s.user_id
        AND (
          newer.submitted_at > s.submitted_at
          OR (newer.submitted_at = s.submitted_at AND newer.id > s.id)
        )
    )
    ORDER BY s.submitted_at DESC
  `);

  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    username: row.username,
    email: row.email,
    model_name: row.model_name,
    benchmark_name: row.display_name,
    benchmark_slug: row.slug,
    benchmark_version: row.benchmark_version,
    total_cost: row.total_cost,
    status: row.status,
    average_f1_macro: row.average_f1_macro,
    average_cross_entropy: row.average_cross_entropy,
    results_published: !!row.is_public,
    submitted_at: row.submitted_at
  }));
}

async function getSubmissionDetail(submissionId, user) {
  const row = await db.get(`
    SELECT s.*, b.display_name, b.slug, e.average_f1_macro, e.average_cross_entropy,
      e.arm2arm_superiority_f1, e.arm2arm_superiority_cross_entropy,
      e.arm2arm_noninferiority_f1, e.arm2arm_noninferiority_cross_entropy,
      e.endpoint_prediction_f1, e.endpoint_prediction_cross_entropy, e.is_public
    FROM submissions s
    JOIN benchmarks b ON b.id = s.benchmark_id
    LEFT JOIN submission_evaluations e ON e.submission_id = s.id
    WHERE s.id = ?
  `, [submissionId]);

  if (!row) {
    throw validationError('SUBMISSION_NOT_FOUND', 'Submission not found.', 404);
  }

  if (row.user_id !== user.id && user.role !== 'admin') {
    throw validationError('FORBIDDEN', 'Access denied.', 403);
  }

  return {
    id: row.id,
    model_name: row.model_name,
    benchmark_name: row.display_name,
    benchmark_slug: row.slug,
    benchmark_version: row.benchmark_version,
    total_cost: row.total_cost,
    status: row.status,
    submitted_at: row.submitted_at,
    raw_payload: JSON.parse(row.raw_payload),
    validation_summary: row.validation_summary ? JSON.parse(row.validation_summary) : null,
    evaluation: {
      average_f1_macro: row.average_f1_macro,
      average_cross_entropy: row.average_cross_entropy,
      arm2arm_superiority_f1: row.arm2arm_superiority_f1,
      arm2arm_superiority_cross_entropy: row.arm2arm_superiority_cross_entropy,
      arm2arm_noninferiority_f1: row.arm2arm_noninferiority_f1,
      arm2arm_noninferiority_cross_entropy: row.arm2arm_noninferiority_cross_entropy,
      endpoint_prediction_f1: row.endpoint_prediction_f1,
      endpoint_prediction_cross_entropy: row.endpoint_prediction_cross_entropy,
      is_public: !!row.is_public
    }
  };
}

module.exports = {
  validationError,
  validateSubmissionPayload,
  createSubmission,
  listUserSubmissions,
  listAllSubmissions,
  getSubmissionDetail
};
