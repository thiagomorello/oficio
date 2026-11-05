# Roadmap

Para onde o Oficio provavelmente vai depois da 0.1. Esta é uma lista de direções que os mantenedores consideram valiosas e sobre as quais já pensaram, **não um conjunto de promessas ou datas**: os itens podem ser reordenados, fundidos ou descartados conforme deploys reais nos ensinam o que importa. Contribuições para qualquer um deles são bem-vindas; abra uma discussão antes de começar uma grande, para que o design seja combinado primeiro. Veja o [CHANGELOG.md](../../CHANGELOG.md) para o que de fato já foi entregue.

## Escala e operação

- **Escala horizontal.** Hoje o estado do escritório vive na memória de um processo ([por quê](architecture.md#por-que-exatamente-uma-réplica)). Mover presença, pertencimento a zonas e rate limiters para um armazenamento compartilhado (Redis pub/sub para a distribuição do tick, Redis ou MySQL para o estado) permitiria várias réplicas do app, deploys sem downtime e escritórios maiores. Este é o maior item arquitetural da lista.
- **Helm chart.** Um chart para Kubernetes com o app de uma réplica, MySQL/LiveKit incluídos opcionais, Ingress com anotações de WebSocket e as portas de mídia do LiveKit via `hostNetwork`/NodePort, substituindo os manifestos escritos à mão do guia de Kubernetes.
- **Mais métricas e logs estruturados.** Ocupação por zona, contagem de inscrições de A/V e saída de log em JSON para coletores de logs.

## Identidade e acesso

- **SSO / OIDC.** Entrar com um provedor de identidade (Google Workspace, Microsoft Entra ID, Keycloak, Authentik…) via OpenID Connect, com criação de conta just-in-time e mapeamento de grupo para administrador, ao lado das contas existentes de e-mail/senha e da sincronização via `import-json`.
- **Gestão de sessões para administradores.** Ver e revogar as sessões ativas de um usuário; tempo de vida de sessão configurável.

## Idiomas

- **Mais idiomas.** O espanhol é o próximo óbvio dada a base de usuários; a camada de i18n está pronta para ele ([como adicionar um idioma](i18n.md#adicionando-um-idioma)). O suporte a layout da direita para a esquerda viria com a primeira contribuição RTL.

## Produto

- **Galeria de modelos de mapa.** Um conjunto de plantas prontas (estúdio pequeno, espaço aberto de 20 mesas, andar de departamento, salão de eventos) selecionáveis no editor de mapa em vez de partir do único mapa padrão, mais importação/exportação de documentos de mapa como arquivos.
- **Polimento do layout mobile.** O escritório é usável em celulares para presença e chat, mas a barra inferior, o painel de chat e o editor de avatar merecem um layout pensado para telas pequenas, e o comportamento do áudio em abas em segundo plano precisa de trabalho.
- **Salas mais ricas.** Recursos no nível da sala, como um link de lousa compartilhada, texto de agenda na porta e reservas de sala com horário.
- **Notificações.** Notificações de desktop para batidas na porta e menções quando a aba está em segundo plano.

## Entregue desta lista

- **Automação do TURN** (não lançado, na `main`): o overlay `docker-compose.turn.yml` habilita o TURN embutido do LiveKit sobre TLS com o certificado que o Caddy emite para o domínio do LiveKit, com um wrapper que espera pelo certificado no primeiro boot e duas opções de renovação ([como usar](livekit.md#turn-quando-e-como)). O TURN/TLS escuta na 5349 porque o Caddy é dono da 443; a 443 em si ainda exige um segundo IP ou um host separado.

## Não planejado

Para alinhar expectativas: o Oficio pretende continuar sendo um escritório focado, auto-hospedável, com A/V por proximidade sobre o LiveKit. Não há planos para uma oferta SaaS hospedada pelo projeto, para um app nativo de desktop ou mobile, nem para substituir o LiveKit por outra stack de mídia.

## Como as prioridades são definidas

Issues e discussões no GitHub, mais o que quebra em deploys reais relatados pelo template *Deployment help*. Se um desses itens importa para você, diga na discussão correspondente; uma descrição curta do seu ambiente e do tamanho da equipe é mais útil do que um joinha.
