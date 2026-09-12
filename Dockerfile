FROM node:26.8-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM dependencies AS checks
COPY tsconfig.json tsconfig.build.json vitest.config.ts eslint.config.js .prettierrc.json ./
COPY src ./src
COPY tests ./tests
CMD ["npm", "test"]

FROM node:26.8-alpine AS runtime
ARG VERSION=dev
ARG VCS_REF=unknown
ENV NODE_ENV=production
ENV APP_VERSION=${VERSION}
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scripts/container-healthcheck.mjs ./container-healthcheck.mjs
LABEL org.opencontainers.image.title="Telegram Service Bot" \
      org.opencontainers.image.description="Telegram bot for service applications and managed content" \
      org.opencontainers.image.version=${VERSION} \
      org.opencontainers.image.revision=${VCS_REF} \
      org.opencontainers.image.licenses="MIT"
USER app
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "/app/container-healthcheck.mjs"]
CMD ["node", "dist/index.js"]
