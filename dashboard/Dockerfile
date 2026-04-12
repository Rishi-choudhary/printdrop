FROM node:20-slim AS base
LABEL service="printdrop-dashboard"
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
COPY dashboard/package.json ./dashboard/
RUN npm ci --workspace=dashboard --include-workspace-root

# Copy dashboard source
COPY dashboard/ ./dashboard/

# Build — NEXT_PUBLIC_API_URL is not needed at build time;
# client code defaults to /api (relative), and next.config.js
# rewrites proxy /api/* to the backend at runtime.
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm run build -w dashboard

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["npm", "run", "start", "-w", "dashboard"]
