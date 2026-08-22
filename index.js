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
  res.send(`
    <html>
      <head>
        <title>Hawtrix API</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; text-align: center; padding: 50px; background: #0A1628; color: white; }
          .btn { display: inline-block; background: #25D366; color: white; padding: 15px 30px; text-decoration: none; border-radius: 10px; font-weight: bold; margin-top: 20px; }
          h1 { color: #FF6B00; }
        </style>
      </head>
      <body>
        <h1>Bienvenue sur Hawtrix</h1>
        <p>Le serveur est opérationnel.</p>
        <p>Besoin d'aide ou d'un code d'activation ?</p>
        <a href="https://wa.me/message/ITZ45LLE2RKSM1" class="btn">Contacter le support WhatsApp</a>
      </body>
    </html>
  `);
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
app.use("/ai", require("./routes/ai"));

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
