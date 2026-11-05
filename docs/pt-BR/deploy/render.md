# Deploy no Render

O Render roda o container do Oficio como um **Web Service** construído a partir do `Dockerfile` do repositório. O Render não tem MySQL gerenciado nem ingress UDP, então o banco de dados fica em um provedor MySQL externo e o áudio/vídeo passa pelo **LiveKit Cloud**. O repositório inclui um Blueprint, [`render.yaml`](../../../render.yaml), que descreve o serviço e suas variáveis.

| | |
|---|---|
| **O que você obtém** | Oficio como container gerenciado com HTTPS, deploys automáticos a partir do Git, logs e um shell no dashboard do Render. |
| **Custo mensal** | Web service **Starter** do Render por cerca de US$ 7/mês (o nível gratuito não serve, veja abaixo); MySQL externo de US$ 0 (níveis gratuitos de provedores de MySQL serverless) até ~US$ 15–30 por uma instância dedicada pequena; LiveKit Cloud no nível gratuito ou pago. Os preços mudam: confira render.com/pricing. |
| **Tempo necessário** | 25 minutos, mais o cadastro no banco de dados externo. |
| **Áudio/vídeo** | LiveKit Cloud (obrigatório). |
| **Banco de dados** | MySQL 8 externo (qualquer provedor acessível pela internet com TLS). |

Os rótulos do dashboard são do Render no fim de 2026.

## Por que não o nível gratuito

Web services gratuitos no Render são desligados depois de cerca de 15 minutos sem tráfego HTTP de entrada e levam dezenas de segundos para acordar. Para o Oficio isso significa: o WebSocket de todo mundo cai, o estado em memória do escritório é perdido e a primeira pessoa a voltar espera por um cold start. Use no mínimo a instância **Starter**. Observe também a cota mensal de horas do nível gratuito e a ausência de instâncias persistentes.

## Antes de começar

1. **MySQL 8 externo**. Opções: um provedor de MySQL serverless com nível gratuito ou hobby (PlanetScale, TiDB Cloud, Aiven for MySQL...), um MySQL do Railway com Public Access habilitado, ou um MySQL em uma VPS pequena. Crie um banco `oficio` e um usuário com todos os direitos sobre ele, e anote a string de conexão. A maioria dos provedores exige TLS; a forma de URL que o Oficio espera é `mysql://user:password@host:3306/oficio?ssl=true` (codifique em URL os caracteres especiais da senha; os parâmetros de TLS por provedor estão em [../database.md](../database.md)).
2. Projeto no **LiveKit Cloud**: URL WebSocket, chave e segredo de API ([livekit-cloud.md](livekit-cloud.md)).
3. Uma conta no Render conectada ao GitHub, e um **fork** de `thiagomorello/oficio` na sua conta (o Render faz deploy de repositórios aos quais você tem acesso).

## Opção A: Blueprint (`render.yaml`)

1. Dashboard: **New + > Blueprint**.
2. Conecte o seu fork. O Render lê o `render.yaml` e mostra um web service `oficio` (runtime Docker, plano Starter, 1 instância, healthcheck `/api/health`).
3. O Blueprint lista variáveis com `sync: false`, que o Render pede para você preencher agora:

   | Variável | Valor |
   |---|---|
   | `OFFICE_PUBLIC_URL` | `https://oficio.onrender.com` (você pode mudar o nome do serviço; a URL é `<name>.onrender.com`) |
   | `OFFICE_ALLOWED_HOSTS` | `oficio.onrender.com` (adicione o seu domínio próprio depois, separado por vírgula) |
   | `DATABASE_URL` | a URL MySQL do seu provedor |
   | `LIVEKIT_URL` | `wss://<project>.livekit.cloud` |
   | `LIVEKIT_INTERNAL_URL` | a mesma URL `wss://` |
   | `LIVEKIT_API_KEY` | do LiveKit Cloud |
   | `LIVEKIT_API_SECRET` | do LiveKit Cloud |

   `OFFICE_JWT_SECRET` e `METRICS_TOKEN` estão marcadas com `generateValue: true`: o Render cria valores aleatórios para você. `NODE_ENV`, `TRUST_PROXY=1`, `OFFICE_COOKIE_SECURE=1`, `LIVEKIT_ROOM=oficio`, `OFFICE_APP_NAME`, `OFFICE_DEFAULT_LOCALE` têm valores fixos no arquivo.
4. **Apply**. O Render faz o build da imagem (3–6 minutos) e o deploy.

## Opção B: Web Service manual

