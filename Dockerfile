FROM node:20-alpine

WORKDIR /app

# Copiar definiciones de dependencias
COPY package.json ./

# Instalar dependencias si las hubiera
RUN npm install --omit=dev || true

# Copiar aplicación y catálogo/semilla separados del volumen persistente /app/data
COPY server.js entrypoint.sh ./
COPY public ./public
COPY data/clientes_aliquo_cache.json /app/catalog/clientes_aliquo_cache.json
COPY data/sat_db.json /app/seed/sat_db.json

# Convertir posibles finales CRLF (Windows) y dar permisos de ejecución a entrypoint.sh
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Puerto oficial de SAT Baza Mazano 2.0 (Easypanel puede sobreescribir PORT=80)
EXPOSE 3090
ENV PORT=3090

# Volumen persistente para almacenar sat_db.json vivo y /app/data/media/
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD sh -c "wget -qO- http://127.0.0.1:${PORT:-3090}/api/health | grep -q '\"ok\":true' || exit 1"

ENTRYPOINT ["/app/entrypoint.sh"]
