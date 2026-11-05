# Backup e restauração

Tudo que vale a pena guardar em uma instância do Oficio está no MySQL; o container do app em si é stateless e o LiveKit não guarda nada. O `scripts/backup.sh` produz um dump lógico comprimido do banco incluído, opcionalmente o copia para um armazenamento compatível com S3, e o `scripts/restore.sh` carrega um dump de volta. Esta página explica o que o dump contém, como agendá-lo, como restaurar e quais volumes Docker você também deve proteger.

## O que há em um dump

O dump cobre o banco `oficio` inteiro:

| Tabela | Conteúdo |
|---|---|
| `users` | contas, hashes de senha, funções, flags de administrador, avatares (`appearance`), configurações |
| `password_tokens` | tokens de convite/redefinição pendentes (vida curta; perder não faz mal) |
| `desks` | quem é dono de qual mesa e sua decoração |
| `chat_messages` | o histórico completo de chat |
| `sessions_log` | histórico de logins |
| `office_maps` | rascunhos de mapa e todas as versões publicadas |
| `office_settings` | configurações da instância, como o id do mapa publicado |
| `telemetry_events` | 14 dias de diagnósticos (a maior parte do tamanho; perder não faz mal) |
| `office_migrations` | quais migrations de esquema foram aplicadas |

