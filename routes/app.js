/**
 * routes/app.js — Notifications, retraits et administration
 * =========================================================
 * GET    /notifications            → notifications de l'utilisateur
 * PUT    /notifications/:id        → marquer une notification comme lue
 * POST   /withdrawals              → demande de retrait
 * GET    /withdrawals              → historique des retraits de l'utilisateur
 *
 * --- Administration (jeton admin requis) ---
 * GET    /admin/users              → tous les utilisateurs
 * PATCH  /admin/users/:id/ban      → bannir / débannir
 * PATCH  /admin/users/:id/suspend  → suspendre / réactiver
 * POST   /admin/notifications      → envoyer une notification à TOUS les utilisateurs
 * PATCH  /admin/withdrawals/:id    → approuver/refuser un retrait
 */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/database");
const { authenticate, adminOnly } = require("../middleware/auth");

const router = express.Router();

/* =================== NOTIFICATIONS =================== */

router.get("/notifications", authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 100
  `).all(req.user.id);
  res.json({ success: true, notifications: rows });
});

router.put("/notifications/:id", authenticate, (req, res) => {
  db.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.user.id);
  res.json({ success: true });
});

router.post("/notifications/read-all", authenticate, (req, res) => {
  db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0").run(req.user.id);
  res.json({ success: true });
});

/* =================== RETRAITS =================== */

router.post("/withdrawals", authenticate, (req, res) => {
  const { amount, code } = req.body;
  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ success: false, message: "Montant invalide" });
  }

  const user = db.prepare("SELECT balance FROM users WHERE id = ?").get(req.user.id);
  if (Number(user.balance) < Number(amount)) {
    return res.status(400).json({ success: false, message: "Solde insuffisant" });
  }

  const id = uuidv4();
  db.prepare(`INSERT INTO withdrawals (id, user_id, amount, code) VALUES (?, ?, ?, ?)`)
    .run(id, req.user.id, Number(amount), (code || "").trim());
  // Déduire du solde immédiatement (remboursé si refusé par l'admin)
  db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(Number(amount), req.user.id);

  res.status(201).json({ success: true, message: "Demande de retrait envoyée. En attente de validation." });
});

router.get("/withdrawals", authenticate, (req, res) => {
  const rows = db.prepare(`SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC`)
    .all(req.user.id);
  res.json({ success: true, withdrawals: rows });
});

/* =================== ADMINISTRATION =================== */

/** Liste de tous les utilisateurs (vue admin) */
router.get("/admin/users", adminOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, surname, phone, profession, neighborhood, referrer_id,
      grade, balance, total_earnings, network_count, is_banned, is_suspended, created_at
    FROM users ORDER BY created_at DESC
  `).all();
  res.json({ success: true, users: rows });
});

/** Bannir / débannir un utilisateur */
router.patch("/admin/users/:id/ban", adminOnly, (req, res) => {
  const { banned } = req.body; // true = bannir, false = débannir
  db.prepare("UPDATE users SET is_banned = ? WHERE id = ?").run(banned ? 1 : 0, req.params.id);
  res.json({ success: true, message: banned ? "Utilisateur banni" : "Utilisateur débanni" });
});

/** Suspendre / réactiver un utilisateur */
router.patch("/admin/users/:id/suspend", adminOnly, (req, res) => {
  const { suspended } = req.body;
  db.prepare("UPDATE users SET is_suspended = ? WHERE id = ?").run(suspended ? 1 : 0, req.params.id);
  res.json({ success: true, message: suspended ? "Utilisateur suspendu" : "Utilisateur réactivé" });
});

/** Envoyer une notification à TOUS les utilisateurs (annonce système) */
router.post("/admin/notifications", adminOnly, (req, res) => {
  const { title, body, type } = req.body;
  if (!title || !body) {
    return res.status(400).json({ success: false, message: "Titre et corps obligatoires" });
  }
  const users = db.prepare("SELECT id FROM users").all();
  const insert = db.prepare("INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)");
  const insertMany = db.transaction((rows) => {
    for (const u of rows) insert.run(uuidv4(), u.id, type || "system", title, body);
  });
  insertMany(users);
  res.json({ success: true, message: `Notification envoyée à ${users.length} utilisateur(s)` });
});

/** Approuver ou refuser une demande de retrait */
router.patch("/admin/withdrawals/:id", adminOnly, (req, res) => {
  const { status } = req.body; // "completed" | "rejected"
  if (!["completed", "rejected"].includes(status)) {
    return res.status(400).json({ success: false, message: "Statut invalide (completed | rejected)" });
  }

  const w = db.prepare("SELECT * FROM withdrawals WHERE id = ?").get(req.params.id);
  if (!w) return res.status(404).json({ success: false, message: "Retrait introuvable" });

  if (status === "rejected") {
    // Rembourser le solde
    db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(w.amount, w.user_id);
  }
  db.prepare("UPDATE withdrawals SET status = ? WHERE id = ?").run(status, req.params.id);

  res.json({ success: true, message: `Retrait marqué comme ${status}` });
});

/* =================== OPPORTUNITÉS =================== */

