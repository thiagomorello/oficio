# Deploy no LiveKit Cloud (apenas áudio/vídeo)

O Oficio usa o [LiveKit](https://livekit.io) para áudio por proximidade, vídeo e compartilhamento de tela. Por padrão a stack do compose roda o seu próprio servidor LiveKit; este guia o troca pelo **LiveKit Cloud**, o serviço hospedado do LiveKit, enquanto todo o resto (o app, o banco de dados) fica onde você fez o deploy.

| | |
|---|---|
| **O que você obtém** | Áudio/vídeo servidos pela rede global do LiveKit; nenhuma porta de mídia para abrir, nenhum `livekit.example.com`, nenhum container do LiveKit para rodar. |
| **Custo mensal** | Existe um nível gratuito (no fim de 2026 o plano "Build" inclui 5.000 minutos de participante por mês); os planos pagos começam em torno de US$ 50/mês com uma cota incluída generosa e excedente cobrado por minuto. Consulte livekit.io/pricing: os números mudam. |
| **Tempo necessário** | 10 minutos. |
| **Áudio/vídeo** | LiveKit Cloud. |
| **Banco de dados** | Inalterado: onde quer que o seu Oficio rode. |

Quando usar:

- Sua plataforma de hospedagem **não tem UDP** (Railway, Render, DigitalOcean App Platform, Fly.io sem trabalho extra, a maioria das configurações de ingress do Kubernetes).
- Você não quer dimensionar e monitorar um servidor de mídia, ou o seu time está espalhado por vários continentes (o LiveKit Cloud direciona cada pessoa para um ponto de presença próximo).
- Você está avaliando o Oficio e quer o caminho mais rápido até um áudio funcionando.

Quando não usar: você precisa que a mídia fique na sua própria infraestrutura, ou o uso está muito acima do nível gratuito e um VPS pequeno sai mais barato.

## 1. Crie o projeto

1. Acesse **cloud.livekit.io** e entre (GitHub, Google ou e-mail).
2. **Create project**. Dê o nome `oficio`. Escolha o plano (comece pelo gratuito).
3. No projeto, abra **Settings** (menu à esquerda). A seção **Project** mostra a **WebSocket URL**: `wss://oficio-abc123.livekit.cloud`. Copie-a; essa é a `LIVEKIT_URL`.

## 2. Crie uma API key

1. **Settings > Keys** (às vezes rotulado **API Keys**) **> Create key**.
2. Dê uma descrição (`oficio server`) e crie.
3. Copie a **API Key** (`APIxxxxxxxxxxxx`) e o **Secret**. O secret é mostrado uma única vez; guarde-o no seu gerenciador de senhas.

Essa chave permite que o servidor do Oficio emita tokens de acesso e gerencie a sala; ela nunca chega ao navegador.

## 3. Configure o Oficio

Quatro variáveis, iguais em qualquer plataforma:

| Variável | Valor |
|---|---|
| `LIVEKIT_URL` | `wss://oficio-abc123.livekit.cloud` (a que os navegadores se conectam) |
| `LIVEKIT_INTERNAL_URL` | a mesma URL `wss://...` (as chamadas de API do servidor também vão para o LiveKit Cloud) |
| `LIVEKIT_API_KEY` | a chave do passo 2 |
| `LIVEKIT_API_SECRET` | o secret do passo 2 |

`LIVEKIT_ROOM` continua `oficio` (nome da única sala que o Oficio usa; o LiveKit Cloud a cria automaticamente).

### Docker Compose em um VPS

1. Edite o `.env`: defina as quatro variáveis acima. Remova as linhas `LIVEKIT_NODE_IP`, `LIVEKIT_TCP_PORT`, `LIVEKIT_UDP_PORT` ou deixe-as; elas são ignoradas sem o servidor local.
2. Desative o serviço LiveKit local. Crie `docker-compose.override.yml` ao lado do `docker-compose.yml`:

   ```yaml
   services:
     livekit:
       deploy:
         replicas: 0
   ```

   `LIVEKIT_DOMAIN` ainda precisa estar definido no `.env` porque a configuração do Caddy faz referência a ele; qualquer nome serve e o registro DNS pode ser excluído. Você também pode fechar 7881/tcp e 7882/udp no firewall.
3. Aplique:

   ```sh
   docker compose up -d
   docker compose ps          # no livekit container; app healthy
   curl -s https://office.example.com/api/health   # "livekit":true
   ```

### Portainer, Coolify, Dokploy

Remova o serviço `livekit` do YAML da stack (e com ele o `ports:` de 7881/7882) e defina as quatro variáveis na interface de variáveis de ambiente da plataforma. Detalhes em [portainer.md](portainer.md), [coolify.md](coolify.md), [dokploy.md](dokploy.md).

### Railway, Render, Fly.io, DigitalOcean App Platform, Kubernetes

Esses guias já assumem o LiveKit Cloud: cole as quatro variáveis onde cada guia indica (**Variables** no Railway, **Environment** no Render, `fly secrets set`, o spec do App Platform, um `Secret` do Kubernetes).

## 4. Teste

1. `GET https://office.example.com/api/health` precisa reportar `"livekit":true` (isso só confere que há uma chave configurada).
2. Entre com dois navegadores (ou com um colega), caminhem até ficar lado a lado e permitam o microfone. Falem: vocês devem se ouvir em menos de um segundo.
3. No painel do LiveKit Cloud, **Sessions** mostra a sala `oficio` com os participantes conectados enquanto houver pessoas em chamada; isso confirma que a chave e a URL estão certas.
4. Para uma verificação em nível de rede a partir de qualquer computador, abra **livekit.io/connection-test**, cole a URL `wss://` e um token. Você pode gerar um token no painel do Cloud (**Settings > Keys > Generate token** em uma chave) ou com a CLI `lk`: `lk token create --api-key APIxxx --api-secret ... --join --room oficio --identity test`. A página informa se signaling, TURN e mídia UDP/TCP alcançam o serviço a partir da sua rede.

## 5. Limites e o que acompanhar

- **Minutos**: o LiveKit cobra por minuto de participante conectado a uma sala. O Oficio conecta uma pessoa à sala apenas enquanto ela está perto de alguém (ou dentro de uma sala de reunião), então o tempo parado em uma mesa não conta. Acompanhe **Usage** no painel nas primeiras semanas e compare com o plano.
- **Concorrência**: o nível gratuito limita participantes simultâneos; veja **Settings > Quotas** (ou a página de cotas na documentação do LiveKit) para o valor atual.
- **Regiões**: o LiveKit Cloud é uma malha global; você não escolhe região. Cada participante se conecta à borda mais próxima.
- **Amigável a firewalls**: o LiveKit Cloud inclui TURN sobre TLS na porta 443, então pessoas em redes corporativas restritivas normalmente se conectam sem nenhuma mudança do seu lado.
- **Rotação de chaves**: crie uma segunda chave, atualize `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`, refaça o deploy e então exclua a chave antiga no painel.

## 6. Voltando para o LiveKit auto-hospedado

1. Garanta que `livekit.example.com` resolve para o servidor e que 7881/tcp + 7882/udp estão abertos.
2. No `.env`: `LIVEKIT_URL=wss://livekit.example.com`, `LIVEKIT_INTERNAL_URL=http://livekit:7880`, e gere um novo par de chaves: `LIVEKIT_API_KEY=API$(openssl rand -hex 6)`, `LIVEKIT_API_SECRET=$(openssl rand -hex 24)` (o mesmo par é passado ao container do LiveKit pelo arquivo compose).
3. Exclua o bloco `livekit` do `docker-compose.override.yml` (ou o arquivo inteiro, se esse era o único conteúdo).
4. `docker compose up -d`, e então `curl https://livekit.example.com/` deve imprimir `OK`.

Os usuários não precisam fazer nada: o navegador recebe a nova URL e um novo token na próxima conexão.

Mais sobre portas, TURN e dimensionamento de um servidor auto-hospedado: [../livekit.md](../livekit.md).
