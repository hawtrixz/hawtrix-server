/**
 * db/database.js — Base de données SQLite (fichier unique, zéro coût)
 * ================================================================
 * Crée la base ./data/hawtrix.db et initialise les tables si elles
 * n'existent pas encore. SQLite est parfait pour quelques centaines
 * d'utilisateurs (et bien plus).
 */
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

// Dossier des données
const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "hawtrix.db"));

// Optimisations utiles en production
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    surname TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    profession TEXT DEFAULT '',
    neighborhood TEXT DEFAULT '',
    referral_code TEXT UNIQUE NOT NULL,
    referrer_id TEXT DEFAULT NULL,
    grade TEXT DEFAULT 'membre',
    password_hash TEXT NOT NULL,
    bio TEXT DEFAULT '',
    skills TEXT DEFAULT '[]',
    avatar TEXT DEFAULT '',
    balance REAL DEFAULT 0,
    total_earnings REAL DEFAULT 0,
    network_count INTEGER DEFAULT 0,
    branches TEXT DEFAULT '{}',
    invite_limit INTEGER DEFAULT NULL,
    is_banned INTEGER DEFAULT 0,
    is_suspended INTEGER DEFAULT 0,
    tutorial_seen INTEGER DEFAULT 0,
    terms_accepted INTEGER DEFAULT 0,
    payment_done INTEGER DEFAULT 0,
    push_token TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_a_id TEXT NOT NULL,
    user_b_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    text TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT DEFAULT 'system',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    code TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    org TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    deadline TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    requirements TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    apply_info TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT 'briefcase',
    color TEXT NOT NULL DEFAULT '#10B981',
    edition TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// Index pour accélérer les requêtes fréquentes
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_conversations_users ON conversations (user_a_id, user_b_id);
  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals (user_id);
  CREATE INDEX IF NOT EXISTS idx_opportunities_active ON opportunities (active, updated_at);
  CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone);

CREATE TABLE IF NOT EXISTS membership_events (
id TEXT PRIMARY KEY,
user_id TEXT NOT NULL UNIQUE,
amount REAL NOT NULL,
referrer_id TEXT DEFAULT NULL,
created_at TEXT DEFAULT (datetime('now'))
);
`);

// Migration non destructive pour les comptes historiques : le téléphone brut est
// conservé pour ne perdre aucune donnée, tandis qu’une colonne normalisée permet
// de retrouver le même compte malgré espaces, tirets ou indicatif présenté autrement.
try {
  db.exec("ALTER TABLE users ADD COLUMN normalized_phone TEXT");
} catch (err) {
  if (!String(err.message).includes("duplicate column name")) throw err;
}

// Migration non destructive : les comptes existants restent actifs ("active"),
// tandis que les nouvelles inscriptions démarrent en attente ("pending").
try {
  db.exec("ALTER TABLE users ADD COLUMN status TEXT");
} catch (err) {
  if (!String(err.message).includes("duplicate column name")) throw err;
}
try {
  db.exec("UPDATE users SET status = 'active' WHERE status IS NULL");
} catch (err) {
  if (!String(err.message).includes("duplicate column")) throw err;
}

const normalizePhone = (phone) => String(phone || "").replace(/\D/g, "");
const users = db.prepare("SELECT id, phone, normalized_phone FROM users").all();
const updatePhone = db.prepare("UPDATE users SET normalized_phone = ? WHERE id = ?");
const presidentPhone = normalizePhone("+22890496651");
const migratePhones = db.transaction(() => {
  for (const row of users) {
    const normalized = normalizePhone(row.phone);
    if (row.normalized_phone !== normalized) updatePhone.run(normalized, row.id);
  }
  const president = users.find((row) => normalizePhone(row.phone) === presidentPhone);
  if (president) db.prepare("UPDATE users SET grade = 'president' WHERE id = ?").run(president.id);
});
migratePhones();

db.exec("CREATE INDEX IF NOT EXISTS idx_users_normalized_phone ON users (normalized_phone)");

module.exports = db;

