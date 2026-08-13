FROM node:22-alpine

WORKDIR /app

COPY mesh/package.json mesh/package-lock.json* ./mesh/
RUN npm install --prefix mesh --omit=dev --no-audit --no-fund

COPY packages ./packages
COPY mesh ./mesh

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O - http://localhost:3000/health || exit 1

CMD ["node", "mesh/run.js"]
