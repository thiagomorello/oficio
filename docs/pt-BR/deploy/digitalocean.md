# Deploy na DigitalOcean

Dois jeitos de rodar o Oficio na DigitalOcean:

- **Caminho A: um Droplet** (servidor virtual) com Docker. A stack inteira, incluindo o LiveKit auto-hospedado, roda em uma máquina. Recomendado.
- **Caminho B: App Platform** (containers gerenciados) com um banco Managed MySQL e LiveKit Cloud. Nenhum servidor para manter, mas sem UDP, então áudio/vídeo precisa passar pelo LiveKit Cloud.

| | Caminho A: Droplet | Caminho B: App Platform |
|---|---|---|
| **O que você obtém** | Stack completa em um servidor, como no [guia de VPS](docker-compose-vps.md) | Container do app gerenciado pela DigitalOcean, banco gerenciado pela DigitalOcean, mídia pelo LiveKit Cloud |
| **Custo mensal** | ~US$ 12–48 pelo Droplet (2–8 GB); Managed MySQL opcional a partir de ~US$ 15 | ~US$ 10+ pelo serviço (basic-xs), ~US$ 15+ pelo Managed MySQL (um banco de desenvolvimento com `production: false` é mais barato), mais o uso do LiveKit Cloud acima da faixa gratuita. Os preços mudam. |
| **Tempo necessário** | ~40 minutos | ~30 minutos |
| **Áudio/vídeo** | LiveKit auto-hospedado no Droplet | LiveKit Cloud (obrigatório) |
| **Banco de dados** | Container MySQL (padrão) ou Managed MySQL | Componente Managed MySQL criado pela spec do app |

Os nomes de menu são do fim de 2026 no painel de controle da DigitalOcean (cloud.digitalocean.com).

---

## Caminho A: Droplet

### A1. Crie o Droplet

1. No painel de controle, clique em **Create > Droplets**.
2. **Region**: a mais próxima da sua equipe. **Datacenter**: qualquer um.
3. **Choose an image**: abra a aba **Marketplace** e procure **Docker**; escolha **Docker on Ubuntu** (Docker Engine e Compose pré-instalados em Ubuntu LTS). O **Ubuntu 24.04 (LTS) x64** puro também funciona; nesse caso instale o Docker como no guia de VPS.
4. **Size**: Basic, Regular ou Premium CPU:

   | Equipe | Droplet |
   |---|---|
   | até ~15 | 1 vCPU / 2 GB |
   | até ~50 | 2 vCPU / 4 GB |
   | até ~150 | 4 vCPU / 8 GB |

5. **Authentication**: SSH key (recomendado) ou senha.
6. Opcional: marque **Enable backups** (snapshots semanais do Droplet, 20% a mais).
7. **Hostname**: `oficio`. Clique em **Create Droplet**. Copie o IPv4 público (`203.0.113.10` abaixo).

### A2. Cloud Firewall

O Docker publica portas por fora do `ufw`, então use o firewall de rede da DigitalOcean, que é aplicado fora do servidor.

1. **Networking** (menu à esquerda) **> Firewalls > Create Firewall**.
2. Nome: `oficio`.
3. **Inbound Rules**: o painel já preenche SSH. Adicione as outras com **New rule**:

   | Tipo | Protocolo | Faixa de portas | Origens |
   |---|---|---|---|
   | SSH | TCP | 22 | All IPv4, All IPv6 (ou só o seu IP) |
   | HTTP | TCP | 80 | All IPv4, All IPv6 |
   | HTTPS | TCP | 443 | All IPv4, All IPv6 |
   | Custom | TCP | 7881 | All IPv4, All IPv6 |
   | Custom | UDP | 7882 | All IPv4, All IPv6 |

4. **Outbound Rules**: deixe os padrões (todo tráfego permitido).
5. **Apply to Droplets**: digite o nome do Droplet e selecione-o. **Create Firewall**.

A imagem Docker do Marketplace também habilita o `ufw` no servidor com um conjunto pequeno de portas; depois de conectar, rode `sudo ufw status` e adicione as mesmas regras (`sudo ufw allow 80/tcp` ... `sudo ufw allow 7882/udp`) para que os dois firewalls concordem, ou `sudo ufw disable` e confie só no Cloud Firewall. A própria documentação de solução de problemas da DigitalOcean recomenda mantê-los consistentes.

### A3. DNS

