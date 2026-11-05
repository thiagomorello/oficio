# Deploy no Railway

O Railway faz o build do container do Oficio a partir do `Dockerfile` do repositório, roda-o como um único serviço sempre ativo e fornece um banco MySQL como outro serviço no mesmo projeto. O Railway não tem ingress UDP, então o áudio/vídeo passa pelo **LiveKit Cloud**.

| | |
|---|---|
| **O que você obtém** | Oficio como container gerenciado com URL HTTPS pública (e seu próprio domínio), MySQL gerenciado pelo Railway, mídia pelo LiveKit Cloud. Nenhum servidor para manter. |
| **Custo mensal** | O plano Hobby do Railway custa cerca de US$ 5/mês incluindo US$ 5 de uso; um serviço Oficio pequeno mais MySQL costuma ficar em torno de US$ 5–15/mês de uso, dependendo de RAM e tráfego. O LiveKit Cloud tem um nível gratuito. Os preços mudam: confira railway.com/pricing. |
| **Tempo necessário** | 20 minutos. |
| **Áudio/vídeo** | LiveKit Cloud (obrigatório; veja [livekit-cloud.md](livekit-cloud.md)). |
| **Banco de dados** | Serviço MySQL do Railway, acessado pela rede privada do Railway. |

Os rótulos da interface são do dashboard do Railway no fim de 2026.

## Antes de começar

- Uma conta no Railway (login com GitHub é o mais simples).
- Um projeto no LiveKit Cloud: URL WebSocket, chave e segredo de API ([livekit-cloud.md](livekit-cloud.md), passos 1–2).
- Opcional: a CLI do Railway (`npm i -g @railway/cli`, depois `railway login`) para logs e acesso ao shell a partir do seu terminal.

## 1. Crie o projeto a partir do GitHub

1. Dashboard: **+ New Project > Deploy from GitHub repo**.
2. Se solicitado, **Configure GitHub App** e conceda acesso. O Railway faz deploy de repositórios que a sua conta GitHub consegue ver, então faça um **fork** de `thiagomorello/oficio` para a sua conta primeiro e escolha o fork. (Alternativa sem fork: **+ New > Docker Image**, imagem `ghcr.io/thiagomorello/oficio:latest`; depois ignore as observações relacionadas a build abaixo.)
3. Selecione o repositório. O Railway detecta o `railway.json` na raiz, que o instrui a fazer o build com o `Dockerfile`, rodar 1 réplica, verificar `/api/health` com timeout de 60 s e reiniciar em caso de falha (até 10 vezes).
4. Clique em **Deploy Now**. O primeiro build leva 3–5 minutos. Ele vai implantar e imediatamente falhar nos healthchecks: as variáveis estão faltando. Isso é esperado; continue.

Renomeie o serviço para `oficio` (clique no serviço, **Settings > Service name**).

## 2. Adicione o MySQL

1. No canvas do projeto, **+ New > Database > Add MySQL**.
2. Aguarde o deploy (cerca de um minuto). Clique no serviço MySQL, aba **Variables**: o Railway fornece `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE` e uma `MYSQL_URL` pronta. O host da `MYSQL_URL` deve terminar em `.railway.internal`: esse é o endereço da rede privada. Se o seu projeto também mostrar `MYSQL_PUBLIC_URL`, essa passa por um proxy TCP público e é cobrada como egress; não a use a partir do app.

O nome padrão do banco é `railway`; o Oficio não se importa com o nome.

## 3. Variáveis no serviço do Oficio

Clique no serviço `oficio`, aba **Variables**, **Raw Editor**, e cole (depois **Update Variables**):

```
NODE_ENV=production
OFFICE_PORT=4747
OFFICE_PUBLIC_URL=https://oficio-production-xxxx.up.railway.app
OFFICE_ALLOWED_HOSTS=oficio-production-xxxx.up.railway.app
TRUST_PROXY=1
OFFICE_COOKIE_SECURE=1
OFFICE_JWT_SECRET=<openssl rand -hex 32>
DATABASE_URL=${{MySQL.MYSQL_URL}}
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_INTERNAL_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=API...
LIVEKIT_API_SECRET=...
LIVEKIT_ROOM=oficio
OFFICE_APP_NAME=Oficio
OFFICE_DEFAULT_LOCALE=en
```

Observações:

- `${{MySQL.MYSQL_URL}}` é uma **variável de referência**: o Railway substitui pelo valor do serviço MySQL no momento do deploy, então você nunca copia a senha. `MySQL` é o nome do serviço no canvas; ajuste se você o renomeou. Confira no serviço MySQL que a variável é realmente a privada (host `*.railway.internal`); o Railway já renomeou essas variáveis ao longo do tempo.
- `OFFICE_PORT=4747` já é definida pela imagem; está repetida aqui para ficar visível. O Oficio lê `OFFICE_PORT`, não a `PORT` do Railway; o domínio público é apontado para a 4747 no próximo passo.
- `OFFICE_PUBLIC_URL` / `OFFICE_ALLOWED_HOSTS`: você só saberá o domínio exato depois do passo 4; volte e corrija. `OFFICE_ALLOWED_HOSTS` é uma lista separada por vírgulas; quando adicionar um domínio próprio, liste ambos.
- Opcionais: `OFFICE_LOGO_URL`, `OFFICE_ACCENT_COLOR`, `OFFICE_SIGN_TEXT`, `SENDGRID_API_KEY` + `MAIL_FROM` (e-mails de convite), `METRICS_TOKEN`. Referência: [../configuration.md](../configuration.md).

