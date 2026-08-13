/**
 * middleware/auth.js â€” VÃ©rification des jetons JWT et accÃ¨s admin
 */
const jwt = require("jsonwebtoken");
const db = require("../db/database");

const SECRET = process.env.JWT_SECRET || "change_me_in_production";

function readBearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

/** Extrait et vÃ©rifie le jeton JWT de l'en-tÃªte Authorization. */
function authenticate(req, res, next) {
  const token = readBearer(req);
  if (!token) {
    return res.status(401).json({ success: false, message: "Connexion requise" });
  }

  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.id);

    if (!user) return res.status(401).json({ success: false, message: "Utilisateur introuvable" });
    if (user.is_banned) return res.status(403).json({ success: false, message: "Ce compte a Ã©tÃ© banni" });
    if (user.is_suspended) return res.status(403).json({ success: false, message: "Ce compte est suspendu" });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Session expirÃ©e, reconnectez-vous" });
  }
}

/**
 * Autorise le jeton serveur historique ou le JWT d'un compte PrÃ©sident.
 * Le grade est relu dans SQLite Ã  chaque requÃªte afin qu'une modification
 * de grade soit immÃ©diatement prise en compte sans perte de session.
 */
function adminOnly(req, res, next) {
  const token = readBearer(req);
  const configuredAdminToken = process.env.ADMIN_SECRET_TOKEN || "";

  if (configuredAdminToken && token === configuredAdminToken) return next();
  if (!token) return res.status(403).json({ success: false, message: "Accès admin refusé" });

  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.id);
    if (!user) return res.status(403).json({ success: false, message: "Accès admin refusé" });
    if (user.is_banned || user.is_suspended) {
      return res.status(403).json({ success: false, message: "Compte Président indisponible" });
    }
    if (user.grade !== "president") {
      return res.status(403).json({ success: false, message: "Accès réservé au Président" });
    }
    req.user = user;
    return next();
  } catch (err) {
    return res.status(403).json({ success: false, message: "Accès admin refusé" });
  }
}

module.exports = { authenticate, adminOnly };
