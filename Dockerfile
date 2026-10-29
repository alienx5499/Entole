# Entole API (apps/api) for Render. Build from the repo root: docker build -t entole-api .

# Stage 1: link the workspaces. The API has no third-party runtime packages, so a filtered
# production install only creates the @entole/* links. The apps/web, apps/mcp, packages/testing
# and packages/entole-sdk package.json files are copied only because the frozen lockfile lists
# those workspaces; none of them ships in the image.
FROM oven/bun:1.4.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared-kernel/package.json packages/shared-kernel/
COPY packages/mandate/package.json packages/mandate/
COPY packages/limit-order/package.json packages/limit-order/
COPY packages/shopping/package.json packages/shopping/
COPY packages/identity/package.json packages/identity/
COPY packages/testing/package.json packages/testing/
COPY packages/entole-sdk/package.json packages/entole-sdk/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
RUN bun install --frozen-lockfile --production --filter @entole/api

# Stage 2: runtime with only the workspaces the API imports.
FROM oven/bun:1.4.4 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app /app
COPY packages/shared-kernel/src packages/shared-kernel/src
COPY packages/mandate/src packages/mandate/src
COPY packages/limit-order/src packages/limit-order/src
COPY packages/shopping/src packages/shopping/src
COPY packages/identity/src packages/identity/src
COPY apps/api/src apps/api/src
RUN rm -rf apps/web apps/mcp
# The oven/bun image ships a non-root "bun" user.
USER bun
EXPOSE 8787
CMD ["bun", "apps/api/src/main.ts"]
