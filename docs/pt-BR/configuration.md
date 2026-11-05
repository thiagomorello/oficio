# Configuração

O Oficio é configurado inteiramente por variáveis de ambiente, lidas uma vez na inicialização por `server/config.ts`. Esta página lista todas as variáveis nos mesmos grupos do [`.env.example`](../../.env.example), com tipo, padrão, se é obrigatória e o que faz; depois explica marca, idiomas, LiveKit, login único, e-mail, métricas, configurações só de desenvolvimento e como o `docker-compose.yml` deriva `DATABASE_URL` e as URLs públicas a partir de `OFFICE_DOMAIN` e `LIVEKIT_DOMAIN`.

## Como os valores são lidos

- Strings vazias contam como "não definido". Espaços em branco nas pontas são removidos.
- Variáveis booleanas aceitam `1`, `true`, `yes`, `sim`, `on` (sem distinção de maiúsculas) como verdadeiro; qualquer outra coisa é falso.
- Na inicialização o servidor registra um **aviso** para cada valor ausente ou inválido sem o qual ele consegue viver (por exemplo, uma cor de destaque inválida volta ao padrão). Valores ausentes sem os quais ele não consegue viver são registrados como erros: sem `DATABASE_URL` o processo encerra (exceto em `--dev`), e sem `OFFICE_JWT_SECRET` toda chamada a `/api/*` responde `503` e a página de login não consegue autenticar ninguém.
- `GET /api/config` (público, sem segredos) mostra os valores de marca e idioma que o servidor realmente aplicou, mais a versão e `oidc: { enabled, label, passwordLogin }` do login único. Use-o para confirmar que uma mudança entrou.
- Reinicie o app depois de alterar o `.env`: `docker compose up -d` recria só os containers cujo ambiente mudou.

## Servidor HTTP

| Variável | Tipo | Padrão | Obrigatória | Descrição |
|---|---|---|---|---|
| `OFFICE_PORT` | inteiro | `4747` | não | Porta em que o processo Node escuta. Valores fora de 1–65535 voltam para 4747. |
| `OFFICE_HOST` | endereço | `0.0.0.0` no Docker, `127.0.0.1` fora dele | não | Endereço de bind. Fora do Docker o padrão é loopback, de modo que um proxy reverso no mesmo host é a única porta de entrada. |
| `OFFICE_IN_DOCKER` | booleano | não definido (a imagem define `1`) | não | Muda o endereço de bind padrão para `0.0.0.0`. O Dockerfile já define isso. |
| `OFFICE_IN_MEMORY` | `0`/`1` | `0` | não | Modo de demonstração: repositórios em memória em vez do MySQL, um administrador `dev@oficio.local` / `dev12345` e um segredo JWT efêmero quando `OFFICE_JWT_SECRET` está vazio. Tudo se perde no restart. Nunca em produção. |
| `OFFICE_DEV` | booleano | não definido | não | Modo de desenvolvimento: middleware do Vite com hot reload, repositórios em memória quando `DATABASE_URL` está vazio, `LOGIN_MASTER_PASSWORD` respeitado. O mesmo que a flag `--dev`. **Nunca defina em produção.** |
| `OFFICE_PUBLIC_URL` | URL | não definido | recomendada | URL base pública, usada para montar links nos e-mails (`/login?reset=…`, `/login?lang=…`). Sem ela, os e-mails de redefinição recorrem ao header `Host` da requisição. |
| `OFFICE_ALLOWED_HOSTS` | nomes de host separados por vírgula | vazio | **sim em produção** | Nomes de host que o servidor aceita nos headers `Host` e `Origin` (a porta é ignorada). `localhost`, `*.localhost` e IPs literais são sempre aceitos. Qualquer outro host recebe `403 Host not allowed`, e upgrades de WebSocket de outras origens são recusados. Protege contra DNS rebinding e CSRF. |
| `TRUST_PROXY` | booleano | `0` | sim atrás de um proxy | Quando `1`, o primeiro endereço em `X-Forwarded-For` é usado como IP do cliente para o rate limiting do login e os logs de sessão. Defina sempre que Caddy, Traefik, nginx ou um túnel estiver na frente do app; deixe `0` quando os navegadores conectam direto, senão os clientes poderiam forjar o próprio IP. |

## Marca (whitelabel)

