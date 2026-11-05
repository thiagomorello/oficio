# Deploy no Kubernetes

Um conjunto mínimo de manifests escritos à mão para rodar o Oficio em um cluster Kubernetes já existente. **Este é um ponto de partida mantido pela comunidade, não uma distribuição com suporte**: ainda não há Helm chart (está no [roadmap](../roadmap.md)), e os manifests abaixo priorizam clareza em vez de completude. Se você roda o Oficio em Kubernetes em produção, por favor compartilhe o que mudou.

| | |
|---|---|
| **O que você obtém** | Oficio como um Deployment de réplica única atrás do seu Ingress controller, com HTTPS do cert-manager (ou do TLS do seu ingress), conectando a um MySQL fora do cluster, e áudio/vídeo pelo LiveKit Cloud ou pelo Helm chart oficial do LiveKit. |
| **Custo mensal** | O que o seu cluster já custa; o Oficio em si precisa de cerca de 0,25 vCPU e 512 MB a mais nos seus nós. MySQL gerenciado e LiveKit Cloud à parte. |
| **Tempo necessário** | 30–45 minutos se o cluster, o ingress e o cert-manager já funcionam. |
| **Áudio/vídeo** | LiveKit Cloud (simples) ou o Helm chart oficial `livekit/livekit-server` com host networking (avançado). |
| **Banco de dados** | MySQL 8 externo: um serviço gerenciado do seu provedor de nuvem ou um MySQL que você opera (um StatefulSet está fora do escopo aqui). |

Pressupostos: `kubectl` apontado para um cluster com um Ingress controller (os exemplos usam ingress-nginx), cert-manager com um `ClusterIssuer` chamado `letsencrypt`, e um MySQL 8 acessível a partir do cluster. Verificado contra as APIs do Kubernetes 1.2x (`apps/v1`, `networking.k8s.io/v1`).

## Por que uma réplica e `Recreate`

O Oficio mantém o estado vivo do escritório em memória; dois Pods seriam dois escritórios separados com o mesmo banco de dados. Portanto: `replicas: 1`, e `strategy: Recreate` para que uma atualização pare o Pod antigo antes de iniciar o novo (um `RollingUpdate` rodaria dois por um breve momento). Os usuários veem alguns segundos de reconexão durante um rollout. Fora isso o Pod é stateless: nenhum PersistentVolume é necessário (o container não escreve nada fora de `/tmp`).

## 1. Namespace e Secret

```sh
kubectl create namespace oficio
```

Gere os secrets e crie o Secret (substitua a URL do MySQL e os valores do LiveKit):

```sh
kubectl -n oficio create secret generic oficio-secrets \
  --from-literal=OFFICE_JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=DATABASE_URL="mysql://oficio:PASSWORD@mysql.example.internal:3306/oficio?ssl=true" \
  --from-literal=LIVEKIT_API_KEY="API..." \
  --from-literal=LIVEKIT_API_SECRET="..." \
  --from-literal=METRICS_TOKEN="$(openssl rand -hex 24)"
```

`DATABASE_URL`: caracteres especiais na senha precisam estar URL-encoded; os parâmetros de TLS dependem do provedor ([../database.md](../database.md)). Para o LiveKit Cloud a chave e o secret vêm do projeto ([livekit-cloud.md](livekit-cloud.md)); para um LiveKit auto-hospedado são o par que você configura em `keys`.

## 2. ConfigMap, Deployment, Service

Salve como `oficio.yaml` e edite os nomes de host e a URL do LiveKit:

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

Aplique e acompanhe:

```sh
kubectl apply -f oficio.yaml
kubectl -n oficio rollout status deployment/oficio
kubectl -n oficio logs deployment/oficio -f
```

Esperado: `deployment "oficio" successfully rolled out`, e nos logs as migrações seguidas da mensagem de escuta. Avisos sobre variáveis ausentes apontam para um erro de digitação no ConfigMap ou no Secret.

A imagem é multi-arch (amd64/arm64), então node pools ARM funcionam.

## 3. Ingress com suporte a WebSocket

O WebSocket do Oficio em `/ws` é um upgrade HTTP comum; o ingress-nginx o deixa passar, mas seus timeouts de proxy padrão de 60 s cortariam conexões ociosas. Aumente-os:

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

Aponte o registro DNS A `office.example.com` para o IP externo do seu ingress controller (`kubectl -n ingress-nginx get svc`). Aplique e então:

```sh
kubectl apply -f oficio-ingress.yaml
kubectl -n oficio get certificate       # READY True after a minute or two
curl -s https://office.example.com/api/health
```

Esperado `{"ok":true,"db":"ok",...,"livekit":true}`.

