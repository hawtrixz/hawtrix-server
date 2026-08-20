// ============================================================
// db/database.js — Schéma Hawtrix (version robuste et non destructive)
// ============================================================
// Ce fichier fait converger la base de données vers le schéma attendu,
// quel que soit son état actuel. Il ne SUPPRIME jamais de données :
// il crée les tables manquantes et ajoute uniquement les colonnes
// manquantes. Les comptes, soldes et numéros existants sont intacts.
// ============================================================

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DATA_DIR = process.env.DATA_DIR || "/opt/render/project/src/data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "hawtrix.db"), { verbose: null });
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ------------------------------------------------------------
// Fonctions utilitaires de migration non destructive
// ------------------------------------------------------------

/**
 * Ajoute une colonne à une table uniquement si elle n'existe pas encore.
 * Ne plante jamais si la colonne existe déjà (erreur "duplicate column" ignorée).
 */
function addColumn(table, column, definition) {
  const row = db.prepare(`PRAGMA table_info(${table})`).all().find((c) => c.name === column);
  if (row) return; // la colonne existe déjà, rien à faire
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (err) {
    if (!String(err.message).includes("duplicate column")) throw err;
  }
}

/**
 * Renomme une colonne seulement si l'ancienne existe et la nouvelle non.
 */
function renameColumn(table, oldName, newName) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (cols.includes(oldName) && !cols.includes(newName)) {
    try {
      db.exec(`ALTER TABLE ${table} RENAME COLUMN ${oldName} TO ${newName}`);
    } catch (err) {
      // L'opération n'est pas supportée sur d'anciennes versions SQLite : on ignore
      if (!String(err.message).includes("duplicate")) throw err;
    }
  }
}

// ------------------------------------------------------------
// Fonction SQL qui normalise le texte : minuscules + accents enlevés.
// Elle est utilisée par la recherche : "etudiant" retrouve "Étudiant".
// ------------------------------------------------------------
function stripAccents(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
db.function("strip_accents", stripAccents);

// ------------------------------------------------------------
// Table des membres (comptes). Si elle existe déjà, le CREATE
// est ignoré (IF NOT EXISTS) et les colonnes manquantes sont
// ajoutées une par une juste après. Zéro donnée perdue.
// ------------------------------------------------------------
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
    referrer_id TEXT DEFAULT '',
    grade TEXT DEFAULT 'membre',
    bio TEXT DEFAULT '',
    skills TEXT DEFAULT '[]',
    avatar TEXT DEFAULT '',
    balance REAL DEFAULT 0,
    total_earnings REAL DEFAULT 0,
    network_count INTEGER DEFAULT 0,
    branches TEXT DEFAULT '{}',
    invite_limit INTEGER DEFAULT 5,
    tutorial_seen INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    payment_done INTEGER DEFAULT 0,
    is_banned INTEGER DEFAULT 0,
    is_suspended INTEGER DEFAULT 0,
    push_token TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Converger les colonnes qui peuvent manquer sur la base existante.
// Sur Render, la table existe déjà sans "status" ni "referrer_id"
// (elle a "referred_by") : ces instructions réparent le schéma
// sans toucher les comptes, soldes et numéros.
addColumn("users", "status", "TEXT DEFAULT 'pending'");
addColumn("users", "referrer_id", "TEXT DEFAULT ''");
addColumn("users", "payment_done", "INTEGER DEFAULT 0");
addColumn("users", "bio", "TEXT DEFAULT ''");
addColumn("users", "skills", "TEXT DEFAULT '[]'");
addColumn("users", "avatar", "TEXT DEFAULT ''");
addColumn("users", "total_earnings", "REAL DEFAULT 0");
addColumn("users", "network_count", "INTEGER DEFAULT 0");
addColumn("users", "branches", "TEXT DEFAULT '{}'");
addColumn("users", "invite_limit", "INTEGER DEFAULT 5");
addColumn("users", "tutorial_seen", "INTEGER DEFAULT 0");
addColumn("users", "is_banned", "INTEGER DEFAULT 0");
addColumn("users", "is_suspended", "INTEGER DEFAULT 0");
addColumn("users", "push_token", "TEXT DEFAULT ''");
addColumn("users", "profession", "TEXT DEFAULT ''");
addColumn("users", "neighborhood", "TEXT DEFAULT ''");
addColumn("users", "normalized_phone", "TEXT");

// Le code du serveur utilise "referrer_id" ; les anciennes bases ont
// la colonne "referred_by". On la renomme pour unifier.
renameColumn("users", "referred_by", "referrer_id");

db.exec("CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone)");
db.exec("CREATE INDEX IF NOT EXISTS idx_users_referral ON users (referral_code)");

// ------------------------------------------------------------
// Conversations et messages (messagerie entre membres)
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// Notifications push (badge messages non lus, alertes système)
// ------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data TEXT,
    read INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users (id)
  );
`);
addColumn("notifications", "data", "TEXT");
addColumn("notifications", "status", "TEXT DEFAULT 'pending'");

// ------------------------------------------------------------
// Retraits (demandes de retrait d'argent, validées par le Président)
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// Opportunités (bourses, emplois, concours — gérées par l'admin)
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// Événements d'adhésion (suivi des inscriptions et commissions)
// ------------------------------------------------------------
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
addColumn("membership_events", "sponsor_id", "TEXT");
addColumn("membership_events", "referrer_id", "TEXT");

// ------------------------------------------------------------
// Avis réels entre membres (notes et commentaires)
// ------------------------------------------------------------
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
