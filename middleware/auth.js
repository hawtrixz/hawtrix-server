/**
 * middleware/auth.js — Vérification des jetons JWT et accès admin
 * ==============================================================
 * Deux niveaux de protection :
 *  - authenticate : l'utilisateur est connecté (jeton JWT valide)
 *  - adminOnly    : réservé à l'administrateur (jeton admin)
 */
const jwt = require("jsonwebtoken");
const db = require("../db/database");

const SECRET = process.env.JWT_SECRET || "change_me_in_production";

/** Extrait et vérifie le jeton JWT de l'en-tête Authorization */
function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ success: false, message: "Connexion requise" });
  }

  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.id);

    if (!user) return res.status(401).json({ success: false, message: "Utilisateur introuvable" });
    if (user.is_banned) return res.status(403).json({ success: false, message: "Ce compte a été banni" });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Session expirée, reconnectez-vous" });
  }
}

/** Vérifie le jeton admin (Authorization: Bearer ADMIN_xxx) */
function adminOnly(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token === (process.env.ADMIN_SECRET_TOKEN || "")) {
    return next();
  }
  return res.status(403).json({ success: false, message: "Accès admin refusé" });
}

module.exports = { authenticate, adminOnly };
