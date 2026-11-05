# Oficio Helm chart

Deploys [Oficio](https://github.com/thiagomorello/oficio), a self-hosted virtual office with proximity audio/video, on Kubernetes:

- the app as a **single-replica** Deployment (`strategy: Recreate`; the office state lives in process memory, see [docs/architecture.md](../../../docs/architecture.md#why-exactly-one-replica)), Service, optional Ingress with WebSocket-friendly annotations for ingress-nginx and Traefik, probes on `/api/health`, hardened security context;
- an optional **MySQL 8** StatefulSet with a PersistentVolumeClaim (`mysql.enabled`, default on), or a connection to an external MySQL (`mysql.external.*`, TLS via `MYSQL_SSL`);
- an optional **LiveKit** server (`livekit.enabled`, default on) with its configuration rendered to a ConfigMap, media ports on the host network or through a NodePort/LoadBalancer Service, and an Ingress for signaling; or `livekit.external.url` for LiveKit Cloud;
- secrets generated on first install and **kept across upgrades**, or your own Secret via `secrets.existingSecret`.

Full guide: [docs/deploy/kubernetes.md](../../../docs/deploy/kubernetes.md) (English) / [docs/pt-BR/deploy/kubernetes.md](../../../docs/pt-BR/deploy/kubernetes.md) (Portuguese).

## Install

The chart is distributed in the repository (`deploy/helm/oficio`). Clone a release tag and install from the path:

```sh
git clone --branch v0.1.1 https://github.com/thiagomorello/oficio.git && cd oficio
cp deploy/helm/oficio/examples/values-minimal.yaml my-values.yaml   # edit: host, LiveKit Cloud URL/key/secret
helm install oficio deploy/helm/oficio -n oficio --create-namespace -f my-values.yaml
kubectl -n oficio rollout status deployment/oficio
kubectl -n oficio exec deploy/oficio -- node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
```

Starting points in [`examples/`](examples/):

| File | What it sets up |
|---|---|
| `values-minimal.yaml` | MySQL in the cluster + LiveKit Cloud. Only HTTPS has to reach the cluster. |
| `values-self-hosted.yaml` | MySQL and LiveKit in the cluster, LiveKit on the host network (7881/tcp + 7882/udp open on the node), two Ingresses with cert-manager. |
| `values-external.yaml` | Managed MySQL with TLS, LiveKit Cloud, Traefik, every secret in a Secret you manage. |

Rendering fails on purpose when `office.allowedHosts` (or `ingress.host`) is empty, or when the bundled LiveKit has no public `wss://` URL.

## Upgrade, roll back, uninstall

```sh
helm upgrade oficio deploy/helm/oficio -n oficio -f my-values.yaml --set image.tag=0.1.1
helm -n oficio history oficio && helm -n oficio rollback oficio 1     # migrations are additive, rolling back the image is safe
helm -n oficio uninstall oficio                                      # keeps the MySQL PVC and nothing else; delete it yourself if you mean it
```

Back up `Secret/<release>` (and `Secret/<release>-mysql`) when the chart generated them: losing `OFFICE_JWT_SECRET` signs everyone out, losing the MySQL passwords locks you out of the data.

## Values

Every value is commented in [`values.yaml`](values.yaml). The ones you will actually touch:

| Key | Default | Description |
|---|---|---|
| `image.repository` / `image.tag` | `ghcr.io/thiagomorello/oficio` / chart `appVersion` | Pin a release tag, never `latest`. |
| `ingress.enabled` | `false` | Create the app Ingress. |
| `ingress.className` | `nginx` | IngressClass. |
| `ingress.host` | `""` | Host name of the office. Default for `office.publicUrl` and `office.allowedHosts`. |
| `ingress.nginx.enabled` | `true` | ingress-nginx annotations: proxy read/send timeouts 3600 s (idle WebSockets), body size 2m. |
| `ingress.traefik.enabled` | `false` | Traefik annotations: `router.entrypoints` (`ingress.traefik.entrypoints`, default `websecure`) and `router.tls`. |
| `ingress.tls.enabled` / `ingress.tls.secretName` | `true` / `<release>-tls` | TLS block of the Ingress. |
| `ingress.certManager.clusterIssuer` / `.issuer` | `""` | Adds the cert-manager annotation to both Ingresses. |
| `ingress.annotations` | `{}` | Extra annotations, merged last. |
| `office.publicUrl` | `https://<ingress.host>` | `OFFICE_PUBLIC_URL` (links in e-mails). |
| `office.allowedHosts` | `<ingress.host>` | `OFFICE_ALLOWED_HOSTS` (Host/Origin guard). Required. |
| `office.appName`, `office.logoUrl`, `office.accentColor`, `office.signText`, `office.defaultLocale` | `Oficio`, `""`, `""`, `""`, `en` | Branding (`OFFICE_APP_NAME`, `OFFICE_LOGO_URL`, `OFFICE_ACCENT_COLOR`, `OFFICE_SIGN_TEXT`, `OFFICE_DEFAULT_LOCALE`). |
| `office.timezone` | `UTC` | `TZ` for the app and the bundled MySQL. |
| `office.cookieSecure` / `office.trustProxy` | `true` / `true` | `OFFICE_COOKIE_SECURE`, `TRUST_PROXY`. |
| `office.livekitRoom` | `oficio` | `LIVEKIT_ROOM`. |
| `office.mailFrom` | `""` | `MAIL_FROM` (needed with `secrets.sendgridApiKey`). |
| `office.extraEnv` / `office.extraEnvFrom` | `[]` | Extra environment for the app container. |
| `secrets.existingSecret` | `""` | Use your own Secret (keys `OFFICE_JWT_SECRET`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `DATABASE_URL` or `MYSQL_PASSWORD`, `METRICS_TOKEN`, `SENDGRID_API_KEY`). The chart then creates no app Secret. |
| `secrets.jwtSecret`, `secrets.livekitApiKey`, `secrets.livekitApiSecret`, `secrets.metricsToken` | `""` | Empty = generated on first install and reused on upgrades (`lookup`). |
| `secrets.sendgridApiKey` | `""` | Enables invite / password-reset e-mails. |
| `metrics.protect` | `true` | Require `Authorization: Bearer <METRICS_TOKEN>` on `/metrics`. |
| `metrics.serviceMonitor.enabled` | `false` | ServiceMonitor for the Prometheus Operator (reads the token from the Secret). |
| `mysql.enabled` | `true` | Bundled MySQL 8 StatefulSet. Prefer a managed database in production. |
| `mysql.auth.database` / `.username` / `.password` / `.rootPassword` | `oficio` / `oficio` / generated / generated | Credentials of the bundled MySQL. |
| `mysql.auth.existingSecret` | `""` | Secret with `mysql-password` and `mysql-root-password`. |
| `mysql.persistence.enabled` / `.size` / `.storageClass` / `.existingClaim` | `true` / `10Gi` / `""` / `""` | Storage of the bundled MySQL. |
| `mysql.bufferPoolSize` / `mysql.maxConnections` | `256M` / `100` | `innodb-buffer-pool-size`, `max-connections`. |
| `mysql.external.databaseUrl` | `""` | Full `DATABASE_URL` for an external MySQL (wins over the parts). |
| `mysql.external.host` / `.port` / `.database` / `.username` / `.password` | `""` / `3306` / `oficio` / `oficio` / `""` | External MySQL as `MYSQL_*` parts (the app URL-encodes them). |
| `mysql.external.existingSecret` / `.existingSecretKey` | `""` / `mysql-password` | Secret holding the external password. |
| `mysql.external.ssl` | `""` | `MYSQL_SSL`: `required` or `skip-verify` (both forms). |
| `mysql.external.sslCa` / `.sslCaConfigMap` | `""` / `""` | CA bundle for a private/corporate CA (`MYSQL_SSL_CA`): PEM pasted into values (stored in a ConfigMap) or an existing ConfigMap with key `ca.crt`. |
| `livekit.enabled` | `true` | Bundled LiveKit server. |
| `livekit.publicUrl` | `wss://<livekit.ingress.host>` | `LIVEKIT_URL` browsers use. Required with the bundled LiveKit. |
| `livekit.hostNetwork` | `true` | Bind media ports on the node (one LiveKit Pod per node, open the ports on the node). |
| `livekit.rtc.tcpPort` / `.udpPort` | `7881` / `7882` | Media ports announced in ICE candidates. In NodePort mode use values inside the node-port range. |
| `livekit.rtc.useExternalIp` / `.nodeIp` | `true` / `""` | Discover the public IP via STUN, or pin it. |
| `livekit.service.type` / `.externalTrafficPolicy` / `.loadBalancerIP` | `NodePort` / `Local` / `""` | The media Service when `hostNetwork=false`. |
| `livekit.room.*`, `livekit.logging.*` | see values | `room` and `logging` sections of `livekit.yaml`. |
| `livekit.extraConfig` | `{}` | Deep-merged into `livekit.yaml` (TURN, port ranges, ...). |
| `livekit.ingress.enabled` / `.host` / `.className` / `.tls.*` / `.annotations` | `false` / `""` / app class / on / `{}` | Ingress for LiveKit signaling (`wss://`). |
| `livekit.external.url` / `.internalUrl` | `""` / `= url` | LiveKit Cloud or a LiveKit elsewhere, when `livekit.enabled=false`. |
| `service.type` / `service.port` | `ClusterIP` / `80` | App Service. |
| `resources`, `livekit.resources`, `mysql.resources` | see values | Requests and limits per component. |
| `podDisruptionBudget.enabled` | `false` | Off on purpose: with one replica `minAvailable: 1` blocks node drains. |
| `podAnnotations`, `podLabels`, `nodeSelector`, `tolerations`, `affinity`, `priorityClassName` | empty | Scheduling knobs for the app (`livekit.*` and `mysql.*` have their own). |
| `podSecurityContext`, `securityContext` | non-root uid 1000, read-only root fs, no capabilities | Pod and container security context of the app. |

## Development

```sh
helm lint deploy/helm/oficio
for f in deploy/helm/oficio/examples/*.yaml; do helm template oficio deploy/helm/oficio -n oficio -f "$f" > /dev/null; done
```

CI runs the same plus `kubeconform -strict` on the rendered output.
