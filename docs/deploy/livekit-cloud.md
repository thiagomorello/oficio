# Deploy on LiveKit Cloud (audio/video only)

Oficio uses [LiveKit](https://livekit.io) for proximity audio, video and screen sharing. By default the compose stack runs your own LiveKit server; this guide swaps it for **LiveKit Cloud**, LiveKit's hosted service, while everything else (the app, the database) stays where you deploy it.

| | |
|---|---|
| **What you get** | Audio/video served by LiveKit's global network; no media ports to open, no `livekit.example.com`, no LiveKit container to run. |
| **Monthly cost** | A free tier exists (as of late 2026 the "Build" plan includes 5,000 participant minutes per month); paid plans start around US$ 50/month with a large included quota and per-minute overage. Check livekit.io/pricing: numbers change. |
| **Time needed** | 10 minutes. |
| **Audio/video** | LiveKit Cloud. |
| **Database** | Unchanged: wherever your Oficio runs. |

When to use it:

- Your hosting platform has **no UDP** (Railway, Render, DigitalOcean App Platform, Fly.io without extra work, most Kubernetes ingress setups).
- You do not want to size and monitor a media server, or your team is spread over several continents (LiveKit Cloud routes each person to a nearby point of presence).
- You are evaluating Oficio and want the fastest path to working audio.

When not to: you need media to stay on your own infrastructure, or usage is far above the free tier and a small VPS is cheaper.

## 1. Create the project

1. Go to **cloud.livekit.io** and sign in (GitHub, Google or e-mail).
2. **Create project**. Name it `oficio`. Pick the plan (start with the free one).
3. In the project, open **Settings** (left menu). The **Project** section shows the **WebSocket URL**: `wss://oficio-abc123.livekit.cloud`. Copy it; this is `LIVEKIT_URL`.

## 2. Create an API key

1. **Settings > Keys** (sometimes labelled **API Keys**) **> Create key**.
2. Give it a description (`oficio server`) and create it.
3. Copy the **API Key** (`APIxxxxxxxxxxxx`) and the **Secret**. The secret is shown once; store it in your password manager.

That key lets the Oficio server mint access tokens and manage the room; it never reaches the browser.

## 3. Configure Oficio

Four variables, the same on every platform:

| Variable | Value |
|---|---|
| `LIVEKIT_URL` | `wss://oficio-abc123.livekit.cloud` (what browsers connect to) |
| `LIVEKIT_INTERNAL_URL` | the same `wss://...` URL (the server's API calls go to LiveKit Cloud too) |
| `LIVEKIT_API_KEY` | the key from step 2 |
| `LIVEKIT_API_SECRET` | the secret from step 2 |

`LIVEKIT_ROOM` stays `oficio` (name of the single room Oficio uses; LiveKit Cloud creates it automatically).

### Docker Compose on a VPS

1. Edit `.env`: set the four variables above. Remove the `LIVEKIT_NODE_IP`, `LIVEKIT_TCP_PORT`, `LIVEKIT_UDP_PORT` lines or leave them; they are ignored without the local server.
2. Disable the local LiveKit service. Create `docker-compose.override.yml` next to `docker-compose.yml`:

   ```yaml
   services:
     livekit:
       deploy:
         replicas: 0
   ```

   `LIVEKIT_DOMAIN` still has to be set in `.env` because the Caddy configuration references it; any name is fine and the DNS record can be deleted. You can also close 7881/tcp and 7882/udp in the firewall.
3. Apply:

   ```sh
   docker compose up -d
   docker compose ps          # no livekit container; app healthy
   curl -s https://office.example.com/api/health   # "livekit":true
   ```

### Portainer, Coolify, Dokploy

Remove the `livekit` service from the stack YAML (and the `ports:` for 7881/7882 with it) and set the four variables in the platform's environment-variables UI. Details in [portainer.md](portainer.md), [coolify.md](coolify.md), [dokploy.md](dokploy.md).

### Railway, Render, Fly.io, DigitalOcean App Platform, Kubernetes

These guides already assume LiveKit Cloud: paste the four variables where each guide says (Railway **Variables**, Render **Environment**, `fly secrets set`, the App Platform spec, a Kubernetes `Secret`).

## 4. Test

1. `GET https://office.example.com/api/health` must report `"livekit":true` (it only checks that a key is configured).
2. Sign in with two browsers (or a colleague), walk next to each other and allow the microphone. Speak: you should hear each other within a second.
3. In the LiveKit Cloud dashboard, **Sessions** shows the room `oficio` with the connected participants while people are in a call; this confirms the key and URL are right.
4. For a network-level check from any computer, open **livekit.io/connection-test**, paste the `wss://` URL and a token. You can generate a token in the Cloud dashboard (**Settings > Keys > Generate token** on a key) or with the `lk` CLI: `lk token create --api-key APIxxx --api-secret ... --join --room oficio --identity test`. The page reports whether signaling, TURN and UDP/TCP media reach the service from your network.

## 5. Limits and what to watch

- **Minutes**: LiveKit bills per participant-minute connected to a room. Oficio connects a person to the room only while they are near someone (or inside a meeting room), so idle time at a desk does not count. Watch **Usage** in the dashboard the first weeks and compare with the plan.
- **Concurrency**: the free tier caps concurrent participants; see **Settings > Quotas** (or the quotas page in LiveKit's docs) for the current value.
- **Regions**: LiveKit Cloud is a global mesh; you do not pick a region. Each participant connects to the closest edge.
- **Firewall-friendly**: LiveKit Cloud includes TURN over TLS on port 443, so people on restrictive corporate networks usually connect without any change on your side.
- **Key rotation**: create a second key, update `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`, redeploy, then delete the old key in the dashboard.

## 6. Moving back to self-hosted LiveKit

1. Make sure `livekit.example.com` resolves to the server and 7881/tcp + 7882/udp are open.
2. In `.env`: `LIVEKIT_URL=wss://livekit.example.com`, `LIVEKIT_INTERNAL_URL=http://livekit:7880`, and generate a fresh key pair: `LIVEKIT_API_KEY=API$(openssl rand -hex 6)`, `LIVEKIT_API_SECRET=$(openssl rand -hex 24)` (the same pair is passed to the LiveKit container by the compose file).
3. Delete the `livekit` block from `docker-compose.override.yml` (or the whole file if that was its only content).
4. `docker compose up -d`, then `curl https://livekit.example.com/` should print `OK`.

Users do not need to do anything: the browser receives the new URL and a new token on its next connection.

More on ports, TURN and sizing a self-hosted server: [../livekit.md](../livekit.md).
