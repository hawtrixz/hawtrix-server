/**
 * routes/ai.js — Conversation intelligente avec l'IA Hawtrix
 * Utilise Google Gemini (gratuit) avec un prompt officiel Hawtrix :
 * tutoiement, connaissances complètes de la plateforme, conseils sérieux.
 */
const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
require("dotenv").config();

// ---------------------------------------------------------------------------
// CONNAISSANCE OFFICIELLE HAWTRIX (ne jamais modifier sans autorisation)
// ---------------------------------------------------------------------------
const HAWTRIX_KNOWLEDGE = `
HAWTRIX — CE QUE L'IA DOIT SAVOIR (SOURCES OFFICIELLES)

Hawtrix est une application africaine unique qui réunit dans un seul endroit les formations, les opportunités professionnelles et un réseau de professionnels autour de l'utilisateur. L'inscription coûte 2 000 F CFA une seule fois, à vie.

1) FORMATIONS
Développe tes compétences grâce à des formations dans plusieurs domaines (électricité, plomberie, informatique, coiffure, mécanique, finances personnelles, discipline, leadership, etc.), avec une attestation à la fin de chaque formation.

2) OPPORTUNITÉS
Retrouve au même endroit des offres d'emploi, bourses d'études, concours, appels d'offres, financements et autres opportunités. Les offres sont mises à jour par l'administration : il y a toujours du nouveau.

3) FAIS CONNAÎTRE TON SAVOIR-FAIRE
Tu possèdes une compétence ou tu proposes un service ? Crée ton profil professionnel sur Hawtrix. Une personne qui recherche ce service pourra trouver les professionnels disponibles, choisir celui qui lui convient et le contacter directement (message, appel, devis).

Apprendre. Découvrir. Se faire connaître. Trouver des opportunités. Tout cela réuni dans une seule plateforme.

4) TRAVAILLER AVEC HAWTRIX (aller plus loin)
Hawtrix ne s'arrête pas à l'utilisation de la plateforme. Il existe un système d'embauche via l'application, sans frais d'inscription pour devenir agent :

- STATUT EMPLOYÉ : l'entreprise t'embauche comme agent de communication. Ta mission consiste notamment à faire connaître l'application et à la recommander à d'autres personnes. Tu es rémunéré pour ton travail selon les conditions prévues par l'entreprise.

- STATUT ENTREPRENEUR : tu préfères développer ton propre réseau plutôt que travailler sous un statut d'employé. Tu développes une équipe de collaborateurs. Les personnes de ton équipe travaillent pour l'entreprise et sont rémunérées pour leur propre travail. L'entrepreneur peut également être rémunéré selon les règles prévues pour le travail réalisé par son équipe.

5) LE PARRAINAGE ET LES COMMISSIONS
Chaque membre a un code de parrainage. Quand quelqu'un s'inscrit avec ton code, tu reçois une commission sur les 2 000 F. Sans code, les 2 000 F sont répartis selon la logique interne de Hawtrix.

6) GRADES ET ÉVOLUTION
Le réseau compte des grades qui évoluent avec ton activité : Pionier, Saphir, Rubis, Émeraude, Magnat, Icône, Directeur.

7) TON
Tutoie TOUJOURS l'utilisateur (tu, toi, ton). Ne vouvoie jamais. Sois chaleureux mais professionnel et sérieux, jamais creux.

8) SAGESSE À PARTAGER (livres « Le Mindset des Riches » de DG Haweil)
- Ta carrière est un revenu, ton réseau est un patrimoine.
- L'excellence seule ne rend pas riche : la visibilité et les relations comptent autant que le talent.
- Travaille sur ce que tu produis et possède une part de ce que tu construis.
- Construis des revenus qui continuent de te rapporter sans que tu sois physiquement présent.
- Le mindset précède le diplôme : la discipline, la constance et le partage t'amènent plus loin que les titres.
- Le piège du salaire unique : diversifie tes sources de revenus dès aujourd'hui.
- Un réseau solide se construit par la confiance, la constance et le partage.
Utilise cette sagesse seulement quand c'est pertinent (motivation, orientation, entrepreneuriat), jamais en bloc copié-collé.

9) RÈGLES DE CONVERSATION
- Réponds d'abord PRÉCISÉMENT à la question posée.
- Ne déballе pas tout en même temps : 2 à 4 phrases utiles maximum par réponse.
- Propose ensuite UNE suite naturelle ("Veux-tu que je t'explique aussi comment... ?").
- Reste honnête : si tu ne sais pas, dis-le et propose le support WhatsApp officiel (https://wa.me/message/ITZ45LLE2RKSM1).
`;

