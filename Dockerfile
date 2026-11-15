# syntax=docker/dockerfile:1

# The build stages run on the builder's own platform. What they produce (static files and the
# runtime dependencies, which are pure JavaScript) is the same on every architecture, so the
# final stage has no RUN step and an arm64 image builds without emulation.
# If a runtime dependency with native code is ever added, drop --platform from the deps stage.
#
# Needs BuildKit (docker buildx), which sets BUILDPLATFORM. The classic builder does not:
# pass it yourself, e.g. --build-arg BUILDPLATFORM=linux/amd64.
ARG BUILDPLATFORM

FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM --platform=$BUILDPLATFORM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir /data

# Runtime: the server runs its TypeScript sources directly (Node strips the types)
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
COPY package.json LICENSE ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY src/engine ./src/engine
COPY src/server ./src/server
COPY src/themes/ids.ts ./src/themes/ids.ts
COPY src/protocol.ts ./src/protocol.ts
COPY --from=deps --chown=node:node /data /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server/index.ts"]
