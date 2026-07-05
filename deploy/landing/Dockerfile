# Minimal static image for the Nimbus landing page (pre-built Vite SPA in ./dist).
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html
EXPOSE 8080
