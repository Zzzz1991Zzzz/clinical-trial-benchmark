const db = require('../database');
const defaultContent = require('../content/siteContent');

const NOTICE_KEY = 'home_announcement';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateAnnouncementItems(items) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error('Notice must contain at least one announcement item.');
  }

  return items.map((item) => {
    const date = String(item?.date || '').trim();
    if (!date) throw new Error('Each notice item requires a date.');

    const parts = Array.isArray(item?.parts) ? item.parts : [];
    if (!parts.length) throw new Error('Each notice item requires content.');

    return {
      date,
      parts: parts.map((part) => {
        if (part?.type === 'link') {
          const label = String(part.label || '').trim();
          const href = String(part.href || '#').trim() || '#';
          if (!label) throw new Error('Notice link items require a label.');
          return { type: 'link', label, href };
        }

        const value = String(part?.value || '').trim();
        if (!value) throw new Error('Notice text items require content.');
        return { type: 'text', value };
      })
    };
  });
}

async function getAnnouncementOverride() {
  const row = await db.get('SELECT json_value FROM site_content WHERE content_key = ?', [NOTICE_KEY]);
  if (!row?.json_value) return null;

  try {
    const parsed = JSON.parse(row.json_value);
    return { items: validateAnnouncementItems(parsed.items || []) };
  } catch (error) {
    console.warn(`[content] Invalid announcement override ignored: ${error.message}`);
    return null;
  }
}

async function getHomeContent() {
  const content = clone(defaultContent);
  const override = await getAnnouncementOverride();
  if (override) content.announcement = override;
  return content;
}

async function updateAnnouncement(items) {
  const normalizedItems = validateAnnouncementItems(items);
  const payload = JSON.stringify({ items: normalizedItems });

  await db.run('DELETE FROM site_content WHERE content_key = ?', [NOTICE_KEY]);
  await db.insert(
    'INSERT INTO site_content (content_key, json_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
    [NOTICE_KEY, payload]
  );

  return { items: normalizedItems };
}

module.exports = {
  getHomeContent,
  updateAnnouncement
};
