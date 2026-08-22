
/**
 * routes/auth.js — Inscription, connexion et profil utilisateur
 * =============================================================
 * POST /auth/register  → crée un compte (téléphone + nom + prénom + profession + quartier)
 * POST /auth/login     → connexion par téléphone + mot de passe
 * GET  /auth/me        → profil de l'utilisateur connecté
 * PUT  /auth/me        → mise à jour du profil
 */
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/database");
const { authenticate, adminOnly } = require("../middleware/auth");

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
  return String(code || "").trim().toUpperCase().replace(/[\s_-]/g, "").replace(/^HWT/, "");
}

function findPresident() {
  const rows = db.prepare("SELECT * FROM users").all();
  return rows.find((row) => normalizePhone(row.phone) === normalizePhone(PRESIDENT_PHONE)) || null;
}

function findReferrer(code) {
  const raw = String(code || "").trim().toUpperCase().replace(/[\s_-]/g, "");
  const wanted = normalizeReferralCode(code);
  if (!wanted) return null;
  const rows = db.prepare("SELECT * FROM users").all();
  const president = rows.find((row) => normalizePhone(row.phone) === normalizePhone(PRESIDENT_PHONE));
  // Compatibilité avec l'ancien code affiché localement par l'APK.
  if (raw === "HWTPRESIDENT" || raw === "PRESIDENT") return president || null;
  return rows.find((row) => normalizeReferralCode(row.referral_code) === wanted) || null;
}

/** Génère un code unique de 5 caractères : exactement 3 lettres et 2 chiffres. */
function makeReferralCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const pick = (source) => source[Math.floor(Math.random() * source.length)];
  const shuffle = (items) => items.sort(() => Math.random() - 0.5).join("");
  for (let attempt = 0; attempt < 100; attempt++) {
    const code = shuffle([pick(letters), pick(letters), pick(letters), pick(digits), pick(digits)]);
    const exists = db.prepare("SELECT 1 FROM users WHERE referral_code = ? LIMIT 1").get(code);
    if (!exists) return code;
  }
  throw new Error("Impossible de générer un code de parrainage unique");
}

