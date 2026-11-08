# syntax=docker/dockerfile:1
# Safeshelf container image: non-root, production dependencies only,
# Playwright's bundled Chromium headless shell.

ARG NODE_IMAGE=node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    SAFESHELF_NO_SANDBOX=1
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY schema ./schema
COPY LICENSE LICENSE-ADDITIONAL-TERMS.md ./
# Install the headless shell and its system libraries as root, then drop privileges.
RUN node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* /tmp/* /root/.cache \
    && mkdir -p /work && chown node:node /work
USER node
WORKDIR /work
ENTRYPOINT ["node", "/app/dist/cli/bin.js"]
CMD ["--help"]
