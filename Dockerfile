# Stage 1: build the bundled CLI/Hub from source
FROM node:22-bookworm AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json tsup.config.ts ./
COPY src ./src
COPY prompts ./prompts
RUN npm run build

# Drop dev deps so the runtime stage stays lean
RUN npm prune --omit=dev


# Stage 2: slim runtime
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prompts ./prompts
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

# Hub-only entry. The interactive CLI is a host-side workflow and is
# not the target of this image.
CMD ["node", "dist/cli.js", "hub", "--port", "3000"]
