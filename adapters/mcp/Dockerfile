# The Sess stdio MCP server (@sess.si/mcp), built from source.
#
# Prepared for Glama's sandboxed build and introspection (LISTINGS.md, Glama). Build context is this
# directory (adapters/mcp): it has its own package-lock.json and takes @sess.si/sdk from the npm
# registry at the pinned integrity, so the repository root is not needed.
#
#   docker build -t sess-mcp adapters/mcp
#   docker run --rm -i sess-mcp
#
# No credential is baked in. The server reads SESS_API_KEY only when a tool is first called, so
# initialize and tools/list answer without one; a tool call without it returns NOT_CONFIGURED. To
# use it for real, pass the key at run time: docker run --rm -i -e SESS_API_KEY sess-mcp

# node:24.21.0-bookworm-slim (a qualified Node in compatibility.json), pinned by digest.
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

FROM ${NODE_IMAGE} AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /build/dist ./dist
COPY LICENSE NOTICE ./
USER node
CMD ["node", "/app/dist/bin.js"]