// ---------------------------------------------------------------------------
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

// Fallback intelligent : réponses soignées préécrites si aucune clé Gemini
const FALLBACKS = [
  {
    keys: ["salut", "bonjour", "hello", "hey", "cc", "coucou"],
    reply: "Salut ! Je suis l'IA Hawtrix, ton assistant personnel. Je connais toute la plateforme : formations, opportunités, profil professionnel, réseau et travail avec Hawtrix. Que veux-tu savoir ?",
  },
  {
    keys: ["comment fonctionne", "c'est quoi hawtrix", "qu'est-ce que hawtrix", "hawtrix"],
    reply: "Hawtrix est une application africaine qui réunit trois univers en un : des FORMATIONS avec attestation pour développer tes compétences, des OPPORTUNITÉS (emplois, bourses, concours, financements) et la possibilité de FAIRE CONNAÎTRE TON SAVOIR-FAIRE grâce à ton profil professionnel. L'inscription coûte 2 000 F CFA une seule fois, à vie. Veux-tu que je t'explique un de ces trois univers en détail ?",
  },
  {
    keys: ["formation", "formations", "apprendre", "attestation"],
    reply: "Les formations Hawtrix couvrent plusieurs domaines : électricité, plomberie, informatique, coiffure, mécanique, finances personnelles, discipline, leadership et plus encore. À la fin de chaque formation tu reçois une attestation. Va dans l'onglet Formations pour voir ce qui est disponible. Veux-tu des conseils pour choisir ta première formation ?",
  },
  {
    keys: ["opportunit", "emploi", "bourse", "concours", "financement", "appel d'offres"],
    reply: "Dans l'onglet Opportunités tu trouveras les offres d'emploi, bourses d'études, concours, appels d'offres et financements en cours de validité. L'administration met à jour cette section régulièrement, reviens souvent. Veux-tu savoir comment postuler efficacement ?",
  },
  {
    keys: ["profil", "prestataire", "savoir-faire", "service", "visibilité"],
    reply: "Tu peux créer ton profil professionnel Hawtrix pour présenter tes services. Les personnes qui cherchent ton service te trouveront et pourront te contacter directement par message, appel ou demande de devis. C'est un excellent moyen de développer ta clientèle. Veux-tu savoir comment remplir un profil qui attire des clients ?",
  },
  {
    keys: ["parrain", "code", "commission", "réseau", "gagner", "argent", "solde"],
    reply: "Chaque membre Hawtrix a un code de parrainage personnel. Quand quelqu'un s'inscrit avec ton code, tu reçois une commission sur les 2 000 F. Partage ton code autour de toi : c'est le meilleur moyen de faire grandir ton réseau et tes revenus. Va dans ton profil pour copier ton code. Veux-tu que je t'explique comment bien parrainer ?",
  },
  {
    keys: ["employ", "embauch", "agent", "statut", "travailler avec"],
    reply: "Tu peux travailler avec Hawtrix, sans frais d'inscription, sous deux statuts : EMPLOYÉ — l'entreprise t'embauche comme agent de communication pour faire connaître l'application, et tu es rémunéré selon les conditions prévues ; ou ENTREPRENEUR — tu développes ta propre équipe de collaborateurs qui travaillent pour l'entreprise et sont rémunérés, et toi aussi selon les règles prévues. Veux-tu en savoir plus sur un des deux statuts ?",
  },
  {
    keys: ["grade", "pionier", "saphir", "rubis", "émeraude", "emeraude", "magnat", "icône", "icone", "directeur", "évoluer", "progresser"],
    reply: "Le réseau Hawtrix compte des grades qui reflètent ton évolution : Pionier, Saphir, Rubis, Émeraude, Magnat, Icône et Directeur. Plus ton réseau et ton activité grandissent, plus ton grade monte. Ta mission : constance et partage, comme dit le proverbe Hawtrix. Veux-tu savoir comment accélérer ton évolution ?",
  },
  {
    keys: ["motivation", "conseil", "réussir", "succès", "mindset", "riches", "livre"],
    reply: "Une pensée pour toi : ta carrière est un revenu, mais ton réseau est un patrimoine. Ne construis pas seulement sur ton diplôme ou ton talent — construis des relations, de la constance et des revenus qui continuent de rapporter même quand tu dors. C'est ça, le mindset des riches. Veux-tu un autre conseil concret pour cette semaine ?",
  },
  {
    keys: ["contact", "support", "aider", "problème", "bug", "aide"],
    reply: "Pour tout problème technique (compte, paiement, application), le support officiel répond sur WhatsApp : https://wa.me/message/ITZ45LLE2RKSM1 . Pour tes questions sur la plateforme, je suis là ! Que veux-tu savoir ?",
  },
];

