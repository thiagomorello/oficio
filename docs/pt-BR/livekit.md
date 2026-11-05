# LiveKit (áudio, vídeo e compartilhamento de tela)

O Oficio não retransmite mídia por conta própria: os navegadores trocam áudio e vídeo por meio de um SFU [LiveKit](https://livekit.io), seja o container incluído no `docker-compose.yml` ou o LiveKit Cloud. Esta página explica como as duas opções diferem, como o par de chaves de API liga o app ao servidor, quais portas e configurações de NAT importam, a diferença entre `node_ip` e `use_external_ip`, porta única versus faixa de portas, quando você precisa de TURN e como habilitá-lo, como testar um deploy e como o LiveKit escala.

## Como o Oficio usa o LiveKit

- O escritório inteiro é **uma sala** (`LIVEKIT_ROOM`, padrão `oficio`). A privacidade vem das inscrições: o servidor do Oficio calcula quem pode ouvir quem a partir das posições e das salas de reunião, e o navegador se inscreve somente nessas pessoas (e diz ao SFU quem pode se inscrever nele). Veja [Arquitetura → Fluxo de tokens do LiveKit](architecture.md#fluxo-de-tokens-do-livekit-e-proximidade).
- O servidor **emite os tokens de acesso** (12 h, identidade `u<userId>`) com `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`. Os navegadores recebem o token na mensagem WebSocket `welcome` ou em `GET /api/livekit/token`.
- O navegador se conecta a **`LIVEKIT_URL`** (`wss://…`) para sinalização, e então negocia a mídia WebRTC diretamente com o SFU por UDP (ou TCP como fallback).
- O servidor fala com a **API room-service** do LiveKit em `LIVEKIT_INTERNAL_URL` (HTTP) para ajustar permissões de participantes.

Sem as três variáveis do LiveKit o escritório continua funcionando: presença, movimento, salas, mesas e chat independem do LiveKit. `/api/health` informa `"livekit": false` e os botões de A/V ficam desabilitados.

## Auto-hospedado (compose) vs LiveKit Cloud

| | Auto-hospedado (`docker-compose.yml`) | LiveKit Cloud |
|---|---|---|
| Roda onde | um container `livekit/livekit-server` ao lado do app | na infraestrutura do LiveKit |
| Portas a abrir | 7881/tcp, 7882/udp (mais a 443 via Caddy para sinalização) | nenhuma |
| DNS | um segundo nome, `livekit.example.com` | nenhum |
| `LIVEKIT_URL` | `wss://livekit.example.com` | `wss://<project>.livekit.cloud` |
| `LIVEKIT_INTERNAL_URL` | `http://livekit:7880` | o mesmo de `LIVEKIT_URL` |
| Chaves | você as gera (`gen-secrets.sh`) | a chave e o segredo de API do projeto, no painel do Cloud |
| TURN | desabilitado por padrão; você adiciona se precisar | incluído |
| Custo | a banda do seu VPS | preço por minuto com um nível gratuito |
| Bom para | equipes de até ~150 em um host bem dimensionado, soberania de dados | zero operação, presença global, equipes espalhadas por continentes |

### Migrando para o LiveKit Cloud

1. Crie um projeto no LiveKit Cloud e copie sua URL WebSocket, chave de API e segredo.
2. No `.env`:

   ```ini
   LIVEKIT_URL=wss://your-project.livekit.cloud
   LIVEKIT_INTERNAL_URL=wss://your-project.livekit.cloud
   LIVEKIT_API_KEY=<project key>
   LIVEKIT_API_SECRET=<project secret>
   ```

3. Remova o serviço `livekit` do seu arquivo compose (ou escale-o para zero), o bloco `{$LIVEKIT_DOMAIN}` da configuração do Caddy, e feche 7881/7882 no firewall.
4. `docker compose up -d`. Guias de plataformas que não têm UDP nenhum (Railway, Render, Fly, DigitalOcean App Platform) sempre usam esse caminho; veja `deploy/livekit-cloud.md`.

## Chaves: como o par funciona

O LiveKit autentica todo token com um mapa **chave de API → segredo**. O mesmo par precisa ser conhecido pelos dois lados:

- No container LiveKit ele chega por `LIVEKIT_KEYS: "<key>: <secret>"` (compose) ou por um bloco `keys:` no `livekit.yaml`.
- No app ele chega por `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET`, que o `docker-compose.yml` passa aos dois serviços a partir das mesmas linhas do `.env`, então eles não podem divergir.

`scripts/gen-secrets.sh` os cria como `API` + 12 caracteres hex e um segredo de 48 caracteres hex (o LiveKit exige pelo menos 32 caracteres). Se você vir `401` ou "invalid token" no console do navegador enquanto `/api/livekit/token` devolve `200`, os pares diferem: compare `docker compose exec app env | grep LIVEKIT_API` com `docker compose exec livekit env | grep LIVEKIT_KEYS`.

## Portas e NAT

O arquivo compose publica duas portas de mídia no host e mantém a sinalização atrás do Caddy:

| Porta | Papel |
|---|---|
| 7880/tcp (interna) | sinalização + health. O Caddy termina o TLS de `https://livekit.example.com` e faz proxy para aqui. `curl https://livekit.example.com/` responde `OK`. |
| 7881/tcp (pública) | ICE sobre TCP. Fallback quando o UDP está bloqueado; funciona, com mais latência. |
| 7882/udp (pública) | toda a mídia. Uma porta para todos os participantes (o LiveKit multiplexa). |

As portas de mídia são publicadas **diretamente no host**, não pelo proxy: o WebRTC precisa que o navegador alcance o SFU no IP:porta anunciado nos candidatos ICE. É por isso que o IP anunciado importa tanto.

### `use_external_ip` vs `node_ip`

A configuração incluída diz:

```yaml
rtc:
  use_external_ip: true
  node_ip: ${LIVEKIT_NODE_IP:-}
```

- **`use_external_ip: true`** faz o LiveKit descobrir seu IP público via STUN na inicialização e anunciá-lo. Funciona para o caso comum de VPS (IP público na interface, ou um NAT 1:1 de nuvem) sem configuração.
- **`node_ip`** fixa o endereço anunciado. Defina `LIVEKIT_NODE_IP=203.0.113.10` no `.env` sempre que souber o IP público. É **obrigatório** em Docker Swarm / redes overlay (a stack Swarm define `use_external_ip: false` e restringe o UDP à faixa do `docker_gwbridge`), em hosts com vários endereços públicos, e sempre que o sintoma for "sinalização funciona, chat funciona, mas não tem áudio".

Se o host está atrás de um NAT que você não controla (servidor em casa, algumas redes de escritório), encaminhe 7881/tcp e 7882/udp para ele e defina `node_ip` como o endereço público do NAT.

### Porta UDP única vs faixa

A configuração do compose usa `udp_port: 7882`: uma porta UDP para todo mundo, a regra de firewall mais simples. A alternativa em [`deploy/livekit/livekit.yaml`](../../deploy/livekit/livekit.yaml) é uma faixa:

```yaml
rtc:
  tcp_port: 7881
  # udp_port: 7882
  port_range_start: 50000
  port_range_end: 60000
```

Uma faixa dá a cada participante suas próprias portas, o que alguns NATs muito antigos lidam melhor e o que distribui a carga entre sockets. Exige publicar a faixa inteira no Docker (`"50000-60000:50000-60000/udp"`), o que o Docker faz lentamente na inicialização do container quando são milhares de portas. Fique com a porta única a menos que tenha um motivo concreto.

### Rodando o LiveKit em um host próprio

Para 100+ pessoas, ou para tirar a mídia do host do app, rode o LiveKit em outro lugar:

1. Instale o `livekit-server` (binário ou container) com [`deploy/livekit/livekit.yaml`](../../deploy/livekit/livekit.yaml), defina `keys:` (ou `LIVEKIT_KEYS`), `node_ip` como o IP público desse host, e abra 7881/tcp + 7882/udp lá.
2. Coloque TLS na frente da 7880 nesse host (Caddy: `livekit.example.com { reverse_proxy 127.0.0.1:7880 }`), ou termine o TLS no host do app e faça proxy para o host do LiveKit por uma rede privada.
3. No `.env` do app: `LIVEKIT_URL=wss://livekit.example.com`, `LIVEKIT_INTERNAL_URL=http://<private-ip>:7880` (ou a URL pública `https://`), e a mesma chave/segredo.
4. Remova o serviço `livekit` do arquivo compose do app.

## TURN: quando e como

Normalmente um navegador alcança o SFU diretamente por UDP 7882, ou por TCP 7881 quando o UDP está bloqueado. Ambos falham somente em redes que permitem **nada além da 443** (proxies corporativos rígidos, alguns Wi-Fi de hotel e aeroporto). Para esses usuários você precisa de um relay TURN que escute na 443 (TLS) e retransmita a mídia para o SFU.

O LiveKit tem um servidor TURN embutido, desabilitado na configuração incluída:

```yaml
turn:
  enabled: false
```

Para habilitá-lo:

1. Escolha um **nome de host separado** para o TURN, por exemplo `turn.example.com`, apontando para o mesmo host. TURN/TLS precisa do próprio certificado; não pode compartilhar a 443 do Caddy do domínio do escritório a menos que você use roteamento por SNI.
2. Configure o LiveKit (no bloco `livekit_config` do compose ou no `livekit.yaml`):

   ```yaml
   turn:
     enabled: true
     domain: turn.example.com
     tls_port: 5349      # or 443 if nothing else uses it on this host
     udp_port: 3478
     # external_tls: true   # when a proxy (Caddy/nginx with SNI) terminates TLS in front of LiveKit
   ```

   Com `external_tls: false` (padrão), o próprio LiveKit precisa dos arquivos de certificado e chave de `turn.example.com` (`cert_file`/`key_file` sob `turn:`); monte-os como somente leitura no container e renove-os com a sua ferramenta ACME. Com `external_tls: true`, um proxy que termina TLS (Caddy layer4/SNI, nginx `stream` com `ssl_preread`, HAProxy) encaminha o SNI `turn.example.com` para a `tls_port` do LiveKit.
3. Publique as portas no host: `5349/tcp` (ou `443/tcp` se dedicada) e `3478/udp`.
4. Reinicie o LiveKit. Os clientes descobrem o servidor TURN automaticamente na resposta de join; nada muda no Oficio.

Usar **443/tcp para o TURN** no mesmo host do Caddy exige roteamento baseado em SNI na frente de ambos (o módulo `layer4` do Caddy ou o `stream` do nginx), porque só um processo pode ser dono da porta. Se isso é mais infraestrutura do que você quer, o LiveKit Cloud inclui TURN na 443 de fábrica. Note que uma instância tem uma única `LIVEKIT_URL`, então você não pode manter o SFU auto-hospedado para a maioria das pessoas e mandar só a equipe afetada para o Cloud; é um ou outro.

## Testando um deploy

1. **A sinalização está acessível com TLS:**

   ```sh
   curl -i https://livekit.example.com/
   ```

   Espere `HTTP/2 200` e o corpo `OK`. Um erro de certificado significa que o Caddy não obteve o certificado; um `502` significa que o Caddy não consegue alcançar o container.

2. **O Oficio consegue emitir tokens:** entre e abra `https://office.example.com/api/livekit/token` no mesmo navegador. Espere `{"url":"wss://livekit.example.com","token":"eyJ…","room":"oficio"}`. Um `503` significa que as três variáveis `LIVEKIT_*` não estão todas definidas no app.

3. **Um navegador consegue de fato entrar e enviar mídia:** gere um token de teste e cole-o, junto com a URL `wss://`, no testador de conexão do LiveKit em <https://livekit.io/connection-test>. Ele reporta os resultados de sinalização, ICE (UDP/TCP) e publish/subscribe, e diz com precisão se o UDP está bloqueado.

   Token com o Node e o SDK já instalados na imagem do app:

   ```sh
   docker compose exec app node --input-type=module -e '
   import { AccessToken } from "livekit-server-sdk";
   const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: "connection-test", ttl: "1h" });
   at.addGrant({ roomJoin: true, room: process.env.LIVEKIT_ROOM ?? "oficio" });
   console.log(await at.toJwt());'
   ```

   Ou com a CLI do LiveKit (`lk`):

   ```sh
   lk token create --api-key "$LIVEKIT_API_KEY" --api-secret "$LIVEKIT_API_SECRET" \
     --join --room oficio --identity connection-test --valid-for 1h
   ```

4. **De ponta a ponta:** duas pessoas em dois navegadores (ou um navegador e uma janela anônima com uma segunda conta) se aproximam uma da outra na recepção. Confira em `chrome://webrtc-internals` o par de candidatos selecionado: `udp` significa o caminho normal, `tcp` significa que o UDP está bloqueado para aquele cliente.

5. **Logs:** `docker compose logs -f livekit`. Os participantes aparecem com a identidade do Oficio (`u12`); linhas repetidas de falha de ICE apontam para o IP anunciado ou para o firewall.

## Notas sobre escala

- Um único nó LiveKit lida com um escritório de ~150 pessoas confortavelmente em 4 vCPU, porque a proximidade mantém cada cliente em 8–10 inscrições. A CPU cresce com o número de streams encaminhados, não com o tamanho da sala; o LiveKit não faz transcodificação.
- Banda: por stream inscrito, 300 kbps–1,5 Mbps de vídeo e ~40 kbps de áudio; o egress do servidor é a soma de todas as inscrições.
- Defina `LIVEKIT_NODE_IP`, dê folga ao container (`memory: 2g` no compose) e considere um host dedicado antes de adicionar mais CPU ao host do app.
- LiveKit multi-nó (vários SFUs compartilhando salas via Redis) é possível, mas está fora do escopo da stack compose; nesse tamanho o LiveKit Cloud costuma ser o caminho mais barato.
- Atualizando o LiveKit: o arquivo compose fixa `livekit/livekit-server:v1.13.11`. Suba a tag deliberadamente e leia as notas de release do LiveKit; o SDK cliente no app (`livekit-client` 2.x) é compatível com toda a linha 1.x do servidor. Veja [Atualização](upgrading.md).

## Relacionado

- [Requisitos → Rede e portas](requirements.md#rede-e-portas)
- [Proxy reverso e TLS](reverse-proxy.md) para Traefik/nginx na frente da sinalização
- [Solução de problemas](troubleshooting.md) para "sem áudio", `401` e falhas de ICE
