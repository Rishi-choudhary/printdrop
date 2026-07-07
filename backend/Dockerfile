FROM node:20-slim AS base
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY prisma/ ./prisma/
RUN npm ci --workspace=backend --include-workspace-root

# Generate Prisma client
RUN npx prisma generate

# Copy backend source
COPY backend/ ./backend/

# Create uploads dir
RUN mkdir -p uploads

EXPOSE 3001
ENV NODE_ENV=production
ENV PORT=3001

# Schema sync is deliberately NOT run at boot: Railway cannot reach a
# DDL-capable Supabase endpoint (session pooler / direct host), and coupling
# `prisma db push` to container start meant one DB hiccup = total outage.
# After changing prisma/schema.prisma, run `npm run db:push` from a machine
# with DB access (or CI) BEFORE deploying.
CMD ["node", "backend/src/index.js"]