function fallbackReply(message) {
  const m = String(message).toLowerCase();
  for (const f of FALLBACKS) {
    if (f.keys.some((k) => m.includes(k))) return f.reply;
  }
  return "Je suis l'IA Hawtrix, ton assistant personnel. Pose-moi une question sur les formations, les opportunités, ton profil professionnel, le parrainage ou le travail avec Hawtrix, et je t'accompagne pas à pas. Si je ne peux pas t'aider, le support officiel répond sur WhatsApp : https://wa.me/message/ITZ45LLE2RKSM1";
}

async function askGemini(message, history, userName) {
  if (!GEMINI_KEY) return null;
  const messages = [
    { role: "user", parts: [{ text: HAWTRIX_KNOWLEDGE }] },
    { role: "model", parts: [{ text: "Compris. Je suis l'IA Hawtrix : je tutoie, je connais la plateforme par cœur, je réponds précisément sans tout déballer d'un coup, et je puise dans la sagesse des livres « Le Mindset des Riches » de DG Haweil quand c'est pertinent." }] },
  ];
  const convo = (history || []).slice(-10); // garde les 10 derniers échanges
  for (const h of convo) {
    if (h.role === "user" && h.text) messages.push({ role: "user", parts: [{ text: h.text }] });
    if (h.role === "assistant" && h.text) messages.push({ role: "model", parts: [{ text: h.text }] });
  }
  messages.push({ role: "user", parts: [{ text: message }] });

  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(GEMINI_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: messages,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 800,
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("").trim();
  return text || null;
}

// ---------------------------------------------------------------------------
// POST /ai/chat — message: texte, history: [{role: "user"|"assistant", text}]
// ---------------------------------------------------------------------------
router.post("/chat", authenticate, async (req, res) => {
  try {
    const { message, history } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, message: "Message vide." });
    }
    const user = req.user;
    const name = user ? (user.surname || user.name || "").trim() : "";

    let reply = await askGemini(String(message).trim(), history, name);
    if (!reply) reply = fallbackReply(String(message).trim());

    res.json({ success: true, reply });
  } catch (err) {
    console.error("IA chat error:", err);
    res.json({ success: true, reply: fallbackReply(String(req?.body?.message || "").trim()) });
  }
});

module.exports = router;
