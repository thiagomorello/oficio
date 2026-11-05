# Proxy reverso e TLS

O app fala HTTP puro (e WebSocket em `/ws`) na porta 4747, e o LiveKit fala HTTP/WebSocket puro na 7880. Algo na frente precisa terminar o TLS de `office.example.com` e `livekit.example.com`, encaminhar os headers `Upgrade` e `X-Forwarded-*` e deixar as conexões de longa duração em paz. O `docker-compose.yml` traz o Caddy para isso, mas Traefik, nginx, Nginx Proxy Manager e Cloudflare Tunnel funcionam. Esta página mostra cada um, lista os headers de que o Oficio precisa e explica o `TRUST_PROXY`.

## O que qualquer proxy precisa fazer

| Requisito | Por quê |
|---|---|
| **TLS** nos dois nomes de host | os navegadores só permitem microfone/câmera em HTTPS; o cookie de sessão é `Secure` |
| Passagem do **upgrade de WebSocket** (headers `Upgrade`, `Connection`, HTTP/1.1 até o backend) | `/ws` carrega a presença; `wss://livekit…` carrega a sinalização do LiveKit |
| Preservar o header **`Host`** | o guard de host do app o compara com `OFFICE_ALLOWED_HOSTS` e responde `403` caso contrário |
| Enviar **`X-Forwarded-For`** (e `X-Forwarded-Proto`) | com `TRUST_PROXY=1` o app usa o primeiro endereço para o rate limiting do login e os logs de sessão |
| **Timeouts de inatividade longos** (uma hora ou mais) na location do WebSocket | o app faz ping a cada 20 s, mas alguns proxies têm por padrão read timeouts de 60 s e cortam sockets silenciosos |
| **Não** bufferizar nem comprimir o WebSocket | padrão; compressão HTTP para páginas não tem problema |
| Deixar **7881/tcp e 7882/udp** em paz | a mídia do LiveKit ignora o proxy completamente e é publicada no host |

Headers de segurança (`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) são bons de adicionar na borda; o app também define os importantes nas próprias respostas.

### `TRUST_PROXY`

- `TRUST_PROXY=1` quando **toda** requisição chega ao app pelo seu proxy (padrão do compose). O app então lê o IP do cliente da primeira entrada de `X-Forwarded-For`.
- `TRUST_PROXY=0` quando os navegadores se conectam à porta 4747 diretamente (desenvolvimento). Com `1` nessa situação, qualquer cliente poderia forjar `X-Forwarded-For` e driblar o rate limiter do login.
- A porta 4747 não deve ser alcançável de fora quando `TRUST_PROXY=1`; na stack compose ela está somente nas redes Docker.

## Caddy (padrão)

O arquivo compose embute este Caddyfile (`configs.caddyfile`), parametrizado por `OFFICE_DOMAIN`, `LIVEKIT_DOMAIN` e `ACME_EMAIL`:

```caddyfile
{
  email {$ACME_EMAIL}
}
{$OFFICE_DOMAIN} {
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    Referrer-Policy "strict-origin-when-cross-origin"
  }
  reverse_proxy app:4747
}
{$LIVEKIT_DOMAIN} {
  reverse_proxy livekit:7880
}
```

O Caddy obtém e renova certificados do Let's Encrypt automaticamente (HTTP-01 na porta 80, TLS-ALPN na 443), faz proxy de WebSockets sem diretivas extras, define `X-Forwarded-For`/`X-Forwarded-Proto` por padrão e mantém upgrades HTTP/1.1 abertos indefinidamente. Os certificados ficam no volume `caddy-data` (`oficio_caddy-data`); mantenha-o nos seus backups para evitar reemissão em um rebuild (limites de taxa do Let's Encrypt).

Para uma instalação avulsa (app no host, não no compose) use [`deploy/caddy/Caddyfile`](../../deploy/caddy/Caddyfile), que é o mesmo arquivo apontando para `127.0.0.1:4747` e `127.0.0.1:7880`:

```sh
export OFFICE_DOMAIN=office.example.com LIVEKIT_DOMAIN=livekit.example.com ACME_EMAIL=admin@example.com
caddy run --config /etc/caddy/Caddyfile
```

## Traefik

Se o Traefik já é dono das portas 80/443 no host (típico com o Portainer), remova o serviço `caddy` e conecte `app` e `livekit` à rede do Traefik com labels. É exatamente o que [`deploy/portainer/stack-swarm.yml`](../../deploy/portainer/stack-swarm.yml) faz; as labels, na forma compose (não Swarm):

```yaml
services:
  app:
    # ...
    networks: [traefik_public, internal]
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=traefik_public"
      - "traefik.http.routers.oficio.rule=Host(`office.example.com`)"
      - "traefik.http.routers.oficio.entrypoints=websecure"
      - "traefik.http.routers.oficio.tls.certresolver=letsencryptresolver"
      - "traefik.http.routers.oficio.middlewares=oficio-headers"
      - "traefik.http.services.oficio.loadbalancer.server.port=4747"
      - "traefik.http.services.oficio.loadbalancer.passHostHeader=true"
      - "traefik.http.middlewares.oficio-headers.headers.stsSeconds=31536000"
      - "traefik.http.middlewares.oficio-headers.headers.frameDeny=true"
      - "traefik.http.middlewares.oficio-headers.headers.contentTypeNosniff=true"
      - "traefik.http.middlewares.oficio-headers.headers.referrerPolicy=strict-origin-when-cross-origin"

  livekit:
    # ...
    networks: [traefik_public, internal]
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=traefik_public"
      - "traefik.http.routers.oficio-livekit.rule=Host(`livekit.example.com`)"
      - "traefik.http.routers.oficio-livekit.entrypoints=websecure"
      - "traefik.http.routers.oficio-livekit.tls.certresolver=letsencryptresolver"
      - "traefik.http.services.oficio-livekit.loadbalancer.server.port=7880"
      - "traefik.http.services.oficio-livekit.loadbalancer.passHostHeader=true"

