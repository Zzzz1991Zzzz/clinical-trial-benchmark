const express = require('express');
const db = require('../database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { listAllSubmissions } = require('../services/submissions');
const { getHomeContent, updateAnnouncement } = require('../services/content');

const router = express.Router();

router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  const users = (await db.get('SELECT COUNT(*) AS count FROM users')).count;
  const benchmarks = (await db.get('SELECT COUNT(*) AS count FROM benchmarks')).count;
  const submissions = (await db.get('SELECT COUNT(*) AS count FROM submissions')).count;
  const pendingEvaluations = (await db.get(
    "SELECT COUNT(*) AS count FROM submission_evaluations WHERE status = 'pending_results'"
  )).count;

  res.json({
    success: true,
    stats: { users, benchmarks, submissions, pending_evaluations: pendingEvaluations }
  });
});

router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  const users = await db.all(`
    SELECT id, username, email, full_name, affiliation, role, email_verified, created_at
    FROM users
    ORDER BY created_at DESC
  `);

  res.json({ success: true, users });
});

router.get('/submissions', authenticateToken, requireAdmin, async (req, res) => {
  const submissions = await listAllSubmissions();
  res.json({ success: true, submissions });
});

router.get('/content/announcement', authenticateToken, requireAdmin, async (req, res) => {
  const content = await getHomeContent();
  res.json({ success: true, announcement: content.announcement });
});

router.put('/content/announcement', authenticateToken, requireAdmin, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const announcement = await updateAnnouncement(items);
  res.json({ success: true, announcement });
});

module.exports = router;
