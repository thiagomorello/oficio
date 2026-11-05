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
| TURN | overlay opcional `docker-compose.turn.yml` (TLS na 5349, UDP na 3478, certificado do Caddy) | incluído, na 443 |
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

Normalmente um navegador alcança o SFU diretamente por UDP 7882, ou por TCP 7881 quando o UDP está bloqueado. Ambos falham em redes que bloqueiam o UDP **e** toda porta fora do padrão (proxies corporativos rígidos, alguns Wi-Fi de hotel e aeroporto). Para esses usuários você precisa de um relay TURN: o navegador abre uma conexão TLS com o servidor TURN, que entrega a mídia ao SFU. Os navegadores só usam o relay quando os caminhos diretos falham, então habilitá-lo não muda nada para o restante das pessoas.

O LiveKit tem um servidor TURN embutido, desabilitado na configuração incluída. A stack compose traz um overlay opcional, [`docker-compose.turn.yml`](../../docker-compose.turn.yml), que o liga usando o certificado que o Caddy já emite para `LIVEKIT_DOMAIN`: sem nome de host extra, sem certificado extra, sem cliente ACME.

### Habilitando o TURN com o overlay (recomendado)

1. Abra duas portas a mais no firewall do host e no firewall do provedor: `5349/tcp` (TURN sobre TLS) e `3478/udp` (TURN sobre UDP), além de 80, 443, 7881/tcp e 7882/udp.

   ```sh
   sudo ufw allow 5349/tcp
   sudo ufw allow 3478/udp
   ```

2. Suba a stack com o overlay. Daqui em diante passe os dois `-f` em todo comando `docker compose`, ou coloque `COMPOSE_FILE=docker-compose.yml:docker-compose.turn.yml` no `.env` para que o `docker compose` puro use os dois:

   ```sh
   docker compose -f docker-compose.yml -f docker-compose.turn.yml up -d
   docker compose -f docker-compose.yml -f docker-compose.turn.yml logs -f livekit
   ```

   Espere `[turn-cert-wait] certificate found, starting livekit-server with TURN` e, em seguida, a linha `Starting TURN server` do próprio LiveKit com `"turn.portTLS": 5349, "turn.portUDP": 3478`. Em uma instalação nova as linhas de espera aparecem antes: o certificado só existe depois que o Caddy o obteve (DNS apontando para o host, porta 80 acessível), e o wrapper fica consultando por ele por até `TURN_CERT_WAIT_SECONDS` (padrão 600) antes de sair e deixar o Docker reiniciar a espera. Enquanto isso o container aparece como *starting* no `docker compose ps`.

3. Escolha como as renovações do certificado chegam ao LiveKit (próxima seção).

O que o overlay faz, para você poder auditar:

- Monta o volume `caddy-data` como somente leitura no container `livekit`, em `/caddy`. O Caddy guarda os certificados em `/data/caddy/certificates/<emissor>/<domínio>/<domínio>.crt` e `.key`; o Caddyfile base fixa o emissor no Let's Encrypt (`acme_ca`) para que o nome do diretório seja previsível (`acme-v02.api.letsencrypt.org-directory`). Se você trocar o emissor no Caddyfile, troque os caminhos no overlay também.
- Substitui a configuração do LiveKit por uma cópia da base mais um bloco `turn:`: `domain: ${LIVEKIT_DOMAIN}`, `tls_port: 5349`, `udp_port: 3478`, `external_tls: false`, `cert_file`/`key_file` apontando para os arquivos do Caddy. As duas configurações são mantidas em sincronia à mão; os dois arquivos dizem isso em um comentário.
- Publica `${TURN_TLS_PORT:-5349}/tcp` e `${TURN_UDP_PORT:-3478}/udp`. O mesmo número é usado no host e no container porque o LiveKit anuncia a porta aos navegadores; mude os dois pelas variáveis do `.env`, não no arquivo compose.
- Envolve o entrypoint da imagem em um pequeno loop `sh` que espera pelo certificado e pela chave antes de dar `exec` no `/livekit-server`.

Os clientes descobrem o servidor TURN na resposta de join; nada muda no Oficio. A faixa de portas de relay que o LiveKit registra no log (`turn.relay_range_start` 30000–40000) é interna, entre o servidor TURN e o SFU no mesmo processo, e não precisa ser publicada nem aberta.

### Renovação do certificado

Certificados do Let's Encrypt valem 90 dias e o Caddy os renova no lugar, dentro do volume `caddy-data`, cerca de 30 dias antes de vencer. O LiveKit lê os arquivos só na inicialização, então precisa ser reiniciado depois de uma renovação; senão, uns três meses depois do primeiro start, o TURN/TLS passaria a apresentar um certificado vencido (a mídia direta por UDP/TCP não é afetada). Duas formas de automatizar o restart; escolha uma:

