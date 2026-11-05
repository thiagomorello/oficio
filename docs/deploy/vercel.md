# Deploy on Vercel

Short version: **Oficio cannot run on Vercel.** This page explains why, so you do not spend an afternoon trying, and points to platforms that give a similar "connect the repo and go" experience.

| | |
|---|---|
| **What you get** | Nothing usable: Vercel cannot host Oficio's server. |
| **Monthly cost** | Not applicable. |
| **Time needed** | 2 minutes to read this. |
| **Audio/video** | Not possible from Vercel. |
| **Database** | Not applicable. |

## Why it does not fit

Vercel is built for static sites and short-lived serverless or edge functions that answer one HTTP request and exit. Oficio is the opposite kind of program:

1. **A long-lived process.** The server runs the office simulation at 20 Hz and keeps the whole office state (positions, rooms, desks, who is talking) in memory. It must stay running between requests; a function that spins up per request has no memory of the office.
2. **WebSockets.** Every browser keeps a persistent WebSocket (`/ws`) open to that process for the entire session. Vercel functions do not accept inbound WebSocket connections.
3. **MySQL.** Oficio needs a MySQL 8 database and a server that holds a connection pool to it.
4. **UDP for media.** Self-hosted LiveKit needs 7882/udp (and 7881/tcp) open to the internet. Vercel exposes HTTPS only.
5. **One instance.** Even if the above were solved, Oficio runs as exactly one replica by design; serverless platforms scale by running many copies.

None of these are configuration problems; they are the shape of the application. Splitting the frontend onto Vercel and the server elsewhere buys nothing either: the frontend is a few static files the Node server already serves, and the browser would still need the server, the WebSocket and LiveKit to live somewhere else. We do not recommend or document that split.

## What to use instead

If you like Vercel's workflow (connect a repository, get a URL, push to deploy):

| Platform | Guide | Notes |
|---|---|---|
| Railway | [railway.md](railway.md) | Builds from the Dockerfile, MySQL service included, LiveKit Cloud for audio/video. Closest to the Vercel feel. |
| Render | [render.md](render.md) | Blueprint (`render.yaml`), external MySQL, LiveKit Cloud. |
| Fly.io | [fly.md](fly.md) | `fly launch` with the shipped `fly.toml`, external MySQL, LiveKit Cloud. |
| DigitalOcean App Platform | [digitalocean.md](digitalocean.md#path-b-app-platform) | App spec in `.do/app.yaml`, Managed MySQL, LiveKit Cloud. |

If you are fine with a server, a small VPS runs the whole thing, audio/video included, for about the price of a coffee: [docker-compose-vps.md](docker-compose-vps.md).

## Using a domain managed at Vercel

If your DNS happens to be hosted at Vercel (because the domain was bought or transferred there), that is just DNS and works with any of the deployments above:

1. Vercel dashboard: **Domains**, click the domain, **DNS Records**.
2. Add an **A** record `office` pointing to your server's IP (VPS, Droplet), or a **CNAME** `office` pointing to the host name your platform gave you (Railway, Render, Fly, App Platform).
3. For a self-hosted LiveKit add the second **A** record `livekit`.

Nothing else from Vercel is involved. The rest of the setup is in the guide for the platform you chose.
