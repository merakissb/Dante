#!/bin/bash
# Crea un par de usuarios de prueba contra el Worker corriendo en local
# (wrangler dev, puerto por defecto 8787). Requiere que exista worker/.dev.vars
# con el mismo ADMIN_SECRET que usas acá abajo.

API="http://127.0.0.1:8787"
ADMIN_SECRET="un-secreto-cualquiera-para-pruebas-locales"

curl -s -X POST "$API/api/admin/usuarios" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"rut": "11111111-1", "nombre": "Ana Prueba"}' | echo

curl -s -X POST "$API/api/admin/usuarios" \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"rut": "22222222-2", "nombre": "Bruno Prueba"}' | echo

echo "Listo. El PIN inicial de cada uno son los últimos 4 dígitos de su RUT."
