/**
 * routes/auth.js â€” Inscription, connexion et profil utilisateur
 * =============================================================
 * POST /auth/register  â†’ crÃ©e un compte (tÃ©lÃ©phone + nom + prÃ©nom + profession + quartier)
 * POST /auth/login     â†’ connexion par tÃ©lÃ©phone + mot de passe
 * GET  /auth/me        â†’ profil de l'utilisateur connectÃ©
 * PUT  /auth/me        â†’ mise Ã  jour du profil
 */
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
const PRESIDENT_PHONE = "+22890496651";
const SECRET = process.env.JWT_SECRET || "change_me_in_production";
const SALT_ROUNDS = 10;
const SIGNUP_FEE = 2000;
const PRESIDENT_BASE_SHARE = 750;

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function normalizeReferralCode(code) {
  return String(code || "").trim().toUpperCase().replace(/\s+/g, "").replace(/^HWT[-_]?/, "");
}

function findPresident() {
  const rows = db.prepare("SELECT * FROM users").all();
  return rows.find((row) => normalizePhone(row.phone) === normalizePhone(PRESIDENT_PHONE)) || null;
}

function findReferrer(code) {
  const wanted = normalizeReferralCode(code);
  if (!wanted) return null;
  const rows = db.prepare("SELECT * FROM users").all();
  return rows.find((row) => normalizeReferralCode(row.referral_code) === wanted) || null;
}

/** CrÃ©e un code de parrainage unique Ã  6 caractÃ¨res */
function makeReferralCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const pick = (source) => source[Math.floor(Math.random() * source.length)];
  const shuffle = (items) => items.sort(() => Math.random() - 0.5).join("");

  for (let attempt = 0; attempt < 100; attempt++) {
    const code = shuffle([
      pick(letters),
      pick(letters),
      pick(letters),
      pick(digits),
      pick(digits),
    ]);

    const exists = db.prepare(
      "SELECT 1 FROM users WHERE referral_code = ? LIMIT 1"
    ).get(code);

    if (!exists) return code;
  }

  throw new Error("Impossible de générer un code de parrainage unique");
}

/** Transforme la ligne SQL en objet utilisateur propre */
function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    surname: row.surname,
    phone: row.phone,
    profession: row.profession,
    neighborhood: row.neighborhood,
    referralCode: row.referral_code,
    referrerId: row.referrer_id,
    grade: row.grade,
    bio: row.bio,
    skills: JSON.parse(row.skills || "[]"),
    avatar: row.avatar,
    balance: Number(row.balance || 0),
    totalEarnings: Number(row.total_earnings || 0),
    networkCount: Number(row.network_count || 0),
    branches: JSON.parse(row.branches || "{}"),
    inviteLimit: row.invite_limit,
    isBanned: !!row.is_banned,
    isSuspended: !!row.is_suspended,
    tutorialSeen: !!row.tutorial_seen,
    joinedAt: row.created_at,
  };
}

/**
 * POST /auth/register
 * Body : { name, surname, phone, password, profession?, neighborhood?, referrerCode? }
 */