Fora do dump, por design: o `.env` (seus segredos — faça backup dele separadamente e com segurança), os certificados do Caddy (reemissíveis; veja [Volumes](#volumes)), o estado do LiveKit (nenhum) e qualquer coisa sobre quem está online.

Os hashes de senha são bcrypt, mas o dump ainda contém e-mails, nomes e chat; trate os arquivos de backup como confidenciais.

## `scripts/backup.sh`

```sh
./scripts/backup.sh [dir] [keep]
```

Rode-o a partir do diretório que contém o `docker-compose.yml` e o `.env` (ele lê `MYSQL_ROOT_PASSWORD` do `.env` e executa `mysqldump` dentro do container `mysql`). Padrões: `dir=./backups`, `keep=14`.

O que ele faz:

1. `mysqldump -u root --single-transaction --quick --routines --triggers --events --hex-blob --default-character-set=utf8mb4 oficio`, passado por `gzip -9` para `backups/oficio-<YYYY-MM-DDTHH-MM-SS>.sql.gz.partial`. `--single-transaction` significa que o app continua rodando e o dump é consistente; sem downtime.
2. Verificações de sanidade: o arquivo precisa ter mais de 1 KiB e terminar com `Dump completed`; caso contrário é apagado e o script sai com 1 e `[backup] FAILED`.
3. Renomeia `.partial` para o nome final e imprime `[backup] OK backups/oficio-….sql.gz (N bytes)`.
4. Retenção: apaga os arquivos mais antigos além de `keep`.
5. Se `S3_BUCKET` está definido, envia o arquivo com `aws s3 cp` para `s3://$S3_BUCKET/oficio/`.

A senha do MySQL é passada pela variável de ambiente `MYSQL_PWD` dentro do container, então ela nunca aparece no `ps`.

### Agendando com cron

```sh
crontab -e
```

```cron
# Daily at 03:00, keep 14 local copies, log to backups/backup.log
0 3 * * * cd /opt/oficio && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Garanta que o usuário do cron consegue rodar `docker compose` (membro do grupo `docker`) e que `/opt/oficio` é onde o seu `.env` fica. Confira `backups/backup.log` depois da primeira noite; um log saudável é uma linha `[backup] OK` por dia.

### Cópia externa para armazenamento compatível com S3

Qualquer bucket compatível com S3 funciona: AWS S3, Backblaze B2, Cloudflare R2, MinIO, DigitalOcean Spaces, Hetzner Object Storage, Wasabi. Instale a AWS CLI no host e forneça as credenciais ao script:

```cron
0 3 * * * cd /opt/oficio && S3_BUCKET=my-backups S3_ENDPOINT=https://s3.us-west-002.backblazeb2.com AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… AWS_DEFAULT_REGION=us-west-002 ./scripts/backup.sh >> backups/backup.log 2>&1
```

Em vez de colocar segredos no crontab, coloque-os em um arquivo acessível só pelo root e carregue-o com `source`:

```cron
0 3 * * * cd /opt/oficio && . /root/oficio-backup.env && ./scripts/backup.sh >> backups/backup.log 2>&1
```

- `S3_BUCKET` habilita o upload; `S3_ENDPOINT` só é necessário para provedores que não são a AWS.
- Os objetos são gravados em `s3://<bucket>/oficio/oficio-<timestamp>.sql.gz`. Defina uma regra de ciclo de vida no bucket para expirar objetos antigos (por exemplo, 90 dias); o script só limpa os arquivos locais.
- Habilite versionamento do bucket ou object lock se quiser proteção contra um host comprometido apagando os backups.

### Fazendo um backup manual antes de uma mudança

```sh
./scripts/backup.sh backups 30
ls -lh backups | tail -3
```

Faça isso antes de toda [atualização](upgrading.md) e antes de publicar uma mudança grande de mapa.

## Restauração

```sh
./scripts/restore.sh backups/oficio-2026-01-15T03-00-00.sql.gz
```

O que ele faz:

1. Imprime um aviso e espera **5 segundos** (Ctrl+C para abortar): o banco `oficio` será **substituído** pelo dump.
2. `docker compose stop app` — todo mundo online é desconectado; a página de login continua respondendo `502` pelo Caddy até o app voltar.
3. Transmite o dump descomprimido para `mysql -u root oficio` dentro do container `mysql`. (Ele remove a primeira linha quando ela é a diretiva `enable the sandbox mode` do MariaDB, que o MySQL 8 não entende, então dumps feitos com um `mariadb-dump` recente também carregam.)
4. `docker compose start app`. O app reexecuta as migrations (sem efeito se o dump é atual), carrega o mapa publicado e inicia.

Depois: as sessões continuam válidas porque são assinadas com `OFFICE_JWT_SECRET`, não armazenadas no banco; usuários cuja senha é diferente no dump precisam entrar de novo (seu `password_version` não bate mais). Reivindicações de mesa, histórico de chat e mapas são o que o dump continha.

Uma restauração leva segundos para um escritório típico. Para uma tabela `telemetry_events` grande pode levar um minuto; essa tabela é só diagnóstico.

### Restaurando em um servidor novo (recuperação de desastre / migração)

1. Provisione o novo host, instale o Docker, clone o repositório, copie o seu **`.env`** do local de backup (mesmo `OFFICE_JWT_SECRET`, mesmas senhas do MySQL; o usuário do banco no dump precisa bater com `MYSQL_USER`/`MYSQL_PASSWORD`).
2. Aponte o DNS para o novo host (baixe o TTL um dia antes, se puder).
3. `docker compose up -d mysql` e espere até ficar healthy (`docker compose ps`), depois `docker compose up -d` para que o Caddy obtenha certificados novos.
4. Copie o dump para lá e rode `./scripts/restore.sh <file>`.
5. Verifique: `curl https://office.example.com/api/health` → `"db":"ok"`, entre, confira os usuários e o mapa publicado em `/admin`.

Se você também guardou o volume `oficio_caddy-data`, restaure-o antes do passo 3 para reutilizar os certificados existentes.

### Restaurando um dump de um banco gerenciado

Os scripts assumem a stack compose. Com um MySQL gerenciado, use os snapshots do provedor, ou `mysqldump`/`mysql` contra o host dele com as mesmas flags do script; o formato do dump é idêntico.

## Volumes

| Volume (`docker volume ls`) | Contém | Fazer backup? |
|---|---|---|
| `oficio_mysql-data` | o diretório de dados do MySQL | **Dumps lógicos (`backup.sh`) são a forma suportada.** Copiar o diretório bruto enquanto o MySQL roda produz uma cópia corrompida; se você fizer snapshot dele (por exemplo, um snapshot de disco do VPS), pare o MySQL antes ou aceite a recuperação de crash na restauração. |
| `oficio_caddy-data` | certificados TLS, conta ACME | Opcional, mas útil: evita reemitir certificados depois de um rebuild (o Let's Encrypt limita a emissão a um punhado por semana por domínio). `docker run --rm -v oficio_caddy-data:/data -v "$PWD":/out alpine tar czf /out/caddy-data.tgz -C /data .` |
| `oficio_caddy-config` | configuração salva automaticamente do Caddy | Não; regenerada a partir do Caddyfile. |

O prefixo de volume `oficio_` vem de `name: oficio` no arquivo compose; stacks do Portainer usam o nome da stack em vez disso.

Guarde o `.env` com os seus backups (criptografado). Sem `OFFICE_JWT_SECRET` todo usuário é desconectado depois de uma restauração; sem as senhas do MySQL o dump é inútil com um container novo; sem `LIVEKIT_API_SECRET` a sua configuração do LiveKit também precisa ser regenerada.

## Testando restaurações

Um backup que você nunca restaurou é uma esperança, não um backup. Uma vez por trimestre:

```sh
# on a scratch machine or a temporary compose project
git clone https://github.com/thiagomorello/oficio.git /tmp/oficio-restore-test && cd /tmp/oficio-restore-test
cp /path/to/your/.env .env           # or a copy with changed domains
docker compose -p oficio-test up -d mysql
# wait for healthy, then load the dump with the same command restore.sh uses
gzip -dc /path/to/oficio-2026-01-15T03-00-00.sql.gz | docker compose -p oficio-test exec -T \
  -e MYSQL_PWD="$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)" mysql mysql -u root oficio
docker compose -p oficio-test exec -T -e MYSQL_PWD="$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)" mysql \
  mysql -u root oficio -e 'SELECT COUNT(*) AS users FROM users; SELECT id,name,published_at FROM office_maps WHERE kind="version";'
docker compose -p oficio-test down -v
```

Ver a sua contagem de usuários e as versões de mapa é prova suficiente.
