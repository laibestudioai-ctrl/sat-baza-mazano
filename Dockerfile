FROM node:20-alpine

WORKDIR /app

# Copiar definiciones de dependencias
COPY package.json ./

# Instalar dependencias si las hubiera (xlsx para scripts, etc.)
RUN npm install --omit=dev || true

# Copiar el código fuente completo (servidor, frontend en public/ y datos persistentes)
COPY . .

# Puerto oficial de SAT Baza Mazano 2.0
EXPOSE 3090
ENV PORT=3090

# Volumen persistente para almacenar sat_db.json
VOLUME ["/app/data"]

CMD ["node", "server.js"]