networks:
  traefik_public:
    external: true
  internal:
```

Ajuste `websecure`, `letsencryptresolver` e `traefik_public` para os nomes da sua instalação do Traefik (no Swarm as labels vão sob `deploy.labels`, como no arquivo da stack). O Traefik v2/v3 encaminha WebSockets e `X-Forwarded-*` automaticamente e não tem timeout de inatividade em conexões com upgrade. Mantenha um redirecionamento HTTP→HTTPS no entrypoint `web` se você tiver um. As portas de mídia do LiveKit continuam sendo publicadas diretamente pelo serviço `livekit` (`mode: host` no Swarm).

## nginx

[`deploy/nginx/oficio.conf`](../../deploy/nginx/oficio.conf) é uma configuração completa para um nginx instalado no host com certificados do certbot. As partes essenciais:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream oficio_app     { server 127.0.0.1:4747; }
upstream oficio_livekit { server 127.0.0.1:7880; }

server {
    listen 443 ssl http2;
    server_name office.example.com;
    ssl_certificate     /etc/letsencrypt/live/office.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/office.example.com/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    client_max_body_size 2m;

    location / {
        proxy_pass http://oficio_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

server {
    listen 443 ssl http2;
    server_name livekit.example.com;
    # ssl_certificate ... for livekit.example.com
    location / {
        proxy_pass http://oficio_livekit;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Mais um server na porta 80 que redireciona para HTTPS. Certificados: `certbot --nginx -d office.example.com -d livekit.example.com`. O `client_max_body_size 2m` basta para os maiores documentos do editor de mapa (o próprio servidor limita uploads de mapa a 4 MiB; aumente ambos se você vir `413` ao salvar um mapa enorme). Se o nginx roda em um container, substitua `127.0.0.1` pelos nomes dos serviços e compartilhe uma rede com `app` e `livekit`.

## Nginx Proxy Manager

Com o NPM já servindo 80/443, remova o serviço `caddy` da stack, garanta que o container do NPM e `app`/`livekit` compartilhem uma rede Docker, e adicione dois proxy hosts na interface:

1. **Hosts → Proxy Hosts → Add Proxy Host.**
2. Aba *Details*: Domain Names `office.example.com`; Scheme `http`; Forward Hostname / IP `app` (o nome do serviço no compose, ou o IP do host quando o app não está no Docker); Forward Port `4747`; habilite **Websockets Support** (é esse o botão que define os headers `Upgrade`); **Block Common Exploits** pode ficar ligado.
3. Aba *SSL*: Request a new SSL certificate (Let's Encrypt), **Force SSL**, **HTTP/2 Support**, **HSTS Enabled**.
4. Aba *Advanced* (opcional): aumente os timeouts de inatividade do WebSocket:

   ```nginx
   proxy_read_timeout 3600s;
   proxy_send_timeout 3600s;
   ```

5. Repita para `livekit.example.com` → `livekit` porta `7880`, de novo com **Websockets Support** e um certificado.

O NPM envia `X-Forwarded-For` e `X-Forwarded-Proto` por padrão, então `TRUST_PROXY=1` está correto.

## Cloudflare Tunnel

Um túnel (`cloudflared`) permite que o **app** seja alcançado pela Cloudflare sem abrir 80/443 no host, e ele carrega WebSockets, então presença e chat funcionam. A **sinalização** do LiveKit também pode passar pelo túnel (é só HTTPS/WebSocket), mas a **mídia não pode**: o WebRTC precisa de UDP 7882 ou TCP 7881 direto até o host do LiveKit. Suas opções:

- Túnel para `office.example.com`, e `livekit.example.com` como um registro **DNS only** apontando para o host com 443 (Caddy/nginx), 7881 e 7882 abertas; ou
- Túnel para o app e **LiveKit Cloud** para a mídia, de modo que o host não exponha nada.

Configurações do túnel: public hostname `office.example.com` → service `http://app:4747` (ou `http://localhost:4747`), sem flags especiais para WebSockets. A Cloudflare adiciona `X-Forwarded-For` e `CF-Connecting-IP`; mantenha `TRUST_PROXY=1`. Defina `OFFICE_PUBLIC_URL=https://office.example.com` e `OFFICE_ALLOWED_HOSTS=office.example.com` como de costume, e `OFFICE_COOKIE_SECURE=1` (o navegador vê HTTPS). A Cloudflare pode fechar WebSockets que considera ociosos; o heartbeat de 20 segundos do Oficio mantém o socket ativo, então na prática isso não é um problema.

Não coloque o proxy de nuvem laranja na frente de `livekit.example.com`: o HTTP-01 do Let's Encrypt na origem falha e a mídia ficaria inalcançável.

## Verificando um proxy

```sh
# TLS and headers
curl -sI https://office.example.com/api/health | head -20

# WebSocket upgrade (101 expected)
curl -sI -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
     -H "Origin: https://office.example.com" https://office.example.com/ws
```

Sem um cookie de sessão a segunda requisição é recusada pelo app (ele verifica o cookie antes do upgrade), mas ver a recusa do app em vez de um erro do proxy prova que os headers de upgrade passaram. Um proxy que remove `Origin` ou `Upgrade` produz um fechamento imediato no navegador; veja [Solução de problemas](troubleshooting.md#403-host-not-allowed-ou-o-websocket-fecha-imediatamente).
