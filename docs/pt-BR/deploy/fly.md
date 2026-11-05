# Deploy no Fly.io

O Fly.io roda o container do Oficio como uma única Machine perto do seu time, com HTTPS e WebSockets cuidados pelo proxy do Fly. O repositório traz um [`fly.toml`](../../../fly.toml) pronto. O banco de dados é um MySQL 8 externo e o áudio/vídeo passa pelo **LiveKit Cloud** (recomendado). Uma seção avançada cobre rodar o LiveKit no Fly com UDP, algo que o Fly suporta, mas que não validamos de ponta a ponta.

| | |
|---|---|
| **O que você obtém** | Oficio em uma Machine do Fly sempre ligada (1 vCPU compartilhada, 1 GB de RAM por padrão), TLS automático, domínio próprio, CLI `fly` para logs e shell. |
| **Custo mensal** | A machine padrão `shared-cpu-1x` com 1 GB custa alguns dólares por mês (o Fly cobra por segundo de uso) mais um pouco de banda; um IPv4 dedicado (necessário só para a seção avançada de UDP) custa cerca de US$ 2/mês. MySQL externo e LiveKit Cloud à parte. Os preços mudam: consulte fly.io/docs/about/pricing. |
| **Tempo necessário** | 25 minutos. |
| **Áudio/vídeo** | LiveKit Cloud (recomendado). LiveKit auto-hospedado no Fly: avançado, mantido pela comunidade. |
| **Banco de dados** | MySQL 8 externo (o Fly anunciou um MySQL gerenciado em beta privado; até ficar disponível para todos, use um provedor externo ou hospede você mesmo o MySQL como um app do Fly, veja [../database.md](../database.md)). |

Os comandos usam `fly` (a CLI `flyctl`), no fim de 2026.

## Antes de começar

1. Instale a CLI (`curl -L https://fly.io/install.sh | sh` no macOS/Linux; `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"` no Windows) e entre: `fly auth login`.
2. Um banco MySQL 8 acessível pela internet com TLS (PlanetScale, TiDB Cloud, Aiven, Railway com Public Access, ou o seu próprio). Banco `oficio`, um usuário com todos os direitos, string de conexão `mysql://user:password@host:3306/oficio?ssl=true` ([../database.md](../database.md) para os parâmetros de TLS de cada provedor).
3. Um projeto no LiveKit Cloud: URL WebSocket, API key e secret ([livekit-cloud.md](livekit-cloud.md)).
4. Um clone do repositório no seu computador: `git clone https://github.com/thiagomorello/oficio.git && cd oficio`.

## 1. Crie o app

O `fly.toml` já contém o build (Dockerfile), o serviço HTTP na porta interna 4747 com `force_https`, um healthcheck em `/api/health`, `auto_stop_machines = "off"` com `min_machines_running = 1` (o escritório precisa ficar sempre de pé) e o ambiente não secreto. Crie o app a partir dele sem fazer deploy ainda:

```sh
fly launch --copy-config --no-deploy --name my-oficio --region gru
```

- `--copy-config` usa o `fly.toml` do repositório em vez de gerar um.
- `--name` precisa ser globalmente único no Fly (vira `my-oficio.fly.dev`). Omita para deixar o Fly escolher um nome.
- `--region`: escolha a mais próxima do seu time (`fly platform regions` lista todas; `gru` é São Paulo, `iad` Virgínia, `ams` Amsterdã...).

Responda **No** se o assistente oferecer criar um banco Postgres ou Redis (o Oficio usa MySQL). Esperado: `Created app 'my-oficio' in organization ...` e um `fly.toml` atualizado com o nome e a região do seu app.

Edite o `fly.toml` para que as duas variáveis voltadas ao público batam com o nome de host real:

```toml
[env]
  OFFICE_PUBLIC_URL = "https://my-oficio.fly.dev"
  OFFICE_ALLOWED_HOSTS = "my-oficio.fly.dev"
```

Adicione `LIVEKIT_URL` e `LIVEKIT_INTERNAL_URL` ao mesmo bloco `[env]` (não são secretas):

```toml
  LIVEKIT_URL = "wss://<project>.livekit.cloud"
  LIVEKIT_INTERNAL_URL = "wss://<project>.livekit.cloud"
```

## 2. Secrets

```sh
fly secrets set \
  OFFICE_JWT_SECRET="$(openssl rand -hex 32)" \
  DATABASE_URL="mysql://user:password@host:3306/oficio?ssl=true" \
  LIVEKIT_API_KEY="API..." \
  LIVEKIT_API_SECRET="..." \
  METRICS_TOKEN="$(openssl rand -hex 24)"
```

Esperado: `Secrets are staged for the first deployment`. Secrets opcionais: `SENDGRID_API_KEY` e `MAIL_FROM` para os e-mails de convite.

## 3. Deploy

```sh
fly deploy
```

O Fly faz o build da imagem remotamente (3–6 minutos na primeira vez), cria uma Machine e aguarda o healthcheck. Esperado ao final: `1 desired, 1 placed, 1 healthy`. Em seguida:

```sh
fly status                 # one machine, state "started", checks passing
fly logs                   # migrations applied, listening on 4747 (Ctrl+C to leave)
curl -s https://my-oficio.fly.dev/api/health
```

Esperado `{"ok":true,"db":"ok",...,"livekit":true}`. Se `db` for `error`, confira a URL do MySQL e se o provedor restringe IPs de origem (Machines do Fly não têm IPv4 de saída fixo a menos que você aloque um: `fly ips allocate-v4` e `fly ips list`).

