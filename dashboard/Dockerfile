FROM node:20-slim AS base
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
COPY dashboard/package.json ./dashboard/
RUN npm ci --workspace=dashboard --include-workspace-root

# Copy dashboard source
COPY dashboard/ ./dashboard/

# Build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w dashboard

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["npm", "run", "start", "-w", "dashboard"]
