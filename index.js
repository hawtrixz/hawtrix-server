/**
 * index.js — Point d'entrée du serveur Hawtrix
 * =============================================
 * API REST Hawtrix avec information de mise à jour facultative.
 * Les anciennes APK ne sont jamais bloquées par le serveur.
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");

// Initialiser la base SQLite.
require("./db/database");

const app = express();

// Middleware principal.
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "2mb" }));

// Version actuelle annoncée par le serveur.
// Cette information ne bloque aucune APK et ne contient aucun lien APK.
const SERVER_VERSION = "2.89.3";

/**
 * Route de santé du serveur.
 */
app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Hawtrix API",
    version: SERVER_VERSION,
    message: "Le serveur fonctionne.",
    docs: {
      auth: "POST /auth/register, POST /auth/login, GET /auth/me",
      chat: "GET/POST /chat/conversations, GET/POST /chat/conversations/:id",
      notifications: "GET /notifications, PUT /notifications/:id",
      withdrawals: "POST /withdrawals, GET /withdrawals",
      admin: "GET /admin/users, PATCH /admin/users/:id/ban, POST /admin/notifications",
      version: "GET /version.json"
    }
  });
});

/**
 * Route publique d'information de version.
 *
 * Important :
 * - latestVersion indique seulement la dernière version connue ;
 * - notes contient une information facultative ;
 * - aucune ancienne version n'est bloquée ;
 * - aucun apkUrl n'est envoyé ;
 * - aucun fichier APK n'est téléchargé par cette route.
 */
app.get("/version.json", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  res.json({
    latestVersion: SERVER_VERSION,
    notes: "Nouvelle version de Hawtrix disponible. Consulte le canal officiel pour les instructions."
  });
});

/**
 * Même information sous forme d'API JSON.
 * Cette route est utile pour tester le serveur Render directement.
 */
app.get("/api/version", (req, res) => {
  res.json({
    latestVersion: SERVER_VERSION,
    notes: "Nouvelle version de Hawtrix disponible. Consulte le canal officiel pour les instructions."
  });
});

// Routes de l'application.
app.use("/auth", require("./routes/auth"));
app.use("/chat", require("./routes/chat"));
app.use("/", require("./routes/app"));

// Route 404 propre.
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route inconnue : ${req.method} ${req.path}`
  });
});

// Gestion globale des erreurs.
app.use((err, req, res, next) => {
  console.error("Erreur serveur :", err);
  res.status(500).json({
    success: false,
    message: "Erreur interne du serveur"
  });
});

const PORT = parseInt(process.env.PORT || "3000", 10);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║   Serveur Hawtrix prêt sur le port ${PORT}    ║
  ║   Test : http://localhost:${PORT}             ║
  ║   Version : ${SERVER_VERSION}                 ║
  ╚══════════════════════════════════════════════╝
  `);
});
