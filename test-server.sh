#!/bin/bash
# test-server.sh — Teste les routes principales du serveur Hawtrix
BASE="http://localhost:3000"

echo "=== 1. Sante du serveur ==="
curl -s "$BASE"
echo ""

echo "=== 2. Inscription (Alice) ==="
curl -s -X POST "$BASE/auth/register" -H "Content-Type: application/json" \
  -d '{"name":"Alice","surname":"Mensah","phone":"+22890123456","password":"secret123","profession":"Couturier","neighborhood":"Be"}' | python3 -m json.tool
TOKEN_A=$(curl -s -X POST "$BASE/auth/register" -H "Content-Type: application/json" \
  -d '{"name":"Alice2","surname":"Mensah2","phone":"+22890123457","password":"secret123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

echo "=== 3. Inscription (Bob) ==="
curl -s -X POST "$BASE/auth/register" -H "Content-Type: application/json" \
  -d '{"name":"Bob","surname":"Koffi","phone":"+22890654321","password":"secret123","profession":"Etudiant","neighborhood":"Tokoin"}' | python3 -m json.tool
TOKEN_B=$(curl -s -X POST "$BASE/auth/register" -H "Content-Type: application/json" \
  -d '{"name":"Bob2","surname":"Koffi2","phone":"+22890654322","password":"secret123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

echo "=== 4. Connexion ==="
curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"phone":"+22890123456","password":"secret123"}' | python3 -m json.tool

echo "=== 5. Liste des utilisateurs (contacts) ==="
curl -s "$BASE/chat/users" -H "Authorization: Bearer $TOKEN_A" | python3 -m json.tool

BOB_ID=$(curl -s "$BASE/chat/users" -H "Authorization: Bearer $TOKEN_A" \
  | python3 -c "import sys,json;
for u in json.load(sys.stdin)['users']:
    if u['surname']=='Koffi' and u['phone']=='+22890654321':
        print(u['id'])")
echo "BOB_ID=$BOB_ID"

echo "=== 6. Ouvrir conversation Alice -> Bob ==="
curl -s -X POST "$BASE/chat/conversations" -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" -d "{\"participantId\":\"$BOB_ID\"}" | python3 -m json.tool
CONV_ID=$(curl -s -X POST "$BASE/chat/conversations" -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" -d "{\"participantId\":\"$BOB_ID\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['conversation']['id'])")
echo "CONV_ID=$CONV_ID"

echo "=== 7. Envoi de messages ==="
curl -s -X POST "$BASE/chat/conversations/$CONV_ID" -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" -d '{"text":"Salut Bob, bienvenue dans Hawtrix !"}' | python3 -m json.tool
curl -s -X POST "$BASE/chat/conversations/$CONV_ID" -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" -d '{"text":"Merci Alice ! Comment ca marche ?"}' | python3 -m json.tool

echo "=== 8. Lecture des messages (cote Bob) ==="
curl -s "$BASE/chat/conversations/$CONV_ID" -H "Authorization: Bearer $TOKEN_B" | python3 -m json.tool

echo "=== 9. Notifications de Bob ==="
curl -s "$BASE/notifications" -H "Authorization: Bearer $TOKEN_B" | python3 -m json.tool

echo "=== 10. Rejet d inscription en doublon ==="
curl -s -X POST "$BASE/auth/register" -H "Content-Type: application/json" \
  -d '{"name":"Alice","surname":"Mensah","phone":"+22890123456","password":"autre123"}' | python3 -m json.tool

echo "=== 11. Admin : notification a tous ==="
ADMIN=$(grep ADMIN_SECRET_TOKEN .env | cut -d= -f2 | tr -d '[:space:]')
curl -s -X POST "$BASE/admin/notifications" -H "Authorization: Bearer $ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Bienvenue a tous","body":"Hawtrix est maintenant en ligne avec le nouveau serveur !","type":"system"}' | python3 -m json.tool

echo "=== 12. Liste utilisateurs (admin) ==="
curl -s "$BASE/admin/users" -H "Authorization: Bearer $ADMIN" | python3 -m json.tool

echo "=== TESTS TERMINES ==="