Salvar as variáveis dispara um redeploy.

## 4. Domínio público

1. Serviço `oficio`, **Settings > Networking > Public Networking > Generate Domain**.
2. O Railway pergunta em qual **porta** o serviço escuta: informe `4747`. Você recebe `oficio-production-xxxx.up.railway.app`.
3. Coloque esse host em `OFFICE_PUBLIC_URL` (`https://...`) e em `OFFICE_ALLOWED_HOSTS` (somente o host) em **Variables**. Redeploy automático.

A rede privada (a conexão com o MySQL) não precisa de nenhuma configuração.

## 5. Verifique o deploy

Aba **Deployments**: o mais recente deve ficar **Active** depois que o healthcheck passar. **View Logs** mostra as migrations seguidas da mensagem de escuta; avisos sobre variáveis ausentes significam que algo acima não foi definido.

```sh
curl -s https://oficio-production-xxxx.up.railway.app/api/health
```

Esperado: `{"ok":true,"db":"ok","version":"...","uptime":..,"online":0,"livekit":true}`. Se `db` for `error`, abra o serviço MySQL e compare o nome da variável que você referenciou.

## 6. Crie o primeiro administrador

Com a CLI do Railway, a partir de qualquer pasta:

```sh
railway login
railway link            # pick the project and the oficio service
railway ssh -- node dist/server/cli.js create-admin --email you@example.com --name "Your Name"
```

`railway ssh` abre um shell no container em execução. Sem ele (CLI mais antiga), a alternativa não é `railway run`: esse comando executa no seu computador, onde o host de banco `*.railway.internal` é inacessível. Em vez disso, habilite temporariamente **Public Access** no serviço MySQL (**Settings > Networking**), rode o comando localmente com `DATABASE_URL` definida com o valor de `MYSQL_PUBLIC_URL` (`DATABASE_URL='mysql://...' node dist/server/cli.js create-admin ...` a partir de um checkout com build feito) e depois desabilite o Public Access novamente. Ou use o dashboard: a visão de deploy do serviço não tem shell, então o `ssh` é realmente o caminho conveniente.

O comando imprime `admin created: you@example.com` e uma senha temporária, uma única vez. Abra a URL do app, entre, defina uma senha e monte seu avatar. Convide colegas em **Administração > Usuários**.

## 7. Domínio próprio

1. **Settings > Networking > Public Networking > + Custom Domain**, informe `office.example.com`. O Railway mostra um destino CNAME.
2. No seu provedor de DNS, crie o CNAME `office` → esse destino. Com Cloudflare, mantenha como **DNS only** (a documentação do Railway explica a alternativa com proxy; DNS only é mais simples).
3. Quando o Railway mostrar o domínio como verificado (certificado emitido), atualize as variáveis: `OFFICE_PUBLIC_URL=https://office.example.com`, `OFFICE_ALLOWED_HOSTS=oficio-production-xxxx.up.railway.app,office.example.com`.

## 8. Operação

- **Réplica única**: o `railway.json` define `numReplicas: 1`. Não aumente em **Settings > Deploy > Replicas**; o estado do escritório fica em memória e uma segunda réplica seria um segundo escritório, separado.
- **Região**: **Settings > Deploy > Region**. Escolha a mais próxima da sua equipe.
- **Recursos**: cobrança por uso. O Oficio em repouso fica em torno de 150–250 MB de RAM; o MySQL em torno de 400 MB. Confira em **Metrics**.
- **Sleep**: o Railway pode colocar serviços para dormir quando não há tráfego (**Settings > Deploy > App Sleeping**). Mantenha **desligado**: um escritório dormindo derruba a presença de todo mundo.
- **Atualizações**: cada push para a branch padrão do seu fork dispara um build e um deploy (você pode desabilitar isso em **Settings > Source**). Para acompanhar o upstream, sincronize o seu fork a partir de `thiagomorello/oficio` e faça push. As migrations rodam na inicialização.
- **Backups**: o Railway oferece backups de volume para serviços de banco de dados na aba **Backups** do serviço em planos pagos (confira a disponibilidade). Adicionalmente, faça um dump a partir da sua máquina enquanto o **Public Access** estiver habilitado: `mysqldump --single-transaction -h <host> -P <port> -u root -p railway | gzip > oficio.sql.gz`, e depois desabilite o Public Access.
- **Logs**: serviço **Deployments > View Logs**, ou `railway logs`.

## Limitações a conhecer

- Sem ingress UDP: o LiveKit não pode rodar no Railway. LiveKit Cloud ou um LiveKit em uma VPS ([../livekit.md](../livekit.md)).
- Deploys reiniciam o container; as pessoas reconectam automaticamente depois de alguns segundos.
- A cobrança de egress do Railway se aplica a todo o tráfego; o tráfego do Oficio em si (atualizações de estado por WebSocket) é leve, e a mídia nunca passa pelo Railway.

Solução de problemas do Oficio em si: [../troubleshooting.md](../troubleshooting.md).
