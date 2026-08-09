/**
 * index.js — Point d'entrée du serveur Hawtrix
 * =============================================
 * Démarre l'API REST et enregistre toutes les routes.
 * La variable PORT vient de l'environnement (Render la fournit).
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

// Initialiser la base de données
require("./db/database");

const app = express();

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "2mb" }));

// --- Santé du serveur (à tester dans le navigateur) ---
app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Hawtrix API",
    version: "1.0.0",
    message: "Le serveur fonctionne. Branchez votre APK sur cette URL.",
    docs: {
      auth: "POST /auth/register, POST /auth/login, GET /auth/me",
      chat: "GET/POST /chat/conversations, GET/POST /chat/conversations/:id",
      notifications: "GET /notifications, PUT /notifications/:id",
      withdrawals: "POST /withdrawals, GET /withdrawals",
      admin: "GET /admin/users, PATCH /admin/users/:id/ban, POST /admin/notifications",
    },
  });
});

// Routes
app.use("/auth", require("./routes/auth"));
app.use("/chat", require("./routes/chat"));
app.use("/", require("./routes/app")); // notifications, withdrawals, admin

// Route 404 propre
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route inconnue : ${req.method} ${req.path}` });
});

// Gestion d'erreur globale
app.use((err, req, res, next) => {
  console.error("Erreur serveur:", err);
  res.status(500).json({ success: false, message: "Erreur interne du serveur" });
});

const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║   Serveur Hawtrix prêt sur le port ${PORT}      ║
  ║   Test : http://localhost:${PORT}             ║
  ╚══════════════════════════════════════════════╝
  `);
});
