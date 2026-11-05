# Deploy no Kubernetes

O Oficio traz um Helm chart em [`deploy/helm/oficio`](../../../deploy/helm/oficio) que instala o app como um Deployment de réplica única atrás do seu Ingress controller, com um StatefulSet de MySQL opcional e um servidor LiveKit opcional ao lado, ou, no lugar deles, conexões a um banco gerenciado e ao LiveKit Cloud. Esta página é o guia do chart; uma seção mais curta no final mantém os manifests crus para quem prefere `kubectl apply`.

| | |
|---|---|
| **O que você obtém** | Oficio como Deployment de réplica única (`Recreate`), Service, Ingress com anotações amigáveis a WebSocket e TLS do cert-manager ou do seu próprio certificado; MySQL no cluster ou externo; áudio/vídeo pelo LiveKit no cluster (host network ou portas de mídia via NodePort/LoadBalancer) ou pelo LiveKit Cloud. |
| **Custo mensal** | O que o seu cluster já custa; o Oficio em si precisa de cerca de 0,25 vCPU e 512 MB a mais nos seus nós, o MySQL e o LiveKit incluídos cerca de 0,5 vCPU e 1 GB a mais. MySQL gerenciado e LiveKit Cloud à parte. |
| **Tempo necessário** | 20–30 minutos se o cluster, o Ingress controller e o cert-manager já funcionam; somar o trabalho de firewall para um LiveKit auto-hospedado. |
| **Áudio/vídeo** | LiveKit Cloud (mais simples) ou o LiveKit incluído (`livekit.enabled`, ligado por padrão). |
| **Banco de dados** | StatefulSet de MySQL 8 incluído (`mysql.enabled`, ligado por padrão) para começar rápido; um MySQL 8 gerenciado para produção. |

Pressupostos: `kubectl` e `helm` 3 apontados para um cluster (Kubernetes 1.25+), um Ingress controller (os exemplos usam ingress-nginx; o Traefik tem seu próprio preset) e, idealmente, cert-manager com um `ClusterIssuer`. A imagem é multi-arch (amd64/arm64), então node pools ARM funcionam.

## Por que uma réplica e `Recreate`

