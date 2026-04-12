FROM node:22-slim

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy application
COPY server.js index.html styles.css ./
COPY public/ ./public/ 2>/dev/null || true
COPY .env.example ./

# Create data directory
RUN mkdir -p data

# Non-root user
RUN addgroup --system app && adduser --system --ingroup app app
RUN chown -R app:app /app
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/status').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
