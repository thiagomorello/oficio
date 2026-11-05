# Deploy on Kubernetes

Oficio ships a Helm chart in [`deploy/helm/oficio`](../../deploy/helm/oficio) that installs the app as a single-replica Deployment behind your Ingress controller, with an optional MySQL StatefulSet and an optional LiveKit server next to it, or connections to a managed database and LiveKit Cloud instead. This page is the guide for the chart; a shorter section at the end keeps the raw manifests for people who prefer `kubectl apply`.

| | |
|---|---|
| **What you get** | Oficio as a single-replica Deployment (`Recreate`), Service, Ingress with WebSocket-friendly annotations and TLS from cert-manager or your own certificate; MySQL in the cluster or external; audio/video through LiveKit in the cluster (host network or NodePort/LoadBalancer media ports) or LiveKit Cloud. |
| **Monthly cost** | Whatever your cluster costs; Oficio itself needs about 0.25 vCPU and 512 MB on top of your nodes, the bundled MySQL and LiveKit about 0.5 vCPU and 1 GB more. Managed MySQL and LiveKit Cloud extra. |
| **Time needed** | 20–30 minutes if the cluster, Ingress controller and cert-manager already work; add the firewall work for a self-hosted LiveKit. |
| **Audio/video** | LiveKit Cloud (simplest) or the bundled LiveKit (`livekit.enabled`, default on). |
| **Database** | Bundled MySQL 8 StatefulSet (`mysql.enabled`, default on) for a quick start; a managed MySQL 8 for production. |

Assumed: `kubectl` and `helm` 3 pointed at a cluster (Kubernetes 1.25+), an Ingress controller (examples use ingress-nginx; Traefik has its own preset) and, ideally, cert-manager with a `ClusterIssuer`. The image is multi-arch (amd64/arm64), so ARM node pools work.

## Why one replica and `Recreate`