O Oficio mantém o estado vivo do escritório em memória; dois Pods seriam dois escritórios separados com o mesmo banco de dados ([arquitetura](../architecture.md#por-que-exatamente-uma-réplica)). Por isso o chart sempre renderiza `replicas: 1` com `strategy: Recreate`: uma atualização para o Pod antigo antes de iniciar o novo, os usuários veem alguns segundos de reconexão, ninguém precisa entrar de novo (as sessões são cookies). Não há valor para escalar horizontalmente nem HPA; escale **para cima** com `resources`. Fora isso o Pod é stateless: não escreve nada fora de um `/tmp` de 64 MB.

## 1. Instalar com o chart

O chart vive no repositório, então clone uma tag de release e instale a partir do caminho (a publicação em um repositório de charts está planejada):

```sh
git clone --branch v0.1.0 https://github.com/thiagomorello/oficio.git && cd oficio
ls deploy/helm/oficio/examples/
```

Escolha um ponto de partida e copie para `my-values.yaml`:

| Exemplo | O que configura | Quando |
|---|---|---|
| `values-minimal.yaml` | MySQL no cluster + LiveKit Cloud, ingress-nginx, cert-manager | Primeira instalação, Kubernetes gerenciado sem UDP público |
| `values-self-hosted.yaml` | MySQL e LiveKit no cluster, LiveKit na host network, dois Ingresses | Você controla os nós e o firewall deles |
| `values-external.yaml` | MySQL gerenciado com TLS, LiveKit Cloud, Traefik, um Secret gerenciado por você | Produção |

Edite pelo menos o(s) host name(s) e, para o LiveKit Cloud, a URL, a chave e o segredo do projeto ([livekit-cloud.md](livekit-cloud.md)). Depois:

```sh
helm install oficio deploy/helm/oficio -n oficio --create-namespace -f my-values.yaml
kubectl -n oficio rollout status deployment/oficio
kubectl -n oficio logs deployment/oficio -f
```

Esperado: `deployment "oficio" successfully rolled out`; nos logs, as migrations seguidas da mensagem de escuta. O MySQL incluído leva cerca de um minuto no primeiro boot; o Pod do app reinicia até o banco responder, o que é normal. As notas do chart (`helm -n oficio get notes oficio`) repetem os próximos passos com os seus nomes preenchidos.

Aponte o registro DNS A do host do escritório para o IP externo do seu Ingress controller (`kubectl -n ingress-nginx get svc`), espere o certificado e verifique de fora:

```sh
kubectl -n oficio get certificate            # READY True depois de um ou dois minutos (cert-manager)
curl -fsS https://office.example.com/api/health   # {"ok":true,"db":"ok",...,"livekit":true}
curl -fsS https://office.example.com/api/config   # a marca que você configurou, sem segredos
```

Primeiro administrador (imprime uma senha temporária uma única vez; ela precisa ser trocada no primeiro login):

```sh
kubectl -n oficio exec deploy/oficio -- node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
```

Abra a URL do escritório, entre, monte um avatar e teste áudio/vídeo entre dois navegadores ([livekit.md](../livekit.md)). `livekit: true` em `/api/health` só significa que o app alcança a API do LiveKit.

## 2. Valores que você vai mexer

Tudo está comentado em [`values.yaml`](../../../deploy/helm/oficio/values.yaml) e resumido no [README do chart](../../../deploy/helm/oficio/README.md). O essencial:

| Chave | O que faz |
|---|---|
| `image.tag` | Release a rodar (padrão: o `appVersion` do chart). Fixe a versão; nunca `latest`. |
| `ingress.enabled`, `ingress.host`, `ingress.className` | O Ingress do escritório. `ingress.host` também é o padrão de `OFFICE_PUBLIC_URL` e `OFFICE_ALLOWED_HOSTS`. |
| `ingress.nginx.enabled` / `ingress.traefik.enabled` | Presets de anotações (veja [Ingress e TLS](#6-ingress-e-tls)). |
| `ingress.certManager.clusterIssuer` | Adiciona a anotação do cert-manager aos dois Ingresses. |
| `office.appName`, `office.logoUrl`, `office.accentColor`, `office.signText`, `office.defaultLocale`, `office.timezone` | Marca e idioma ([configuração](../configuration.md)). |
| `secrets.*` / `secrets.existingSecret` | Veja [Segredos](#3-segredos). |
| `mysql.enabled`, `mysql.persistence.size`, `mysql.external.*` | Veja [Banco de dados](#4-banco-de-dados). |
| `livekit.enabled`, `livekit.publicUrl`, `livekit.hostNetwork`, `livekit.ingress.*`, `livekit.external.url` | Veja [Áudio/vídeo](#5-áudiovídeo). |
| `resources`, `mysql.resources`, `livekit.resources` | Requests/limits por componente. |
| `podDisruptionBudget.enabled` | Desligado por padrão de propósito (uma réplica). |
| `metrics.serviceMonitor.enabled` | Integração com o Prometheus Operator. |

O chart define `OFFICE_IN_DOCKER=1`, `TRUST_PROXY=1`, `OFFICE_COOKIE_SECURE=1`, `NODE_ENV=production` e as probes em `/api/health` por você. A renderização falha com uma mensagem clara quando `office.allowedHosts` (ou `ingress.host`) está vazio, ou quando o LiveKit incluído não tem uma URL `wss://` pública.

## 3. Segredos

O app lê seus segredos de um único Secret do Kubernetes (`envFrom`). Duas formas de fornecê-lo:

- **Gerenciado pelo chart (padrão).** Deixe `secrets.jwtSecret`, `secrets.livekitApiKey`, `secrets.livekitApiSecret`, `secrets.metricsToken` e as senhas do MySQL vazios: o chart gera valores aleatórios na primeira instalação e **reaproveita os valores vivos em todo upgrade** (ele consulta o Secret existente). `helm template` não consegue consultar nada, então a saída dele mostra valores novos a cada vez; isso é esperado. Com o LiveKit Cloud, cole a chave e o segredo do projeto em `secrets.livekitApiKey/livekitApiSecret`, ou use a opção seguinte.
- **Seu próprio Secret** (`secrets.existingSecret: oficio-secrets`). O chart não cria Secret do app. Chaves: `OFFICE_JWT_SECRET` (obrigatória), `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` (para A/V), `DATABASE_URL` ou `MYSQL_PASSWORD` (MySQL externo), `METRICS_TOKEN`, `SENDGRID_API_KEY`. Funciona com External Secrets, Sealed Secrets ou um simples `kubectl create secret`, como em `values-external.yaml`.

Faça backup de `Secret/oficio` e `Secret/oficio-mysql` quando o chart os gerou: perder `OFFICE_JWT_SECRET` desloga todo mundo, perder as senhas do MySQL tranca o acesso aos dados. O LiveKit incluído lê os mesmos `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` do Secret do app (`LIVEKIT_KEYS` é montado a partir deles), então app e servidor nunca discordam.

## 4. Banco de dados

**MySQL incluído** (`mysql.enabled: true`): um StatefulSet com um PersistentVolumeClaim (`mysql.persistence.size`, padrão 10 GiB, a StorageClass padrão do cluster a menos que `mysql.persistence.storageClass` diga outra coisa), `utf8mb4`, `innodb-buffer-pool-size` de `mysql.bufferPoolSize`. O app conecta por `MYSQL_HOST=<release>-mysql` com a senha de `Secret/<release>-mysql`. Os backups são seus: `kubectl -n oficio exec sts/oficio-mysql -- sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" oficio' > oficio.sql` ([backup-restore.md](../backup-restore.md)).

**MySQL externo** (`mysql.enabled: false`), a recomendação para produção: um MySQL 8 gerenciado (a oferta da sua nuvem com os IPs de saída do cluster na allow-list e TLS obrigatório) ou um operator que você já roda. Informe em partes (`mysql.external.host/port/database/username` + a senha em `mysql.external.password` ou, melhor, `mysql.external.existingSecret`; o app faz o URL-encode de usuário e senha por você) com `mysql.external.ssl: required` para TLS, ou como uma única URL em `mysql.external.databaseUrl` ([database.md](../database.md) para notas por provedor). Para uma CA privada ou corporativa, cole o bundle PEM em `mysql.external.sslCa` (o chart o guarda em um ConfigMap, monta e define `MYSQL_SSL_CA`) ou aponte `mysql.external.sslCaConfigMap` para um ConfigMap com a chave `ca.crt`. As migrations são aditivas e rodam a cada início.

## 5. Áudio/vídeo

### Opção A: LiveKit Cloud (mais simples)

```yaml
livekit:
  enabled: false
  external:
    url: wss://your-project.livekit.cloud
secrets:
  livekitApiKey: API...        # ou coloque LIVEKIT_API_KEY/LIVEKIT_API_SECRET em secrets.existingSecret
  livekitApiSecret: ...
```

`LIVEKIT_URL` e `LIVEKIT_INTERNAL_URL` apontam ambos para o projeto no Cloud; nada mais roda no cluster. [livekit-cloud.md](livekit-cloud.md).

### Opção B: LiveKit incluído (`livekit.enabled: true`)

A mídia WebRTC precisa de UDP (mais um fallback TCP) dos navegadores até o Pod do LiveKit nas portas que ele anuncia, o que não cabe no modelo de Ingress. O chart oferece dois caminhos:

- **`livekit.hostNetwork: true` (padrão, o modelo de Kubernetes documentado pelo LiveKit).** O Pod abre 7880/7881/7882 diretamente no nó. Abra `livekit.rtc.tcpPort` (7881/tcp) e `livekit.rtc.udpPort` (7882/udp) no firewall/security group desse nó; mantenha a 7880 fechada (a sinalização passa pelo Ingress). `use_external_ip: true` descobre o IP público do nó via STUN; defina `livekit.rtc.nodeIp` para fixá-lo (redes overlay, várias camadas de NAT). No máximo um Pod do LiveKit por nó; fixe-o com `livekit.nodeSelector` em clusters com vários nós. Clusters privados e node pools serverless não funcionam por causa do NAT extra.
- **`livekit.hostNetwork: false`.** Um segundo Service `<release>-livekit-rtc` (`livekit.service.type`: `NodePort` ou `LoadBalancer`, `externalTrafficPolicy: Local`) encaminha as portas de mídia 1:1 para o Pod. Com `NodePort` a porta do nó precisa ser igual à porta anunciada, então defina `livekit.rtc.tcpPort/udpPort` dentro da faixa de node ports do cluster (padrão 30000–32767, por exemplo 30881/30882). Com `LoadBalancer` defina `livekit.rtc.nodeIp` com o IP do load balancer assim que ele for atribuído (o STUN descobriria o nó, não o balanceador); load balancers mistos TCP+UDP dependem da sua nuvem.

A sinalização (`wss://`) precisa de TLS: habilite `livekit.ingress` com seu próprio host (`livekit.example.com`) e o mesmo issuer do cert-manager, ou defina `livekit.publicUrl` com um endpoint TLS que você fornece. Se o host do LiveKit fica atrás de uma CDN/proxy, esse registro precisa ser *DNS only*: o WebRTC precisa do IP real. O app recebe `LIVEKIT_URL=wss://livekit.example.com` e `LIVEKIT_INTERNAL_URL=http://<release>-livekit:7880` automaticamente. A configuração do LiveKit é renderizada em um ConfigMap a partir de `livekit.rtc.*`, `livekit.room.*` e `livekit.logging.*` (mesmo formato de [`deploy/livekit/livekit.yaml`](../../../deploy/livekit/livekit.yaml)); `livekit.extraConfig` é mesclado por cima para TURN, faixas de porta e o que mais for preciso ([livekit.md](../livekit.md)). Portas abaixo de 1024 (TURN/TLS na 443 ou 5349) exigiriam capabilities extras; termine o TLS do TURN em outro lugar ou use uma porta mais alta.

## 6. Ingress e TLS

O WebSocket do Oficio em `/ws` é um upgrade HTTP comum. Os presets cuidam do que cada controller precisa:

- **ingress-nginx** (`ingress.nginx.enabled: true`, padrão): `proxy-read-timeout`/`proxy-send-timeout` de 3600 s para que WebSockets ociosos não sejam cortados depois de 60 s, `proxy-body-size: 2m`.
- **Traefik** (`ingress.className: traefik`, `ingress.traefik.enabled: true`, `ingress.nginx.enabled: false`): `router.entrypoints: websecure` e `router.tls: "true"`. O Traefik faz proxy de WebSockets sem configuração extra; os timeouts de ociosidade ficam no entrypoint.
- **Outros** (HAProxy, load balancers de nuvem): desligue os dois presets e adicione os equivalentes do controller em `ingress.annotations`.

TLS: `ingress.tls.enabled` (ligado por padrão) referencia `ingress.tls.secretName` (padrão `<release>-tls`). Com `ingress.certManager.clusterIssuer: letsencrypt` o cert-manager emite para os dois Ingresses; sem cert-manager crie o Secret você mesmo (`kubectl create secret tls`) ou deixe o certificado padrão do seu Ingress controller servir. HTTPS é obrigatório: os navegadores recusam microfone/câmera em HTTP puro e o cookie de sessão é `Secure`. As mesmas anotações de ingress-nginx/Traefik são aplicadas ao Ingress do LiveKit.

## 7. Atualizar e voltar atrás

```sh
helm upgrade oficio deploy/helm/oficio -n oficio -f my-values.yaml --set image.tag=0.1.1
kubectl -n oficio rollout status deployment/oficio
```

O `Recreate` para o Pod antigo, inicia o novo (as migrations rodam), a readiness fica verde, os usuários reconectam. Os segredos gerados são mantidos. Para voltar: `helm -n oficio history oficio` e depois `helm -n oficio rollback oficio <revision>`; o schema é aditivo, então a imagem anterior continua funcionando ([upgrading.md](../upgrading.md)). Mudar um valor que vai para o ConfigMap ou o Secret reinicia o Pod do app automaticamente (anotações de checksum).

## 8. Desinstalar

```sh
helm -n oficio uninstall oficio
kubectl -n oficio get pvc            # o volume do MySQL sobrevive de propósito
```

Apague o PVC (`data-oficio-mysql-0`) e o namespace só quando tiver certeza; os Secrets gerados pelo chart somem com a release, então exporte-os antes se puder voltar.

## 9. Observabilidade

- `/api/health` é a probe; também informa `online` (pessoas conectadas), `db` e `livekit`.
- `/metrics` (Prometheus) exige `Authorization: Bearer <METRICS_TOKEN>` enquanto `metrics.protect` está ligado. `metrics.serviceMonitor.enabled: true` cria um `ServiceMonitor` que lê o token do Secret do app (CRDs do Prometheus Operator necessárias).
- Os logs vão para stdout como linhas simples.

## Alternativa: manifests crus

Se preferir não usar Helm, a saída do chart é YAML comum do Kubernetes. O jeito mais rápido de obter manifests para `kubectl apply` é renderizá-los (`helm template oficio deploy/helm/oficio -n oficio -f my-values.yaml > oficio.yaml`), revisar e commitar. O mínimo escrito à mão, para um MySQL externo e LiveKit Cloud, está abaixo.

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
  OFFICE_DEFAULT_LOCALE: "pt-BR"
  LIVEKIT_URL: "wss://<project>.livekit.cloud"
  LIVEKIT_INTERNAL_URL: "wss://<project>.livekit.cloud"
  LIVEKIT_ROOM: "oficio"
  TZ: "America/Sao_Paulo"
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
          image: ghcr.io/thiagomorello/oficio:0.1.0
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

`kubectl apply -f oficio.yaml`, depois as mesmas verificações e o mesmo comando `create-admin` da seção 1. Atualizações: `kubectl -n oficio set image deployment/oficio app=ghcr.io/thiagomorello/oficio:0.1.1`; mantenha `replicas: 1` e `Recreate`. Para um LiveKit auto-hospedado sem o chart, rode-o com host networking e a configuração de [`deploy/livekit/livekit.yaml`](../../../deploy/livekit/livekit.yaml), exponha a sinalização por um Ingress na porta 7880 e defina `LIVEKIT_INTERNAL_URL` com o Service dele ([livekit.md](../livekit.md)).

## O que ainda falta

Templates de `NetworkPolicy`, um repositório de charts publicado e relatos de clusters reais (quais Ingress controllers, quais nuvens, como as portas de mídia se comportaram). Se você roda o Oficio em Kubernetes em produção, por favor compartilhe o que mudou por uma issue ou PR.

Troubleshooting do Oficio em si: [../troubleshooting.md](../troubleshooting.md).