Outros ingress controllers: Traefik e HAProxy lidam com WebSockets por padrão; procure os equivalentes deles para os timeouts de leitura/escrita. `TRUST_PROXY=1` está definido para que o app leia `X-Forwarded-For` do ingress para o rate limiting. Se você usa um host com proxy da Cloudflare na frente do ingress, isso é aceitável para o nome de host do app (não para o nome de host de um LiveKit auto-hospedado).

## 4. Primeiro administrador

```sh
kubectl -n oficio exec deploy/oficio -- node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
```

Imprime `admin created: you@example.com` e uma senha temporária uma única vez. Abra `https://office.example.com`, entre, defina uma nova senha. Convide colegas em **Administração > Usuários**.

## 5. Áudio/vídeo

### Opção A: LiveKit Cloud (recomendado)

Já está ligado acima: `LIVEKIT_URL` e `LIVEKIT_INTERNAL_URL` no ConfigMap apontam para o projeto do Cloud, chave e secret no Secret. Nada mais para rodar no cluster. [livekit-cloud.md](livekit-cloud.md).

### Opção B: Helm chart oficial do LiveKit (avançado)

O LiveKit publica um chart em `https://helm.livekit.io` (`livekit/livekit-server`). Seu modelo documentado para Kubernetes: os Pods usam **host networking**, então cada nó roda no máximo um Pod do LiveKit e o IP público do nó precisa aceitar 7881/tcp e a(s) porta(s) UDP de mídia diretamente; um Redis é obrigatório para mais de um nó; clusters privados e node pools serverless não são suportados por causa das camadas extras de NAT. Leia primeiro a documentação "Self-hosting > Kubernetes" do LiveKit; o resumo aqui vai ficar desatualizado.

Ideia mínima de nó único (um `values.yaml`):

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

Depois exponha o signaling com um Ingress para `livekit.example.com` apontando ao Service do chart na porta 7880 (mesmos timeouts de WebSocket acima, TLS do cert-manager), abra 7881/tcp + 7882/udp no firewall/security group do nó, e defina no ConfigMap do Oficio `LIVEKIT_URL: wss://livekit.example.com`, `LIVEKIT_INTERNAL_URL: http://livekit-livekit-server.oficio.svc:7880` (confira o nome do Service com `kubectl -n oficio get svc`) e o mesmo par chave/secret no Secret. As chaves exatas dos values do chart (`loadBalancer`, `livekit.*`) vêm dos exemplos do LiveKit; verifique-as contra a versão do chart que você instalar. A configuração de referência do LiveKit que o Oficio usa é [`deploy/livekit/livekit.yaml`](../../../deploy/livekit/livekit.yaml). Mais em [../livekit.md](../livekit.md).

## 6. Banco de dados

Os manifests assumem um MySQL 8 fora do Deployment. Escolhas razoáveis:

- O MySQL gerenciado da sua nuvem (Cloud SQL, RDS, DigitalOcean Managed Databases, Azure Database for MySQL) com os nós do cluster ou o IP de NAT na lista de permitidos e TLS obrigatório.
- Um MySQL que você roda em outro lugar.
- Um StatefulSet ou operator de MySQL dentro do cluster, se você já opera um; use um Service `ClusterIP` e coloque `mysql://oficio:...@mysql.oficio.svc:3306/oficio` em `DATABASE_URL`.

Os backups passam a ser responsabilidade do lado do banco; um `mysqldump` do banco `oficio` basta para restaurar em qualquer lugar ([../backup-restore.md](../backup-restore.md)). As migrações do app são aditivas e rodam na inicialização.

## 7. Atualizações

Fixe a tag da imagem e avance-a:

```sh
kubectl -n oficio set image deployment/oficio app=ghcr.io/thiagomorello/oficio:1.2.4
kubectl -n oficio rollout status deployment/oficio
```

`Recreate` para o Pod antigo, inicia o novo (as migrações rodam), o readiness fica verde, os usuários reconectam. `kubectl -n oficio rollout undo deployment/oficio` volta atrás se preciso (o schema é aditivo, então a versão anterior continua funcionando).

## 8. Observabilidade

- `/api/health` é a probe; também reporta `online` (pessoas conectadas) e `db`.
- `/metrics` (Prometheus) exige `Authorization: Bearer <METRICS_TOKEN>`. Um `ServiceMonitor` com `bearerTokenSecret` apontando para `oficio-secrets/METRICS_TOKEN` funciona com o Prometheus Operator.
- Os logs vão para o stdout como linhas simples.

## O que falta neste ponto de partida

- Um Helm chart (roadmap); `HorizontalPodAutoscaler` está intencionalmente ausente (réplica única); `NetworkPolicy`; `PodDisruptionBudget` (com uma réplica ele bloquearia drains de nó; escolha conscientemente); e uma receita testada de LiveKit no Kubernetes. Contribuições são bem-vindas: abra uma issue ou um PR no GitHub.

Solução de problemas do Oficio em si: [../troubleshooting.md](../troubleshooting.md).
