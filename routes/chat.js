/*
 * Routes de messagerie Hawtrix — recherche tolérante aux accents + avis réels.
 * Toutes les routes existantes (conversations, messages, recherche users) sont préservées.
 *
 * GET   /chat/conversations             → liste des conversations + non-lus
 * GET   /chat/users?q=...               → recherche (accents facultatifs)
 * POST  /chat/conversations             → ouvrir une conversation
 * GET   /chat/conversations/:id         → messages + marquer comme lus
 * POST  /chat/conversations/:id         → envoyer un message
 * GET   /chat/reviews/:userId           → avis réels reçus
 * POST  /chat/reviews                   → donner un avis
 */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

/**
 * Normalise une chaîne : minuscules et suppression des accents.
 * "Étudiant" → "etudiant", "tègu" → "tegu".
 */
function stripAccents(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * GET /chat/conversations
 * Retourne la liste des conversations avec le dernier message et le nombre de non-lus.
 */
router.get("/conversations", authenticate, (req, res) => {
  const id = req.user.id;

  const conversations = db.prepare(`
    SELECT c.id,
      CASE WHEN c.user_a_id = ? THEN c.user_b_id ELSE c.user_a_id END AS participant_id,
      (SELECT name || ' ' || surname FROM users WHERE id =
        CASE WHEN c.user_a_id = ? THEN c.user_b_id ELSE c.user_a_id END) AS participant_name,
      (SELECT text FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_timestamp,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != ? AND read = 0) AS unread
    FROM conversations c
    WHERE c.user_a_id = ? OR c.user_b_id = ?
    ORDER BY last_timestamp DESC
  `).all(id, id, id, id, id);

  res.json({ success: true, conversations });
});

/**
 * GET /chat/users?q=...
 * Recherche d'utilisateurs par nom, prénom, téléphone, métier ou quartier.
 * Les accents sont facultatifs : "etudiant" retrouve "Étudiant".
 */
router.get("/users", authenticate, (req, res) => {
  const q = (req.query.q || "").trim();
  let rows;
  if (q) {
    const like = `%${stripAccents(q)}%`;
    rows = db.prepare(`
      SELECT id, name, surname, phone, profession, neighborhood, referral_code, is_banned, is_suspended
      FROM users WHERE (
        strip_accents(name) LIKE ? OR strip_accents(surname) LIKE ?
        OR strip_accents(phone) LIKE ? OR strip_accents(profession) LIKE ?
        OR strip_accents(neighborhood) LIKE ?
      ) AND id != ?
      LIMIT 30
    `).all(like, like, like, like, like, req.user.id);
  } else {
    rows = db.prepare(`
      SELECT id, name, surname, phone, profession, neighborhood, referral_code, is_banned, is_suspended
      FROM users WHERE id != ? AND is_banned = 0 ORDER BY created_at DESC LIMIT 30
    `).all(req.user.id);
  }
  res.json({ success: true, users: rows });
});

/**
 * POST /chat/conversations
 * Body : { participantId } — ouvre (ou retrouve) une conversation.
 */
router.post("/conversations", authenticate, (req, res) => {
  const { participantId } = req.body;
  if (!participantId) {
    return res.status(400).json({ success: false, message: "participantId requis" });
  }

  const participant = db.prepare("SELECT id, name, surname, is_banned FROM users WHERE id = ?").get(participantId);
  if (!participant) {
    return res.status(404).json({ success: false, message: "Utilisateur introuvable" });
  }
  if (participant.is_banned) {
    return res.status(403).json({ success: false, message: "Cet utilisateur ne peut pas discuter" });
  }

  const myId = req.user.id;
  const existing = db.prepare(`
    SELECT id FROM conversations WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)
  `).get(myId, participantId, participantId, myId);

  let conversation;
  if (existing) {
    conversation = { id: existing.id };
  } else {
    const id = uuidv4();
    db.prepare("INSERT INTO conversations (id, user_a_id, user_b_id) VALUES (?, ?, ?)")
      .run(id, myId, participantId);
    conversation = { id };
  }

  res.json({ success: true, conversation: { ...conversation, participantId, participantName: `${participant.name} ${participant.surname}` } });
});

/**
 * GET /chat/conversations/:id
 * Retourne les messages et marque automatiquement les non-lus comme lus.
 */
router.get("/conversations/:id", authenticate, (req, res) => {
  const id = req.params.id;
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
  if (!conv || (conv.user_a_id !== req.user.id && conv.user_b_id !== req.user.id)) {
    return res.status(404).json({ success: false, message: "Conversation introuvable" });
  }

  db.prepare("UPDATE messages SET read = 1 WHERE conversation_id = ? AND sender_id != ? AND read = 0")
    .run(id, req.user.id);

  const messages = db.prepare(`
    SELECT m.id, m.sender_id, m.text, m.created_at, m.read, u.name, u.surname
    FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ?
    ORDER BY m.created_at ASC
  `).all(id);

  res.json({ success: true, messages });
});

/**
 * POST /chat/conversations/:id
 * Body : { text } — envoie un message et crée la notification pour le destinataire.
 */
router.post("/conversations/:id", authenticate, (req, res) => {
  const id = req.params.id;
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, message: "Message vide" });
  }

  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
  if (!conv || (conv.user_a_id !== req.user.id && conv.user_b_id !== req.user.id)) {
    return res.status(404).json({ success: false, message: "Conversation introuvable" });
  }

  const messageId = uuidv4();
  db.prepare("INSERT INTO messages (id, conversation_id, sender_id, text) VALUES (?, ?, ?, ?)")
    .run(messageId, id, req.user.id, text.trim());

  // Notifier le destinataire (notification Android dans la barre du téléphone).
  const recipientId = conv.user_a_id === req.user.id ? conv.user_b_id : conv.user_a_id;
  const sender = db.prepare("SELECT name, surname FROM users WHERE id = ?").get(req.user.id);
  const notifId = uuidv4();
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, 'message', ?, ?)
  `).run(notifId, recipientId, "Nouveau message", `${sender.name} ${sender.surname} vous a envoyé un message`);

  // Pousser la notification si le destinataire a un token push enregistré.
  const recipient = db.prepare("SELECT push_token FROM users WHERE id = ?").get(recipientId);
  if (recipient && recipient.push_token) {
    const { Expo } = require("expo-server-sdk");
    if (Expo.isExpoPushToken(recipient.push_token)) {
      const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
      expo.sendPushNotificationsAsync([{
        to: recipient.push_token,
        sound: "default",
        title: "Hawtrix",
        body: `${sender.name} ${sender.surname} vous a envoyé un message`,
      }]).catch(() => {});
    }
  }

  res.json({
    success: true,
    message: {
      id: messageId,
      sender_id: req.user.id,
      text: text.trim(),
      created_at: new Date().toISOString(),
      read: 0,
      name: sender.name,
      surname: sender.surname,
    },
  });
});

/**
 * GET /chat/reviews/:userId
 * Retourne les avis réels donnés à un utilisateur.
 */
router.get("/reviews/:userId", authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.rating, r.text, r.created_at,
           u.id AS reviewer_id, u.name, u.surname
    FROM reviews r
    JOIN users u ON u.id = r.reviewer_id
    WHERE r.reviewed_id = ?
    ORDER BY r.created_at DESC
  `).all(req.params.userId);
  res.json({ success: true, reviews: rows });
});

