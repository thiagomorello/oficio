# Deploy no Coolify

O Coolify é uma plataforma auto-hospedada que faz o deploy de aplicações nos seus próprios servidores a partir de uma interface web, com um proxy Traefik (ou Caddy) próprio cuidando dos domínios e do HTTPS. O Oficio roda no Coolify como um recurso **Docker Compose** com três serviços: `app`, `mysql` e `livekit`. O proxy do Coolify substitui o serviço `caddy` da stack padrão.

| | |
|---|---|
| **O que você obtém** | Oficio, MySQL e um LiveKit auto-hospedado em um servidor que você já gerencia com o Coolify; domínios, TLS, logs, reinícios e redeploys pela interface do Coolify. |
| **Custo mensal** | Só o seu servidor (o Coolify em si é gratuito e open source). Para o Oficio sozinho, 2 GB de RAM bastam para ~15 pessoas; o Coolify acrescenta ~1 GB próprio. |
| **Tempo necessário** | 20–30 minutos. |
| **Áudio/vídeo** | LiveKit auto-hospedado no mesmo compose (portas 7881/7882 publicadas no host). [LiveKit Cloud](livekit-cloud.md) opcional. |
| **Banco de dados** | Container MySQL 8 no mesmo compose, dados em um volume Docker gerenciado pelo Coolify. |

A interface do Coolify muda com frequência; os rótulos abaixo são do Coolify v4 (fim de 2026). Onde um rótulo for diferente, procure o equivalente.

## Por que não usar o `docker-compose.yml` do repositório como está

Três motivos, todos relacionados ao serviço Caddy:

1. O proxy do Coolify já escuta nas portas 80 e 443 do servidor. O `caddy` da stack falharia ao tentar ocupá-las.
2. O Coolify atribui domínios por serviço e gera a configuração do proxy por conta própria; o Caddy é redundante.
3. O Coolify reescreve o arquivo compose que ele implanta (adiciona sua rede, labels e volumes) e não preserva de forma confiável os blocos inline `configs: content:` do Compose. O compose enxuto abaixo configura o LiveKit pela variável de ambiente `LIVEKIT_CONFIG`, exatamente como a stack do Portainer faz.

Portanto, em vez de apontar o Coolify para o repositório, você cola um arquivo compose próprio. Ele é curto.

## Pré-requisitos

- Um servidor com o Coolify instalado e seu proxy em execução (dashboard do Coolify acessível).
- DNS: `office.example.com` e `livekit.example.com` como registros A apontando para o IP público do servidor (`203.0.113.10`). Cloudflare: **DNS only**.
- Firewall (host e provedor): 80/tcp, 443/tcp (o proxy), 7881/tcp e 7882/udp (mídia do LiveKit), 22/tcp (SSH), e a porta 8000/tcp do próprio Coolify restrita ao seu IP.
- Segredos, gerados no seu computador:

  ```sh
  echo "OFFICE_JWT_SECRET=$(openssl rand -hex 32)"
  echo "MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)"
  echo "MYSQL_PASSWORD=$(openssl rand -hex 24)"
  echo "LIVEKIT_API_KEY=API$(openssl rand -hex 6)"
  echo "LIVEKIT_API_SECRET=$(openssl rand -hex 24)"
  ```

## 1. Crie o recurso

1. No Coolify, abra o seu **Project** (ou crie um: **Projects > + Add**) e depois o ambiente (`production`).
2. **+ New Resource**. Em **Docker Based**, escolha **Docker Compose Empty** (um compose que você mesmo cola).
3. Selecione o **Server** e o **Destination** (a rede Docker padrão serve).

## 2. Cole o compose

No editor **Docker Compose**, cole o conteúdo abaixo e clique em **Save**:

