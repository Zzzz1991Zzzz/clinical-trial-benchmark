const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');
const { attachSession, clearSession, generateVerificationCode } = require('../lib/security');
const { rateLimit } = require('../lib/rateLimiter');
const { logAuthEvent, logAudit } = require('../services/audit');
const { sendVerificationCode } = require('../services/email');

const router = express.Router();

function getIpAddress(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    full_name: user.full_name,
    affiliation: user.affiliation,
    role: user.role,
    email_verified: !!user.email_verified,
    created_at: user.created_at
  };
}

function normalizeUsername(value = '') {
  return value.trim().toLowerCase();
}

function normalizeEmail(value = '') {
  return value.trim().toLowerCase();
}

async function getLatestVerification(userId) {
  return db.get(`
    SELECT id, created_at
    FROM email_verifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `, [userId]);
}

async function createVerification(user) {
  await db.run('UPDATE email_verifications SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL', [user.id]);

  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await db.run(`
    INSERT INTO email_verifications (user_id, code, purpose, expires_at)
    VALUES (?, ?, 'signup', ?)
  `, [user.id, code, expiresAt]);

  await sendVerificationCode({
    email: user.email,
    code,
    username: user.username
  });

  return code;
}

router.post(
  '/signup',
  rateLimit({
    key: 'signup',
    limit: 5,
    windowMs: 15 * 60 * 1000,
    message: 'Too many signup attempts. Please try again later.'
  }),
  async (req, res) => {
    const { username, password, email, full_name, affiliation } = req.body;
    const normalizedUsername = normalizeUsername(username);
    const normalizedEmail = normalizeEmail(email);
    const normalizedFullName = full_name?.trim();
    const normalizedAffiliation = affiliation?.trim();

    if (!normalizedUsername || !password || !normalizedEmail || !normalizedFullName || !normalizedAffiliation) {
      return res.status(400).json({
        success: false,
        error_code: 'INVALID_INPUT',
        message: 'username, password, email, full_name, and company or university name are required.'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error_code: 'WEAK_PASSWORD',
        message: 'Password must be at least 8 characters.'
      });
    }

    const existing = await db.get(`
      SELECT id
      FROM users
      WHERE lower(trim(username)) = ? OR lower(trim(email)) = ?
    `, [normalizedUsername, normalizedEmail]);
    if (existing) {
      return res.status(409).json({
        success: false,
        error_code: 'USER_EXISTS',
        message: 'Username or email already exists.'
      });
    }

    const hashedPassword = bcrypt.hashSync(password, 12);
    const result = await db.insert(`
      INSERT INTO users (username, password, email, full_name, affiliation, role, email_verified)
      VALUES (?, ?, ?, ?, ?, 'user', 0)
    `, [normalizedUsername, hashedPassword, normalizedEmail, normalizedFullName, normalizedAffiliation]);

    const user = await db.get(`
      SELECT id, username, email, full_name, affiliation, role, email_verified, created_at
      FROM users WHERE id = ?
    `, [result.lastInsertRowid]);

    try {
      await createVerification(user);
    } catch (error) {
      await db.run('DELETE FROM users WHERE id = ?', [user.id]);
      return res.status(502).json({
        success: false,
        error_code: 'EMAIL_DELIVERY_FAILED',
        message: 'Failed to send verification email. Please try again later.'
      });
    }
    attachSession(res, user);
    await logAuthEvent({ userId: user.id, eventType: 'signup', success: true, ipAddress: getIpAddress(req) });
    await logAudit({ userId: user.id, action: 'signup', entityType: 'user', entityId: String(user.id) });

    res.status(201).json({
      success: true,
      user: sanitizeUser(user),
      message: 'Account created. Please verify your email before submitting.'
    });
  }
);

