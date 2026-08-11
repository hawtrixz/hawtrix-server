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
const { authenticate } = require("../middleware/auth");


const router = express.Router();
const PRESIDENT_PHONE = "+22890496651";
const SECRET = process.env.JWT_SECRET || "change_me_in_production";
const SALT_ROUNDS = 10;


/** Crée un code de parrainage unique à 6 caractères */
function makeReferralCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return "HWT-" + code;
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
    return res.status(400).json({ success: false, message: "Nom, prénom, téléphone et mot de passe obligatoires" });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, message: "Le mot de passe doit faire au moins 6 caractères" });
  }
  if (phone.replace(/\D/g, "").length < 8) {
    return res.status(400).json({ success: false, message: "Numéro de téléphone invalide" });
  }


  // Le téléphone existe déjà ?
  const existing = db.prepare("SELECT id FROM users WHERE phone = ?").get(phone.trim());
  if (existing) {
    return res.status(409).json({ success: false, message: "Ce numéro est déjà utilisé. Connectez-vous plutôt." });
  }


  // Parrain valide ?
  let referrerId = null;
  if (referrerCode) {
    const ref = db.prepare("SELECT id FROM users WHERE referral_code = ?").get(referrerCode.trim());
    if (!ref) {
      return res.status(400).json({ success: false, message: "Code de parrainage invalide" });
    }
    referrerId = ref.id;
    // Mettre à jour le réseau du parrain
    db.prepare("UPDATE users SET network_count = network_count + 1 WHERE id = ?").run(referrerId);
  }


  const id = uuidv4();
  const referralCode = makeReferralCode();
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
