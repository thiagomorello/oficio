# Deploy no Dokploy

O Dokploy é uma plataforma de deploy auto-hospedada (uma interface web sobre Docker e Docker Swarm) com um proxy Traefik embutido que ocupa as portas 80/443 e emite certificados Let's Encrypt. O Oficio roda no Dokploy como um serviço **Compose** com `app`, `mysql` e `livekit`; o Traefik do Dokploy substitui o serviço `caddy` da stack padrão.

| | |
|---|---|
| **O que você obtém** | Oficio, MySQL e um LiveKit auto-hospedado em um servidor que você gerencia com o Dokploy; domínios, TLS, logs, terminal e redeploys pela interface. |
| **Custo mensal** | Só o servidor (o Dokploy é gratuito e open source). 2 GB de RAM para ~15 pessoas mais o consumo do próprio Dokploy; 4 GB é confortável. |
| **Tempo necessário** | 20–30 minutos. |
| **Áudio/vídeo** | LiveKit auto-hospedado no compose (7881/tcp + 7882/udp publicadas no host). [LiveKit Cloud](livekit-cloud.md) opcional. |
| **Banco de dados** | Container MySQL 8 no compose, dados em um volume Docker. |

Os rótulos são do Dokploy no fim de 2026; consulte a documentação do Dokploy se algum menu tiver mudado de lugar.

## Por que um compose colado em vez do arquivo do repositório

O `docker-compose.yml` do repositório inclui o Caddy em 80/443, o que colide com o Traefik do Dokploy, e usa blocos inline `configs: content:` do Compose que a reescrita da plataforma pode não preservar. O Dokploy consegue implantar um compose a partir de um repositório Git, mas o tratamento do `.env` em serviços compose baseados em Git teve arestas (variáveis não carregadas de subdiretórios), então o caminho confiável é o modo **Raw**: cole um compose enxuto e coloque as variáveis na aba **Environment** do Dokploy.

## Pré-requisitos

- Dokploy instalado em um servidor, dashboard acessível (porta 3000 por padrão; restrinja-a ao seu IP).
- Registros DNS A `office.example.com` e `livekit.example.com` apontando para o IP do servidor (`203.0.113.10`). Cloudflare: **DNS only**.
- Firewall (host e provedor): 80/tcp, 443/tcp, 7881/tcp, 7882/udp, 22/tcp. O MySQL permanece interno.
- Segredos gerados localmente:

  ```sh
  echo "OFFICE_JWT_SECRET=$(openssl rand -hex 32)"
  echo "MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)"
  echo "MYSQL_PASSWORD=$(openssl rand -hex 24)"
  echo "LIVEKIT_API_KEY=API$(openssl rand -hex 6)"
  echo "LIVEKIT_API_SECRET=$(openssl rand -hex 24)"
  ```

## 1. Crie o serviço Compose

1. **Projects > Create Project** (nome `oficio`), abra-o.
2. **Create Service > Compose**. Nome: `oficio`. Tipo de compose: **Docker Compose** (não Stack, a menos que você rode o Dokploy em modo Swarm de propósito). **Create**.
3. No serviço, aba **General**, **Provider**: escolha **Raw**.

## 2. Cole o compose

Cole no editor **Compose file** e clique em **Save**:

