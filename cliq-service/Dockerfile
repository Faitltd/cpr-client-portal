# ---- Stage 1: build ----
FROM node:20-alpine@sha256:89c3cc2e35b1b826b0e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6 AS build

# Native build tools required by better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- Stage 2: production ----
FROM node:20-alpine@sha256:89c3cc2e35b1b826b0e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6 AS production

WORKDIR /app

# Copy node_modules from the build stage. The native better-sqlite3 bindings are
# already compiled for node:20-alpine (same base), so no rebuild is needed.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json ./
# Remove devDependencies from the copied node_modules
RUN npm prune --omit=dev

COPY --from=build /app/dist ./dist

# Persistent volume for SQLite will be mounted here at runtime
RUN mkdir -p /app/data

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