Mantenha exatamente **uma** Machine: `fly scale count 1` se em algum momento você mudou isso. Duas Machines seriam dois escritórios separados. Por padrão, `fly deploy` usa uma estratégia rolling que inicia brevemente a nova Machine antes de parar a antiga; com uma Machine isso significa alguns segundos em que os clientes reconectam, o que não é problema.

## 4. Primeiro administrador

```sh
fly ssh console -C "node dist/server/cli.js create-admin --email you@example.com --name 'Your Name'"
```

Esperado: `admin created: you@example.com` e uma senha temporária mostrada uma única vez. Abra `https://my-oficio.fly.dev`, entre, defina uma nova senha. Convide colegas em **Administração > Usuários**.

## 5. Domínio próprio

```sh
fly certs add office.example.com
```

O Fly imprime os registros DNS a criar: um CNAME `office` → `my-oficio.fly.dev` (ou registros A/AAAA para os IPs do app, `fly ips list`). Com Cloudflare, mantenha o registro como **DNS only**. Acompanhe com `fly certs show office.example.com` até o certificado ser emitido. Depois atualize o `fly.toml`:

```toml
  OFFICE_PUBLIC_URL = "https://office.example.com"
  OFFICE_ALLOWED_HOSTS = "my-oficio.fly.dev,office.example.com"
```

e rode `fly deploy`.

## 6. Operação

- **Recursos**: `[[vm]]` no `fly.toml` define `shared-cpu-1x`, 1 GB. Para ~50 pessoas: `fly scale vm shared-cpu-2x --memory 2048` (ou edite o arquivo e faça o deploy).
- **Atualizações**: `git pull` no seu clone e `fly deploy`. Para fazer deploy da imagem publicada em vez de fazer o build: `fly deploy --image ghcr.io/thiagomorello/oficio:1.2.3`. As migrações rodam na inicialização.
- **Logs e métricas**: `fly logs`, `fly dashboard` (abre o painel web com as métricas da Machine). `/metrics` é protegido por `METRICS_TOKEN`.
- **Backups**: os snapshots do seu provedor de MySQL. Guarde os secrets no seu gerenciador de senhas (`fly secrets list` mostra nomes e digests, nunca os valores).
- **Excluir**: `fly apps destroy my-oficio`.

## Avançado: LiveKit auto-hospedado no Fly (comunidade, não validado)

O Fly suporta serviços UDP, então rodar o LiveKit em um segundo app do Fly é possível em princípio. **Não** validamos isso de ponta a ponta e não damos suporte; está documentado aqui como ponto de partida para quem quiser tentar. Se você precisa de áudio previsível, use o LiveKit Cloud ou um LiveKit em um VPS ([../livekit.md](../livekit.md)).

O que a documentação do Fly diz sobre UDP (confira na página atual "Running apps on UDP and TCP"):

- UDP exige um **IPv4 dedicado** no app (`fly ips allocate-v4`, cerca de US$ 2/mês); UDP sobre IPv6 não é suportado.
- O processo precisa **vincular o socket UDP ao endereço especial `fly-global-services`** (resolvido a partir de `/etc/hosts` dentro da Machine), não a `0.0.0.0`; caso contrário as respostas saem com o endereço de origem errado e nunca chegam ao cliente. Serviços TCP continuam vinculados a `0.0.0.0`.
- A **porta interna UDP precisa ser igual à porta externa**; o Fly não reescreve portas UDP.

Um esboço de `fly.toml` para um app `livekit`:

```toml
app = "my-oficio-livekit"
primary_region = "gru"

[build]
  image = "livekit/livekit-server:v1.13.11"

[env]
  LIVEKIT_CONFIG = """
port: 7880
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: false
  node_ip: 203.0.113.10        # the dedicated IPv4 of this Fly app
turn:
  enabled: false
room:
  auto_create: true
"""

[http_service]                   # signaling: wss://my-oficio-livekit.fly.dev
  internal_port = 7880
  force_https = true
  auto_stop_machines = "off"
  min_machines_running = 1

[[services]]                     # media over TCP
  internal_port = 7881
  protocol = "tcp"
  [[services.ports]]
    port = 7881

[[services]]                     # media over UDP
  internal_port = 7882
  protocol = "udp"
  [[services.ports]]
    port = 7882
```

Depois `fly secrets set LIVEKIT_KEYS="APIxxx: secret"` e, no app do Oficio, `LIVEKIT_URL=wss://my-oficio-livekit.fly.dev`, `LIVEKIT_INTERNAL_URL=http://my-oficio-livekit.internal:7880` (rede privada do Fly) e o mesmo par key/secret.

A questão em aberto é o bind em `fly-global-services`: a seção `rtc` do LiveKit oferece listas de inclusão `interfaces` / `ips` para restringir quais endereços ele usa, mas se isso faz as respostas UDP saírem do endereço certo no Fly é exatamente o que ninguém confirmou para esta configuração. Teste com dois navegadores em redes diferentes e com o testador de conexão do LiveKit (livekit.io/connection-test) antes de depender disso. Relatos, bons ou ruins, são bem-vindos como issues no GitHub.

## Limitações

- Apenas uma Machine; o auto-stop do Fly precisa ficar desligado (e fica, no `fly.toml` que acompanha o repositório).
- Ainda não há MySQL gerenciado (beta privado no momento em que isto foi escrito); MySQL externo ou um app do Fly com MySQL auto-hospedado e um volume.
- O IPv4 de saída do app é compartilhado a menos que você aloque um dedicado; provedores de banco com lista de IPs permitidos precisam disso.

Solução de problemas do Oficio: [../troubleshooting.md](../troubleshooting.md).