const OPPORTUNITY_TYPES = new Set(["Emploi", "Stage", "Bourse", "Concours", "Projet", "Financement", "Appel d'offres", "Événement"]);

function mapOpportunity(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    org: row.org,
    country: row.country,
    deadline: row.deadline,
    description: row.description,
    requirements: row.requirements,
    url: row.url,
    applyInfo: row.apply_info,
    image: row.image,
    color: row.color,
    edition: row.edition,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validHttpUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Liste publique : l'application peut la consulter à chaque ouverture. */
router.get("/opportunities", (req, res) => {
  const rows = db.prepare("SELECT * FROM opportunities WHERE active = 1 ORDER BY updated_at DESC, created_at DESC").all();
  res.json({ success: true, opportunities: rows.map(mapOpportunity) });
});

/** Liste complète réservée au Président. */
router.get("/admin/opportunities", adminOnly, (req, res) => {
  const rows = db.prepare("SELECT * FROM opportunities ORDER BY updated_at DESC, created_at DESC").all();
  res.json({ success: true, opportunities: rows.map(mapOpportunity) });
});

/** Création d'une opportunité par le Président. */
router.post("/admin/opportunities", adminOnly, (req, res) => {
  const body = req.body || {};
  const required = ["type", "title", "deadline", "url"];
  if (required.some((key) => !String(body[key] || "").trim())) {
    return res.status(400).json({ success: false, message: "Type, titre, date limite et lien officiel sont obligatoires" });
  }
  if (!OPPORTUNITY_TYPES.has(String(body.type).trim())) {
    return res.status(400).json({ success: false, message: "Catégorie d'opportunité invalide" });
  }
  if (!validHttpUrl(body.url)) {
    return res.status(400).json({ success: false, message: "Le lien officiel doit commencer par http:// ou https://" });
  }
  const id = uuidv4();
  db.prepare(`INSERT INTO opportunities
    (id, type, title, org, country, deadline, description, requirements, url, apply_info, image, color, edition, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
    id,
    String(body.type).trim(),
    String(body.title).trim(),
    String(body.org || "").trim(),
    String(body.country || "").trim(),
    String(body.deadline).trim(),
    String(body.description || "").trim(),
    String(body.requirements || "").trim(),
    String(body.url).trim(),
    String(body.applyInfo || "").trim(),
    String(body.image || "briefcase").trim(),
    String(body.color || "#10B981").trim(),
    String(body.edition || "").trim(),
  );
  const row = db.prepare("SELECT * FROM opportunities WHERE id = ?").get(id);
  res.status(201).json({ success: true, opportunity: mapOpportunity(row) });
});

/** Modification complète partielle d'une opportunité par le Président. */
router.patch("/admin/opportunities/:id", adminOnly, (req, res) => {
  const current = db.prepare("SELECT * FROM opportunities WHERE id = ?").get(req.params.id);
  if (!current) return res.status(404).json({ success: false, message: "Opportunité introuvable" });
  const body = req.body || {};
  const type = body.type === undefined ? current.type : String(body.type).trim();
  const url = body.url === undefined ? current.url : String(body.url).trim();
  if (!OPPORTUNITY_TYPES.has(type)) return res.status(400).json({ success: false, message: "Catégorie d'opportunité invalide" });
  if (!validHttpUrl(url)) return res.status(400).json({ success: false, message: "Lien officiel invalide" });
  const fields = {
    type,
    title: body.title === undefined ? current.title : String(body.title).trim(),
    org: body.org === undefined ? current.org : String(body.org).trim(),
    country: body.country === undefined ? current.country : String(body.country).trim(),
    deadline: body.deadline === undefined ? current.deadline : String(body.deadline).trim(),
    description: body.description === undefined ? current.description : String(body.description).trim(),
    requirements: body.requirements === undefined ? current.requirements : String(body.requirements).trim(),
    url,
    apply_info: body.applyInfo === undefined ? current.apply_info : String(body.applyInfo).trim(),
    image: body.image === undefined ? current.image : String(body.image).trim(),
    color: body.color === undefined ? current.color : String(body.color).trim(),
    edition: body.edition === undefined ? current.edition : String(body.edition).trim(),
    active: body.active === undefined ? current.active : (body.active ? 1 : 0),
  };
  db.prepare(`UPDATE opportunities SET type=@type, title=@title, org=@org, country=@country,
    deadline=@deadline, description=@description, requirements=@requirements, url=@url,
    apply_info=@apply_info, image=@image, color=@color, edition=@edition, active=@active,
    updated_at=datetime('now') WHERE id=@id`).run({ ...fields, id: req.params.id });
  const row = db.prepare("SELECT * FROM opportunities WHERE id = ?").get(req.params.id);
  res.json({ success: true, opportunity: mapOpportunity(row) });
});

/** Désactivation logique : l'offre reste dans l'historique admin mais disparaît des utilisateurs. */
router.delete("/admin/opportunities/:id", adminOnly, (req, res) => {
  const result = db.prepare("UPDATE opportunities SET active = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  if (!result.changes) return res.status(404).json({ success: false, message: "Opportunité introuvable" });
  res.json({ success: true, message: "Opportunité désactivée" });
});

module.exports = router;