| Variável | Tipo | Padrão | Obrigatória | Descrição |
|---|---|---|---|---|
| `OFFICE_APP_NAME` | string, máx. 40 caracteres | `Oficio` | não | Nome mostrado nos títulos das páginas, na página de login, no cabeçalho da administração, nos e-mails (assunto e nome do remetente) e no manifesto PWA. Valores mais longos são truncados. |
| `OFFICE_LOGO_URL` | URL absoluta ou caminho começando com `/` | `/assets/brand/logo.svg` | não | Logo na barra superior, nas páginas de login e de administração. Qualquer coisa que não seja `http(s)://…` ou `/…` volta ao padrão. |
| `OFFICE_ACCENT_COLOR` | `#rrggbb` | `#7c9cff` | não | Cor de destaque para botões, realces, a placa dentro do mapa e o cabeçalho dos e-mails. Valores inválidos registram um aviso e usam o padrão. |
| `OFFICE_SIGN_TEXT` | string, máx. 14 caracteres | valor de `OFFICE_APP_NAME` (truncado) | não | Texto da placa da recepção no mapa. Renderizado em uma fonte pixel 5x7 em maiúsculas; acentos são removidos. |
| `OFFICE_DEFAULT_LOCALE` | `en` \| `pt-BR` \| `es` | `en` | não | Idioma padrão para visitantes que não escolheram um, para mensagens do servidor e para e-mails. Valores desconhecidos registram um aviso e usam `en`. |

