FROM nginx:1.27-alpine

WORKDIR /usr/share/nginx/html
COPY . .
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

# Default route for Maubot plugin API; override at runtime as needed.
ENV BACKEND_PLUGIN_URL=http://matrix-maubot:29316/_matrix/maubot/plugin/

EXPOSE 80