/** Transforme la ligne SQL en objet utilisateur propre avec sécurité paiement */
function toUser(row) {
  if (!row) return null;
  
  // Le paiement est considéré fait SEULEMENT si le statut est 'active'
  // ou si c'est le Président lui-même (+22890496651).
  const isPresident = normalizePhone(row.phone) === normalizePhone(PRESIDENT_PHONE);
  const isPaid = isPresident || row.status === "active" || row.payment_done === 1;

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
    status: row.status || "pending",
    paymentDone: isPaid, // Information CRITIQUE pour l'APK
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
    return res.status(400).json({ success: false, message: "Nom, prénom, téléphone et mot de passe obligatoires" });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, message: "Le mot de passe doit faire au moins 6 caractères" });
  }
  if (phone.replace(/\D/g, "").length < 8) {
    return res.status(400).json({ success: false, message: "Numéro de téléphone invalide" });
  }

  // Le téléphone existe déjà ? Comparaison normalisée pour conserver les
  // comptes historiques même si l'ancien format incluait espaces ou préfixes.
  const normalizedInputPhone = normalizePhone(phone);
  const existing = db.prepare("SELECT id FROM users WHERE normalized_phone = ?").get(normalizedInputPhone)
    || db.prepare("SELECT id FROM users").all().find((row) => normalizePhone(row.phone) === normalizedInputPhone);
  if (existing) {
    return res.status(409).json({ success: false, message: "Ce numéro est déjà utilisé. Connectez-vous plutôt." });
  }

  // Le code est accepté quel que soit son format de présentation.
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
    INSERT INTO users (id, name, surname, phone, normalized_phone, profession, neighborhood,
      referral_code, referrer_id, grade, password_hash, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(id, name.trim(), surname.trim(), normalizedPhone, normalizePhone(normalizedPhone),
    (profession || "").trim(), (neighborhood || "").trim(), referralCode, referrerId, initialGrade, passwordHash);

  // Nouvelle inscription = EN ATTENTE de validation par le Président.
  // Aucune commission n'est distribuée tant que le Président n'a pas validé.
  const newMemberName = `${surname.trim()} ${name.trim()}`.trim();
  const presidents = db.prepare("SELECT id, phone, name FROM users WHERE grade = 'president' AND is_banned = 0").all();
  for (const president of presidents) {
    db.prepare("INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, 'system', ?, ?)").run(
      uuidv4(),
      president.id,
      "Nouvelle inscription en attente",
      `${newMemberName} (${normalizedPhone}) demande à rejoindre Hawtrix. Pensez à vérifier et valider dans Administration → Inscriptions en attente.`
    );
  }
  // Le parrain reçoit aussi la notification de demande (sans commission pour l'instant).
  if (referrerId) {
    db.prepare("INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, 'system', ?, ?)").run(
      uuidv4(),
      referrerId,
      "Nouveau filleul en attente",
      `Votre filleul ${newMemberName} (${normalizedPhone}) attend la validation du Président.`
    );
  }

  const user = toUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: "30d" });

  // Notification de bienvenue
  db.prepare(`INSERT INTO notifications (id, user_id, type, title, body)
    VALUES (?, ?, 'system', 'Bienvenue sur Hawtrix !',
    'Votre compte a été créé avec succès. Code parrainage : ${referralCode}')`)
    .run(uuidv4(), id);

  res.status(201).json({
    success: true,
    message: "Compte créé avec succès",
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
    return res.status(400).json({ success: false, message: "Téléphone et mot de passe obligatoires" });
  }

  const normalizedLoginPhone = normalizePhone(phone);
  let userRow = db.prepare("SELECT * FROM users WHERE normalized_phone = ?").get(normalizedLoginPhone);
  if (!userRow) userRow = db.prepare("SELECT * FROM users").all().find((row) => normalizePhone(row.phone) === normalizedLoginPhone);
  if (!userRow) {
    return res.status(401).json({ success: false, message: "Numéro introuvable. Créez un compte d'abord." });
  }

  const ok = bcrypt.compareSync(password, userRow.password_hash);
  if (!ok) {
    return res.status(401).json({ success: false, message: "Mot de passe incorrect" });
  }
  // Migration transparente de l'ancien compte local vers le grade président serveur.
  if (normalizePhone(phone) === normalizePhone(PRESIDENT_PHONE) && userRow.grade !== "president") {
    db.prepare("UPDATE users SET grade = 'president' WHERE id = ?").run(userRow.id);
    userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userRow.id);
  }
  if (userRow.is_banned) {
    return res.status(403).json({ success: false, message: "Ce compte a été banni par l'administrateur" });
  }
  if (userRow.status === "rejected") {
    return res.status(403).json({ success: false, message: "Cette inscription a été refusée par le Président" });
  }
  if (userRow.status === "pending") {
    // Exception : le Président n'a pas besoin d'approbation admin.
    if (normalizePhone(phone) === normalizePhone(PRESIDENT_PHONE)) {
      db.prepare("UPDATE users SET status = 'active', payment_done = 1 WHERE id = ?").run(userRow.id);
      userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userRow.id);
    } else {
      return res.status(403).json({ success: false, pending: true, message: "Votre inscription est en attente de validation par le Président. Vous pourrez vous connecter dès qu'elle sera validée." });
    }
  }
  if (userRow.is_suspended) {
    return res.status(403).json({ success: false, message: "Ce compte est temporairement suspendu par l'administrateur" });
  }

  // Migration transparente : les comptes déjà actifs ou ayant un historique
  // (réseau, gains, grade président) ont déjà réglé leur activation de 2000 F.
  // Ils ne doivent JAMAIS revoir la page de paiement.
  if (userRow.payment_done === 0 && (
    userRow.grade === "president" ||
    Number(userRow.total_earnings || 0) > 0 ||
    Number(userRow.network_count || 0) > 0 ||
    userRow.status === "active"
  )) {
    db.prepare("UPDATE users SET payment_done = 1 WHERE id = ?").run(userRow.id);
    userRow.payment_done = 1;
  }

  const user = toUser(userRow);
  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: "30d" });

  res.json({ success: true, message: "Connexion réussie", user, token });
});

/** GET /auth/me — profil de l'utilisateur connecté */
router.get("/me", authenticate, (req, res) => {
  const user = toUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id));
  res.json({ success: true, user });
});