```yaml
services:
  app:
    image: ghcr.io/thiagomorello/oficio:${OFICIO_VERSION:-latest}
    restart: unless-stopped
    depends_on:
      mysql:
        condition: service_healthy
    environment:
      - SERVICE_FQDN_APP_4747
      - NODE_ENV=production
      - TZ=${TZ:-UTC}
      - OFFICE_IN_DOCKER=1
      - OFFICE_HOST=0.0.0.0
      - OFFICE_PORT=4747
      - OFFICE_PUBLIC_URL=https://${OFFICE_DOMAIN}
      - OFFICE_ALLOWED_HOSTS=${OFFICE_DOMAIN}
      - OFFICE_COOKIE_SECURE=1
      - TRUST_PROXY=1
      - OFFICE_JWT_SECRET=${OFFICE_JWT_SECRET}
      - OFFICE_APP_NAME=${OFFICE_APP_NAME:-Oficio}
      - OFFICE_LOGO_URL=${OFFICE_LOGO_URL:-}
      - OFFICE_ACCENT_COLOR=${OFFICE_ACCENT_COLOR:-}
      - OFFICE_SIGN_TEXT=${OFFICE_SIGN_TEXT:-}
      - OFFICE_DEFAULT_LOCALE=${OFFICE_DEFAULT_LOCALE:-en}
      - DATABASE_URL=mysql://oficio:${MYSQL_PASSWORD}@mysql:3306/oficio
      - LIVEKIT_URL=wss://${LIVEKIT_DOMAIN}
      - LIVEKIT_INTERNAL_URL=http://livekit:7880
      - LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
      - LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
      - LIVEKIT_ROOM=oficio
      - SENDGRID_API_KEY=${SENDGRID_API_KEY:-}
      - MAIL_FROM=${MAIL_FROM:-}
      - METRICS_TOKEN=${METRICS_TOKEN:-}
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://127.0.0.1:4747/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

  livekit:
    image: livekit/livekit-server:v1.13.11
    restart: unless-stopped
    environment:
      - SERVICE_FQDN_LIVEKIT_7880
      - LIVEKIT_KEYS=${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
      - |
        LIVEKIT_CONFIG=
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
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:7880/ || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3

  mysql:
    image: mysql:8.0
    restart: unless-stopped
    command:
      - "--character-set-server=utf8mb4"
      - "--collation-server=utf8mb4_unicode_ci"
      - "--innodb-buffer-pool-size=256M"
      - "--max-connections=100"
    environment:
      - MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
      - MYSQL_DATABASE=oficio
      - MYSQL_USER=oficio
      - MYSQL_PASSWORD=${MYSQL_PASSWORD}
      - TZ=${TZ:-UTC}
    volumes:
      - mysql-data:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -u root -p$$MYSQL_ROOT_PASSWORD --silent"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

volumes:
  mysql-data:
```

Sobre as duas linhas `SERVICE_FQDN_*`: são as variáveis "mágicas" do Coolify. `SERVICE_FQDN_APP_4747` diz ao Coolify que o serviço `app` quer um domínio roteado para a porta 4747 do container, e `SERVICE_FQDN_LIVEKIT_7880` faz o mesmo para o `livekit` na porta 7880. Depois de salvar, o Coolify mostra um campo **Domains** para cada um desses dois serviços. (O YAML deriva de [`deploy/portainer/stack.yml`](../../../deploy/portainer/stack.yml) sem o Caddy; as opções de hardening de segurança `read_only`, `cap_drop` e `tmpfs` foram deixadas de fora porque a reescrita do compose feita pelo Coolify nem sempre as preserva. Adicione-as de volta se a sua versão do Coolify as mantiver.)

## 3. Domínios

Na página do recurso, o Coolify lista os serviços. Para cada um:

- **app** > **Domains**: `https://office.example.com`
- **livekit** > **Domains**: `https://livekit.example.com`

Use `https://`: é assim que o Coolify sabe que deve solicitar um certificado Let's Encrypt pelo seu proxy. Ignore as sugestões `sslip.io` geradas; o Oficio precisa ser acessado pelo mesmo nome de host que você colocou em `OFFICE_DOMAIN`.

## 4. Variáveis de ambiente

Abra a aba **Environment Variables**. O Coolify já preencheu os nomes `${...}` que encontrou no compose; preencha os valores (ou use **Developer view** para colar linhas `KEY=value`):

| Variável | Valor |
|---|---|
| `OFFICE_DOMAIN` | `office.example.com` |
| `LIVEKIT_DOMAIN` | `livekit.example.com` |
| `LIVEKIT_NODE_IP` | `203.0.113.10` (IP público do servidor; recomendado) |
| `OFFICE_JWT_SECRET` | 64 caracteres hex |
| `MYSQL_ROOT_PASSWORD` | 48 caracteres hex |
| `MYSQL_PASSWORD` | 48 caracteres hex, somente hex |
| `LIVEKIT_API_KEY` | `API` + 12 hex |
| `LIVEKIT_API_SECRET` | 48 caracteres hex |

Opcionais: `OFICIO_VERSION` (tag da imagem, padrão `latest`), `OFFICE_APP_NAME`, `OFFICE_LOGO_URL`, `OFFICE_ACCENT_COLOR`, `OFFICE_SIGN_TEXT`, `OFFICE_DEFAULT_LOCALE` (`en`/`pt-BR`), `SENDGRID_API_KEY` + `MAIL_FROM`, `METRICS_TOKEN`, `TZ`. Deixe as que você não conhece vazias em vez de excluí-las.

