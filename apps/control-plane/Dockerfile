FROM node:24.16.0-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @sketch-test/control-plane deploy --prod --legacy /deploy

FROM node:24.16.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /deploy/ ./
USER node
EXPOSE 3802
CMD ["node", "--no-strip-types", "dist/main.js"]
