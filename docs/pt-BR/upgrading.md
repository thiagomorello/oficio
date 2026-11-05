# Atualização

Atualizar o Oficio significa puxar uma imagem mais nova e recriar o container `app`; as migrations de banco rodam automaticamente e são aditivas, então um rollback é só a tag mais antiga. Esta página cobre as tags de versão, o procedimento no compose, a leitura do changelog, o que as migrations fazem durante uma atualização, como fazer rollback, como manter o LiveKit e as outras imagens atualizadas e como atualizar uma instalação a partir do código-fonte.

## Versionamento e tags de imagem

O Oficio segue o [Versionamento Semântico](https://semver.org/); todo release tem notas no [CHANGELOG.md](../../CHANGELOG.md) e um release no GitHub. As imagens são publicadas em `ghcr.io/thiagomorello/oficio` para `linux/amd64` e `linux/arm64`:

| Tag | Significado | Use para |
|---|---|---|
| `0.1.1` | release exato | produção: previsível, você escolhe quando mudar |
| `0.1` | último patch de uma minor | produção, se você quiser correções de bugs automaticamente no `pull` |
| `latest` | último **release** | o padrão no `docker-compose.yml`; bom para equipes pequenas, mas pode pular uma versão minor no `pull` |
| `edge` | todo push na `main` | testar mudanças ainda não lançadas; nunca produção |
| `sha-<commit>` | um build específico | reproduzir um relato de bug |

O arquivo compose lê a tag de `OFICIO_VERSION` no `.env` (`image: ghcr.io/thiagomorello/oficio:${OFICIO_VERSION:-latest}`). Fixe-a:

```ini
OFICIO_VERSION=0.1.1
```

A versão em execução é visível em `GET /api/health` (`"version"`) e nos logs do app na inicialização.

## Antes de atualizar

1. **Leia o changelog** de todas as versões entre a sua e a de destino: [CHANGELOG.md](../../CHANGELOG.md) → o release correspondente no GitHub. Procure os títulos **Changed**, **Removed** e qualquer nota sobre variáveis de ambiente, portas ou o arquivo compose. Somente versões minor e major podem exigir ação; patches nunca exigem.
2. **Compare o arquivo compose** se você acompanha o repositório: `git fetch && git diff HEAD..origin/main -- docker-compose.yml .env.example`. Variáveis novas aparecem no `.env.example` com um padrão; copie as que quiser para o `.env`.
3. **Faça backup**: `./scripts/backup.sh` ([Backup e restauração](backup-restore.md)). As migrations são aditivas e seguras, mas um backup torna o rollback um não evento.
4. Escolha um momento tranquilo: a atualização reinicia o app, o que desconecta todo mundo por alguns segundos (eles reconectam automaticamente e continuam autenticados).

## Atualizando a stack compose

```sh
cd /opt/oficio
git pull                                  # if you keep the repository checkout (optional)
sed -i 's/^OFICIO_VERSION=.*/OFICIO_VERSION=0.2.0/' .env   # or edit .env by hand
docker compose pull app
docker compose up -d
docker compose logs -f app
```

O que você deve ver nos logs:

- avisos de configuração, se houver (variáveis novas que você talvez queira definir);
- uma linha `migration 00N_…` por migration pendente, ou `database is already up to date` quando não há nada a aplicar;
- `Published map #N loaded.` e o `Oficio <version> (docker) listening on http://0.0.0.0:4747` final.

Depois:

```sh
curl -s https://office.example.com/api/health
```

O campo `version` mostra o novo release e `ok` é `true`. Abra o escritório em um navegador; o cliente recarrega seus assets automaticamente porque os nomes dos arquivos do bundle têm hash do conteúdo.

`docker compose up -d` recria só os containers cuja imagem ou configuração mudou, então MySQL, LiveKit e Caddy continuam rodando, a menos que você também tenha alterado as linhas deles.

### Portainer e outras plataformas

- **Stack do Portainer:** altere `OFICIO_VERSION` nas variáveis de ambiente da stack (ou a tag da imagem no editor) e clique em **Update the stack** com *Re-pull image* habilitado. No Swarm o serviço atualiza em `stop-first` (uma réplica) e faz rollback automaticamente se o healthcheck falhar por 30 s (`failure_action: rollback`).
- **Railway / Render / Fly / DigitalOcean App Platform / Coolify / Dokploy:** altere a tag da imagem (ou faça o redeploy a partir do novo commit) na interface da plataforma; o app migra na inicialização da mesma forma. Veja os guias em `deploy/`.
- **Kubernetes:** com o Helm chart, `helm upgrade oficio deploy/helm/oficio -n oficio -f my-values.yaml --set image.tag=X.Y.Z` (o chart mantém `replicas: 1` e `strategy: Recreate` por você); com manifests crus, atualize a tag da imagem no Deployment e mantenha essas duas configurações para que dois pods do app nunca rodem ao mesmo tempo.

## Migrations durante uma atualização

- A nova versão do app aplica as migrations pendentes **na inicialização**, sob um named lock do MySQL, antes de começar a servir. Se uma migration falha, o processo encerra com o erro SQL nos logs e o container reinicia; corrija a causa (normalmente privilégios em um banco gerenciado) e reinicie. A versão antiga pode ser iniciada de novo nesse meio-tempo (veja rollback).
- As migrations são **aditivas**: criam tabelas e adicionam colunas, nunca removem ou renomeiam. Dados gravados pela versão nova vão para colunas novas que a versão antiga simplesmente ignora.
- Você pode rodá-las com antecedência para encurtar a janela de restart: `docker compose run --rm app node dist/server/cli.js migrate` com a imagem nova, enquanto o app antigo ainda está servindo. O named lock evita uma corrida com a execução de migrations do próprio app.

## Fazendo rollback

Como o esquema só cresce, voltar é uma troca de tag:

```sh
sed -i 's/^OFICIO_VERSION=.*/OFICIO_VERSION=0.1.0/' .env
docker compose pull app
docker compose up -d app
```

A versão mais antiga inicia contra o esquema mais novo sem reclamar. Duas ressalvas:

- Recursos introduzidos pela versão mais nova não estão disponíveis, e os dados que ela armazenou ficam invisíveis até você atualizar de novo (não são perdidos).
- Se uma nota de release diz explicitamente que uma migration **não é retrocompatível** (raro; seria uma versão major), restaure o backup que você fez em vez disso: `./scripts/restore.sh backups/<file>` com a versão antiga rodando.

## Mantendo as outras imagens atualizadas

| Serviço | Imagem no compose | Como atualizar |
|---|---|---|
| LiveKit | `livekit/livekit-server:v1.13.11` (fixada) | Edite a tag no `docker-compose.yml`, leia as notas de release do LiveKit, `docker compose pull livekit && docker compose up -d livekit`. Chamadas em andamento caem e reconectam em segundos. Fique na linha 1.x; o SDK `livekit-client` incluído é compatível com servidores 1.x. O projeto sobe essa tag nos próprios releases; puxar o repositório lhe dá a combinação testada. |
| MySQL | `mysql:8.0` (patch flutuante) | `docker compose pull mysql && docker compose up -d mysql` pega os patches 8.0.x; o MySQL atualiza seu diretório de dados automaticamente dentro da linha 8.0. Faça um backup antes. Migrar para 8.4 é suportado pelo MySQL (in-place a partir de 8.0), mas teste em uma cópia primeiro. |
| Caddy | `caddy:2-alpine` (flutuante) | `docker compose pull caddy && docker compose up -d caddy`. Os certificados persistem no volume. |

Uma atualização completa de tudo: `docker compose pull && docker compose up -d`, depois de um backup.

## Atualizando uma instalação a partir do código-fonte

```sh
cd /opt/oficio
git fetch --tags
git checkout v0.2.0
npm ci
npm run build
npm run cli -- migrate            # optional: the server also migrates at start
sudo systemctl restart oficio     # or however you run `node dist/server/index.js`
```

O Node.js precisa continuar na 22 ou mais nova. Confira o `engines` do `package.json` depois de um release major.

## Checklist

- [ ] Changelog lido para todas as versões intermediárias
- [ ] `.env.example` comparado, variáveis novas definidas
- [ ] `./scripts/backup.sh` rodou e imprimiu `[backup] OK`
- [ ] `OFICIO_VERSION` atualizado, `docker compose pull app && docker compose up -d`
- [ ] Logs mostram migrations aplicadas e o banner da nova versão
- [ ] `/api/health` → `ok: true`, `version` correto
- [ ] Entrar, andar pelo escritório, testar áudio com um colega
- [ ] Se algo estiver errado: tag anterior, `docker compose up -d app`, abrir uma issue com `docker compose logs --tail=200 app`