```yaml
services:
  app:
    image: ghcr.io/thiagomorello/oficio:${OFICIO_VERSION:-latest}
    restart: unless-stopped
    depends_on:
      mysql:
        condition: service_healthy
    environment:
      NODE_ENV: production
      TZ: ${TZ:-UTC}
      OFFICE_IN_DOCKER: "1"
      OFFICE_HOST: 0.0.0.0
      OFFICE_PORT: "4747"
      OFFICE_PUBLIC_URL: https://${OFFICE_DOMAIN}
      OFFICE_ALLOWED_HOSTS: ${OFFICE_DOMAIN}
      OFFICE_COOKIE_SECURE: "1"
      TRUST_PROXY: "1"
      OFFICE_JWT_SECRET: ${OFFICE_JWT_SECRET}
      OFFICE_APP_NAME: ${OFFICE_APP_NAME:-Oficio}
      OFFICE_LOGO_URL: ${OFFICE_LOGO_URL:-}
      OFFICE_ACCENT_COLOR: ${OFFICE_ACCENT_COLOR:-}
      OFFICE_SIGN_TEXT: ${OFFICE_SIGN_TEXT:-}
      OFFICE_DEFAULT_LOCALE: ${OFFICE_DEFAULT_LOCALE:-en}
      DATABASE_URL: mysql://oficio:${MYSQL_PASSWORD}@mysql:3306/oficio
      LIVEKIT_URL: wss://${LIVEKIT_DOMAIN}
      LIVEKIT_INTERNAL_URL: http://livekit:7880
      LIVEKIT_API_KEY: ${LIVEKIT_API_KEY}
      LIVEKIT_API_SECRET: ${LIVEKIT_API_SECRET}
      LIVEKIT_ROOM: oficio
      SENDGRID_API_KEY: ${SENDGRID_API_KEY:-}
      MAIL_FROM: ${MAIL_FROM:-}
      METRICS_TOKEN: ${METRICS_TOKEN:-}
    read_only: true
    tmpfs:
      - /tmp:size=64m
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://127.0.0.1:4747/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    networks: [default, dokploy-network]

  livekit:
    image: livekit/livekit-server:v1.13.11
    restart: unless-stopped
    environment:
      LIVEKIT_KEYS: "${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}"
      LIVEKIT_CONFIG: |
        port: 7880
        rtc:
          tcp_port: 7881
          udp_port: 7882
          use_external_ip: true
          node_ip: ${LIVEKIT_NODE_IP:-}
        turn:
          enabled: false
        room:
          auto_create: true
          empty_timeout: 300
          departure_timeout: 20
        logging:
          level: info
          pion_level: error
    ports:
      - "7881:7881/tcp"
      - "7882:7882/udp"
    read_only: true
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:7880/ || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks: [default, dokploy-network]

  mysql:
    image: mysql:8.0
    restart: unless-stopped
    command:
      - "--character-set-server=utf8mb4"
      - "--collation-server=utf8mb4_unicode_ci"
      - "--innodb-buffer-pool-size=256M"
      - "--max-connections=100"
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: oficio
      MYSQL_USER: oficio
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
      TZ: ${TZ:-UTC}
    volumes:
      - mysql-data:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -u root -p$$MYSQL_ROOT_PASSWORD --silent"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
    networks: [default]

volumes:
  mysql-data:

networks:
  dokploy-network:
    external: true
```

Observações: `dokploy-network` é a rede externa que o Traefik do Dokploy usa para alcançar os containers; `app` e `livekit` entram nela para que os domínios possam ser roteados, `mysql` não. Isto é o [`deploy/portainer/stack.yml`](../../../deploy/portainer/stack.yml) sem o Caddy. O Dokploy pode adicionar labels próprias ao implantar; isso é esperado.

## 3. Variáveis de ambiente

Aba **Environment**. Cole uma linha `KEY=value` por variável:

```
OFFICE_DOMAIN=office.example.com
LIVEKIT_DOMAIN=livekit.example.com
LIVEKIT_NODE_IP=203.0.113.10
OFFICE_JWT_SECRET=<64 hex>
MYSQL_ROOT_PASSWORD=<48 hex>
MYSQL_PASSWORD=<48 hex, hex only>
LIVEKIT_API_KEY=API<12 hex>
LIVEKIT_API_SECRET=<48 hex>
```

Opcionais: `OFICIO_VERSION`, `OFFICE_APP_NAME`, `OFFICE_LOGO_URL`, `OFFICE_ACCENT_COLOR`, `OFFICE_SIGN_TEXT`, `OFFICE_DEFAULT_LOCALE`, `SENDGRID_API_KEY`, `MAIL_FROM`, `METRICS_TOKEN`, `TZ`. **Save**.

## 4. Domínios

Aba **Domains**, **Add Domain**, duas vezes:

| Host | Nome do serviço | Porta do container | HTTPS | Certificado |
|---|---|---|---|---|
| `office.example.com` | `app` | `4747` | ligado | Let's Encrypt |
| `livekit.example.com` | `livekit` | `7880` | ligado | Let's Encrypt |

