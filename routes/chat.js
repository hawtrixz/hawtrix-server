/**
 * routes/chat.js — Chat partagé entre utilisateurs
 * ================================================
 * GET  /chat/conversations            → liste des conversations de l'utilisateur
 * POST /chat/conversations            → créer/ouvrir une conversation avec un utilisateur
 * GET  /chat/conversations/:id        → messages d'une conversation
 * POST /chat/conversations/:id        → envoyer un message
 * GET  /chat/users                    → liste des utilisateurs (pour la recherche de contacts)
 */
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

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
 * Recherche d'utilisateurs par nom, prénom ou téléphone (pour ajouter un contact).
 */
router.get("/users", authenticate, (req, res) => {
  const q = (req.query.q || "").trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT id, name, surname, phone, profession, referral_code
      FROM users WHERE (name LIKE ? OR surname LIKE ? OR phone LIKE ?) AND id != ?
      LIMIT 30
    `).all(like, like, like, req.user.id);
  } else {
    rows = db.prepare(`
      SELECT id, name, surname, phone, profession, referral_code
      FROM users WHERE id != ? ORDER BY created_at DESC LIMIT 30
    `).all(req.user.id);
  }
  res.json({ success: true, users: rows });
});

/**
 * POST /chat/conversations
 * Body : { participantId } — ouvre (ou retrouve) une conversation avec un utilisateur.
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

  const [a, b] = [req.user.id, participantId].sort();
  let conversation = db.prepare("SELECT * FROM conversations WHERE user_a_id = ? AND user_b_id = ?").get(a, b);

  if (!conversation) {
    const id = uuidv4();
    db.prepare("INSERT INTO conversations (id, user_a_id, user_b_id) VALUES (?, ?, ?)").run(id, a, b);
    conversation = { id, participantId, participantName: `${participant.name} ${participant.surname}` };
  } else {
    conversation = { ...conversation, participantId, participantName: `${participant.name} ${participant.surname}` };
  }

  res.json({ success: true, conversation });
});

/**
 * GET /chat/conversations/:id
 * Retourne les messages d'une conversation (avec marquage "lu").
 */
router.get("/conversations/:id", authenticate, (req, res) => {const conversation = db.prepare(
  "SELECT * FROM conversations WHERE id = ?"
).get(req.params.id);

if (!conversation) {
  return res.status(404).json({
    success: false,
    message: "Conversation introuvable",
  });
}

if (
  conversation.user_a_id !== req.user.id &&
  conversation.user_b_id !== req.user.id
) {
  return res.status(403).json({
    success: false,
    message: "Accès refusé à cette conversation",
  });
}

  const messages = db.prepare(`
    SELECT m.*, u.name, u.surname
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ?
    ORDER BY m.created_at ASC
    LIMIT 200
  `).all(req.params.id);

  // Marquer comme lus les messages reçus dans cette conversation
  db.prepare(`UPDATE messages SET read = 1
    WHERE conversation_id = ? AND sender_id != ? AND read = 0`)
    .run(req.params.id, req.user.id);

  res.json({ success: true, messages });
});

/**
 * POST /chat/conversations/:id
 * Body : { text } — envoie un message et crée une notification pour le destinataire.
 */
router.post("/conversations/:id", authenticate, (req, res) => {
  const { text } = req.body;
  if (!text || !String(text).trim()) {
    return res.status(400).json({ success: false, message: "Le message est vide" });
  }

  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(req.params.id);
  if (!conv) {
    return res.status(404).json({ success: false, message: "Conversation introuvable" });
  }
  if (conv.user_a_id !== req.user.id && conv.user_b_id !== req.user.id) {
    return res.status(403).json({ success: false, message: "Accès refusé à cette conversation" });
  }

  const messageId = uuidv4();
  db.prepare(`INSERT INTO messages (id, conversation_id, sender_id, text)
    VALUES (?, ?, ?, ?)`).run(messageId, req.params.id, req.user.id, String(text).trim());

  // Destinataire
  const recipientId = conv.user_a_id === req.user.id ? conv.user_b_id : conv.user_a_id;
  const recipient = db.prepare("SELECT name, surname FROM users WHERE id = ?").get(recipientId);

  // Notification pour le destinataire
  db.prepare(`INSERT INTO notifications (id, user_id, type, title, body)
    VALUES (?, ?, 'message', 'Nouveau message', ?)`)
    .run(uuidv4(), recipientId, `${req.user.name} ${req.user.surname} : ${String(text).trim().slice(0, 60)}`);

  res.status(201).json({
    success: true,
    message: {
      id: messageId,
      senderId: req.user.id,
      name: `${req.user.name} ${req.user.surname}`,
      text: String(text).trim(),
      timestamp: new Date().toISOString(),
    },
  });
});

module.exports = router;
