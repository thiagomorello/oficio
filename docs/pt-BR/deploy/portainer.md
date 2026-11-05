# Deploy no Portainer

O Portainer é uma interface web para Docker. O Oficio traz dois arquivos de stack para ele: [`deploy/portainer/stack.yml`](../../../deploy/portainer/stack.yml) para um host Docker **standalone** (inclui Caddy para HTTPS) e [`deploy/portainer/stack-swarm.yml`](../../../deploy/portainer/stack-swarm.yml) para **Docker Swarm** com um Traefik já existente. Os dois são autocontidos: nenhum arquivo do repositório é montado, toda configuração é uma variável de ambiente da stack.

| | |
|---|---|
| **O que você obtém** | A stack completa (app, MySQL, LiveKit auto-hospedado e Caddy ou o seu Traefik) gerenciada pela interface do Portainer: logs, console, restart, redeploy. |
| **Custo mensal** | Só o servidor em que o Portainer roda (veja o [guia de VPS](docker-compose-vps.md#1-escolha-o-tamanho-do-servidor) para dimensionamento). O Portainer Community Edition é gratuito. |
| **Tempo necessário** | 20–30 minutos. |
| **Áudio/vídeo** | LiveKit auto-hospedado na stack; [LiveKit Cloud](livekit-cloud.md) opcional. |
| **Banco de dados** | Container MySQL 8 na stack, dados em um volume Docker. |

Os rótulos da interface são do Portainer CE 2.2x (fim de 2026); edições mais antigas ou a Business podem diferir um pouco.

## Pré-requisitos

- Um host Linux com Docker e Portainer instalados (o quick start do próprio Portainer: um container `portainer/portainer-ce` na porta 9443). Docker Engine 24+ com Compose v2.23+ para a stack standalone (ela usa `configs` inline).
- Dois registros DNS A para o host: `office.example.com` e `livekit.example.com` (Cloudflare: **DNS only**).
- Firewall (host e provedor): 80/tcp, 443/tcp, 7881/tcp, 7882/udp, mais 22/tcp para SSH e 9443/tcp para o Portainer (restrinja essa última ao seu IP, se puder). O MySQL nunca é publicado.
- Segredos gerados no seu computador (qualquer terminal com `openssl`, incluindo o Git Bash no Windows):

  ```sh
  echo "OFFICE_JWT_SECRET=$(openssl rand -hex 32)"
  echo "MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)"
  echo "MYSQL_PASSWORD=$(openssl rand -hex 24)"
  echo "LIVEKIT_API_KEY=API$(openssl rand -hex 6)"
  echo "LIVEKIT_API_SECRET=$(openssl rand -hex 24)"
  echo "METRICS_TOKEN=$(openssl rand -hex 24)"
  ```

  Mantenha `MYSQL_PASSWORD` só com hexadecimais: ela vai embutida em uma URL.

---

## Parte 1: Host Docker standalone (`stack.yml`)

### 1. Adicione a stack

Entre no Portainer, escolha o seu environment (normalmente `local`) e depois **Stacks > + Add stack**.

**Name**: `oficio`.

**Build method**, escolha um:

**Repository** (o Portainer baixa o arquivo do GitHub e pode mantê-lo atualizado):

| Campo | Valor |
|---|---|
| Repository URL | `https://github.com/thiagomorello/oficio` |
| Repository reference | `refs/heads/main` (ou uma tag de release, p. ex. `refs/tags/v1.0.0`) |
| Compose path | `deploy/portainer/stack.yml` |
| Authentication | desligado (repositório público) |

**Web editor** (o YAML é seu): abra [`deploy/portainer/stack.yml`](../../../deploy/portainer/stack.yml) no GitHub, clique em **Raw**, copie tudo e cole no editor. Use este método se quiser editar a stack (por exemplo para remover o `caddy`).

### 2. Variáveis de ambiente

Role até **Environment variables**. Clique em **+ Add an environment variable** para cada linha, ou **Advanced mode** e cole linhas `KEY=value` (uma por linha; é aqui também que fica **Load variables from .env file**, se você preparou um).

Obrigatórias:

| Variável | Valor |
|---|---|
| `OFFICE_DOMAIN` | `office.example.com` |
| `LIVEKIT_DOMAIN` | `livekit.example.com` |
| `ACME_EMAIL` | `you@example.com` (avisos do Let's Encrypt) |
| `OFFICE_JWT_SECRET` | 64 caracteres hex (`openssl rand -hex 32`) |
| `MYSQL_ROOT_PASSWORD` | 48 caracteres hex |
| `MYSQL_PASSWORD` | 48 caracteres hex (somente hex) |
| `LIVEKIT_API_KEY` | `API` + 12 caracteres hex |
| `LIVEKIT_API_SECRET` | 48 caracteres hex |

Recomendada:

| Variável | Valor |
|---|---|
| `LIVEKIT_NODE_IP` | IPv4 público do host (`203.0.113.10`); o LiveKit o anuncia aos navegadores. Sem ele o LiveKit descobre o IP via STUN, o que funciona na maioria dos hosts com uma única interface de rede. |

Opcionais:

| Variável | Padrão | Finalidade |
|---|---|---|
| `OFICIO_VERSION` | `latest` | tag da imagem: `1.2.3`, `1.2`, `latest`, `edge` |
| `OFFICE_APP_NAME` | `Oficio` | nome nos títulos e e-mails |
| `OFFICE_LOGO_URL` | logo embutido | URL absoluta do seu logo |
| `OFFICE_ACCENT_COLOR` | `#7c9cff` | `#rrggbb` |
| `OFFICE_SIGN_TEXT` | nome do app | placa da recepção, máx. 14 caracteres |
| `OFFICE_DEFAULT_LOCALE` | `en` | `en` ou `pt-BR` |
| `SENDGRID_API_KEY`, `MAIL_FROM` | vazio | e-mails de convite / redefinição |
| `METRICS_TOKEN` | vazio (métricas agregadas públicas) | protege `/metrics` |
| `TZ` | `UTC` | fuso horário dos containers |
| `LIVEKIT_TCP_PORT`, `LIVEKIT_UDP_PORT` | `7881`, `7882` | portas do host para a mídia |

A stack deriva o resto sozinha: `OFFICE_PUBLIC_URL=https://$OFFICE_DOMAIN`, `OFFICE_ALLOWED_HOSTS=$OFFICE_DOMAIN`, `LIVEKIT_URL=wss://$LIVEKIT_DOMAIN`, `DATABASE_URL=mysql://oficio:$MYSQL_PASSWORD@mysql:3306/oficio`.

### 3. Deploy

Clique em **Deploy the stack**. O Portainer baixa quatro imagens e inicia os containers; em **Stacks > oficio** você deve ver `app`, `livekit`, `mysql`, `caddy` com status **running** (e **healthy** depois de ~30 s para `app`, `livekit`, `mysql`).

Confira os logs: clique em um container e depois em **Logs**. No `caddy`, espere por `certificate obtained successfully` para os dois domínios; no `app`, as migrations seguidas da mensagem de que está escutando. Se o Caddy registrar `challenge failed`, o DNS ainda não aponta para este host ou a porta 80 está fechada.

De qualquer computador:

```sh
curl -s https://office.example.com/api/health      # {"ok":true,"db":"ok",...,"livekit":true}
curl -s https://livekit.example.com/                # OK
```

### 4. Crie o primeiro admin pelo console

1. **Containers**, clique no container `oficio-app-1` (o nome pode trazer o prefixo da stack).
2. Clique em **Console** (o ícone `>_`), comando `/bin/sh`, usuário `node`, **Connect**.
3. Rode:

   ```sh
   node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
   ```

   Esperado: `admin created: you@example.com` e uma senha temporária, mostrada uma vez. Adicione `--password 'YourOwnPassword'` (8+ caracteres) para escolhê-la você mesmo.
4. Abra `https://office.example.com`, entre, defina uma nova senha, monte o avatar.

Convide a equipe em **Administração > Usuários**. Sem `SENDGRID_API_KEY`, as senhas temporárias são mostradas para você na tela.

### 5. Atualizando

**Método Repository**: abra a stack e, em **Stack details**, clique em **Pull and redeploy**. O Portainer relê o arquivo da stack do GitHub, baixa imagens mais novas (marque **Re-pull image** se for oferecido) e recria os containers alterados. Em **GitOps updates** você também pode ligar **Automatic updates** com **Polling** (o Portainer verifica o repositório em um intervalo e refaz o deploy quando o arquivo mudou; a Community Edition suporta polling, enquanto gatilhos por webhook têm sido um recurso da Business Edition; confira a documentação atual do Portainer). Note que o polling só refaz o deploy quando o *arquivo* da stack muda, não quando uma nova imagem `latest` é publicada; defina `OFICIO_VERSION` com uma tag específica e avance-a, ou use **Pull and redeploy** à mão.

**Método Web editor**: abra a stack, aba **Editor**, altere `OFICIO_VERSION` nas variáveis (ou nada), marque **Re-pull image and redeploy** e clique em **Update the stack**.

As migrations rodam no primeiro início do app depois de uma atualização. Todo mundo é desconectado por alguns segundos e reconecta.

### 6. Backups

`scripts/backup.sh` assume um checkout com `docker compose` e `.env`, então a partir do Portainer use `mysqldump` diretamente no host (cron no host Docker):

```sh
docker exec -e MYSQL_PWD='<MYSQL_ROOT_PASSWORD>' oficio-mysql-1 \
  mysqldump -u root --single-transaction --quick --routines --triggers --hex-blob oficio \
  | gzip -9 > /var/backups/oficio-$(date +%F).sql.gz
```

(Ajuste o nome do container a partir de **Containers**.) Faça backup também dos valores das variáveis de ambiente da sua stack: sem `OFFICE_JWT_SECRET` e `MYSQL_PASSWORD` um dump é difícil de reutilizar. Mais: [../backup-restore.md](../backup-restore.md).

### 7. Proxy reverso já existente no mesmo host (Nginx Proxy Manager, Traefik, Caddy)

Se algo já escuta em 80/443, o Caddy da stack vai falhar ao iniciar. Use o método **Web editor** e:

1. Apague o bloco inteiro do serviço `caddy:` e os volumes `caddy-data`/`caddy-config`, além da entrada `caddyfile` em `configs:`.
2. Torne `app` e `livekit` alcançáveis pelo seu proxy: ou anexe a rede do seu proxy a eles (adicione-a em `networks:` dos dois serviços e declare-a como `external: true`) ou publique-os localmente: `app` com `ports: ["127.0.0.1:4747:4747"]`, `livekit` com um `"127.0.0.1:7880:7880"` extra.
3. No seu proxy, roteie `office.example.com` para `app:4747` (ou `127.0.0.1:4747`) e `livekit.example.com` para `livekit:7880`, com suporte a WebSocket habilitado (Nginx Proxy Manager: ligue **Websockets Support** no proxy host). Deixe `ACME_EMAIL` de fora; o proxy cuida dos certificados. Exemplos: [../reverse-proxy.md](../reverse-proxy.md).

As portas de mídia 7881/tcp e 7882/udp ainda precisam ser publicadas no host pelo serviço `livekit`; elas não passam pelo proxy.

---

## Parte 2: Docker Swarm com Traefik (`stack-swarm.yml`)

Esta stack assume a configuração comum de Portainer + Traefik no Swarm: uma rede overlay externa em que o Traefik escuta, um entrypoint HTTPS e um resolver de certificados Let's Encrypt. Ela não tem Caddy; o Traefik termina o TLS para os dois nomes de host.

### O que é diferente no Swarm

- `app` roda com `replicas: 1` e `update_config.order: stop-first` (o estado do escritório vive em memória).
- As portas de mídia do LiveKit usam `mode: host` (publicadas no nó que roda a task, fora do routing mesh, como o WebRTC exige). **`LIVEKIT_NODE_IP` é obrigatório**: a descoberta via STUN não é confiável através de redes overlay, então a stack fixa `use_external_ip: false` e anuncia esse IP.
- Fixe `livekit` e `mysql` em um nó: descomente as linhas `placement.constraints: ["node.hostname == my-node"]` e coloque o hostname do nó (`docker node ls`). O LiveKit precisa ficar onde suas portas estão abertas, e o MySQL onde seu volume local vive.
- `docker stack deploy` não suporta `configs: content:` inline, então o LiveKit é configurado pela variável de ambiente `LIVEKIT_CONFIG`. Ele também responde UDP apenas através de `172.18.0.0/16` (a faixa padrão da `docker_gwbridge`); altere `ips.includes` se a sua gwbridge usa outra faixa (`docker network inspect docker_gwbridge`).

### Passos

1. **Stacks > + Add stack**, nome `oficio`, build method **Repository** com compose path `deploy/portainer/stack-swarm.yml` (ou cole-o no **Web editor**).
2. Variáveis de ambiente, obrigatórias: `OFFICE_DOMAIN`, `LIVEKIT_DOMAIN`, `LIVEKIT_NODE_IP`, `OFFICE_JWT_SECRET`, `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` (hex), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Integração com o Traefik, altere só se as suas forem diferentes: `TRAEFIK_NETWORK` (padrão `traefik_public`), `TRAEFIK_ENTRYPOINT` (`websecure`), `TRAEFIK_CERTRESOLVER` (`letsencryptresolver`). Variáveis opcionais de marca como na Parte 1.
3. Abra 7881/tcp e 7882/udp no nó que roda o LiveKit (firewall do host e firewall do provedor). 80/443 são do Traefik e já devem estar abertas.
4. **Deploy the stack**. Em **Services** você deve ver `oficio_app`, `oficio_livekit`, `oficio_mysql`, cada um em `1/1`.
5. Confira: `curl https://office.example.com/api/health` e `curl https://livekit.example.com/` (`OK`). O dashboard do Traefik, se você tiver um, mostra os dois routers `oficio` e `oficio-livekit`.
6. Abra um console na task do app: **Services > oficio_app**, clique na task em execução, **Console**, `/bin/sh`, e rode `node dist/server/cli.js create-admin --email you@example.com --name "Your Name"`.

Atualização: **Pull and redeploy** (Repository) ou **Update the stack** (editor). O Swarm para a task antiga do app primeiro e depois inicia a nova.

Backups: `docker exec` no container da task `oficio_mysql`, no nó dela, com o comando `mysqldump` da Parte 1.

---

## LiveKit Cloud em vez do LiveKit incluído

Remova o serviço `livekit:` de qualquer uma das stacks (Web editor) e defina `LIVEKIT_URL` e `LIVEKIT_INTERNAL_URL`, ambos, com a sua URL `wss://<project>.livekit.cloud` e `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` com a chave do projeto. Como as stacks fixam `LIVEKIT_URL: wss://${LIVEKIT_DOMAIN}` e `LIVEKIT_INTERNAL_URL: http://livekit:7880` no ambiente do `app`, altere essas duas linhas para `${LIVEKIT_URL}` e `${LIVEKIT_INTERNAL_URL}` para que as suas variáveis sejam usadas. As portas 7881/7882 podem então ser fechadas. Veja [livekit-cloud.md](livekit-cloud.md).

## Solução de problemas

- **A stack falha com "additional properties 'content' not allowed"**: o Compose do host Docker é mais antigo que v2.23. Atualize o Docker no host (`apt install docker-compose-plugin`) ou use o arquivo do Swarm, que não usa configs inline.
- **`caddy` reinicia em loop, "address already in use"**: as portas 80/443 estão ocupadas por outro proxy. Veja a Parte 1, seção 7.
- **As pessoas não ouvem nada**: 7882/udp fechada no firewall do provedor, ou (Swarm) `LIVEKIT_NODE_IP` errado / LiveKit agendado em um nó onde as portas não estão abertas.
- **O login devolve 503**: `OFFICE_JWT_SECRET` vazio. Confira as variáveis de ambiente da stack e refaça o deploy.
- Mais em [../troubleshooting.md](../troubleshooting.md).
