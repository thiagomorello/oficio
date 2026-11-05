# Deploy on Kubernetes

A minimal, hand-written set of manifests to run Oficio on an existing Kubernetes cluster. **This is a community-maintained starting point, not a supported distribution**: there is no Helm chart yet (it is on the [roadmap](../roadmap.md)), and the manifests below favour clarity over completeness. If you run Oficio on Kubernetes in production, please share what you changed.

| | |
|---|---|
| **What you get** | Oficio as a single-replica Deployment behind your Ingress controller, with HTTPS from cert-manager (or your ingress's TLS), connecting to a MySQL outside the cluster, and audio/video through LiveKit Cloud or LiveKit's official Helm chart. |
| **Monthly cost** | Whatever your cluster costs; Oficio itself needs about 0.25 vCPU and 512 MB on top of your nodes. Managed MySQL and LiveKit Cloud extra. |
| **Time needed** | 30–45 minutes if the cluster, ingress and cert-manager already work. |
| **Audio/video** | LiveKit Cloud (simple) or the official `livekit/livekit-server` Helm chart with host networking (advanced). |
| **Database** | External MySQL 8: a managed service from your cloud provider or a MySQL you operate (a StatefulSet is out of scope here). |

Assumed: `kubectl` pointed at a cluster with an Ingress controller (examples use ingress-nginx), cert-manager with a `ClusterIssuer` named `letsencrypt`, and a MySQL 8 you can reach from the cluster. Verified against Kubernetes 1.2x APIs (`apps/v1`, `networking.k8s.io/v1`).

## Why one replica and `Recreate`

Oficio keeps the live office state in memory; two Pods would be two separate offices with the same database. So: `replicas: 1`, and `strategy: Recreate` so an update stops the old Pod before starting the new one (a `RollingUpdate` would briefly run two). Users see a few seconds of reconnect during a rollout. The Pod is otherwise stateless: no PersistentVolume is needed (the container writes nothing outside `/tmp`).

## 1. Namespace and Secret

```sh
kubectl create namespace oficio
```

Generate the secrets and create the Secret (replace the MySQL URL and LiveKit values):

```sh
kubectl -n oficio create secret generic oficio-secrets \
  --from-literal=OFFICE_JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=DATABASE_URL="mysql://oficio:PASSWORD@mysql.example.internal:3306/oficio?ssl=true" \
  --from-literal=LIVEKIT_API_KEY="API..." \
  --from-literal=LIVEKIT_API_SECRET="..." \
  --from-literal=METRICS_TOKEN="$(openssl rand -hex 24)"
```

`DATABASE_URL`: special characters in the password must be URL-encoded; TLS parameters depend on the provider ([../database.md](../database.md)). For LiveKit Cloud the key and secret come from the project ([livekit-cloud.md](livekit-cloud.md)); for a self-hosted LiveKit they are the pair you configure in its `keys`.

## 2. ConfigMap, Deployment, Service

Save as `oficio.yaml` and edit the host names and the LiveKit URL:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: oficio-config
  namespace: oficio
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
metadata:
  name: oficio
  namespace: oficio
  labels: { app: oficio }
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels: { app: oficio }
  template:
    metadata:
      labels: { app: oficio }
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000          # the image runs as the "node" user
        fsGroup: 1000
      containers:
        - name: app
          image: ghcr.io/thiagomorello/oficio:latest   # pin a release tag in production, e.g. :1.2.3
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 4747
          envFrom:
            - configMapRef: { name: oficio-config }
            - secretRef: { name: oficio-secrets }
          readinessProbe:
            httpGet: { path: /api/health, port: http }
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /api/health, port: http }
            initialDelaySeconds: 30
            periodSeconds: 30
            failureThreshold: 3
          resources:
            requests: { cpu: 250m, memory: 256Mi }
            limits: { memory: 1Gi }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: { sizeLimit: 64Mi }
---
apiVersion: v1
kind: Service
metadata:
  name: oficio
  namespace: oficio
spec:
  selector: { app: oficio }
  ports:
    - name: http
      port: 80
      targetPort: http
```

Apply and watch:

```sh
kubectl apply -f oficio.yaml
kubectl -n oficio rollout status deployment/oficio
kubectl -n oficio logs deployment/oficio -f
```

Expected: `deployment "oficio" successfully rolled out`, and in the logs the migrations followed by the listening message. Warnings about missing variables point at a typo in the ConfigMap or Secret.

The image is multi-arch (amd64/arm64), so ARM node pools work.

## 3. Ingress with WebSocket support

Oficio's WebSocket at `/ws` is a normal HTTP upgrade; ingress-nginx passes it through, but its default 60 s proxy timeouts would cut idle connections. Raise them:

```yaml
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
  tls:
    - hosts: [office.example.com]
      secretName: oficio-tls
  rules:
    - host: office.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: oficio
                port: { name: http }
