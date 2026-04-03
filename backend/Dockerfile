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

# Run migrations then start
CMD npx prisma db push --skip-generate && node backend/src/index.js
