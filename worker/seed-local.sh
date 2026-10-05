#!/bin/bash
# Prepara datos de prueba en el entorno Docker local (docker compose up -d).
# Crea dos usuarios por la API de admin y deja al primero como admin.
# Ejecutar desde la raíz del repo:  bash worker/seed-local.sh
set -u

API="http://127.0.0.1:8787"
ADMIN_SECRET="un-secreto-cualquiera-para-pruebas-locales"

create_user() {
  curl -s -X POST "$API/api/admin/users" \
    -H "Authorization: Bearer $ADMIN_SECRET" \
    -H "Content-Type: application/json" \
    -d "{\"rut\": \"$1\", \"name\": \"$2\"}"
  echo
}

create_user "11111111-1" "Ana Prueba (admin)"
create_user "22222222-2" "Bruno Prueba"

docker compose exec -T api npx wrangler d1 execute decretos_firma_db --local \
  --command "UPDATE users SET is_admin = 1 WHERE rut = '11111111-1'" > /dev/null

echo "Listo. Ana (11111111-1) es admin. El PIN temporal de cada usuario nuevo aparece arriba (tempPin)."
echo "Si ya existían, usa 'Resetear PIN' en el panel de administración o el endpoint PATCH."
