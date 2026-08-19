const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DATA_DIR = process.env.DATA_DIR || "/opt/render/project/src/data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "hawtrix.db"), { verbose: null });
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Fonction SQL qui normalise le texte : minuscules + accents enlevés.
// Elle est utilisée par la recherche : "etudiant" retrouve "Étudiant".
function stripAccents(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
db.function("strip_accents", stripAccents);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    surname TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    normalized_phone TEXT,
    password_hash TEXT NOT NULL,
    profession TEXT DEFAULT '',
    neighborhood TEXT DEFAULT '',
    referral_code TEXT UNIQUE,
    referred_by TEXT,
    grade TEXT DEFAULT 'membre',
    balance REAL DEFAULT 0,
    is_banned INTEGER DEFAULT 0,
    is_suspended INTEGER DEFAULT 0,
    is_admin INTEGER DEFAULT 0,
    payment_done INTEGER DEFAULT 0,
    signup_code TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    push_token TEXT
  );
`);

db.exec("CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone)");
db.exec("CREATE INDEX IF NOT EXISTS idx_users_referral ON users (referral_code)");

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_a_id TEXT NOT NULL,
    user_b_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_a_id) REFERENCES users (id),
    FOREIGN KEY (user_b_id) REFERENCES users (id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    text TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users (id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data TEXT,
    read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users (id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS withdrawals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    phone TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    code TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users (id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    org TEXT NOT NULL,
    link TEXT,
    deadline TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS membership_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    sponsor_id TEXT,
    amount REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    code TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Migration non destructive : table des avis réels entre membres.
// Chaque membre peut donner un seul avis sur un autre membre (modifiable).
db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    reviewer_id TEXT NOT NULL,
    reviewed_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (reviewer_id) REFERENCES users (id),
    FOREIGN KEY (reviewed_id) REFERENCES users (id)
  );
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_reviews_reviewed ON reviews (reviewed_id)");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_pair ON reviews (reviewer_id, reviewed_id)");

module.exports = db;
