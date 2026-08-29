# Backend do Refract (checkout LemonSqueezy + licença Ed25519 + Pix futuramente).
# Imagem Node 20; better-sqlite3 compila binário nativo, então o build precisa
# de toolchain (python3/make/g++). O npm install roda DENTRO do container, então
# o better-sqlite3 é compilado para Linux — não reaproveita o build de Windows.
FROM node:20-bookworm-slim AS base
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./

ENV NODE_ENV=production
ENV PORT=8787
# Aponta o SQLite para o volume persistente montado em /data (ver fly.toml),
# senão o banco (licenças/checkouts) seria perdido a cada redeploy/restart.
ENV DB_PATH=/data/refract-ls.db
EXPOSE 8787
CMD ["node", "server.js"]
