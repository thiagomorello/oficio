# Deploy em um VPS com Docker Compose

Esta é a instalação de referência do Oficio. Todos os outros guias desta pasta ou seguem estes passos em um provedor específico ou explicam o que muda quando uma plataforma não consegue rodar uma das peças.

| | |
|---|---|
| **O que você obtém** | A stack completa em um servidor: o app do Oficio, MySQL 8, um servidor LiveKit auto-hospedado para áudio/vídeo e Caddy com certificados HTTPS automáticos. |
| **Custo mensal** | Cerca de US$ 5–25 pelo servidor, dependendo do provedor e do tamanho da equipe (os preços mudam; veja [dimensionamento](#1-escolha-o-tamanho-do-servidor)). Nada mais a pagar. |
| **Tempo necessário** | 30–45 minutos na primeira vez, a maior parte esperando DNS e certificados. |
| **Áudio/vídeo** | LiveKit auto-hospedado na mesma stack do `docker compose` (ou [LiveKit Cloud](livekit-cloud.md), se preferir). |
| **Banco de dados** | Container MySQL 8 na mesma stack, com um volume Docker e um script de backup. |

Você precisa de: um VPS com endereço IPv4 público, um domínio que você controle e um terminal com SSH (Windows PowerShell, Terminal do macOS ou Linux).

## Como as peças se encaixam

```
browser ──HTTPS/WSS──> Caddy (80/443) ──> app:4747        (pages, API, WebSocket /ws)
                                     └──> livekit:7880    (LiveKit signaling, wss://livekit.example.com)
browser ──WebRTC media──────────────────> livekit 7881/tcp + 7882/udp  (published directly on the host)
app ──> mysql:3306 (internal network only)
```

Dois nomes de host apontam para o mesmo servidor: `office.example.com` (o app) e `livekit.example.com` (sinalização de áudio/vídeo). Os navegadores se recusam a abrir microfone e câmera em `http://` puro, então HTTPS não é opcional; o Caddy obtém os certificados do Let's Encrypt para você.

O app mantém o estado ao vivo do escritório (quem está onde, quem está falando) em memória, então ele sempre roda como **um** container. Não escale para duas réplicas.

## 1. Escolha o tamanho do servidor

| Tamanho da equipe (pessoas online ao mesmo tempo) | Servidor | Observações |
|---|---|---|
| até ~15 | 1 vCPU, 2 GB RAM | Tudo em uma máquina, incluindo o LiveKit. |
| até ~50 | 2 vCPU, 4 GB RAM | Ainda uma máquina só. |
| até ~150 | 4 vCPU, 8 GB RAM | Considere mover o LiveKit para um servidor próprio ou para o [LiveKit Cloud](livekit-cloud.md). |

20 GB de disco é mais que suficiente: as imagens ocupam cerca de 1,5 GB e o banco de dados cresce devagar (histórico de chat e telemetria). Escolha uma região próxima da maior parte da equipe: a latência do áudio acompanha o servidor.

Ubuntu 22.04 LTS ou 24.04 LTS, x86_64 ou ARM64 (a imagem é multi-arch), com endereço IPv4 público.

## 2. Crie o servidor e conecte-se

Crie o VPS no painel do seu provedor com Ubuntu 24.04 e, se for oferecido, sua chave pública SSH. Anote o IP público (usamos `203.0.113.10` nos exemplos).

```sh
ssh root@203.0.113.10
```

Esperado: um prompt de shell como `root@vps:~#`. Se você recebeu uma senha de root em vez de uma chave, digite-a agora.

### Crie um usuário não-root (recomendado)

```sh
adduser deploy                 # choose a password; the other questions can stay empty
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # copies your SSH key, if you used one
```

A partir de agora, conecte-se como `deploy`:

```sh
ssh deploy@203.0.113.10
```

Atualize o sistema uma vez:

```sh
sudo apt update && sudo apt upgrade -y
```

## 3. Instale o Docker

Use o script oficial de conveniência do Docker (ele configura o repositório apt e instala o Docker Engine com o plugin do Compose):

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker                  # or log out and back in
```

Confira as versões. O Oficio precisa do Docker Engine 24 ou mais novo e do Compose **v2.23 ou mais novo** (a stack usa `configs` inline, que versões antigas do Compose não entendem):

```sh
docker --version
docker compose version
```

Esperado: algo como `Docker version 27.x` e `Docker Compose version v2.3x`. Se `docker compose` (com espaço) não for encontrado, você tem o antigo `docker-compose` v1: instale o plugin com `sudo apt install docker-compose-plugin`. Se preferir o método manual via repositório apt, siga a seção "Install using the apt repository" da documentação do Docker; o resultado é o mesmo.

## 4. Aponte o DNS para o servidor

No seu provedor de DNS (registrador, Cloudflare, Route 53...), crie dois **registros A** apontando para o IPv4 do servidor:

| Tipo | Nome | Valor | TTL |
|---|---|---|---|
| A | `office` | `203.0.113.10` | 300 |
| A | `livekit` | `203.0.113.10` | 300 |

Observações:

- Com **Cloudflare**, deixe os dois registros como **DNS only** (nuvem cinza). O proxy da Cloudflare (nuvem laranja) não transporta o tráfego WebRTC de que o LiveKit precisa e interfere no WebSocket do host do LiveKit.
- Os dois registros precisam resolver antes de você iniciar a stack, caso contrário o Let's Encrypt não consegue emitir os certificados. Confira a partir do seu computador:

```sh
nslookup office.example.com
nslookup livekit.example.com
```

Esperado: ambos respondem `203.0.113.10`. Registros novos costumam propagar em poucos minutos.

## 5. Firewall

Abra somente o que a stack precisa:

| Porta | Protocolo | Finalidade |
|---|---|---|
| 22 | TCP | SSH (seu acesso) |
| 80 | TCP | HTTP: validação do Let's Encrypt e redirecionamento para HTTPS |
| 443 | TCP | HTTPS e WebSockets (app e sinalização do LiveKit) |
| 7881 | TCP | Mídia do LiveKit sobre TCP (fallback quando UDP está bloqueado na rede do usuário) |
| 7882 | UDP | Mídia do LiveKit sobre UDP (o caminho normal) |
| 5349 | TCP | opcional: TURN sobre TLS, só com o overlay `docker-compose.turn.yml` ([LiveKit → TURN](../livekit.md#turn-quando-e-como)) |
| 3478 | UDP | opcional: TURN sobre UDP, só com o overlay |

O MySQL (3306) nunca é publicado; ele só é alcançável a partir do container do app, em uma rede Docker interna. Opcionalmente abra também 443/udp para HTTP/3; não é obrigatório.

Com `ufw` no servidor:

```sh
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 7881/tcp
sudo ufw allow 7882/udp
sudo ufw enable
sudo ufw status
```

Se habilitar o TURN depois (`docker-compose.turn.yml`), acrescente `sudo ufw allow 5349/tcp` e `sudo ufw allow 3478/udp`.

**Importante:** o Docker publica portas de containers escrevendo suas próprias regras de iptables, que passam por cima do `ufw`. Na prática o `ufw` não protege portas publicadas por containers; ele protege os serviços do próprio host (SSH). Então configure também o firewall que o seu **provedor** oferece no painel de controle (Hetzner "Firewalls", DigitalOcean "Cloud Firewalls", Hostinger "Firewall", security groups da AWS...) com as mesmas cinco regras. O firewall do provedor fica na frente do servidor e não é afetado pelo Docker.

## 6. Obtenha o Oficio

```sh
sudo mkdir -p /opt/oficio && sudo chown $USER:$USER /opt/oficio
git clone https://github.com/thiagomorello/oficio.git /opt/oficio
cd /opt/oficio
```

Você só precisa do repositório pelo `docker-compose.yml`, pelo `.env.example` e pelos scripts; a aplicação em si é baixada como imagem pré-construída de `ghcr.io/thiagomorello/oficio`.

## 7. Crie o `.env` e gere os segredos

```sh
./scripts/gen-secrets.sh
```

Saída esperada:

```
created .env from .env.example
set OFFICE_JWT_SECRET
set MYSQL_ROOT_PASSWORD
set MYSQL_PASSWORD
set LIVEKIT_API_KEY
set LIVEKIT_API_SECRET
set METRICS_TOKEN

Done. Now edit .env and set: OFFICE_DOMAIN, LIVEKIT_DOMAIN, ACME_EMAIL, ...
```

O script copia `.env.example` para `.env`, preenche todos os segredos com valores hexadecimais aleatórios (`openssl rand`), reescreve `DATABASE_URL` para bater com a senha do MySQL gerada e define o modo do `.env` como 600. É seguro rodar de novo: valores existentes são mantidos.

Sem o script (por exemplo em uma máquina sem `openssl`), gere os valores você mesmo: `openssl rand -hex 32` para `OFFICE_JWT_SECRET`, `openssl rand -hex 24` para as senhas do MySQL e `LIVEKIT_API_SECRET`, e `API$(openssl rand -hex 6)` para `LIVEKIT_API_KEY`. Mantenha `MYSQL_PASSWORD` só com caracteres hexadecimais: ela vai embutida em `DATABASE_URL`, onde símbolos teriam de ser codificados como URL.

## 8. Edite o `.env`

```sh
nano .env
```

Defina estas quatro linhas (todo o resto pode ficar como foi gerado):

| Variável | Defina como | Por quê |
|---|---|---|
| `OFFICE_DOMAIN` | `office.example.com` | Nome de host do app. O Caddy pede um certificado para ele; `OFFICE_PUBLIC_URL` (links nos e-mails) e `OFFICE_ALLOWED_HOSTS` (verificação de Host/Origin) usam esse valor por padrão no `docker-compose.yml`. |
| `LIVEKIT_DOMAIN` | `livekit.example.com` | Nome de host para a sinalização do LiveKit. `LIVEKIT_URL` usa por padrão `wss://` + este valor. |
| `ACME_EMAIL` | `you@example.com` | O Let's Encrypt envia avisos de expiração de certificado para esse endereço. |
| `LIVEKIT_NODE_IP` | `203.0.113.10` | IPv4 público que o LiveKit anuncia aos navegadores para a mídia. Opcional (o LiveKit consegue descobri-lo via STUN), mas recomendado: evita um chute errado em hosts com várias interfaces. |

O arquivo de exemplo também contém `OFFICE_PUBLIC_URL=https://office.example.com`, `OFFICE_ALLOWED_HOSTS=office.example.com` e `LIVEKIT_URL=wss://livekit.example.com`. Atualize-os para os seus domínios reais ou apague as três linhas para que os padrões do compose (derivados de `OFFICE_DOMAIN` / `LIVEKIT_DOMAIN`) sejam aplicados. Deixar os valores de exemplo faria o app rejeitar requisições para o seu nome de host real.

Marca opcional, também no `.env`: `OFFICE_APP_NAME`, `OFFICE_LOGO_URL`, `OFFICE_ACCENT_COLOR` (`#rrggbb`), `OFFICE_SIGN_TEXT` (a placa na recepção, máximo de 14 caracteres), `OFFICE_DEFAULT_LOCALE` (`en`, `pt-BR` ou `es`). E-mail para convites e redefinições de senha: `SENDGRID_API_KEY` e `MAIL_FROM`; sem eles o painel de administração mostra as senhas temporárias na tela. Referência completa: [../configuration.md](../configuration.md).

Salve com `Ctrl+O`, `Enter` e depois `Ctrl+X`.

## 9. Inicie a stack

```sh
docker compose up -d
```

Esperado: o Docker baixa quatro imagens e imprime `Started` para `oficio-mysql-1`, `oficio-livekit-1`, `oficio-caddy-1` e `oficio-app-1`. O app espera o MySQL passar no healthcheck (até uns 30 segundos) antes de iniciar.

Acompanhe os logs:

```sh
docker compose logs -f
```

O que procurar:

- `mysql`: `ready for connections` (o primeiro boot inicializa o diretório de dados, o que leva ~20 s).
- `app`: migrations sendo aplicadas, depois uma linha dizendo que está escutando na porta 4747. Avisos sobre configuração faltando são impressos no boot: com um `.env` completo não deve haver nenhum.
- `caddy`: `certificate obtained successfully` para os dois nomes de host. Se aparecer `challenge failed`, o DNS ainda não aponta para este servidor ou a porta 80 está fechada; corrija e o Caddy tenta de novo sozinho.
- `livekit`: `starting LiveKit server` com `nodeIP` igual ao seu IP público.

Pressione `Ctrl+C` para parar de acompanhar os logs (os containers continuam rodando). `docker compose ps` mostra os quatro com status `running` e `(healthy)`.

## 10. Confira se funciona

```sh
curl -s https://office.example.com/api/health
```

Esperado: `{"ok":true,"db":"ok","version":"0.1.1","uptime":42,"online":0,"livekit":true}` (versão e uptime variam). `db` precisa ser `ok` e `livekit` precisa ser `true`.

```sh
curl -s https://livekit.example.com/
```

Esperado: `OK`. Esse é o endpoint de sinalização do LiveKit atrás do Caddy.

`https://office.example.com/api/config` devolve a marca pública (nome, cores) em JSON; é um jeito rápido de confirmar que o seu `OFFICE_APP_NAME` entrou em vigor.

## 11. Crie o primeiro administrador

```sh
./scripts/first-admin.sh you@example.com "Your Name"
```

Esperado:

```
admin created: you@example.com
temporary password (shown only once, must be changed on first login): Xk7...
```

A senha temporária é impressa **uma única vez**. O script roda `node dist/server/cli.js create-admin --email ... --name ...` dentro do container `app`; você pode passar um terceiro argumento para escolher a senha você mesmo (mínimo de 8 caracteres). Rodá-lo de novo para um e-mail existente promove essa conta a admin sem mudar a senha.

## 12. Entre e convide sua equipe

1. Abra `https://office.example.com`. Você vê a página de login com seu nome e logo.
2. Entre com o e-mail e a senha temporária. Você será solicitado a definir uma nova senha.
3. Monte seu avatar e entre no escritório.
4. Abra o painel de **Administração** (link na barra superior para administradores) e vá em **Usuários**. Crie um usuário com e-mail e nome: se `SENDGRID_API_KEY` estiver definido, a pessoa recebe um e-mail de convite; caso contrário, a senha temporária é mostrada para você repassar.

Teste o áudio com um colega: fiquem lado a lado e permitam o microfone quando o navegador pedir. Se não ouvir nada, veja [../livekit.md](../livekit.md) e [../troubleshooting.md](../troubleshooting.md); os culpados habituais são 7882/udp fechada no firewall do provedor ou a Cloudflare fazendo proxy de `livekit.example.com`.

## 13. Backups

`scripts/backup.sh` faz um dump do banco de dados com `mysqldump` pela stack do compose em `./backups/oficio-<timestamp>.sql.gz` e mantém os últimos 14 arquivos. Rode uma vez à mão:

```sh
cd /opt/oficio && ./scripts/backup.sh
ls -lh backups/
```

Depois agende para toda noite às 03:00:

```sh
crontab -e
```

Adicione a linha:

```
0 3 * * * cd /opt/oficio && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Defina `S3_BUCKET` (e credenciais da AWS, ou `S3_ENDPOINT` para armazenamento compatível com S3) no ambiente para também enviar cada dump para fora do servidor com a AWS CLI. Restaure com `./scripts/restore.sh backups/<file>.sql.gz` (ele para o app durante a importação). Copie o seu `.env` para um lugar seguro também: sem `OFFICE_JWT_SECRET` e a senha do MySQL, um dump é difícil de usar. Detalhes: [../backup-restore.md](../backup-restore.md).

## 14. Atualizações

A stack segue a tag de imagem `latest`. Para atualizar:

```sh
cd /opt/oficio
git pull                         # picks up compose/script changes, if any
docker compose pull
docker compose up -d
```

As migrations do banco rodam automaticamente quando o novo container do app inicia. Para fixar uma release em vez de `latest`, adicione `OFICIO_VERSION=1.2.3` ao `.env` (tags publicadas no GitHub Releases: `X.Y.Z`, `X.Y`, `latest`; `edge` é o branch `main` sem testes). Veja [../upgrading.md](../upgrading.md).

## 15. Desinstalar

```sh
cd /opt/oficio
docker compose down            # stops and removes the containers, keeps the data
docker compose down -v         # also deletes the MySQL data and the certificates (irreversible)
cd / && sudo rm -rf /opt/oficio
```

---

## Variações

### Construir a imagem a partir do código-fonte em vez de baixá-la

Útil quando você alterou o código ou precisa de uma arquitetura que a imagem publicada não cobre. `docker-compose.build.yml` sobrescreve o serviço `app` para fazer o build a partir do checkout:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

O build precisa de ~2 GB de RAM e alguns minutos. Repita o mesmo comando depois de cada `git pull` para reconstruir.

### Rodando em ARM

A imagem publicada é multi-arch (`linux/amd64` e `linux/arm64`), assim como as imagens do MySQL, do LiveKit e do Caddy. Os passos acima funcionam sem alteração em VPSes Ampere/Graviton e em um Raspberry Pi 4/5 com SO de 64 bits. ARM de 32 bits não é suportado.

### Usando um proxy reverso existente (nginx, Traefik, Nginx Proxy Manager, outro Caddy)

Se as portas 80/443 do host já estão ocupadas, remova o serviço `caddy` da stack e roteie os dois nomes de host você mesmo:

1. Crie `docker-compose.override.yml` ao lado de `docker-compose.yml`:

   ```yaml
   services:
     caddy:
       deploy:
         replicas: 0
     app:
       ports: ["127.0.0.1:4747:4747"]
     livekit:
       ports:
         - "127.0.0.1:7880:7880"
         - "${LIVEKIT_TCP_PORT:-7881}:7881/tcp"
         - "${LIVEKIT_UDP_PORT:-7882}:7882/udp"
   ```

   Mantenha `OFFICE_DOMAIN` e `LIVEKIT_DOMAIN` no `.env` (a definição de `caddy` ainda os referencia, mesmo com zero réplicas).
2. No seu proxy, encaminhe `https://office.example.com` para `127.0.0.1:4747` e `https://livekit.example.com` para `127.0.0.1:7880`, com upgrade de WebSocket habilitado e timeouts de leitura longos. Configurações prontas: [`deploy/caddy/Caddyfile`](../../../deploy/caddy/Caddyfile) e [`deploy/nginx/oficio.conf`](../../../deploy/nginx/oficio.conf). Defina `TRUST_PROXY=1` (já é o padrão no arquivo compose). Guia completo: [../reverse-proxy.md](../reverse-proxy.md).

### Usando LiveKit Cloud em vez do LiveKit incluído

Pule por completo o serviço `livekit`, o registro `livekit.example.com` e as portas 7881/7882:

1. Crie um projeto no LiveKit Cloud e copie a URL WebSocket e um par de chave/segredo de API ([livekit-cloud.md](livekit-cloud.md)).
2. No `.env`: `LIVEKIT_URL=wss://<project>.livekit.cloud`, `LIVEKIT_INTERNAL_URL=wss://<project>.livekit.cloud`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` do projeto.
3. Desative o serviço local com um arquivo de override:

   ```yaml
   services:
     livekit:
       deploy:
         replicas: 0
   ```

   `LIVEKIT_DOMAIN` ainda precisa estar definido com algum valor (o Caddy o referencia); aponte para um nome não usado ou mantenha o registro, é inofensivo.
4. `docker compose up -d`.

### Fixando a versão, fuso horário, memória do MySQL

No `.env`: `OFICIO_VERSION=1.2.3` (tag da imagem), `TZ=America/Sao_Paulo` (relógio dos containers e do MySQL), `MYSQL_BUFFER_POOL=512M` (buffer do InnoDB, padrão 256M; aumente em servidores com 8 GB ou mais).

## Próximos passos

- [Hostinger](hostinger.md), [DigitalOcean](digitalocean.md): os mesmos passos com o painel do provedor descrito.
- [Portainer](portainer.md), [Coolify](coolify.md), [Dokploy](dokploy.md): rode esta stack a partir de uma interface web.
- [../admin-guide.md](../admin-guide.md): usuários, editor de mapa, telemetria, CLI.
- [../troubleshooting.md](../troubleshooting.md): certificados, áudio, WebSocket, banco de dados.
