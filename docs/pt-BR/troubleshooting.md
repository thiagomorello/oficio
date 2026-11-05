# Solução de problemas

Sintomas que você pode encontrar ao instalar ou operar o Oficio, cada um com a causa usual e a correção. Comece pelas três ferramentas do topo (logs, o endpoint de health e o console do navegador); a maioria dos problemas aparece em uma delas em um minuto. Se travar, o fim da página diz o que incluir ao pedir ajuda.

## As três primeiras coisas a verificar

**1. Logs.**

```sh
docker compose logs -f --tail=100 app livekit caddy
```

O app registra avisos de configuração na inicialização (segredos faltando, cor inválida, LiveKit não configurado), toda migration que aplica e uma linha de aviso por handler de requisição que falhou. O Caddy registra a emissão de certificados e erros de proxy. O LiveKit registra entradas e problemas de ICE.

**2. Health.**

```sh
curl -s https://office.example.com/api/health
# {"ok":true,"db":"ok","version":"0.1.1","uptime":1234,"online":7,"livekit":true}
```

| Campo | Significado |
|---|---|
| `ok` | `false` (HTTP 503) quando a verificação do banco falhou |
| `db` | `ok`, `error` (não consegue rodar `SELECT 1` em 2 s) ou `fake` (modo dev sem banco) |
| `version` | versão do app; inclua-a em relatos de bug |
| `uptime` | segundos desde que o processo iniciou; um número pequeno significa que acabou de reiniciar |
| `online` | pessoas conectadas agora |
| `livekit` | se `LIVEKIT_API_KEY` está configurada (não se o SFU está acessível) |

**3. Console do navegador** (F12 → Console e Network). Chamadas `fetch` que falharam mostram o status HTTP e o erro JSON; o WebSocket aparece em Network → WS; problemas do LiveKit são registrados com um prefixo `livekit`.

## Sintomas

### O botão de microfone ou câmera não faz nada

**Causa:** a página não é servida por HTTPS. Os navegadores só permitem `getUserMedia` em origens `https://` ou em `localhost`; em HTTP puro a API simplesmente não existe e os botões ficam inertes. Uma segunda causa é uma permissão negada antes.

**Correção:** abra o escritório por `https://office.example.com` (nunca pelo IP cru ou por `http://`). Confira o cadeado na barra de endereços. Se a permissão foi negada, clique no cadeado → Configurações do site → permitir Microfone e Câmera, e recarregue. Para desenvolvimento, use `http://localhost:4747`, que os navegadores tratam como seguro.

### As pessoas não se ouvem nem se veem, mas o chat funciona

**Causa:** a sinalização (`wss://livekit…`) funciona, mas a mídia (UDP 7882, fallback TCP 7881) não alcança o host do LiveKit, ou o LiveKit anuncia o IP errado. Típico: regra de firewall faltando no painel do provedor, `LIVEKIT_NODE_IP` vazio em um host onde a descoberta por STUN escolhe um endereço privado (Swarm/overlay, hosts com várias interfaces), ou proxy do Cloudflare (nuvem laranja) na frente do nome do LiveKit.

**Correção:**