1. **New + > Web Service**, conecte o fork.
2. **Language**: Docker. **Region**: a mais próxima da sua equipe. **Instance type**: Starter ou superior. Deixe **Dockerfile path** como `./Dockerfile`.
3. **Environment Variables > Add from .env** e cole:

   ```
   NODE_ENV=production
   PORT=4747
   OFFICE_PUBLIC_URL=https://oficio.onrender.com
   OFFICE_ALLOWED_HOSTS=oficio.onrender.com
   TRUST_PROXY=1
   OFFICE_COOKIE_SECURE=1
   OFFICE_JWT_SECRET=<openssl rand -hex 32>
   DATABASE_URL=mysql://user:password@host:3306/oficio?ssl=true
   LIVEKIT_URL=wss://<project>.livekit.cloud
   LIVEKIT_INTERNAL_URL=wss://<project>.livekit.cloud
   LIVEKIT_API_KEY=API...
   LIVEKIT_API_SECRET=...
   LIVEKIT_ROOM=oficio
   OFFICE_APP_NAME=Oficio
   OFFICE_DEFAULT_LOCALE=en
   ```

4. **Advanced > Health Check Path**: `/api/health`. **Create Web Service**.

### Sobre a porta

A imagem escuta em `OFFICE_PORT=4747` (definida no Dockerfile) e ignora a `PORT` do Render. O runtime Docker do Render detecta a porta que o seu processo abre e roteia o tráfego HTTPS para ela; definir `PORT=4747` não é obrigatório, mas torna a detecção imediata e documenta a intenção, e é por isso que a Opção B a inclui. O Render não lê o `EXPOSE` do Dockerfile.

## Verifique

Aba **Events**: o deploy deve chegar a **Live**. Aba **Logs**: migrations aplicadas e depois a mensagem de escuta. A partir do seu computador:

```sh
curl -s https://oficio.onrender.com/api/health
```

Esperado: `{"ok":true,"db":"ok",...,"livekit":true}`. `db: "error"` significa que a URL do MySQL ou o parâmetro de TLS está errado, ou que o provedor bloqueia os IPs de saída do Render (confira **Settings > Outbound IP addresses** e inclua-os na lista de permissão do provedor de banco, se ele tiver uma lista de IPs permitidos).

## Primeiro administrador

Aba **Shell** do serviço (abre um terminal dentro do container em execução; disponível em instâncias pagas). Execute:

```sh
node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
```

Copie a senha temporária (mostrada uma única vez), abra `https://oficio.onrender.com`, entre e defina uma nova senha. Convide colegas em **Administração > Usuários** (com `SENDGRID_API_KEY` + `MAIL_FROM` definidas, eles recebem um e-mail; caso contrário, você repassa a senha temporária mostrada a você).

## Domínio próprio

1. **Settings > Custom Domains > Add Custom Domain**: `office.example.com`.
2. Crie no seu provedor de DNS o CNAME que o Render mostra (`office` → `oficio.onrender.com`). Cloudflare: **DNS only** é o mais simples.
3. O Render emite o certificado assim que o DNS resolver. Depois atualize **Environment**: `OFFICE_PUBLIC_URL=https://office.example.com`, `OFFICE_ALLOWED_HOSTS=oficio.onrender.com,office.example.com`. Salve; o Render faz o redeploy.

## Operação

- **Uma instância**: `numInstances: 1` no Blueprint; nunca escale o serviço horizontalmente (**Settings > Scaling** fica em 1). O estado do escritório fica em memória.
- **Deploys**: por padrão, o Render faz deploy automático a cada push para a branch do fork (**Settings > Build & Deploy > Auto-Deploy**). Para acompanhar as releases do upstream, sincronize o seu fork e faça push. Cada deploy reinicia o container; os usuários reconectam em alguns segundos. As migrations rodam na inicialização.
- **Deploys sem downtime** no Render rodam brevemente a nova instância ao lado da antiga enquanto o healthcheck passa; ambas conectam ao mesmo banco de dados, o que não é problema para o Oficio (a instância antiga para de atender assim que a nova fica ativa e os clientes reconectam a ela).
- **Backups**: responsabilidade do seu provedor MySQL; a maioria oferece snapshots diários. Guarde também `OFFICE_JWT_SECRET` e as outras variáveis em um lugar seguro (**Environment > Export** em alguns planos do Render, ou copie-as).
- **Métricas/logs**: abas **Metrics** e **Logs**. `/metrics` (Prometheus) é protegido pelo `METRICS_TOKEN` gerado.

## Limitações

- Sem UDP: o LiveKit não pode rodar no Render. LiveKit Cloud ou um LiveKit em uma VPS ([../livekit.md](../livekit.md)).
- Sem MySQL gerenciado: o Render oferece apenas Postgres e armazenamentos chave-valor; o Oficio precisa de MySQL 8.
- Instâncias gratuitas são desligadas e perdem a presença; use Starter ou superior.

Solução de problemas do Oficio: [../troubleshooting.md](../troubleshooting.md).
