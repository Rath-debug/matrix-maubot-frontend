FROM nginx:1.27-alpine

WORKDIR /app

# Copy everything
COPY . .

# Serve public folder
RUN cp -a /app/public/* /usr/share/nginx/html/

# Copy nginx config template
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

# Railway environment variables
ENV PORT=8080
ENV BACKEND_PLUGIN_URL=https://matrix-maubot-production.up.railway.app/_matrix/maubot/plugin/

EXPOSE 8080