Path `/` para ambos. O Dokploy escreve os routers do Traefik; upgrades de WebSocket passam pelo Traefik sem configuração extra.

## 5. Deploy

Clique em **Deploy**. A aba **Deployments** transmite o log (pull das imagens, criação dos containers). Depois, em **Logs**, escolha cada serviço: o `mysql` chega a `ready for connections`, o `app` roda as migrations e escuta na 4747, o `livekit` imprime `starting LiveKit server`. Os certificados aparecem na primeira requisição HTTPS (dê ao Traefik até um minuto).

Verifique:

```sh
curl -s https://office.example.com/api/health      # {"ok":true,"db":"ok",...,"livekit":true}
curl -s https://livekit.example.com/                # OK
```

## 6. Primeiro administrador

Aba **Advanced** (ou **Terminal**): escolha o container `app` e abra um shell, ou faça `ssh` no servidor e `docker exec -it $(docker ps -qf name=oficio.*app) sh`. Execute:

```sh
node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
```

Entre em `https://office.example.com` com a senha temporária (mostrada uma única vez), defina uma nova e monte seu avatar. Convide colegas em **Administração > Usuários**.

## 7. Volumes persistentes e backups

`mysql-data` é um volume Docker nomeado (`docker volume ls` no servidor o mostra com o prefixo do nome do projeto compose). **Stop** o mantém; excluir o serviço no Dokploy pode removê-lo, então exporte um dump antes.

Backups: os backups agendados do Dokploy se aplicam aos seus próprios serviços de banco de dados, não a um MySQL dentro de um compose. Duas opções:

- Cron no servidor:

  ```sh
  docker exec -e MYSQL_PWD='<MYSQL_ROOT_PASSWORD>' $(docker ps -qf name=oficio.*mysql) \
    mysqldump -u root --single-transaction --quick --routines --triggers --hex-blob oficio \
    | gzip -9 > /var/backups/oficio-$(date +%F).sql.gz
  ```

- Crie o MySQL como um serviço **Database** do Dokploy (que tem backups agendados para S3), remova o `mysql` do compose e defina `DATABASE_URL` com o host interno que o Dokploy mostra. Veja [../database.md](../database.md).

Guarde também uma cópia das variáveis de ambiente.

## 8. Atualizações

**Redeploy** faz o pull de `latest` (ou da `OFICIO_VERSION` fixada) e recria os containers; as migrations rodam na inicialização. Todo mundo é desconectado por alguns segundos. Para fixar releases, defina `OFICIO_VERSION=1.2.3` em **Environment** e avance a versão de propósito. O **Auto Deploy**/webhooks do Dokploy se aplicam a serviços baseados em Git; no modo Raw, você faz o redeploy manualmente.

## 9. LiveKit Cloud em vez do LiveKit incluído

Remova o serviço `livekit` e o domínio `livekit.example.com`, substitua `LIVEKIT_URL: wss://${LIVEKIT_DOMAIN}` e `LIVEKIT_INTERNAL_URL: http://livekit:7880` no `app` pela sua URL `wss://<project>.livekit.cloud`, e use a chave/segredo de API do projeto Cloud. [livekit-cloud.md](livekit-cloud.md).

## Solução de problemas

- **404 do Traefik no domínio**: o domínio foi anexado ao serviço ou porta errados; verifique **Domains** (`app`/4747, `livekit`/7880) e se ambos os serviços listam `dokploy-network`.
- **`network dokploy-network declared as external, but could not be found`**: o seu Dokploy usa outro nome de rede; rode `docker network ls` no servidor e ajuste o compose.
- **O login retorna 503**: `OFFICE_JWT_SECRET` está vazio em **Environment**.
- **Requisições rejeitadas por causa do nome de host**: `OFFICE_DOMAIN` precisa ser igual ao host que você adicionou em **Domains**.
- **Sem áudio**: 7882/udp fechada no firewall do provedor, ou `LIVEKIT_NODE_IP` não é o IP público.
- [../troubleshooting.md](../troubleshooting.md) para o restante.
