FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

COPY nginx.conf /etc/nginx/nginx.conf
COPY html /usr/share/nginx/html
COPY docker-entrypoint.d/50-generate-certs.sh /docker-entrypoint.d/50-generate-certs.sh
RUN chmod +x /docker-entrypoint.d/50-generate-certs.sh

HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O - http://localhost/healthz || exit 1
