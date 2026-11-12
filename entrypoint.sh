#!/bin/sh
set -e

mkdir -p /app/data/media/fichajes /app/catalog /app/seed

# Semilla inicial: solo copiar sat_db.json si el volumen /app/data aún está vacío
if [ ! -f /app/data/sat_db.json ] && [ -f /app/seed/sat_db.json ]; then
  echo "📦 Inicializando /app/data/sat_db.json desde semilla inicial..."
  cp /app/seed/sat_db.json /app/data/sat_db.json
fi

exec node server.js
