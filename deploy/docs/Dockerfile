# Minimal static image for the Nimbus docs (pre-built Next.js static export in ./out).
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY out /usr/share/nginx/html
EXPOSE 8080
