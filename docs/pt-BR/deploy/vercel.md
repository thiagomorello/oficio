# Deploy na Vercel

Versão curta: **o Oficio não roda na Vercel.** Esta página explica o motivo, para você não gastar uma tarde tentando, e aponta plataformas que oferecem uma experiência parecida de "conecte o repositório e pronto".

| | |
|---|---|
| **O que você obtém** | Nada utilizável: a Vercel não consegue hospedar o servidor do Oficio. |
| **Custo mensal** | Não se aplica. |
| **Tempo necessário** | 2 minutos para ler isto. |
| **Áudio/vídeo** | Impossível a partir da Vercel. |
| **Banco de dados** | Não se aplica. |

## Por que não encaixa

A Vercel foi feita para sites estáticos e funções serverless ou edge de vida curta, que respondem uma requisição HTTP e encerram. O Oficio é o tipo oposto de programa:

1. **Um processo de longa duração.** O servidor roda a simulação do escritório a 20 Hz e mantém todo o estado do escritório (posições, salas, mesas, quem está falando) em memória. Ele precisa continuar rodando entre as requisições; uma função que sobe a cada requisição não tem memória do escritório.
2. **WebSockets.** Cada navegador mantém um WebSocket persistente (`/ws`) aberto com esse processo durante toda a sessão. Funções da Vercel não aceitam conexões WebSocket de entrada.
3. **MySQL.** O Oficio precisa de um banco MySQL 8 e de um servidor que mantenha um pool de conexões com ele.
4. **UDP para mídia.** O LiveKit auto-hospedado precisa de 7882/udp (e 7881/tcp) abertos para a internet. A Vercel expõe apenas HTTPS.
5. **Uma instância.** Mesmo que tudo acima fosse resolvido, o Oficio roda como exatamente uma réplica por design; plataformas serverless escalam rodando muitas cópias.

Nenhum desses pontos é problema de configuração; é a forma da aplicação. Separar o frontend na Vercel e o servidor em outro lugar também não rende nada: o frontend são alguns arquivos estáticos que o servidor Node já serve, e o navegador continuaria precisando que o servidor, o WebSocket e o LiveKit vivessem em outro lugar. Não recomendamos nem documentamos essa separação.

## O que usar no lugar

Se você gosta do fluxo da Vercel (conectar um repositório, receber uma URL, fazer push para o deploy):

| Plataforma | Guia | Observações |
|---|---|---|
| Railway | [railway.md](railway.md) | Build a partir do Dockerfile, serviço MySQL incluído, LiveKit Cloud para áudio/vídeo. O mais parecido com a sensação da Vercel. |
| Render | [render.md](render.md) | Blueprint (`render.yaml`), MySQL externo, LiveKit Cloud. |
| Fly.io | [fly.md](fly.md) | `fly launch` com o `fly.toml` que acompanha o repositório, MySQL externo, LiveKit Cloud. |
| DigitalOcean App Platform | [digitalocean.md](digitalocean.md#caminho-b-app-platform) | App spec em `.do/app.yaml`, Managed MySQL, LiveKit Cloud. |

Se um servidor não é problema para você, um VPS pequeno roda tudo, áudio/vídeo incluídos, pelo preço de um café: [docker-compose-vps.md](docker-compose-vps.md).

## Usando um domínio gerenciado na Vercel

Se por acaso o seu DNS está hospedado na Vercel (porque o domínio foi comprado ou transferido para lá), isso é só DNS e funciona com qualquer um dos deploys acima:

1. Painel da Vercel: **Domains**, clique no domínio, **DNS Records**.
2. Adicione um registro **A** `office` apontando para o IP do seu servidor (VPS, Droplet), ou um **CNAME** `office` apontando para o nome de host que a sua plataforma forneceu (Railway, Render, Fly, App Platform).
3. Para um LiveKit auto-hospedado, adicione o segundo registro **A** `livekit`.

Nada mais da Vercel entra na história. O resto da configuração está no guia da plataforma que você escolheu.
