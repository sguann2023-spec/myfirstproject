const fs = require('fs');
const path = require('path');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function flattenKeys(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  const out = [];
  for (const key of Object.keys(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    const child = value[key];
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      out.push(...flattenKeys(child, next));
    } else {
      out.push(next);
    }
  }
  return out;
}

function getLocaleJsonFiles(localesDir) {
  if (!fs.existsSync(localesDir)) return [];
  const langs = fs.readdirSync(localesDir, { withFileTypes: true }).filter(d => d.isDirectory());
  const files = [];
  for (const lang of langs) {
    const langDir = path.join(localesDir, lang.name);
    const entries = fs.readdirSync(langDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(path.join(langDir, entry.name));
      }
    }
  }
  return files;
}

function getI18nReservedStrings() {
  const localesDir = path.resolve(__dirname, '../locales');
  const files = getLocaleJsonFiles(localesDir);
  const keys = new Set();

  for (const file of files) {
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const k of flattenKeys(json)) keys.add(k);
    } catch (_) {}
  }

  if (keys.size === 0) {
    ['logo_title', 'login_button', 'switch_account', 'lang_zh', 'lang_en'].forEach(k => keys.add(k));
  }

  return Array.from(keys).map(k => `^${escapeRegex(k)}$`);
}

module.exports = { getI18nReservedStrings };