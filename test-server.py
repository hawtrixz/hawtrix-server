#!/usr/bin/env python3
"""test-server.py — Teste toutes les routes principales du serveur Hawtrix."""
import json
import os
import urllib.request

BASE = "http://localhost:3000"


def req(method, path, body=None, token=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode())


def show(title, d):
    print(f"\n=== {title} ===")
    print(json.dumps(d, indent=2, ensure_ascii=False)[:600])


# 1. Santé
show("1. Santé du serveur", req("GET", "/"))

# 2. Inscription Alice (création OU connexion si déjà inscrite)
phone_a = "+22891111111"
phone_b = "+22892222222"
alice = req("POST", "/auth/register", {
    "name": "Alice", "surname": "Mensah", "phone": phone_a,
    "password": "secret123", "profession": "Couturier", "neighborhood": "Bè",
})
if not alice.get("token"):
    alice = req("POST", "/auth/login", {"phone": phone_a, "password": "secret123"})
show("2. Inscription/connexion Alice", alice)
token_a = alice.get("token")

# 3. Inscription Bob
bob = req("POST", "/auth/register", {
    "name": "Bob", "surname": "Koffi", "phone": phone_b,
    "password": "secret123", "profession": "Étudiant", "neighborhood": "Tokoin",
})
if not bob.get("token"):
    bob = req("POST", "/auth/login", {"phone": phone_b, "password": "secret123"})
show("3. Inscription/connexion Bob", bob)
token_b = bob.get("token")

# 4. Rejet du doublon
show("4. Rejet doublon (même téléphone)", req("POST", "/auth/register", {
    "name": "Alice", "surname": "Mensah", "phone": "+22891111111", "password": "autre",
}))

# 5. Connexion
show("5. Connexion Alice", req("POST", "/auth/login", {
    "phone": "+22891111111", "password": "secret123",
}))

# 6. Recherche de contacts
users = req("GET", "/chat/users", token=token_a)
show("6. Contacts (recherche Bob)", users)
bob_id = next((u["id"] for u in users.get("users", []) if u["phone"] == "+22892222222"), None)

if bob_id:
    # 7. Ouvrir conversation
    conv = req("POST", "/chat/conversations", {"participantId": bob_id}, token=token_a)
    show("7. Ouvrir conversation", conv)
    conv_id = conv.get("conversation", {}).get("id")

    # 8. Envoyer des messages
    show("8. Alice → Bob", req("POST", f"/chat/conversations/{conv_id}",
                               {"text": "Salut Bob, bienvenue dans Hawtrix !"}, token=token_a))
    show("9. Bob → Alice", req("POST", f"/chat/conversations/{conv_id}",
                               {"text": "Merci Alice ! Comment ça marche ?"}, token=token_b))

    # 9. Lire les messages côté Bob (marqués comme lus)
    show("10. Messages vus par Bob", req("GET", f"/chat/conversations/{conv_id}", token=token_b))

# 10. Notifications
show("11. Notifications de Bob", req("GET", "/notifications", token=token_b))

# 12. Retrait
# 13. Admin
admin_token = [l.split("=", 1)[1].strip() for l in open(".env") if l.startswith("ADMIN_SECRET_TOKEN=")][0]
show("12. Admin : notification à tous", req("POST", "/admin/notifications", {
    "title": "Bienvenue à tous",
    "body": "Hawtrix est maintenant en ligne avec le nouveau serveur !",
    "type": "system",
}, token=admin_token))

show("13. Admin : liste des utilisateurs", req("GET", "/admin/users", token=admin_token))

# 14. Vérification de la notification de bienvenue chez Alice après l'annonce admin
show("14. Notifications d'Alice (après annonce admin)", req("GET", "/notifications", token=token_a))

print("\n✅ TESTS TERMINÉS")
