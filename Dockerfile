# Build stage
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev --ignore-scripts

# Production stage
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
USER node

# Default: stdio (docker run -i). For remote access over Streamable HTTP a
# non-loopback bind needs a token and a Host allow-list, or the server refuses
# to start:
#   docker run -p 3000:3000 -e MCP_TRANSPORT=http -e HOST=0.0.0.0 \
#     -e MCP_AUTH_TOKEN=<secret> -e MCP_ALLOWED_HOSTS=mcp.example.ch:3000 \
#     ghcr.io/netadvanced/mcp-swiss-ng
# then point clients at http://<host>:3000/mcp (health: /health).
EXPOSE 3000
ENTRYPOINT ["node", "dist/index.js"]