Detalhes e dicas em [Detalhes da marca](#detalhes-da-marca) abaixo.

## Sessão e login

| Variável | Tipo | Padrão | Obrigatória | Descrição |
|---|---|---|---|---|
| `OFFICE_JWT_SECRET` | string aleatória (hex, 64 caracteres recomendados) | não definido | **sim** | Assina o cookie de sessão (`office_session`, HS256, 30 dias). Sem ele o endpoint de login responde `503`. Em `--dev` um segredo efêmero é gerado, então as sessões se perdem ao reiniciar. Gere com `openssl rand -hex 32`. Alterá-lo desconecta todo mundo. |
| `OFFICE_COOKIE_SECURE` | booleano | `1` | não | Define a flag `Secure` no cookie de sessão, para que os navegadores só o enviem por HTTPS. Defina `0` **somente** para desenvolvimento local em HTTP puro; em HTTP com `1` o navegador descarta o cookie e você volta em loop para a página de login. |
| `LOGIN_MASTER_PASSWORD` | string | não definido | não | Uma senha que entra em qualquer conta. **Só respeitada em `--dev`**; fora do modo dev é ignorada e um aviso é registrado. Mantenha vazia em produção. |

## Login único (OpenID Connect, opcional)

| Variável | Tipo | Padrão | Obrigatória | Descrição |
|---|---|---|---|---|
| `OIDC_ISSUER` | URL | não definido | sim para SSO | Issuer do provedor de identidade (base de `/.well-known/openid-configuration`), por exemplo `https://accounts.google.com`, `https://login.microsoftonline.com/<tenant-id>/v2.0`, `https://keycloak.example.com/realms/<realm>`. Precisa ser `https://` (`http://` puro só em `--dev`). |
| `OIDC_CLIENT_ID` | string | não definido | sim para SSO | Client ID da aplicação registrada no provedor. |
| `OIDC_CLIENT_SECRET` | string | não definido | sim para SSO | Client secret dessa aplicação. |
| `OIDC_SCOPES` | separados por espaço | `openid email profile` | não | Escopos pedidos. `openid` é acrescentado se faltar. Adicione um escopo de grupos se o provedor precisar dele para a claim de admin. |
| `OIDC_BUTTON_LABEL` | string, máx. 40 caracteres | nome do provedor a partir do host do issuer (`Google`, `Microsoft`, `Keycloak`, `Authentik` ou o domínio com inicial maiúscula), senão `Single sign-on` | não | Texto do botão de login: "Continuar com …". |
| `OIDC_AUTO_CREATE` | booleano | `1` | não | Cria a conta no primeiro login. `0`: só contas existentes (pelo e-mail ou já vinculadas) conseguem entrar. |
| `OIDC_ALLOWED_DOMAINS` | domínios separados por vírgula | vazio (qualquer) | não | Domínios de e-mail aceitos, conferidos contra a claim `email`, sem diferenciar maiúsculas. |
| `OIDC_ADMIN_CLAIM` | string | não definido | não | Claim (por exemplo `groups`, `roles`) cujos valores concedem acesso de administrador. Defina junto com `OIDC_ADMIN_VALUES`. O mapeamento só concede: nunca remove o acesso de administrador de contas promovidas localmente. |
| `OIDC_ADMIN_VALUES` | separados por vírgula | não definido | não | Valores dessa claim que tornam a pessoa administradora (por exemplo `oficio-admins`, ou o GUID de um grupo no Entra ID). |
| `OIDC_PASSWORD_LOGIN` | booleano | `1` | não | `0` esconde e desativa o formulário de e-mail/senha enquanto o login único está ativo (`POST /api/auth/login` responde `403`). A CLI e `LOGIN_MASTER_PASSWORD` em `--dev` continuam funcionando. Ignorado, com aviso, quando o login único está desligado. |

O login único só fica ativo quando as três primeiras estão todas definidas; um conjunto parcial registra um aviso no boot e o mantém desligado. A URI de redirecionamento a registrar no provedor é `https://<OFFICE_DOMAIN>/api/auth/oidc/callback` (montada a partir de `OFFICE_PUBLIC_URL`). Configuração provedor a provedor, regras de vínculo de conta e códigos de erro: [Login único](sso.md).

## Banco de dados MySQL

| Variável | Tipo | Padrão | Obrigatória | Descrição |
|---|---|---|---|---|
| `DATABASE_URL` | `mysql://user:password@host:3306/database` | não definido | **sim** (exceto `--dev`) | URL de conexão. O servidor lê somente esquema, usuário, senha, host, porta e nome do banco; parâmetros de query são ignorados (veja [Banco de dados](database.md)). Codifique em URL os caracteres especiais da senha (`@` → `%40`, `#` → `%23`, …). |
| `MYSQL_HOST` | host | não definido | alternativa | Usado com as outras partes `MYSQL_*` **somente quando `DATABASE_URL` está vazio**; o servidor monta uma URL a partir delas (usuário e senha são codificados em URL para você). |
| `MYSQL_PORT` | inteiro | `3306` | não | Parte da forma alternativa. |
| `MYSQL_USER` | string | `root` (servidor) / `oficio` (compose) | não | Parte da forma alternativa; também o usuário que o `docker-compose.yml` cria no container MySQL. |
| `MYSQL_PASSWORD` | string | vazio | sim com compose | Parte da forma alternativa; também a senha do usuário MySQL do compose e a que vai embutida na `DATABASE_URL` do compose. Mantenha-a segura para URL (hex) porque ela entra em uma URL. |
| `MYSQL_DATABASE` | string | `oficio` | não | Parte da forma alternativa; também o banco que o container MySQL do compose cria. |
| `MYSQL_SSL` | `required` \| `skip-verify` \| vazio | vazio | não | TLS até o banco (funciona com as duas formas). `required` valida o certificado do servidor; `skip-verify` criptografa sem validar. O mesmo que `?ssl=true` / `?ssl=skip-verify` na `DATABASE_URL`. |
| `MYSQL_SSL_CA` | caminho de arquivo | vazio | não | Bundle PEM com a CA que assinou o certificado do banco, para CAs privadas ou corporativas. Implica TLS com validação. O mesmo que `?sslca=/caminho` na `DATABASE_URL`. Veja [Banco de dados → TLS](database.md#tls). |
| `MYSQL_ROOT_PASSWORD` | string | — | sim com compose | Senha de root do container MySQL incluído, usada na primeira inicialização e por `scripts/backup.sh` / `restore.sh`. Não é lida pelo app. |
| `MYSQL_BUFFER_POOL` | tamanho | `256M` | não | só compose: `innodb-buffer-pool-size` do MySQL incluído. Aumente para `512M`–`1G` em hosts com 8 GB ou mais. |

Com o `docker-compose.yml` você normalmente nunca escreve `DATABASE_URL` à mão: o arquivo compose a monta como `mysql://${MYSQL_USER:-oficio}:${MYSQL_PASSWORD}@mysql:3306/${MYSQL_DATABASE:-oficio}`. O `gen-secrets.sh` também reescreve a linha `DATABASE_URL` no `.env` para bater, o que importa quando você roda a CLI a partir do código-fonte contra o mesmo banco.

## LiveKit (áudio e vídeo)

| Variável | Tipo | Padrão | Obrigatória | Descrição |
|---|---|---|---|---|
| `LIVEKIT_URL` | `wss://host` | não definido | sim para A/V | URL pública de sinalização à qual os navegadores se conectam. Auto-hospedado: `wss://livekit.example.com` (Caddy na frente da porta 7880). LiveKit Cloud: `wss://<project>.livekit.cloud`. Também devolvida em `GET /api/livekit/token`. |
| `LIVEKIT_INTERNAL_URL` | `http://host:7880` ou `wss://…` | recorre a `LIVEKIT_URL` | não | URL que o **servidor** usa para a API room-service do LiveKit (atualizar permissões de participantes). Dentro do compose: `http://livekit:7880`. `ws(s)://` é convertido para `http(s)://` automaticamente. Para o LiveKit Cloud use o mesmo valor de `LIVEKIT_URL`. |
| `LIVEKIT_API_KEY` | string | não definido | sim para A/V | Chave de API, idêntica à configurada no servidor LiveKit (`LIVEKIT_KEYS`). Convenção: `API` + 12 caracteres hex. |
| `LIVEKIT_API_SECRET` | string, 32+ caracteres | não definido | sim para A/V | Segredo correspondente. Gere com `openssl rand -hex 24`. Uma divergência entre app e servidor aparece como `401`/erros de token no console do navegador. |
| `LIVEKIT_ROOM` | string | `oficio` | não | Nome da única sala LiveKit que o escritório inteiro usa. Mude só se várias instâncias do Oficio compartilham um mesmo servidor LiveKit. |
| `LIVEKIT_NODE_IP` | IPv4 | vazio | recomendada | só compose: IP público anunciado nos candidatos ICE (`rtc.node_ip`). Vazio significa que o LiveKit o descobre via STUN (`use_external_ip: true`). **Obrigatório** em Docker Swarm / redes overlay, onde a descoberta não é confiável. |
| `LIVEKIT_TCP_PORT` | inteiro | `7881` | não | só compose: porta do host publicada para ICE-TCP. |
| `LIVEKIT_UDP_PORT` | inteiro | `7882` | não | só compose: porta do host publicada para mídia sobre UDP. |
| `TURN_TLS_PORT` | inteiro | `5349` | não | só `docker-compose.turn.yml`: porta TURN/TLS (mesmo número no host e no container). Veja [LiveKit → TURN](livekit.md#turn-quando-e-como). |
| `TURN_UDP_PORT` | inteiro | `3478` | não | só `docker-compose.turn.yml`: porta TURN/UDP (mesmo número no host e no container). |
| `TURN_CERT_WAIT_SECONDS` | inteiro | `600` | não | só `docker-compose.turn.yml`: quanto tempo o `livekit` espera pelo certificado do Caddy no primeiro boot antes de sair e tentar de novo. |
| `TURN_RELOADER_INTERVAL` | inteiro | `21600` | não | só `docker-compose.turn.yml`: com que frequência o sidecar opcional `turn-cert-reloader` verifica o certificado (segundos). |

Quando qualquer uma de `LIVEKIT_URL`, `LIVEKIT_API_KEY` ou `LIVEKIT_API_SECRET` está faltando, o servidor registra `LiveKit não configurado`, `/api/health` informa `"livekit": false`, e o escritório roda sem áudio/vídeo (presença e chat continuam funcionando). Mais em [LiveKit](livekit.md).

## Domínios (docker-compose.yml com Caddy)

| Variável | Tipo | Padrão | Obrigatória | Descrição |
|---|---|---|---|---|
| `OFFICE_DOMAIN` | nome de host | — | **sim com compose** | O Caddy serve o app em `https://$OFFICE_DOMAIN`. Também o fallback de `OFFICE_PUBLIC_URL` e `OFFICE_ALLOWED_HOSTS`. |
| `LIVEKIT_DOMAIN` | nome de host | — | **sim com compose** | O Caddy faz proxy de `https://$LIVEKIT_DOMAIN` para `livekit:7880`. Também o fallback de `LIVEKIT_URL`. |
| `ACME_EMAIL` | e-mail | vazio | recomendada | E-mail de contato que o Caddy informa ao Let's Encrypt (avisos de expiração). |
| `OFICIO_VERSION` | tag da imagem | `latest` | não | Tag de `ghcr.io/thiagomorello/oficio` a executar. Fixe-a (`0.1.0`) em produção; veja [Atualização](upgrading.md). |
| `TZ` | fuso horário | `UTC` | não | Fuso horário dos containers do app e do MySQL (afeta os timestamps dos logs e o contador de "logins hoje" no painel de administração). |

Estas não são lidas pelo processo Node; existem para o `docker-compose.yml`, o Caddy e as stacks do Portainer.

### Como o compose deriva as URLs públicas

```yaml
OFFICE_PUBLIC_URL:    ${OFFICE_PUBLIC_URL:-https://${OFFICE_DOMAIN}}
OFFICE_ALLOWED_HOSTS: ${OFFICE_ALLOWED_HOSTS:-${OFFICE_DOMAIN}}
LIVEKIT_URL:          ${LIVEKIT_URL:-wss://${LIVEKIT_DOMAIN}}
LIVEKIT_INTERNAL_URL: ${LIVEKIT_INTERNAL_URL:-http://livekit:7880}
DATABASE_URL:         mysql://${MYSQL_USER:-oficio}:${MYSQL_PASSWORD}@mysql:3306/${MYSQL_DATABASE:-oficio}
```

`${VAR:-default}` significa "use `VAR` se estiver definida e não vazia, senão o padrão". Então o `.env` mínimo para o compose é os dois domínios mais os segredos. Se você definir `OFFICE_PUBLIC_URL`, `OFFICE_ALLOWED_HOSTS` ou `LIVEKIT_URL` explicitamente, eles prevalecem; o `.env.example` vem com eles pré-preenchidos com valores `example.com`, que você precisa alterar ou remover.

Variáveis marcadas com `:?` no arquivo compose (`OFFICE_JWT_SECRET`, `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `OFFICE_DOMAIN`, `LIVEKIT_DOMAIN`) fazem o `docker compose up` se recusar a iniciar, com uma mensagem clara, quando estão vazias.

## E-mail (opcional)

| Variável | Tipo | Padrão | Obrigatória | Descrição |
|---|---|---|---|---|
| `SENDGRID_API_KEY` | string | não definido | não | Chave de API do SendGrid. Habilita e-mails de convite (senha temporária) e links de redefinição de senha. |
| `MAIL_FROM` | e-mail | não definido | sim quando a chave está definida | Endereço do remetente; precisa estar verificado no SendGrid. O nome do remetente é `OFFICE_APP_NAME`. Definir a chave sem `MAIL_FROM` registra um aviso e não envia nada. |

O mailer nunca lança exceção: se o SendGrid responder com erro, o app registra `SendGrid responded 4xx` e a interface de administração recorre a mostrar a senha temporária na tela. Os e-mails são enviados no idioma salvo do destinatário, ou no idioma de quem fez o pedido para contas recém-criadas; veja [i18n](i18n.md).

## Observabilidade (opcional)

| Variável | Tipo | Padrão | Obrigatória | Descrição |
|---|---|---|---|---|
| `METRICS_TOKEN` | string | não definido | não | Quando definido, `GET /metrics` exige `Authorization: Bearer <token>`; caso contrário o endpoint é público (só contadores agregados, sem dados pessoais). O `gen-secrets.sh` o preenche. |

Métricas expostas (formato texto do Prometheus): `office_online_users`, `office_ws_connections`, `office_tick_duration_ms{stat="last"|"max"}`, `office_chat_messages_total`, `office_logins_total`, `process_uptime_seconds`, `nodejs_heap_used_bytes`. Exemplo de configuração de scrape:

```yaml
scrape_configs:
  - job_name: oficio
    scheme: https
    static_configs: [{ targets: ['office.example.com'] }]
    authorization: { credentials: '<METRICS_TOKEN>' }
```

`GET /api/health` é sempre público e devolve `{ ok, db, version, uptime, online, livekit }`; `db` é `ok`, `error` (status 503) ou `fake` (modo dev sem banco de dados).

## Desenvolvimento local

| Variável | Tipo | Padrão | Obrigatória | Descrição |
|---|---|---|---|---|
| `VITE_PORT` | inteiro | `5173` | não | Porta do servidor de desenvolvimento do Vite avulso (`npm run dev:client`), que faz proxy de `/api` e `/ws` para `OFFICE_PORT`. Não é necessária com `npm run dev`, que embute o Vite no servidor Node. |

`npm run dev` (= `--dev`) sem `DATABASE_URL` usa repositórios em memória e cria a conta `dev@oficio.local` / `dev12345` (admin). O `docker-compose.dev.yml` fornece um MySQL local (`mysql://oficio:oficio@127.0.0.1:3306/oficio`) e um LiveKit em `ws://127.0.0.1:7880` com chave `devkey` / segredo `devsecretdevsecretdevsecret12345`. Câmera e microfone funcionam em `localhost` sem HTTPS; defina `OFFICE_COOKIE_SECURE=0` se você faz login por HTTP puro a partir de outro nome de host.

## Detalhes da marca

Tudo sobre a aparência de uma instância vem das cinco variáveis de marca `OFFICE_*`; nenhum arquivo precisa ser editado.

- **Nome** (`OFFICE_APP_NAME`): aparece no `<title>`, no login, na administração, nos e-mails e no manifesto PWA (`/manifest.webmanifest`, gerado em tempo de execução; `short_name` são os primeiros 12 caracteres).
- **Logo** (`OFFICE_LOGO_URL`): aponte para um arquivo no seu CDN ou para um caminho servido pelo app. O padrão `/assets/brand/logo.svg` e os ícones PWA (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) podem ser regenerados nas suas cores e com o seu texto pelo gerador incluído, que desenha a mesma fonte pixel 5x7 que a placa dentro do mapa usa:

  ```sh
  pip install pillow
  python scripts/assets/make-brand.py --text ACME --accent "#ff6600"
  ```

  Os arquivos vão para `client/public/assets/brand/`; reconstrua a imagem (ou monte a pasta) para distribuí-los. Para um logo personalizado que você já tem, basta definir `OFFICE_LOGO_URL`.
- **Cor de destaque** (`OFFICE_ACCENT_COLOR`): a interface deriva uma paleta inteira a partir dela (`accentPalette` em `shared/branding.ts`): um tom **strong** um pouco mais escuro para estados de hover e ativo, um tom **dark** para bordas e realces discretos, um tom **light** para fundos suaves, e a cor do texto **sobre** o destaque, escolhida automaticamente (quase preto em destaques claros, branco em escuros, pela luminância WCAG). A mesma paleta estiliza os e-mails HTML.
- **Placa** (`OFFICE_SIGN_TEXT`): a placa da recepção no mapa padrão carrega o rótulo especial `{brand}`, que o renderizador substitui por este texto na fonte pixel. Mantenha-o curto (14 caracteres no máximo) e em ASCII; acentos são removidos. Mapas desenhados por você podem usar `{brand}` em qualquer placa.

Os clientes leem esses valores de `GET /api/config` ao carregar, então uma alteração mais um restart do container bastam; nenhum rebuild.

## Idioma

`OFFICE_DEFAULT_LOCALE` é o padrão da instância, não uma trava. A ordem de resolução no navegador é: a escolha salva da pessoa (configurações ou o seletor da página de login, guardada no `localStorage` e no perfil do usuário) → `navigator.languages` do navegador → `OFFICE_DEFAULT_LOCALE`. O servidor escolhe o idioma das mensagens de erro da API e dos e-mails a partir de `?lang=` (usado nos links dos e-mails) → `Accept-Language` → o padrão. Valores suportados: `en`, `pt-BR`, `es`. Explicação completa e como adicionar um idioma: [i18n](i18n.md).

## Exemplo completo de `.env` para um VPS

```ini
OFFICE_PORT=4747
OFFICE_PUBLIC_URL=https://office.example.com
OFFICE_ALLOWED_HOSTS=office.example.com
TRUST_PROXY=1

OFFICE_APP_NAME=Acme Office
OFFICE_ACCENT_COLOR=#ff6600
OFFICE_SIGN_TEXT=ACME
OFFICE_DEFAULT_LOCALE=en

OFFICE_JWT_SECRET=<openssl rand -hex 32>
OFFICE_COOKIE_SECURE=1
LOGIN_MASTER_PASSWORD=

DATABASE_URL=mysql://oficio:<hex>@mysql:3306/oficio
MYSQL_ROOT_PASSWORD=<hex>
MYSQL_USER=oficio
MYSQL_PASSWORD=<hex>
MYSQL_DATABASE=oficio

LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_INTERNAL_URL=http://livekit:7880
LIVEKIT_API_KEY=API<12 hex>
LIVEKIT_API_SECRET=<openssl rand -hex 24>
LIVEKIT_ROOM=oficio
LIVEKIT_NODE_IP=203.0.113.10
LIVEKIT_TCP_PORT=7881
LIVEKIT_UDP_PORT=7882

OFFICE_DOMAIN=office.example.com
LIVEKIT_DOMAIN=livekit.example.com
ACME_EMAIL=admin@example.com
OFICIO_VERSION=0.1.0
TZ=UTC

SENDGRID_API_KEY=
MAIL_FROM=
METRICS_TOKEN=<openssl rand -hex 24>

OIDC_ISSUER=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
```

Mantenha o `.env` fora do controle de versão (ele está no gitignore) e legível somente pelo usuário que faz o deploy (`chmod 600 .env`, o que o `gen-secrets.sh` faz por você).
