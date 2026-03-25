# Deploy matrix-maubot-frontend on Railway

## 1) Create services

In the same Railway project, create:

- `matrix-maubot` (backend)
- `matrix-maubot-frontend` (this folder)

Both can be deployed from this repository using each service's **Root Directory** setting.

Suggested root directories:

- backend: `matrix-maubot`
- frontend: `matrix-maubot-frontend`

## 2) Configure frontend environment variables

Set these in the `matrix-maubot-frontend` service:

- `PORT=8080`
- `BACKEND_PLUGIN_URL=http://${{matrix-maubot.RAILWAY_PRIVATE_DOMAIN}}/_matrix/maubot/plugin/`

Notes:

- `BACKEND_PLUGIN_URL` must end with `/`.
- If you use public networking between services, replace it with your backend public URL:
  - example: `https://your-backend.up.railway.app/_matrix/maubot/plugin/`

## 3) Deploy

Railway will detect the Dockerfile in this folder and build it.

No custom start command is required.

## 4) Verify

After deployment, open the frontend service public URL.

- The dashboard should load.
- Widget API calls should go to `/api/*` and be proxied to `BACKEND_PLUGIN_URL`.

If API calls fail, check:

- Backend service is running
- `BACKEND_PLUGIN_URL` is correct and ends with `/`
- Backend is reachable from frontend over the selected network mode

## 5) TLS handshake errors (502)

If logs show SSL handshake failures to upstream, such as:

- `SSL_do_handshake() failed`

Then verify:

- For private networking, use HTTP private domain URL:
  - `http://${{matrix-maubot.RAILWAY_PRIVATE_DOMAIN}}/_matrix/maubot/plugin/`
- For public networking, use your backend HTTPS domain URL:
  - `https://your-backend.up.railway.app/_matrix/maubot/plugin/`

This frontend nginx config now enables upstream SNI and sends the upstream host header, which is required by many HTTPS endpoints.