router.post(
  '/signin',
  rateLimit({
    key: 'signin',
    limit: 10,
    windowMs: 15 * 60 * 1000,
    message: 'Too many sign-in attempts. Please try again later.'
  }),
  async (req, res) => {
    const { username, password } = req.body;
    const loginIdentifier = username?.trim().toLowerCase();

    if (!loginIdentifier || !password) {
      return res.status(400).json({
        success: false,
        error_code: 'INVALID_INPUT',
        message: 'username and password are required.'
      });
    }

    const user = await db.get(`
      SELECT id, username, email, password, full_name, affiliation, role, email_verified, created_at
      FROM users
      WHERE lower(trim(username)) = ? OR lower(trim(email)) = ?
    `, [loginIdentifier, loginIdentifier]);

    if (!user || !bcrypt.compareSync(password, user.password)) {
      await logAuthEvent({
        userId: user?.id || null,
        eventType: 'signin',
        success: false,
        ipAddress: getIpAddress(req),
        metadata: { username: loginIdentifier }
      });
      return res.status(401).json({
        success: false,
        error_code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials.'
      });
    }

    attachSession(res, user);
    await logAuthEvent({ userId: user.id, eventType: 'signin', success: true, ipAddress: getIpAddress(req) });
    await logAudit({ userId: user.id, action: 'signin', entityType: 'user', entityId: String(user.id) });

    res.json({
      success: true,
      user: sanitizeUser(user)
    });
  }
);

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ success: true, message: 'Signed out.' });
});

router.post('/verify-email', authenticateToken, async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({
      success: false,
      error_code: 'INVALID_INPUT',
      message: 'Verification code is required.'
    });
  }

  const verification = await db.get(`
    SELECT * FROM email_verifications
    WHERE user_id = ? AND code = ? AND used_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `, [req.user.id, code]);

  if (!verification) {
    await logAuthEvent({ userId: req.user.id, eventType: 'verify_email', success: false, ipAddress: getIpAddress(req) });
    return res.status(400).json({
      success: false,
      error_code: 'INVALID_CODE',
      message: 'Verification code is invalid.'
    });
  }

  if (Date.parse(verification.expires_at) < Date.now()) {
    return res.status(400).json({
      success: false,
      error_code: 'EXPIRED_CODE',
      message: 'Verification code has expired.'
    });
  }

  await db.run('UPDATE email_verifications SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [verification.id]);
  await db.run('UPDATE users SET email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.user.id]);

  const updatedUser = await db.get(`
    SELECT id, username, email, full_name, affiliation, role, email_verified, created_at
    FROM users WHERE id = ?
  `, [req.user.id]);

  attachSession(res, updatedUser);
  await logAuthEvent({ userId: req.user.id, eventType: 'verify_email', success: true, ipAddress: getIpAddress(req) });
  await logAudit({ userId: req.user.id, action: 'verify_email', entityType: 'user', entityId: String(req.user.id) });

  res.json({
    success: true,
    user: sanitizeUser(updatedUser),
    message: 'Email verified successfully.'
  });
});

router.post(
  '/resend-verification',
  authenticateToken,
  rateLimit({
    key: 'resend_verification',
    limit: 5,
    windowMs: 15 * 60 * 1000,
    message: 'Too many resend attempts. Please try again later.'
  }),
  async (req, res) => {
    if (req.user.email_verified) {
      return res.json({
        success: true,
        message: 'Email is already verified.'
      });
    }

    const latestVerification = await getLatestVerification(req.user.id);
    if (latestVerification && (Date.now() - Date.parse(latestVerification.created_at)) < 5 * 60 * 1000) {
      return res.status(429).json({
        success: false,
        error_code: 'VERIFICATION_COOLDOWN',
        message: 'You can request a new verification code once every 5 minutes.'
      });
    }

    try {
      await createVerification(req.user);
    } catch (error) {
      return res.status(502).json({
        success: false,
        error_code: 'EMAIL_DELIVERY_FAILED',
        message: 'Failed to send verification email. Please try again later.'
      });
    }

    await logAuthEvent({ userId: req.user.id, eventType: 'resend_verification', success: true, ipAddress: getIpAddress(req) });
    await logAudit({ userId: req.user.id, action: 'resend_verification', entityType: 'user', entityId: String(req.user.id) });

    res.json({
      success: true,
      message: 'A new verification code has been sent.'
    });
  }
);

router.get('/me', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: sanitizeUser(req.user)
  });
});

module.exports = router;
