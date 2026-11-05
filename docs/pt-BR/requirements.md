# Requisitos

O que você precisa antes de instalar o Oficio: um host Linux dimensionado para a sua equipe, Docker (ou Node.js e MySQL para rodar a partir do código-fonte), um punhado de portas abertas, dois nomes DNS com HTTPS e um navegador moderno em cada mesa. Esta página lista tudo isso e termina com um checklist para você marcar antes de rodar `docker compose up -d`.

## Hardware

O Oficio tem quatro partes móveis: o **app** (Node.js, mantém o estado do escritório em memória), o **MySQL**, o servidor de mídia **LiveKit** (áudio, vídeo, compartilhamento de tela) e o **Caddy** (proxy reverso com TLS automático). Em um único VPS, todos compartilham a mesma máquina. Os números abaixo são estimativas para a stack inteira; o resultado real depende de quantas câmeras estão ligadas ao mesmo tempo.

| Pessoas simultâneas | vCPU | RAM | Disco | Observações |
|---|---|---|---|---|
| até ~15 | 1 | 2 GB | 20 GB SSD | O menor VPS que a maioria dos provedores vende. Suficiente para uma equipe pequena. |
| até ~50 | 2 | 4 GB | 40 GB SSD | Folga confortável para o LiveKit quando várias câmeras estão ligadas. |
| até ~150 | 4 | 8 GB | 80 GB SSD | Rode o LiveKit em um host próprio, ou use o LiveKit Cloud, para que a carga de mídia não concorra com o app. |

Para onde vai a memória, aproximadamente:

| Componente | Ocioso | Crescimento |
|---|---|---|
| app | 150–300 MB | pequeno; o estado do escritório é minúsculo comparado com a base do Node |
| MySQL 8 | 400–800 MB | limitado por `innodb-buffer-pool-size` (256 MB no arquivo compose, `MYSQL_BUFFER_POOL`) |
| LiveKit | ~200 MB | cerca de 5 MB por participante conectado |
| Caddy | ~30 MB | desprezível |

O arquivo compose define limites de memória (app 1 GB, LiveKit 2 GB, MySQL 1 GB) para que um processo descontrolado não derrube o host.

### O que realmente custa CPU e banda

O app em si é barato: ele roda uma simulação a 20 Hz de algumas dezenas de avatares e envia deltas de posição a 10 Hz por WebSocket. A parte cara é a mídia. O LiveKit é um SFU: cada publicador envia um stream para cima, e o servidor o encaminha para todo mundo que está inscrito. CPU e egress, portanto, escalam com o **número de inscrições**, não com o número de pessoas online.

A proximidade mantém esse número pequeno. Uma pessoa só se inscreve nas pessoas próximas ou na mesma sala de reunião; na prática isso dá no máximo 8–10 streams por cliente. Por stream, reserve 300 kbps–1,5 Mbps para vídeo e cerca de 40 kbps para áudio. A banda de saída do servidor é aproximadamente a soma de todas as inscrições ativas. Um escritório de 50 pessoas com, digamos, seis reuniões de quatro pessoas com câmera ligada precisa de algo em torno de 20–30 Mbps de egress, o que qualquer VPS oferece.

## Software

### Rodando com Docker (recomendado)

- **Docker 24+** com **Docker Compose v2.23 ou mais novo**. Os arquivos compose usam `configs: content:` (configuração inline), que versões mais antigas do Compose não entendem. Verifique com `docker compose version`.
- Um host Linux 64 bits. **Ubuntu 22.04 / 24.04** ou **Debian 12** são as bases testadas. A imagem é multi-arch (linux/amd64 e linux/arm64), então máquinas ARM também funcionam.
- `git` e `openssl` (usados por `scripts/gen-secrets.sh`).

### Rodando a partir do código-fonte

- **Node.js 22+** (`engines.node >= 22` em `../../package.json`).
- **MySQL 8** acessível a partir do app (`DATABASE_URL`).
- Um servidor LiveKit (auto-hospedado ou LiveKit Cloud) se você quiser áudio e vídeo.
- Um proxy reverso para TLS: o processo Node serve HTTP puro na porta 4747.

Veja [Configuração](configuration.md) e [CONTRIBUTING.md](../../CONTRIBUTING.md) para o ambiente de desenvolvimento, que roda com dados em memória e sem MySQL.

## Rede e portas

| Porta | Protocolo | Quem escuta | Exposta à internet? | Finalidade |
|---|---|---|---|---|
| 80 | TCP | Caddy | sim | Redirecionamento de HTTP para HTTPS e desafios HTTP-01 do Let's Encrypt |
| 443 | TCP | Caddy | sim | HTTPS para o app e `wss://` para o WebSocket em `/ws`; HTTPS para a sinalização do LiveKit |
| 443 | UDP | Caddy | opcional | HTTP/3 (QUIC). Bom ter, não é obrigatório |
| 7880 | TCP | LiveKit | não | Sinalização do LiveKit (HTTP/WebSocket). O Caddy faz proxy de `https://livekit.example.com` para ela |
| 7881 | TCP | LiveKit | sim | ICE sobre TCP: fallback de mídia quando o UDP está bloqueado |
| 7882 | UDP | LiveKit | sim | Toda a mídia WebRTC (áudio, vídeo, tela) em uma única porta UDP |
| 4747 | TCP | app | não | HTTP + WebSocket do app. Só o Caddy fala com ele |
| 3306 | TCP | MySQL | não | Banco de dados. Nunca exponha |