/**
 * POST /chat/reviews
 * Body : { reviewedId, rating, text } — donner (ou mettre à jour) un avis.
 * Le serveur refuse de s'auto-évaluer et limite à un avis par paire.
 */
router.post("/reviews", authenticate, (req, res) => {
  const { reviewedId, rating, text } = req.body;
  const r = Number(rating);
  const cleanText = String(text || "").trim();
  if (!reviewedId || r < 1 || r > 5 || cleanText.length < 3 || cleanText.length > 500) {
    return res.status(400).json({ success: false, message: "Note (1-5) et texte (3-500 caractères) requis" });
  }
  if (reviewedId === req.user.id) {
    return res.status(400).json({ success: false, message: "Vous ne pouvez pas vous donner d'avis" });
  }
  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(reviewedId);
  if (!target) {
    return res.status(404).json({ success: false, message: "Utilisateur introuvable" });
  }

  const existing = db.prepare("SELECT id FROM reviews WHERE reviewer_id = ? AND reviewed_id = ?").get(req.user.id, reviewedId);
  if (existing) {
    db.prepare("UPDATE reviews SET rating = ?, text = ?, created_at = datetime('now') WHERE id = ?")
      .run(r, cleanText, existing.id);
    return res.json({ success: true, message: "Avis mis à jour" });
  }
  db.prepare("INSERT INTO reviews (id, reviewer_id, reviewed_id, rating, text) VALUES (?, ?, ?, ?, ?)")
    .run(uuidv4(), req.user.id, reviewedId, r, cleanText);
  res.json({ success: true, message: "Avis publié" });
});

module.exports = router;
