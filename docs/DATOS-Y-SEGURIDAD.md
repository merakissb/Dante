# Datos y seguridad

## Qué datos trata el sistema
- Por usuario: RUT, nombre, hash del PIN (HMAC-SHA256 con sal y pimienta secreta).
- Por recepción de decreto: ID del decreto, RUT y nombre de quien lo recibió, fecha.
- Registro de accesos: RUT ingresado, resultado, IP, navegador, fecha. Nunca el PIN.
- No se tratan datos de contribuyentes, montos, ni contenido de los decretos.

## Quién lo ve
RUT y nombre solo son visibles para personas autenticadas, y el acceso lo
administra un admin (crea, desactiva, resetea). No hay lista pública de usuarios
ni registro abierto. El registro de accesos solo lo ve el admin.

## Qué hay en el repositorio (público)
- Ningún secreto: `ADMIN_SECRET`, `PIN_PEPPER` y el token de Cloudflare viven en
  secretos del proveedor y en `.env` (ignorado por git).
- Los valores de `docker-compose.yml` son solo para desarrollo local.
- Las pruebas usan RUT ficticios. Excepción conocida: la migración `0001`
  contiene el RUT de la persona administradora inicial para marcarla como admin,
  y el historial de git anterior puede contener RUT y nombres usados en pruebas.
- La URL del Worker y del frontend son públicas por diseño (el navegador las necesita).

## Límites
- PIN de 4 dígitos: débil por naturaleza; mitigado con bloqueo por cuenta, límite
  por IP y pimienta, sin segundo factor.
- Este documento describe el diseño; no reemplaza una evaluación legal bajo la
  Ley 19.628 / Ley 21.719 (protección de datos personales).