Se os nameservers do domínio estão na DigitalOcean: **Networking > Domains**, abra o domínio e, em **Create new record**, adicione dois registros **A** (`office` e `livekit`, ambos para `203.0.113.10`, TTL 300). Caso contrário, adicione os mesmos registros no seu registrador; com Cloudflare, deixe-os como **DNS only** (nuvem cinza).

### A4. Instale o Oficio

Siga o [guia de referência para VPS](docker-compose-vps.md) a partir do passo 2. Com a imagem do Marketplace o Docker já está presente (pule o passo 3). Resumo:

```sh
ssh root@203.0.113.10
adduser deploy && usermod -aG sudo,docker deploy && su - deploy
sudo mkdir -p /opt/oficio && sudo chown $USER:$USER /opt/oficio
git clone https://github.com/thiagomorello/oficio.git /opt/oficio && cd /opt/oficio
./scripts/gen-secrets.sh
nano .env            # OFFICE_DOMAIN, LIVEKIT_DOMAIN, ACME_EMAIL, LIVEKIT_NODE_IP=203.0.113.10
docker compose up -d && docker compose logs -f
curl -s https://office.example.com/api/health
./scripts/first-admin.sh you@example.com "Your Name"
```

### A5. Opcional: Managed MySQL em vez do container

Útil se você quer que a DigitalOcean cuide de backups, failover e atualizações do banco de dados.

1. **Create > Databases**: engine **MySQL 8**, mesma região do Droplet, o menor plano para começar. Crie.
2. No **Overview** do cluster, em **Connection details**, escolha **Connection string** e **Public network** ou **VPC network** (VPC é preferível se o Droplet estiver na mesma região). A string se parece com `mysql://doadmin:<password>@<host>:25060/defaultdb?ssl-mode=REQUIRED`.
3. Aba **Users & Databases**: crie um banco `oficio` (e, se quiser, um usuário `oficio`).
4. **Settings > Trusted sources**: clique em **Edit**, adicione o seu Droplet (pelo nome) e **Save**. Nada mais consegue alcançar o banco.
5. Em `/opt/oficio/.env` defina `DATABASE_URL=mysql://oficio:<password>@<host>:25060/oficio?ssl=true` (o Managed MySQL exige TLS; veja [../database.md](../database.md) para os parâmetros de TLS exatos que o app aceita) e desative o MySQL incluído com `docker-compose.override.yml`:

   ```yaml
   services:
     mysql:
       deploy:
         replicas: 0
     app:
       depends_on: !reset []
   ```

6. `docker compose up -d`. O app cria suas tabelas no primeiro início. Os backups ficam então em **Databases > seu cluster > Backups**.

### A6. Backups, atualizações, desinstalação

Como no guia de VPS: `scripts/backup.sh` + cron para o banco, `docker compose pull && docker compose up -d` para atualizar. Os **Snapshots** do Droplet (página do Droplet > **Snapshots > Take snapshot**) são uma rede de segurança do disco inteiro; desligue o Droplet antes para uma cópia consistente, ou confie nos dumps SQL.

---

## Caminho B: App Platform

O App Platform roda o container do Oficio a partir do `Dockerfile` do repositório, com estes limites que você deve conhecer antes de começar:

- **Sem UDP e sem portas TCP arbitrárias**: o App Platform expõe apenas HTTP(S). O LiveKit não consegue rodar lá, então áudio/vídeo usa o **LiveKit Cloud** (ou um LiveKit em um Droplet; veja [../livekit.md](../livekit.md)).
- **Uma instância**: `instance_count: 1`. O estado do escritório vive em memória; duas instâncias seriam dois escritórios diferentes.
- **Sem MySQL no container**: a spec cria um cluster **Managed MySQL** e injeta a string de conexão.

### B1. Pré-requisitos

- Um projeto no LiveKit Cloud: URL WebSocket (`wss://<project>.livekit.cloud`), chave e segredo de API. Passos em [livekit-cloud.md](livekit-cloud.md).
- `doctl` instalado e autenticado (`doctl auth init`), ou use o editor de spec do painel de controle.
- A origem no GitHub: o App Platform faz o build a partir de um repositório GitHub que a sua conta DigitalOcean está autorizada a ler (**Settings > Source Control** ou durante a criação). A spec aponta para `thiagomorello/oficio`; se o App Platform não conseguir acessá-lo pela sua conta, faça um **fork** do repositório e altere `github.repo` na spec para o seu fork. Como alternativa, substitua o bloco `github` + `dockerfile_path` por uma origem de imagem apontando para a imagem pré-construída `ghcr.io/thiagomorello/oficio:latest` (o App Platform suporta o GitHub Container Registry como registro de imagens; confira a referência atual da app spec para os campos `image:` exatos).