1. Abra 7881/tcp e 7882/udp **tanto** no firewall do host **quanto** no firewall da nuvem; `sudo ss -lunp | grep 7882` confirma que o LiveKit escuta.
2. Defina `LIVEKIT_NODE_IP=<public IP>` no `.env` e `docker compose up -d livekit`.
3. Garanta que `livekit.example.com` está como DNS only no Cloudflare.
4. Teste com <https://livekit.io/connection-test> usando um token gerado como em [LiveKit → Testando](livekit.md#testando-um-deploy). Ele diz se UDP, TCP ou nenhum dos dois funciona. Se só o TCP funciona, o áudio funciona com mais latência e a sua regra de UDP está errada; se nenhum, o IP anunciado está errado ou as portas estão fechadas.
5. Em `chrome://webrtc-internals`, olhe o par de candidatos ICE selecionado para a conexão do LiveKit.
6. Se tudo acima está certo e só as pessoas de uma rede restrita (proxy corporativo, Wi-Fi de hotel) são afetadas, a rede delas bloqueia o UDP e portas fora do padrão. Habilite o TURN sobre TLS com o overlay `docker-compose.turn.yml` e abra 5349/tcp + 3478/udp; veja [LiveKit → TURN](livekit.md#turn-quando-e-como). A etapa **TURN** do testador precisa então passar a partir dessa rede.

### O login devolve `503`

**Causa:** `OFFICE_JWT_SECRET` não está definido. O app registra `OFFICE_JWT_SECRET not set: login will respond 503` na inicialização e toda requisição `/api/*` responde `503 authentication not configured`.

**Correção:** rode `./scripts/gen-secrets.sh` (preenche os segredos vazios no `.env`) ou defina `OFFICE_JWT_SECRET=$(openssl rand -hex 32)`, depois `docker compose up -d app`. No Portainer ou em um PaaS, adicione a variável nas configurações de ambiente. Note que o arquivo compose se recusa a iniciar quando a variável está vazia (`:?run ./scripts/gen-secrets.sh`), então isso acontece principalmente com stacks personalizadas.

### `403 Host not allowed`, ou o WebSocket fecha imediatamente

**Causa:** o nome de host na barra de endereços do navegador não está em `OFFICE_ALLOWED_HOSTS`. O guard aceita `localhost`, `*.localhost`, IPs literais e os nomes listados; tudo o mais é rejeitado com `403 Host not allowed: <host>`, e upgrades de WebSocket cuja `Origin` não é permitida são fechados antes do handshake. Um proxy que reescreve o `Host` para o endereço do backend ou remove a `Origin` provoca o mesmo.

**Correção:** defina `OFFICE_ALLOWED_HOSTS=office.example.com` (separe vários nomes por vírgula; portas são ignoradas) e reinicie o app. No seu proxy, passe o `Host` original (`proxy_set_header Host $host` no nginx, `passHostHeader=true` no Traefik; o Caddy faz isso por padrão) e não remova `Origin`/`Upgrade`. Veja [Proxy reverso](reverse-proxy.md).

### Redirecionado para a página de login em loop / cookie não é mantido

**Causa:** o navegador está descartando o cookie de sessão. Quase sempre `OFFICE_COOKIE_SECURE=1` (o padrão) enquanto a página é acessada por HTTP puro: a flag `Secure` faz o navegador descartar o cookie, então o `POST` de login tem sucesso (`200` na aba Network), mas a requisição seguinte não leva cookie e o gate de páginas manda você de volta para `/login`. Um proxy que troca de nome de host entre o login e a página seguinte tem o mesmo efeito. Já que está aí, confira também o `TRUST_PROXY`: com `0` atrás de um proxy, todos os usuários compartilham o IP do proxy para o rate limiting e algumas senhas erradas bloqueiam todo mundo com `429 Too many attempts`.

**Correção:** sirva o site por HTTPS e abra-o pelo nome canônico (`https://office.example.com`). Para testes locais por HTTP defina `OFFICE_COOKIE_SECURE=0`. Atrás de Caddy, Traefik, nginx ou um túnel, defina `TRUST_PROXY=1`.

### LiveKit `401` / "invalid token" / `could not establish signal connection`

**Causa:** a chave/segredo de API com que o app assina os tokens difere do par que o servidor LiveKit conhece (`LIVEKIT_KEYS`), ou `LIVEKIT_URL` aponta para outro LiveKit. Com o LiveKit Cloud: credenciais de projeto erradas.

**Correção:** compare os valores:

```sh
docker compose exec app env | grep -E 'LIVEKIT_(URL|API_KEY)'
docker compose exec livekit env | grep LIVEKIT_KEYS
```

A chave nos dois precisa bater e o segredo precisa ser a mesma string. Edite o `.env`, depois `docker compose up -d` (os dois containers são recriados porque o ambiente deles mudou). Os tokens valem 12 horas; depois da correção, recarregue o escritório.

### O LiveKit diz `token is not valid yet` (áudio travado em "Reconectando")

**Causa:** o relógio da máquina (ou VM) que roda o LiveKit está atrasado em relação ao relógio da máquina que roda o app. O app emite tokens que passam a valer "agora"; um servidor LiveKit cujo relógio está nem que seja um minuto atrasado os rejeita com `invalid authorization token: token has invalid claims: token is not valid yet` no log, e o app registra `LiveKit: failed to update permissions`.

**Correção:** sincronize os relógios. Em um VPS, habilite o NTP (`timedatectl set-ntp true`). No Docker Desktop (Windows/macOS) o relógio da VM desvia depois que o computador dorme: reinicie o Docker Desktop (ou `wsl --shutdown` no Windows) e inicie os containers de novo. Compare com `date -u` no host e `docker run --rm alpine date -u`.

### `/api/health` mostra `db: error`

**Causa:** o app não consegue rodar `SELECT 1` em dois segundos. Na primeira inicialização o MySQL precisa de ~30 s para se inicializar (o app espera o healthcheck no compose, mas não em stacks personalizadas). Caso contrário: valores errados de `DATABASE_URL` ou `MYSQL_*`, caracteres especiais na senha sem codificação de URL, o host do banco inalcançável a partir da rede do app, ou um banco gerenciado que exige TLS enquanto a URL não tem `?ssl=true` (veja [Banco de dados → TLS](database.md#tls)).

**Correção:** `docker compose logs mysql` para o lado do banco, `docker compose logs app` para o erro de conexão (`ECONNREFUSED`, `ER_ACCESS_DENIED_ERROR`, `ETIMEDOUT`). Confira a URL caractere por caractere; teste a partir do container do app:

```sh
docker compose exec app node -e 'const u=new URL(process.env.DATABASE_URL);console.log(u.hostname,u.port,u.username,u.pathname)'
docker compose exec mysql mysql -u oficio -p oficio -e 'SELECT 1'
```

A senha usada pelo app precisa bater com a que o MySQL foi inicializado; se você alterou `MYSQL_PASSWORD` depois da primeira inicialização, altere-a dentro do MySQL também (`ALTER USER`) ou recrie o volume (o que apaga todos os dados).

### O Caddy não consegue obter um certificado

**Causa:** o Let's Encrypt não conseguiu alcançar `http://office.example.com/.well-known/acme-challenge/…`. DNS não propagado ou apontando para outro lugar, porta 80 bloqueada, proxy do Cloudflare (nuvem laranja) ligado, ou outro processo já ocupando 80/443 no host. O Caddy registra `could not get certificate from issuer` e tenta de novo com backoff.

**Correção:** `dig +short office.example.com` precisa devolver o IP público do host, tanto a partir do próprio host quanto de fora; `sudo ss -ltnp | grep -E ':80|:443'` deve mostrar somente o Caddy; mude os registros do Cloudflare para DNS only; abra 80 e 443 no firewall do provedor. Depois `docker compose restart caddy`. Depois de várias tentativas falhas você pode bater nos limites de taxa do Let's Encrypt; espere uma hora antes de tentar de novo em vez de reiniciar em loop.

### E-mails não são enviados

**Causa:** `SENDGRID_API_KEY` faltando (a interface de administração então mostra senhas temporárias em vez disso; esse é o fallback de design), ou definida sem `MAIL_FROM` (aviso na inicialização: `SENDGRID_API_KEY definido sem MAIL_FROM`), ou o SendGrid recusando a requisição: `SendGrid responded 401` (chave inválida), `403` (remetente não verificado), `400` (endereço malformado).

**Correção:** defina as duas variáveis, verifique o endereço ou domínio do remetente no SendGrid, reinicie o app e acompanhe `docker compose logs -f app` enquanto convida um usuário de teste. O mailer nunca lança exceção: um envio falho recorre a mostrar a senha na tela, então nada se perde.

### `503 Client not built` ao rodar a partir do código-fonte

**Causa:** `node dist/server/index.js` não encontrou `dist/client/index.html`. O servidor de produção serve o build do Vite; ele não compila o cliente.

**Correção:** `npm run build` (roda o `vite build` e o bundle do servidor), depois inicie de novo. Para desenvolvimento use `npm run dev`, que serve o cliente pelo Vite com hot reload.

### Porta 4747 já em uso

**Causa:** outro processo (ou uma instância anterior) escuta na porta. O app registra `Port 4747 is already in use (set OFFICE_PORT to use another one)` e encerra.

**Correção:** encontre-o com `sudo ss -ltnp | grep 4747` e pare-o, ou defina `OFFICE_PORT=4748` (e atualize o seu proxy). No compose a porta é interna, então um conflito só ocorre com rede em modo host ou uma segunda stack.

### `429 Too many attempts` no login

**Causa:** dez tentativas falhas para o mesmo IP e e-mail em dez minutos. Atrás de um proxy com `TRUST_PROXY=0`, todos os usuários compartilham o IP do proxy e o limite se torna global.

**Correção:** espere o número de segundos em `Retry-After`, e defina `TRUST_PROXY=1` quando estiver atrás de um proxy.

### `409` ao salvar no editor de mapa

**Causa:** outro administrador salvou o rascunho compartilhado desde que você o carregou (concorrência otimista em `updated_at`).

**Correção:** recarregue o rascunho no editor e refaça a sua alteração; há um único rascunho por instância.

### O mapa padrão voltou / meu mapa sumiu depois de um restart

**Causa:** o mapa publicado falhou na validação na inicialização (`Mapa publicado #N inválido`), tipicamente depois de uma edição manual no banco, então o app recorreu ao mapa padrão em memória. Nada foi apagado.

**Correção:** abra `/admin/mapa`, escolha a versão no painel de versões, restaure-a para o rascunho, rode **Validar**, corrija os erros listados e publique de novo.

### Todo mundo desconecta a cada N segundos / selo de "reconectando"

**Causa:** um proxy com um timeout curto de inatividade ou total em WebSockets (padrão do nginx `proxy_read_timeout 60s` sem o timeout longo da configuração fornecida; alguns load balancers limitam conexões a 60 s), ou o host está usando swap e os ticks travam (`office_tick_duration_ms` em `/metrics`).

**Correção:** aumente `proxy_read_timeout`/`proxy_send_timeout` para 3600 s na location `/` (veja [Proxy reverso](reverse-proxy.md)), confira a memória livre, confira em `/admin/telemetria` eventos `ws_drop` agrupados no tempo.

### As pessoas parecem "teletransportar" ou travar

**Causa:** tempo de ida e volta alto ou perda de pacotes na rede do usuário; o servidor rejeita ou corrige as posições do cliente (telemetria `moved_reject`, `pos_jump`).

**Correção:** problema por usuário na maioria dos casos; o resumo da telemetria mostra o RTT p95 por pessoa. Se todo mundo é afetado ao mesmo tempo, confira a CPU do servidor e `office_tick_duration_ms`.

### `npm run dev` funciona, mas um colega na LAN não consegue entrar

**Causa:** o servidor de desenvolvimento faz bind em `127.0.0.1` por padrão e, quando acessado por um nome da LAN, o guard de host recusa o nome.

**Correção:** `OFFICE_HOST=0.0.0.0`, `OFFICE_ALLOWED_HOSTS=<your-lan-name>`, `OFFICE_COOKIE_SECURE=0` (HTTP puro). Acessar pelo IP funciona sem a entrada na lista de permitidos (IPs são sempre aceitos), mas microfone e câmera exigem HTTPS ou `localhost`, então use isso só para testar presença/chat.

## Reunindo informações para um relato de bug ou uma dúvida de deploy

Use os templates de issue do repositório: **Bug report** para algo quebrado, **Deployment help** quando um passo de `docs/deploy/*.md` falha (o template inclui um checklist dos suspeitos usuais: DNS, firewall, endpoint de health, segredos). Perguntas e ideias vão para o GitHub Discussions.

Inclua:

- A versão do Oficio (`/api/health` → `version`) e como está instalado (compose, Portainer, PaaS, código-fonte).
- `docker compose logs --tail=200 app` (mais `livekit` para problemas de áudio/vídeo, `caddy` para problemas de TLS), com os segredos removidos.
- A saída de `curl -s https://office.example.com/api/health` e, para A/V, o resultado do teste de conexão do LiveKit.
- Navegador e sistema operacional, e qualquer linha vermelha do console do navegador.
- Qual passo de qual guia você estava seguindo quando deu errado.

Nunca cole o `.env`, tokens ou senhas; remova-os antes de publicar.