/** PUT /auth/push-token — enregistre le jeton de notification de l'appareil. */
router.put("/push-token", authenticate, (req, res) => {
  const pushToken = String(req.body?.pushToken || "").trim();
  if (!pushToken || !pushToken.startsWith("ExponentPushToken[")) {
    return res.status(400).json({ success: false, message: "Jeton Expo invalide" });
  }
  db.prepare("UPDATE users SET push_token = ? WHERE id = ?").run(pushToken, req.user.id);
  res.json({ success: true });
});

/** PUT /auth/me — mise à jour du profil */
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
  res.json({ success: true, message: "Profil mis à jour", user });
});

/**
 * PATCH /auth/registrations/:id — le Président valide ou refuse une inscription.
 * Body : { status } avec "active" (validée) ou "rejected" (refusée).
 * Lors de la validation, les commissions de l'adhésion de 2 000 FCFA sont
 * distribuées exactement selon la logique contractuelle de l'APK.
 */
router.patch("/registrations/:id", adminOnly, (req, res) => {
  const status = String(req.body?.status || "").trim();
  if (!["active", "rejected"].includes(status)) {
    return res.status(400).json({ success: false, message: "Statut invalide (active | rejected)" });
  }

  const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!member) return res.status(404).json({ success: false, message: "Membre introuvable" });
  if (member.status !== "pending") {
    return res.status(409).json({ success: false, message: "Cette inscription n'est pas en attente ou a déjà été traitée" });
  }

  if (status === "active") {
    // Répartition contractuelle de l'APK : 750 F President, 500 F direct,
    // puis division par 3 à chaque niveau supérieur ; reliquat au President.
    const president = db.prepare("SELECT id FROM users WHERE grade = 'president' AND is_banned = 0").all();
    const referrer = member.referrer_id ? db.prepare("SELECT * FROM users WHERE id = ?").get(member.referrer_id) : null;
    const credited = new Map();
    const credit = (userId, amount) => {
      if (userId && amount > 0) credited.set(userId, (credited.get(userId) || 0) + amount);
    };
    const distribute = db.transaction(() => {
      const event = db.prepare("INSERT OR IGNORE INTO membership_events (id, user_id, amount, referrer_id) VALUES (?, ?, ?, ?)")
        .run(uuidv4(), member.id, SIGNUP_FEE, member.referrer_id);
      if (event.changes === 0) return false;

      if (!member.referrer_id) {
        for (const p of president) credit(p.id, SIGNUP_FEE);
      } else {
        let remaining = SIGNUP_FEE;
        for (const p of president) {
          credit(p.id, PRESIDENT_BASE_SHARE);
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
        for (const p of president) {
          if (remaining > 0) credit(p.id, remaining);
        }
      }
      for (const [userId, amount] of credited) {
        db.prepare("UPDATE users SET balance = balance + ?, total_earnings = total_earnings + ? WHERE id = ?").run(amount, amount, userId);
        db.prepare("INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, 'mlm', ?, ?)").run(uuidv4(), userId, "Commission reçue", `Votre commission d'adhésion de ${amount} FCFA a été créditée après validation d'une inscription.`);
      }
      if (member.referrer_id) db.prepare("UPDATE users SET network_count = network_count + 1 WHERE id = ?").run(member.referrer_id);
      return true;
    });
    distribute();

    db.prepare("UPDATE users SET status = 'active', payment_done = 1 WHERE id = ?").run(member.id);
    db.prepare("INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, 'system', ?, ?)").run(
      uuidv4(), member.id, "Inscription validée",
      "Bienvenue dans Hawtrix ! Votre inscription a été validée par le Président. Votre activation de 2000 FCFA est prise en compte."
    );
  } else {
    db.prepare("UPDATE users SET status = 'rejected' WHERE id = ?").run(member.id);
    db.prepare("INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, 'system', ?, ?)").run(
      uuidv4(), member.id, "Inscription refusée",
      "Votre inscription a été refusée par le Président. Contactez l'administration pour plus d'informations."
    );
  }

  res.json({ success: true, message: `Inscription ${status === "active" ? "validée" : "refusée"}` });
});
module.exports = router;
