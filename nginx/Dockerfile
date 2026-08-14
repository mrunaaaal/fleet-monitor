FROM node:20-alpine AS web-build

WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=web-build /app/dist /usr/share/nginx/html
COPY nginx/docker-entrypoint.d/50-generate-certs.sh /docker-entrypoint.d/50-generate-certs.sh
RUN chmod +x /docker-entrypoint.d/50-generate-certs.sh

HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O - http://localhost/healthz || exit 1