router.post("/register", (req, res) => {
  const { name, surname, phone, password, profession, neighborhood, referrerCode } = req.body;

  if (!name || !surname || !phone || !password) {
    return res.status(400).json({ success: false, message: "Nom, prÃ©nom, tÃ©lÃ©phone et mot de passe obligatoires" });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, message: "Le mot de passe doit faire au moins 6 caractÃ¨res" });
  }
  if (phone.replace(/\D/g, "").length < 8) {
    return res.status(400).json({ success: false, message: "NumÃ©ro de tÃ©lÃ©phone invalide" });
  }

  // Le tÃ©lÃ©phone existe dÃ©jÃ  ? Comparaison normalisÃ©e pour conserver les
  // comptes historiques mÃªme si l'ancien format incluait espaces ou prÃ©fixes.
  const normalizedInputPhone = normalizePhone(phone);
  const existing = db.prepare("SELECT id FROM users").all().find((row) => normalizePhone(row.phone) === normalizedInputPhone);
  if (existing) {
    return res.status(409).json({ success: false, message: "Ce numÃ©ro est dÃ©jÃ  utilisÃ©. Connectez-vous plutÃ´t." });
  }

  // Le code est acceptÃ© quel que soit son format de prÃ©sentation.
  let referrer = null;
  let referrerId = null;
  if (referrerCode && String(referrerCode).trim()) {
    referrer = findReferrer(referrerCode);
    if (!referrer) {
      return res.status(400).json({ success: false, message: "Code de parrainage invalide" });
    }
    referrerId = referrer.id;
  }

  const id = uuidv4();
  const referralCode = makeReferralCode();
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  const normalizedPhone = phone.trim();
  const initialGrade = normalizePhone(normalizedPhone) === normalizePhone(PRESIDENT_PHONE) ? "president" : "membre";

  db.prepare(`
    INSERT INTO users (id, name, surname, phone, profession, neighborhood,
      referral_code, referrer_id, grade, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), surname.trim(), normalizedPhone,
    (profession || "").trim(), (neighborhood || "").trim(), referralCode, referrerId, initialGrade, passwordHash);

  // L'inscription serveur rÃ©ussie vaut adhÃ©sion payÃ©e de 2 000 FCFA.
  // L'opÃ©ration est enregistrÃ©e avant les crÃ©dits et protÃ©gÃ©e par UNIQUE(user_id),
  // afin qu'une rÃ©pÃ©tition de requÃªte ne puisse jamais payer deux fois.
  const president = findPresident();
  const credited = new Map();
  const credit = (userId, amount) => {
    if (userId && amount > 0) credited.set(userId, (credited.get(userId) || 0) + amount);
  };
  const distributeMembership = db.transaction(() => {
    const event = db.prepare("INSERT OR IGNORE INTO membership_events (id, user_id, amount, referrer_id) VALUES (?, ?, ?, ?)")
      .run(uuidv4(), id, SIGNUP_FEE, referrerId);
    if (event.changes === 0) return false;

    // RÃ©partition contractuelle de l'APK : 750 F President, 500 F direct,
    // puis division par 3 Ã  chaque niveau supÃ©rieur ; reliquat au President.
    if (!referrerId) {
      if (president) credit(president.id, SIGNUP_FEE);
    } else {
      let remaining = SIGNUP_FEE;
      if (president) {
        credit(president.id, PRESIDENT_BASE_SHARE);
        remaining -= PRESIDENT_BASE_SHARE;
      }
      let current = referrer;
      let levelShare = 500;
      const visited = new Set();
      while (current && remaining > 0 && !visited.has(current.id)) {
        visited.add(current.id);
        const amount = Math.min(levelShare, remaining);
        credit(current.id, amount);
        remaining -= amount;
        levelShare = Math.max(1, Math.floor(levelShare / 3));
        current = current.referrer_id ? db.prepare("SELECT * FROM users WHERE id = ?").get(current.referrer_id) : null;
      }
      if (president && remaining > 0) credit(president.id, remaining);
    }
    for (const [userId, amount] of credited) {
      db.prepare("UPDATE users SET balance = balance + ?, total_earnings = total_earnings + ? WHERE id = ?").run(amount, amount, userId);
      db.prepare("INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, 'mlm', ?, ?)").run(uuidv4(), userId, "Commission reÃ§ue", `Votre commission d'adhÃ©sion de ${amount} FCFA a Ã©tÃ© crÃ©ditÃ©e.`);
    }
    if (referrerId) db.prepare("UPDATE users SET network_count = network_count + 1 WHERE id = ?").run(referrerId);
    return true;
  });
  distributeMembership();

  const user = toUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: "30d" });

  // Notification de bienvenue
  db.prepare(`INSERT INTO notifications (id, user_id, type, title, body)
    VALUES (?, ?, 'system', 'Bienvenue sur Hawtrix !',
    'Votre compte a Ã©tÃ© crÃ©Ã© avec succÃ¨s. Code parrainage : ${referralCode}')`)
    .run(uuidv4(), id);

  res.status(201).json({
    success: true,
    message: "Compte crÃ©Ã© avec succÃ¨s",
    user,
    token,
  });
});

/**
 * POST /auth/login
 * Body : { phone, password }
 */
router.post("/login", (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ success: false, message: "TÃ©lÃ©phone et mot de passe obligatoires" });
  }

  let userRow = db.prepare("SELECT * FROM users").all().find((row) => normalizePhone(row.phone) === normalizePhone(phone));
  if (!userRow) {
    return res.status(401).json({ success: false, message: "NumÃ©ro introuvable. CrÃ©ez un compte d'abord." });
  }

  const ok = bcrypt.compareSync(password, userRow.password_hash);
  if (!ok) {
    return res.status(401).json({ success: false, message: "Mot de passe incorrect" });
  }
  // Migration transparente de lâ€™ancien compte local vers le grade prÃ©sident serveur.
  if (normalizePhone(phone) === normalizePhone(PRESIDENT_PHONE) && userRow.grade !== "president") {
    db.prepare("UPDATE users SET grade = 'president' WHERE id = ?").run(userRow.id);
    userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userRow.id);
  }
  if (userRow.is_banned) {
    return res.status(403).json({ success: false, message: "Ce compte a Ã©tÃ© banni par l'administrateur" });
  }

  const user = toUser(userRow);
  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: "30d" });

  res.json({ success: true, message: "Connexion rÃ©ussie", user, token });
});

/** GET /auth/me â€” profil de l'utilisateur connectÃ© */
router.get("/me", authenticate, (req, res) => {
  const user = toUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id));
  res.json({ success: true, user });
});

/** PUT /auth/me â€” mise Ã  jour du profil */
router.put("/me", authenticate, (req, res) => {
  const { name, surname, profession, neighborhood, bio, skills, avatar } = req.body;
  db.prepare(`UPDATE users SET
      name = COALESCE(?, name),
      surname = COALESCE(?, surname),
      profession = COALESCE(?, profession),
      neighborhood = COALESCE(?, neighborhood),
      bio = COALESCE(?, bio),
      skills = COALESCE(?, skills),
      avatar = COALESCE(?, avatar)
    WHERE id = ?`)
    .run(name, surname, profession, neighborhood,
      bio, skills ? JSON.stringify(skills) : undefined, avatar, req.user.id);

  const user = toUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id));
  res.json({ success: true, message: "Profil mis Ã  jour", user });
});

module.exports = router;