`7881` e `7882` são os padrões; altere-os com `LIVEKIT_TCP_PORT` / `LIVEKIT_UDP_PORT` no `.env`. Como alternativa a uma única porta UDP, o LiveKit pode usar uma faixa como `50000-60000/udp` (veja [`deploy/livekit/livekit.yaml`](../../deploy/livekit/livekit.yaml) e [LiveKit](livekit.md)); a porta única é mais simples de liberar no firewall e é o que o arquivo compose usa.

Um firewall mínimo com `ufw`:

```sh
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw allow 7881/tcp
sudo ufw allow 7882/udp
sudo ufw enable
```

Provedores de nuvem costumam ter um segundo firewall no painel de controle (security groups); abra as mesmas portas lá.

### O que acontece quando o UDP está bloqueado

O WebRTC prefere UDP. Se um participante está atrás de um firewall corporativo que descarta UDP, o navegador recorre a **ICE sobre TCP na porta 7881**. As chamadas continuam funcionando, mas com mais latência e mais jitter, porque o TCP retransmite pacotes perdidos em vez de pulá-los. Se uma rede bloqueia tudo exceto a 443, até o fallback TCP falha; esse é o único caso em que você precisa de um servidor TURN, que vem desabilitado por padrão. [LiveKit](livekit.md) explica quando e como habilitá-lo.

Presença e chat nunca dependem de UDP: eles viajam pelo WebSocket na 443.

## Domínios, DNS e TLS

Você precisa de **dois nomes de host** apontando para o mesmo IP público:

| Nome | Exemplo | Usado para |
|---|---|---|
| `OFFICE_DOMAIN` | `office.example.com` | o app: páginas, API, WebSocket |
| `LIVEKIT_DOMAIN` | `livekit.example.com` | sinalização do LiveKit (`wss://livekit.example.com`) |

Crie dois **registros A** (e AAAA se você tiver IPv6) e espere até que resolvam a partir do próprio host (`dig +short office.example.com`). O Caddy solicita certificados ao Let's Encrypt na primeira inicialização; se o DNS ainda não estiver pronto ele tenta de novo, mas os primeiros minutos são mais tranquilos quando o DNS já funciona.

**HTTPS é obrigatório.** Os navegadores só concedem `getUserMedia` (microfone e câmera) em origens `https://` ou em `localhost`. Sem TLS, os botões de microfone e câmera silenciosamente não fazem nada, e o cookie de sessão (`OFFICE_COOKIE_SECURE=1`) nunca é armazenado.

**Usuários do Cloudflare:** mantenha os dois registros como **DNS only** (nuvem cinza). Atrás do proxy de nuvem laranja, a mídia WebRTC (UDP 7882 / TCP 7881) não consegue alcançar o seu host e a validação HTTP-01 do Let's Encrypt falha. Um Cloudflare Tunnel pode ficar na frente do app, mas a mídia do LiveKit ainda precisa de um caminho direto ou do LiveKit Cloud; veja [Proxy reverso e TLS](reverse-proxy.md).

## Navegadores

Qualquer navegador atual com suporte a WebRTC e WebSocket:

- Chrome, Edge, Firefox e Safari, versão principal atual e anterior.
- Navegadores móveis (Safari no iOS, Chrome no Android) funcionam para presença e chat. Áudio e vídeo dependem do aparelho e das políticas de autoplay e segundo plano do navegador; trate o celular como "bom o bastante para ver quem está por perto", não como o cliente principal.
- O escritório é desenhado em um canvas HTML com pixel art, então pesa pouco na GPU. Laptops antigos rodam sem problema.

Cada pessoa precisa permitir o acesso ao microfone e à câmera quando o navegador pedir; uma permissão negada precisa ser redefinida nas configurações do site no navegador.

## Serviços opcionais

| Serviço | Necessário para | Sem ele |
|---|---|---|
| **SendGrid** (`SENDGRID_API_KEY` + `MAIL_FROM`) | e-mails de convite com a senha temporária e links de "esqueci minha senha" | o administrador vê a senha temporária na tela e a repassa; "esqueci minha senha" orienta o usuário a procurar um administrador |
| **Armazenamento compatível com S3** (`S3_BUCKET`, `S3_ENDPOINT`, `AWS_*` para `scripts/backup.sh`) | cópias externas dos dumps do banco de dados | os dumps ficam no disco do host |
| **Prometheus** (coleta `GET /metrics`, protegido por `METRICS_TOKEN`) | dashboards e alertas | o endpoint continua existindo; ninguém o lê |
| **LiveKit Cloud** | áudio/vídeo sem rodar o servidor de mídia você mesmo | você roda o container LiveKit incluído |
| **MySQL gerenciado** | não rodar o banco de dados você mesmo | você roda o container `mysql:8.0` incluído |

## Checklist pré-instalação

- [ ] Um host Linux (Ubuntu 22.04/24.04 ou Debian 12) com **IPv4 público** e pelo menos 1 vCPU / 2 GB de RAM.
- [ ] `docker compose version` imprime 2.23 ou mais novo.
- [ ] Dois registros A de DNS (`office.…` e `livekit.…`) resolvem para o host. Proxy do Cloudflare **desligado**.
- [ ] Firewall (host e provedor) permite entrada em 80/tcp, 443/tcp, 7881/tcp, 7882/udp.
- [ ] Você sabe o IP público do host (`curl -4 ifconfig.me`) para definir `LIVEKIT_NODE_IP`.
- [ ] Um endereço de e-mail para os avisos de expiração do Let's Encrypt (`ACME_EMAIL`).
- [ ] Opcional: uma chave de API do SendGrid e um endereço de remetente verificado.
- [ ] Opcional: um bucket S3 para backups externos.
- [ ] Você leu as notas de hardening em [SECURITY.md](../../SECURITY.md).

Próximo passo: [Início rápido](quickstart.md).
