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

module.exports = router;