Marque os segredos como tal se a sua versão do Coolify oferecer a opção (oculta os valores na interface).

## 5. Deploy

Clique em **Deploy** (canto superior direito). A aba **Deployments** mostra o log: pull das imagens e depois a inicialização dos containers. Aguarde até que os três containers estejam **Running**; o `app` fica **Healthy** cerca de 30 s depois do `mysql`.

Aba **Logs** por serviço: o `app` deve mostrar as migrations e a mensagem de escuta; o `livekit` deve mostrar `starting LiveKit server` com o seu `nodeIP`. O proxy do Coolify obtém os certificados em segundo plano (a primeira visita pode levar um minuto).

Verifique a partir do seu computador:

```sh
curl -s https://office.example.com/api/health      # {"ok":true,"db":"ok",...,"livekit":true}
curl -s https://livekit.example.com/                # OK
```

## 6. Primeiro administrador

No recurso, abra o **Terminal** do serviço **app** (o Coolify oferece um terminal por container; como alternativa, faça `ssh` no servidor e `docker exec -it <app-container> sh`, descobrindo o nome com `docker ps`). Execute:

```sh
node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
```

Copie a senha temporária (mostrada uma única vez), abra `https://office.example.com`, entre e defina a sua senha. Convide pessoas em **Administração > Usuários**.

## 7. Dados persistentes

O volume `mysql-data` guarda tudo. O Coolify o nomeia com o identificador do recurso; encontre-o na aba **Storages** (ou com `docker volume ls` no servidor). **Não** clique em "Delete" no recurso a menos que queira perder o banco de dados; use **Stop** em vez disso.

Backups: os backups agendados nativos do Coolify se aplicam a bancos criados como recursos "Database" do Coolify, não a um MySQL dentro de um compose. Agende um dump no servidor com cron:

```sh
docker exec -e MYSQL_PWD='<MYSQL_ROOT_PASSWORD>' <mysql-container> \
  mysqldump -u root --single-transaction --quick --routines --triggers --hex-blob oficio \
  | gzip -9 > /var/backups/oficio-$(date +%F).sql.gz
```

Alternativa: crie o MySQL como um recurso **Database** separado do Coolify (que ganha o agendador de backups do Coolify e o upload para S3), remova o serviço `mysql` do compose e aponte `DATABASE_URL` para ele (nome de host interno mostrado pelo Coolify). Veja [../database.md](../database.md).

## 8. Atualizações

Com `OFICIO_VERSION` não definido (`latest`), clique em **Redeploy** no recurso: o Coolify faz o pull da imagem mais nova e recria os containers. Para fixar releases, defina `OFICIO_VERSION=1.2.3` e altere quando quiser atualizar. Tags e notas de release: GitHub Releases do repositório. As migrations rodam automaticamente na inicialização.

## 9. LiveKit Cloud em vez do LiveKit incluído

Exclua o serviço `livekit:` do compose, defina `LIVEKIT_URL` e `LIVEKIT_INTERNAL_URL` no serviço `app` como `wss://<project>.livekit.cloud` (substitua as duas linhas que referenciam `LIVEKIT_DOMAIN` / `http://livekit:7880`) e preencha `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` com a chave do projeto Cloud. As portas 7881/7882 podem ser fechadas. [livekit-cloud.md](livekit-cloud.md).

## Solução de problemas

- **O domínio mostra a página "no resource" do Coolify ou um erro de certificado**: o domínio não foi salvo no serviço certo, ou o DNS aponta para outro lugar. Verifique **Domains** em `app` e `livekit`, e `nslookup`.
- **A página de login diz que o serviço está indisponível (503)**: `OFFICE_JWT_SECRET` vazio. Preencha e faça o redeploy.
- **"Origin not allowed" / requisições rejeitadas**: `OFFICE_DOMAIN` difere do domínio que você informou no Coolify. Eles precisam ser exatamente iguais.
- **O áudio não conecta**: 7882/udp não aberta no firewall do provedor, ou `LIVEKIT_NODE_IP` errado. `curl https://livekit.example.com/` deve imprimir `OK`.
- **O LiveKit registra "could not parse config"**: a indentação do bloco `LIVEKIT_CONFIG` foi alterada ao colar. Compare com o YAML acima.
- A documentação do Coolify sobre recursos Docker Compose e variáveis `SERVICE_*` cobre o lado da plataforma; [../troubleshooting.md](../troubleshooting.md) cobre o Oficio.