Oficio keeps the live office state in memory; two Pods would be two separate offices with the same database ([architecture](../architecture.md#why-exactly-one-replica)). The chart therefore always renders `replicas: 1` with `strategy: Recreate`: an upgrade stops the old Pod before starting the new one, users see a few seconds of reconnect, nobody has to log in again (sessions are cookies). There is no value to scale out and no HPA; scale **up** with `resources`. The Pod is otherwise stateless: it writes nothing outside a 64 MB `/tmp`.

## 1. Install with the chart

The chart lives in the repository, so clone a release tag and install from the path (publishing to a chart repository is planned):

```sh
git clone --branch v0.1.1 https://github.com/thiagomorello/oficio.git && cd oficio
ls deploy/helm/oficio/examples/
```

Pick a starting point and copy it to `my-values.yaml`:

| Example | What it sets up | When |
|---|---|---|
| `values-minimal.yaml` | MySQL in the cluster + LiveKit Cloud, ingress-nginx, cert-manager | First install, managed Kubernetes without public UDP |
| `values-self-hosted.yaml` | MySQL and LiveKit in the cluster, LiveKit on the host network, two Ingresses | You control the nodes and their firewall |
| `values-external.yaml` | Managed MySQL with TLS, LiveKit Cloud, Traefik, a Secret you manage | Production |

Edit at least the host name(s) and, for LiveKit Cloud, the project URL, key and secret ([livekit-cloud.md](livekit-cloud.md)). Then:

```sh
helm install oficio deploy/helm/oficio -n oficio --create-namespace -f my-values.yaml
kubectl -n oficio rollout status deployment/oficio
kubectl -n oficio logs deployment/oficio -f
```

Expected: `deployment "oficio" successfully rolled out`; in the logs the migrations followed by the listening message. The bundled MySQL takes about a minute on first boot; the app Pod restarts until the database answers, which is normal. The chart's notes (`helm -n oficio get notes oficio`) repeat the next steps with your names filled in.

Point the DNS A record of the office host at your Ingress controller's external IP (`kubectl -n ingress-nginx get svc`), wait for the certificate, then check from outside:

```sh
kubectl -n oficio get certificate            # READY True after a minute or two (cert-manager)
curl -fsS https://office.example.com/api/health   # {"ok":true,"db":"ok",...,"livekit":true}
curl -fsS https://office.example.com/api/config   # the branding you set, no secrets
```

First administrator (prints a temporary password once; it must be changed at first login):

```sh
kubectl -n oficio exec deploy/oficio -- node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
```

Open the office URL, sign in, build an avatar, and test audio/video between two browsers ([livekit.md](../livekit.md)). `livekit: true` in `/api/health` only means the app can reach the LiveKit API.

## 2. Values you will touch

Everything is commented in [`values.yaml`](../../deploy/helm/oficio/values.yaml) and summarised in the [chart README](../../deploy/helm/oficio/README.md). The essentials:

| Key | What it does |
|---|---|
| `image.tag` | Release to run (default: the chart's `appVersion`). Pin it; never `latest`. |
| `ingress.enabled`, `ingress.host`, `ingress.className` | The office Ingress. `ingress.host` is also the default for `OFFICE_PUBLIC_URL` and `OFFICE_ALLOWED_HOSTS`. |
| `ingress.nginx.enabled` / `ingress.traefik.enabled` | Annotation presets (see [Ingress and TLS](#6-ingress-and-tls)). |
| `ingress.certManager.clusterIssuer` | Adds the cert-manager annotation to both Ingresses. |
| `office.appName`, `office.logoUrl`, `office.accentColor`, `office.signText`, `office.defaultLocale`, `office.timezone` | Branding and language ([configuration](../configuration.md)). |
| `secrets.*` / `secrets.existingSecret` | See [Secrets](#3-secrets). |
| `mysql.enabled`, `mysql.persistence.size`, `mysql.external.*` | See [Database](#4-database). |
| `livekit.enabled`, `livekit.publicUrl`, `livekit.hostNetwork`, `livekit.ingress.*`, `livekit.external.url` | See [Audio/video](#5-audiovideo). |
| `resources`, `mysql.resources`, `livekit.resources` | Requests/limits per component. |
| `podDisruptionBudget.enabled` | Off by default on purpose (one replica). |
| `metrics.serviceMonitor.enabled` | Prometheus Operator integration. |

The chart sets `OFFICE_IN_DOCKER=1`, `TRUST_PROXY=1`, `OFFICE_COOKIE_SECURE=1`, `NODE_ENV=production` and the probes on `/api/health` for you. Rendering fails with a clear message when `office.allowedHosts` (or `ingress.host`) is empty, or when the bundled LiveKit has no public `wss://` URL.

## 3. Secrets

The app reads its secrets from one Kubernetes Secret (`envFrom`). Two ways to provide it:

- **Chart-managed (default).** Leave `secrets.jwtSecret`, `secrets.livekitApiKey`, `secrets.livekitApiSecret`, `secrets.metricsToken` and the MySQL passwords empty: the chart generates random values on the first install and **reuses the live values on every upgrade** (it looks the existing Secret up). `helm template` cannot look anything up, so its output shows fresh values every time; that is expected. With LiveKit Cloud paste the project's key and secret into `secrets.livekitApiKey/livekitApiSecret`, or use the next option.
- **Your own Secret** (`secrets.existingSecret: oficio-secrets`). The chart creates no app Secret. Keys: `OFFICE_JWT_SECRET` (required), `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` (for A/V), `DATABASE_URL` or `MYSQL_PASSWORD` (external MySQL), `METRICS_TOKEN`, `SENDGRID_API_KEY`. Works with External Secrets, Sealed Secrets or plain `kubectl create secret` as in `values-external.yaml`.

Back up `Secret/oficio` and `Secret/oficio-mysql` when the chart generated them: losing `OFFICE_JWT_SECRET` signs everyone out, losing the MySQL passwords locks you out of the data. The bundled LiveKit reads the same `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` from the app Secret (`LIVEKIT_KEYS` is built from them), so app and server never disagree.

## 4. Database

**Bundled MySQL** (`mysql.enabled: true`): one StatefulSet with a PersistentVolumeClaim (`mysql.persistence.size`, default 10 GiB, the cluster's default StorageClass unless `mysql.persistence.storageClass` says otherwise), `utf8mb4`, `innodb-buffer-pool-size` from `mysql.bufferPoolSize`. The app connects through `MYSQL_HOST=<release>-mysql` with the password from `Secret/<release>-mysql`. Backups are yours: `kubectl -n oficio exec sts/oficio-mysql -- sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" oficio' > oficio.sql` ([backup-restore.md](../backup-restore.md)).

**External MySQL** (`mysql.enabled: false`), the recommendation for production: a managed MySQL 8 (your cloud's offering with the cluster's egress IPs allow-listed and TLS required) or an operator you already run. Give it as parts (`mysql.external.host/port/database/username` + the password in `mysql.external.password` or, better, `mysql.external.existingSecret`; the app URL-encodes user and password for you) with `mysql.external.ssl: required` for TLS, or as one URL in `mysql.external.databaseUrl` ([database.md](../database.md) for provider notes). For a private or corporate CA, paste the PEM bundle into `mysql.external.sslCa` (the chart stores it in a ConfigMap, mounts it and sets `MYSQL_SSL_CA`) or point `mysql.external.sslCaConfigMap` at a ConfigMap with key `ca.crt`. Migrations are additive and run at every start.

## 5. Audio/video

### Option A: LiveKit Cloud (simplest)

```yaml
livekit:
  enabled: false
  external:
    url: wss://your-project.livekit.cloud
secrets:
  livekitApiKey: API...        # or put LIVEKIT_API_KEY/LIVEKIT_API_SECRET in secrets.existingSecret
  livekitApiSecret: ...
```

`LIVEKIT_URL` and `LIVEKIT_INTERNAL_URL` both point at the Cloud project; nothing else runs in the cluster. [livekit-cloud.md](livekit-cloud.md).

### Option B: bundled LiveKit (`livekit.enabled: true`)

WebRTC media needs UDP (plus a TCP fallback) from browsers to the LiveKit Pod on the ports it announces, which does not fit the Ingress model. The chart offers two ways:

- **`livekit.hostNetwork: true` (default, LiveKit's documented Kubernetes model).** The Pod binds 7880/7881/7882 directly on the node. Open `livekit.rtc.tcpPort` (7881/tcp) and `livekit.rtc.udpPort` (7882/udp) on that node's firewall/security group; keep 7880 closed (signaling goes through the Ingress). `use_external_ip: true` discovers the node's public IP via STUN; set `livekit.rtc.nodeIp` to pin it (overlay networks, several NAT layers). At most one LiveKit Pod per node; pin it with `livekit.nodeSelector` on multi-node clusters. Private clusters and serverless node pools do not work because of the extra NAT.
- **`livekit.hostNetwork: false`.** A second Service `<release>-livekit-rtc` (`livekit.service.type`: `NodePort` or `LoadBalancer`, `externalTrafficPolicy: Local`) forwards the media ports 1:1 to the Pod. With `NodePort` the node port must equal the announced port, so set `livekit.rtc.tcpPort/udpPort` inside the cluster's node-port range (default 30000–32767, e.g. 30881/30882). With `LoadBalancer` set `livekit.rtc.nodeIp` to the load balancer's IP once assigned (STUN would discover the node, not the balancer); mixed TCP+UDP load balancers depend on your cloud.

Signaling (`wss://`) needs TLS: enable `livekit.ingress` with its own host (`livekit.example.com`) and the same cert-manager issuer, or set `livekit.publicUrl` to a TLS endpoint you provide. If the LiveKit host sits behind a CDN/proxy, that record must be *DNS only*: WebRTC needs the real IP. The app gets `LIVEKIT_URL=wss://livekit.example.com` and `LIVEKIT_INTERNAL_URL=http://<release>-livekit:7880` automatically. The LiveKit configuration is rendered to a ConfigMap from `livekit.rtc.*`, `livekit.room.*` and `livekit.logging.*` (same shape as [`deploy/livekit/livekit.yaml`](../../deploy/livekit/livekit.yaml)); `livekit.extraConfig` is deep-merged on top for TURN, port ranges and anything else ([livekit.md](../livekit.md)). Ports below 1024 (TURN/TLS on 443 or 5349) would need extra capabilities; terminate TURN TLS elsewhere or use a higher port.

## 6. Ingress and TLS

Oficio's WebSocket at `/ws` is a plain HTTP upgrade. The presets handle what each controller needs:

- **ingress-nginx** (`ingress.nginx.enabled: true`, default): `proxy-read-timeout`/`proxy-send-timeout` 3600 s so idle WebSockets are not cut after 60 s, `proxy-body-size: 2m`.
- **Traefik** (`ingress.className: traefik`, `ingress.traefik.enabled: true`, `ingress.nginx.enabled: false`): `router.entrypoints: websecure` and `router.tls: "true"`. Traefik proxies WebSockets without extra configuration; idle timeouts live on the entrypoint.
- **Others** (HAProxy, cloud load balancers): disable both presets and add the controller's equivalents in `ingress.annotations`.

TLS: `ingress.tls.enabled` (default on) references `ingress.tls.secretName` (default `<release>-tls`). With `ingress.certManager.clusterIssuer: letsencrypt` cert-manager issues it for both Ingresses; without cert-manager create the Secret yourself (`kubectl create secret tls`) or let your Ingress controller's default certificate serve. HTTPS is mandatory: browsers refuse microphone/camera on plain HTTP and the session cookie is `Secure`. The same ingress-nginx/Traefik annotations are applied to the LiveKit Ingress.

## 7. Upgrade and roll back

```sh
helm upgrade oficio deploy/helm/oficio -n oficio -f my-values.yaml --set image.tag=0.1.1
kubectl -n oficio rollout status deployment/oficio
```

`Recreate` stops the old Pod, starts the new one (migrations run), readiness turns green, users reconnect. Generated secrets are kept. To go back: `helm -n oficio history oficio` then `helm -n oficio rollback oficio <revision>`; the schema is additive, so the previous image still works ([upgrading.md](../upgrading.md)). Changing a value that lands in the ConfigMap or Secret restarts the app Pod automatically (checksum annotations).

## 8. Uninstall

```sh
helm -n oficio uninstall oficio
kubectl -n oficio get pvc            # the MySQL volume survives on purpose
```

Delete the PVC (`data-oficio-mysql-0`) and the namespace only when you are sure; the chart-generated Secrets go away with the release, so export them first if you might come back.

## 9. Observability

- `/api/health` is the probe; it also reports `online` (people connected), `db` and `livekit`.
- `/metrics` (Prometheus) requires `Authorization: Bearer <METRICS_TOKEN>` while `metrics.protect` is on. `metrics.serviceMonitor.enabled: true` creates a `ServiceMonitor` that reads the token from the app Secret (Prometheus Operator CRDs required).
- Logs go to stdout as plain lines.

## Alternative: raw manifests

If you would rather not use Helm, the chart's output is ordinary Kubernetes YAML. The quickest way to get manifests you can `kubectl apply` is to render them (`helm template oficio deploy/helm/oficio -n oficio -f my-values.yaml > oficio.yaml`), review them and commit them. The hand-written minimum, for an external MySQL and LiveKit Cloud, is below.

```sh
kubectl create namespace oficio
kubectl -n oficio create secret generic oficio-secrets \
  --from-literal=OFFICE_JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=DATABASE_URL="mysql://oficio:PASSWORD@mysql.example.internal:3306/oficio?ssl=true" \
  --from-literal=LIVEKIT_API_KEY="API..." \
  --from-literal=LIVEKIT_API_SECRET="..." \
  --from-literal=METRICS_TOKEN="$(openssl rand -hex 24)"
```

```yaml
apiVersion: v1
kind: ConfigMap
metadata: { name: oficio-config, namespace: oficio }
data:
  NODE_ENV: "production"
  OFFICE_IN_DOCKER: "1"
  OFFICE_HOST: "0.0.0.0"
  OFFICE_PORT: "4747"
  OFFICE_PUBLIC_URL: "https://office.example.com"
  OFFICE_ALLOWED_HOSTS: "office.example.com"
  OFFICE_COOKIE_SECURE: "1"
  TRUST_PROXY: "1"
  OFFICE_APP_NAME: "Oficio"
  OFFICE_DEFAULT_LOCALE: "en"
  LIVEKIT_URL: "wss://<project>.livekit.cloud"
  LIVEKIT_INTERNAL_URL: "wss://<project>.livekit.cloud"
  LIVEKIT_ROOM: "oficio"
  TZ: "UTC"
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: oficio, namespace: oficio, labels: { app: oficio } }
spec:
  replicas: 1
  strategy: { type: Recreate }
  selector: { matchLabels: { app: oficio } }
  template:
    metadata: { labels: { app: oficio } }
    spec:
      securityContext: { runAsNonRoot: true, runAsUser: 1000, fsGroup: 1000 }
      containers:
        - name: app
          image: ghcr.io/thiagomorello/oficio:0.1.1
          ports: [{ name: http, containerPort: 4747 }]
          envFrom:
            - configMapRef: { name: oficio-config }
            - secretRef: { name: oficio-secrets }
          readinessProbe: { httpGet: { path: /api/health, port: http }, initialDelaySeconds: 10, periodSeconds: 10 }
          livenessProbe: { httpGet: { path: /api/health, port: http }, initialDelaySeconds: 30, periodSeconds: 30 }
          resources: { requests: { cpu: 250m, memory: 256Mi }, limits: { memory: 1Gi } }
          securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } }
          volumeMounts: [{ name: tmp, mountPath: /tmp }]
      volumes: [{ name: tmp, emptyDir: { sizeLimit: 64Mi } }]
---
apiVersion: v1
kind: Service
metadata: { name: oficio, namespace: oficio }
spec:
  selector: { app: oficio }
  ports: [{ name: http, port: 80, targetPort: http }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: oficio
  namespace: oficio
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-body-size: "2m"
spec:
  ingressClassName: nginx
  tls: [{ hosts: [office.example.com], secretName: oficio-tls }]
  rules:
    - host: office.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend: { service: { name: oficio, port: { name: http } } }
```

`kubectl apply -f oficio.yaml`, then the same checks and `create-admin` command as in section 1. Updates: `kubectl -n oficio set image deployment/oficio app=ghcr.io/thiagomorello/oficio:0.1.1`; keep `replicas: 1` and `Recreate`. For a self-hosted LiveKit without the chart, run it with host networking and the configuration in [`deploy/livekit/livekit.yaml`](../../deploy/livekit/livekit.yaml), expose signaling through an Ingress on port 7880 and set `LIVEKIT_INTERNAL_URL` to its Service ([livekit.md](../livekit.md)).

## What is still missing

`NetworkPolicy` templates, a published chart repository, and reports from real clusters (which Ingress controllers, which clouds, how the media ports behaved). If you run Oficio on Kubernetes in production, please share what you changed through an issue or PR.

Troubleshooting Oficio itself: [../troubleshooting.md](../troubleshooting.md).