| | Cron no host: [`scripts/turn-restart-on-renew.sh`](../../scripts/turn-restart-on-renew.sh) | Sidecar: `--profile turn-reloader` |
|---|---|---|
| Como | o cron roda o script a cada 6 h; ele lê a data de modificação do certificado dentro do container `caddy`, compara com o valor salvo em `./.turn-cert.mtime` e roda `docker compose restart livekit` quando mudou | um container `docker:cli` (`turn-cert-reloader`) faz o mesmo loop com o volume de certificados e o socket do Docker montados como somente leitura, reiniciando o container `livekit` do mesmo projeto compose |
| Privilégios | nada além da CLI do docker que você já usa no host | acesso ao socket do Docker, que equivale a root no host. O container roda somente leitura, sem rede e com todas as capabilities removidas, mas um comprometimento da imagem ou do script controlaria o Docker |
| Configuração | uma linha no crontab | uma flag a mais no `up`; nada no host |

Cron:

```sh
# a cada 6 horas, a partir do diretório com docker-compose.yml e .env
0 */6 * * * cd /opt/oficio && ./scripts/turn-restart-on-renew.sh >> turn-renew.log 2>&1
```

Sidecar:

```sh
docker compose -f docker-compose.yml -f docker-compose.turn.yml --profile turn-reloader up -d
docker compose -f docker-compose.yml -f docker-compose.turn.yml --profile turn-reloader logs turn-cert-reloader
```

Fique com o sidecar se prefere não mexer no crontab do host e aceita o acesso ao socket; fique com o cron caso contrário. De um jeito ou de outro o restart interrompe áudio e vídeo por alguns segundos uma vez a cada ~60 dias; os navegadores reconectam sozinhos. `TURN_RELOADER_INTERVAL` (segundos, padrão 21600) muda a cadência do sidecar.

### Testando o TURN

1. A porta TLS apresenta o certificado do Caddy: `openssl s_client -connect livekit.example.com:5349 -servername livekit.example.com </dev/null 2>/dev/null | openssl x509 -noout -issuer -dates` imprime um emissor Let's Encrypt e a validade atual.
2. O testador de conexão do LiveKit em <https://livekit.io/connection-test> (token como em [Testando um deploy](#testando-um-deploy)) tem uma etapa **TURN** dedicada, que conecta com o ICE restrito a candidatos relay. Sem o overlay ela falha; com ele, precisa passar de qualquer rede.
3. De um navegador no escritório, `chrome://webrtc-internals` mostra o par de candidatos selecionado: `relay` significa que a mídia passa pelo TURN, `udp`/`tcp` são os caminhos diretos. `docker compose logs livekit` mostra as alocações.

### Limitações

- **O TURN/TLS escuta na 5349, não na 443.** O Caddy é dono da 443 no IP do host, para o app e para a sinalização. Redes que permitem *somente* a 443 continuam sem alcançar o relay. Servir TURN na 443 exige um segundo IP público no host ou um host TURN separado (com nome de host e certificado próprios), ou o LiveKit Cloud, que inclui TURN na 443. Redes que bloqueiam o UDP e liberam um punhado de portas TCP (o caso comum) são cobertas pela 5349.
- Uma instância tem uma única `LIVEKIT_URL`: você não pode manter o SFU auto-hospedado para a maioria das pessoas e mandar só a equipe afetada para o Cloud; é um ou outro.
- O overlay é para o `docker-compose.yml`; as stacks do Portainer mantêm o TURN desabilitado e precisam da configuração manual abaixo.

### Configuração manual (LiveKit em outro lugar)

Quando o LiveKit roda no próprio host, ou você quer outro arranjo, configure o bloco `turn:` você mesmo (veja [`deploy/livekit/livekit.yaml`](../../deploy/livekit/livekit.yaml)):

```yaml
turn:
  enabled: true
  domain: livekit.example.com   # o nome ao qual os navegadores se conectam; precisa bater com o certificado
  tls_port: 5349                # ou 443 se nada mais usa a porta nesse host
  udp_port: 3478
  external_tls: false           # o LiveKit termina o TLS com os arquivos abaixo
  cert_file: /certs/fullchain.pem
  key_file: /certs/privkey.pem
```

Monte o certificado e a chave como somente leitura, publique `tls_port/tcp` e `udp_port/udp`, e reinicie o LiveKit depois de cada renovação. Com `external_tls: true`, um proxy que termina TLS (Caddy `layer4`/SNI, nginx `stream` com `ssl_preread`, HAProxy) encaminha o SNI do nome de host do TURN para a `tls_port` do LiveKit; é assim também que a 443 pode ser compartilhada com um servidor web no mesmo IP, ao preço de rodar esse proxy.

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