### B2. Prepare a spec

Copie [`.do/app.yaml`](../../../.do/app.yaml) e edite os placeholders:

```yaml
envs:
  - key: OFFICE_JWT_SECRET
    type: SECRET
    value: <openssl rand -hex 32>
  - key: LIVEKIT_URL
    value: wss://<project>.livekit.cloud
  - key: LIVEKIT_INTERNAL_URL
    value: wss://<project>.livekit.cloud
  - key: LIVEKIT_API_KEY
    type: SECRET
    value: <from LiveKit Cloud>
  - key: LIVEKIT_API_SECRET
    type: SECRET
    value: <from LiveKit Cloud>
```

O que o resto da spec já faz: `http_port: 4747` (a porta em que a imagem escuta), `health_check.http_path: /api/health`, `OFFICE_PUBLIC_URL: ${APP_URL}` e `OFFICE_ALLOWED_HOSTS: ${APP_DOMAIN}` (o App Platform preenche a URL `ondigitalocean.app` gerada), `DATABASE_URL: ${db.DATABASE_URL}` (preenchida a partir do componente de banco `db`), `TRUST_PROXY=1`, `OFFICE_COOKIE_SECURE=1`. `region: nyc` e `instance_size_slug: basic-xs` podem ser alterados; `databases[0].production: true` pode ser definido como `false` para um banco de desenvolvimento mais barato enquanto você avalia.

### B3. Crie o app

```sh
doctl apps create --spec .do/app.yaml
```

Esperado: uma tabela com o ID do novo app e `Default Ingress` (algo como `https://oficio-abcde.ondigitalocean.app`). O primeiro build leva 5–10 minutos (ele constrói a imagem Docker e depois cria o cluster MySQL). Acompanhe no painel: **Apps > oficio > Activity**, ou:

```sh
doctl apps list
doctl apps logs <app-id> --type build --follow
doctl apps logs <app-id> --type run --follow
```

Sem `doctl`: **Create > App Platform**, escolha o repositório e o branch do GitHub, deixe-o detectar o Dockerfile e, na página de revisão, escolha **Edit App Spec** e cole o seu YAML editado.

### B4. Confira e crie o admin

```sh
curl -s https://oficio-abcde.ondigitalocean.app/api/health
```

Esperado `{"ok":true,"db":"ok",...,"livekit":true}`.

Abra o app no painel, aba **Console** (um shell dentro do container em execução), e rode:

```sh
node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
```

Copie a senha temporária, abra a URL do app e entre.

### B5. Domínio personalizado

1. **Apps > oficio > Settings > Domains > Add Domain**, informe `office.example.com`. O App Platform mostra um destino CNAME (ou, se o domínio é gerenciado pelo DNS da DigitalOcean, oferece criar o registro).
2. Crie o CNAME no seu provedor de DNS. Os certificados são emitidos automaticamente assim que ele resolve.
3. Atualize as variáveis de ambiente (Settings > componente do app > **Environment Variables**, ou `doctl apps update <id> --spec`): `OFFICE_PUBLIC_URL=https://office.example.com` e `OFFICE_ALLOWED_HOSTS=oficio-abcde.ondigitalocean.app,office.example.com`. Salvar faz um novo deploy do app.

### B6. Atualizações e limites

- `deploy_on_push: false` na spec significa que você faz deploy de propósito: **Actions > Force Rebuild and Deploy** no painel, ou `doctl apps create-deployment <app-id>`. Defina como `true` para deploys automáticos a partir de `main`.
- Logs: aba **Runtime Logs**. Métricas: **Insights**.
- Cada deploy reinicia o único container: todo mundo é desconectado por alguns segundos e reconecta automaticamente.
- Os backups e a janela de manutenção do banco estão em **Databases > oficio-db**.
- Para apagar tudo: `doctl apps delete <app-id>` e depois apague o cluster de banco em **Databases** (ele não é removido junto com o app).

## Qual caminho devo escolher?

Um Droplet custa menos, mantém áudio/vídeo na sua própria máquina e é o que o resto da documentação assume. O App Platform elimina a manutenção de servidor ao preço de um banco gerenciado e do uso do LiveKit Cloud. Os dois funcionam bem; para 50+ pessoas ou se você valoriza não ter servidor para manter atualizado, o Caminho B é razoável.
