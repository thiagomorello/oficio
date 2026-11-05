# Roadmap

Where Oficio is likely to go after 0.1. This is a list of directions the maintainers consider valuable and have thought about, **not a set of promises or dates**: items can be reordered, merged or dropped as real deployments teach us what matters. Contributions toward any of them are welcome; open a discussion before starting a large one so the design is agreed first. See [CHANGELOG.md](../CHANGELOG.md) for what has actually shipped.

## Scaling and operations

- **Horizontal scaling.** Today the office state lives in the memory of one process ([why](architecture.md#why-exactly-one-replica)). Moving presence, zone membership and rate limiters to a shared store (Redis pub/sub for the tick fan-out, Redis or MySQL for state) would allow several app replicas, zero-downtime deploys and larger offices. This is the biggest architectural item on the list.
- **Database TLS with a custom CA.** `?ssl=true` / `MYSQL_SSL` already cover providers with public CAs; add a way to point at a private CA bundle ([details](database.md#tls)).
- **Helm chart.** A chart for Kubernetes with the one-replica app, optional bundled MySQL/LiveKit, Ingress with WebSocket annotations and the LiveKit `hostNetwork`/NodePort media ports, replacing the hand-written manifests in the Kubernetes guide.
- **More metrics and structured logs.** Per-zone occupancy, A/V subscription counts and JSON log output for log shippers.

## Identity and access

- **SSO / OIDC.** Sign in with an identity provider (Google Workspace, Microsoft Entra ID, Keycloak, Authentik…) via OpenID Connect, with just-in-time account creation and group-to-admin mapping, next to the existing e-mail/password accounts and the `import-json` sync.
- **Session management for admins.** See and revoke a user's active sessions; configurable session lifetime.

## Languages

- **More languages.** Spanish is the obvious next one given the user base; the i18n layer is ready for it ([how to add a language](i18n.md#adding-a-language)). Right-to-left layout support would come with the first RTL contribution.

## Product

- **Map templates gallery.** A set of ready-made floor plans (small studio, 20-desk open plan, department floor, event hall) selectable from the map editor instead of starting from the single default map, plus import/export of map documents as files.
- **Mobile layout polish.** The office is usable on phones for presence and chat, but the bottom bar, chat panel and avatar editor deserve a layout designed for small screens, and audio behaviour in background tabs needs work.
- **Richer rooms.** Room-level features such as a shared whiteboard link, agenda text on the door, and timed room bookings.
- **Notifications.** Desktop notifications for knocks and mentions when the tab is in the background.

## Shipped from this list

- **TURN automation** (unreleased, on `main`): the `docker-compose.turn.yml` overlay enables LiveKit's embedded TURN over TLS with the certificate Caddy issues for the LiveKit domain, with a cert-wait wrapper for the first boot and two renewal options ([how to use it](livekit.md#turn-when-and-how)). TURN/TLS listens on 5349 because Caddy owns 443; 443 itself still needs a second IP or a separate host.

## Not planned

To set expectations: Oficio intends to stay a focused, self-hostable office with proximity A/V on LiveKit. There are no plans for a hosted SaaS offering run by the project, for a native desktop or mobile app, or for replacing LiveKit with a different media stack.

## How priorities are set

Issues and discussions on GitHub, plus what breaks in real deployments reported through the *Deployment help* template. If one of these items matters to you, say so in the corresponding discussion; a short description of your setup and team size is more useful than a thumbs-up.