```

Point the DNS A record `office.example.com` at your ingress controller's external IP (`kubectl -n ingress-nginx get svc`). Apply, then:

```sh
kubectl apply -f oficio-ingress.yaml
kubectl -n oficio get certificate       # READY True after a minute or two
curl -s https://office.example.com/api/health
```

Expected `{"ok":true,"db":"ok",...,"livekit":true}`.

Other ingress controllers: Traefik and HAProxy handle WebSockets by default; look for their equivalents of the read/write timeouts. `TRUST_PROXY=1` is set so the app reads `X-Forwarded-For` from the ingress for rate limiting. If you use a Cloudflare-proxied host in front of the ingress, that is acceptable for the app host name (not for a self-hosted LiveKit host name).

## 4. First admin

```sh
kubectl -n oficio exec deploy/oficio -- node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
```

Prints `admin created: you@example.com` and a temporary password once. Open `https://office.example.com`, sign in, set a new password. Invite colleagues in **Admin > Users**.

## 5. Audio/video

### Option A: LiveKit Cloud (recommended)

Already wired above: `LIVEKIT_URL` and `LIVEKIT_INTERNAL_URL` in the ConfigMap point at the Cloud project, key and secret in the Secret. Nothing else to run in the cluster. [livekit-cloud.md](livekit-cloud.md).

### Option B: LiveKit's official Helm chart (advanced)

LiveKit publishes a chart at `https://helm.livekit.io` (`livekit/livekit-server`). Its documented Kubernetes model: Pods use **host networking**, so each node runs at most one LiveKit Pod and the node's public IP must accept 7881/tcp and the UDP media port(s) directly; a Redis is required for more than one node; private clusters and serverless node pools are not supported because of the extra NAT layers. Read LiveKit's "Self-hosting > Kubernetes" docs first; the summary here will go stale.

Minimal single-node idea (a `values.yaml`):

```yaml
replicaCount: 1
livekit:
  port: 7880
  rtc:
    tcp_port: 7881
    udp_port: 7882
    use_external_ip: true
  keys:
    APIxxxxxxxxxxxx: your-secret-at-least-32-characters
  room:
    auto_create: true
    empty_timeout: 300
loadBalancer:
  type: disable          # we expose signaling through our own Ingress below
```

```sh
helm repo add livekit https://helm.livekit.io && helm repo update
helm -n oficio install livekit livekit/livekit-server -f values.yaml
```

Then expose signaling with an Ingress for `livekit.example.com` to the chart's Service on port 7880 (same WebSocket timeouts as above, TLS from cert-manager), open 7881/tcp + 7882/udp on the node's firewall/security group, and set in the Oficio ConfigMap `LIVEKIT_URL: wss://livekit.example.com`, `LIVEKIT_INTERNAL_URL: http://livekit-livekit-server.oficio.svc:7880` (check the Service name with `kubectl -n oficio get svc`) and the same key/secret in the Secret. The chart's exact values keys (`loadBalancer`, `livekit.*`) are from LiveKit's examples; verify them against the chart version you install. The reference LiveKit configuration Oficio uses is [`deploy/livekit/livekit.yaml`](../../deploy/livekit/livekit.yaml). More in [../livekit.md](../livekit.md).

## 6. Database

The manifests assume MySQL 8 outside the Deployment. Reasonable choices:

- Your cloud's managed MySQL (Cloud SQL, RDS, DigitalOcean Managed Databases, Azure Database for MySQL) with the cluster's nodes or NAT IP allow-listed and TLS required.
- A MySQL you run elsewhere.
- A MySQL StatefulSet or operator inside the cluster if you already operate one; use a `ClusterIP` Service and put `mysql://oficio:...@mysql.oficio.svc:3306/oficio` in `DATABASE_URL`.

Backups are then the database side's job; `mysqldump` of the `oficio` database is enough to restore anywhere ([../backup-restore.md](../backup-restore.md)). The app's migrations are additive and run at start.

## 7. Updates

Pin the image tag and bump it:

```sh
kubectl -n oficio set image deployment/oficio app=ghcr.io/thiagomorello/oficio:1.2.4
kubectl -n oficio rollout status deployment/oficio
```

`Recreate` stops the old Pod, starts the new one (migrations run), readiness turns green, users reconnect. `kubectl -n oficio rollout undo deployment/oficio` goes back if needed (the schema is additive, so the previous version still works).

## 8. Observability

- `/api/health` is the probe; it also reports `online` (people connected) and `db`.
- `/metrics` (Prometheus) requires `Authorization: Bearer <METRICS_TOKEN>`. A `ServiceMonitor` with `bearerTokenSecret` pointing at `oficio-secrets/METRICS_TOKEN` works with the Prometheus Operator.
- Logs go to stdout as plain lines.

## What is missing from this starting point

- A Helm chart (roadmap), `HorizontalPodAutoscaler` is intentionally absent (single replica), `NetworkPolicy`, `PodDisruptionBudget` (with one replica it would block node drains; choose consciously), and a tested LiveKit-on-Kubernetes recipe. Contributions welcome: open an issue or PR on GitHub.

Troubleshooting Oficio itself: [../troubleshooting.md](../troubleshooting.md).
