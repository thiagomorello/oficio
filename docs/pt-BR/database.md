# Banco de dados

O Oficio armazena usuários, mesas, histórico de chat, mapas, configurações e telemetria em **MySQL 8**. Você pode rodar o container `mysql:8.0` incluído no `docker-compose.yml` ou apontar o app para um serviço de MySQL gerenciado. Esta página cobre as duas opções, o formato da `DATABASE_URL` e sua forma alternativa `MYSQL_*`, o estado atual do suporte a TLS, como as migrations funcionam, como dimensionar o banco e onde fica o procedimento de backup.

## MySQL incluído (padrão)

O `docker-compose.yml` inicia o `mysql:8.0` com:

- `utf8mb4` / `utf8mb4_unicode_ci` como padrões do servidor (as tabelas declaram a própria collation `utf8mb4` de qualquer forma);
- `innodb-buffer-pool-size` a partir de `MYSQL_BUFFER_POOL` (padrão `256M`) e `max-connections=100`;
- um volume nomeado `mysql-data` montado em `/var/lib/mysql` (visível como `oficio_mysql-data` em `docker volume ls`);
- um healthcheck (`mysqladmin ping`) pelo qual o serviço `app` espera (`condition: service_healthy`); a primeira inicialização leva cerca de 30 segundos enquanto o MySQL se inicializa;
- somente a rede `internal`: a porta **não** é publicada no host.

Na primeira inicialização a imagem oficial cria o banco `MYSQL_DATABASE` (padrão `oficio`) e o usuário `MYSQL_USER` / `MYSQL_PASSWORD`, e define `MYSQL_ROOT_PASSWORD`. Esses três valores são lidos **somente na primeira inicialização**; alterá-los depois no `.env` não altera o banco. Para rotacionar a senha do app depois, rode `ALTER USER 'oficio'@'%' IDENTIFIED BY '<new>'` dentro do MySQL e atualize o `.env`.

Para abrir um shell do MySQL:

```sh
docker compose exec -e MYSQL_PWD="$(grep -E '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)" mysql mysql -u root oficio
```

A opção incluída é a certa para quase todo deploy em um único host: é um container, com backup pelo `scripts/backup.sh`, e seu único consumidor é o app sentado na mesma rede interna.

## MySQL gerenciado

Qualquer serviço compatível com MySQL 8 funciona, desde que o app consiga alcançá-lo por TCP: DigitalOcean Managed MySQL, Aiven for MySQL, PlanetScale ou TiDB Cloud (compatíveis com MySQL), o plugin MySQL do Railway, os bancos gerenciados da Hostinger, Amazon RDS/Aurora MySQL, Google Cloud SQL for MySQL, Azure Database for MySQL. Os guias de plataforma em `deploy/` usam um banco gerenciado sempre que a plataforma não tem volumes persistentes.

Passos:

1. Crie uma instância MySQL **8.x** e um banco chamado `oficio` (qualquer nome funciona; ele só precisa estar na URL) com `utf8mb4` como conjunto de caracteres padrão.
2. Crie um usuário com direitos completos nesse banco (`CREATE`, `ALTER`, `INDEX`, `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `REFERENCES`). As migrations criam tabelas e chaves estrangeiras na inicialização, então um usuário somente leitura ou somente DML não basta.
3. Permita o IP do host do app no firewall / fontes confiáveis do serviço. Prefira o endereço de **rede privada** do provedor quando o app roda na mesma região.
4. Defina `DATABASE_URL` e remova o serviço `mysql` e o bloco `depends_on` do seu arquivo compose.
5. Inicie o app e confira se `GET /api/health` informa `"db": "ok"`.

Leia a seção [TLS](#tls) antes de escolher um provedor: muitos serviços gerenciados **exigem** conexões criptografadas por padrão.

## Formato da `DATABASE_URL`

```
mysql://USER:PASSWORD@HOST:PORT/DATABASE
```

- O esquema precisa ser exatamente `mysql://` (não `mysql2://`, não `mariadb://`).
- `PORT` assume `3306` quando omitida.
- `USER` e `PASSWORD` são **decodificados de URL**: codifique com percentual qualquer coisa que não seja uma letra simples, dígito ou `-._~`. Casos comuns: `@` → `%40`, `#` → `%23`, `:` → `%3A`, `/` → `%2F`, `?` → `%3F`, `%` → `%25`, espaço → `%20`. O `scripts/gen-secrets.sh` gera senhas em hex justamente para que isso nunca morda.
- `DATABASE` é o caminho depois da barra. Sempre inclua.
- **Parâmetros de query são ignorados.** O servidor interpreta a URL em host, porta, usuário, senha e banco (veja `server/db/pool.ts`); qualquer coisa depois de `?` não tem efeito.

Exemplos:

```ini
# bundled container (what docker-compose.yml assembles)
DATABASE_URL=mysql://oficio:4f1e…@mysql:3306/oficio

# managed service over a private network
DATABASE_URL=mysql://oficio:p%40ss%23word@10.0.0.12:3306/oficio

# managed service with a non-standard port
DATABASE_URL=mysql://doadmin:AVNS_xxxxxxxx@db-mysql-nyc3-12345-do-user-1-0.b.db.ondigitalocean.com:25060/oficio
```

Os nomes de host acima são exemplos; use os que o seu provedor mostra.

### A alternativa `MYSQL_*`

Quando `DATABASE_URL` está vazia, o servidor monta a URL a partir das partes:

```ini
MYSQL_HOST=10.0.0.12
MYSQL_PORT=3306          # default 3306
MYSQL_USER=oficio        # default root
MYSQL_PASSWORD=p@ss#word # no encoding needed here
MYSQL_DATABASE=oficio    # default oficio
```

`MYSQL_USER` e `MYSQL_PASSWORD` são codificados em URL para você, então essa forma é prática quando a senha tem caracteres especiais. `DATABASE_URL`, quando presente, sempre prevalece. A CLI (`node dist/server/cli.js …`) usa as mesmas duas formas.

## TLS

Por padrão o app abre conexões sem criptografia, o que é adequado para o container incluído (o tráfego nunca sai da rede Docker de um host). Serviços gerenciados normalmente **exigem** TLS; ative-o de uma de duas maneiras:

- acrescente `?ssl=true` à `DATABASE_URL`: `mysql://user:pass@host:3306/oficio?ssl=true` (`sslmode=required` também é aceito), ou
- defina `MYSQL_SSL=required` (funciona tanto com `DATABASE_URL` quanto com a forma `MYSQL_*`).

Com `required` o certificado do servidor é validado contra o bundle de CAs do sistema do container, que cobre todos os grandes provedores (DigitalOcean, Aiven, PlanetScale/TiDB, o proxy público do Railway). `ssl=false`, `0` ou um valor vazio desabilita o TLS.

**CA privada ou corporativa.** Quando o certificado do banco é assinado por uma CA que não está no bundle do sistema (um MySQL próprio, uma PKI corporativa, alguns provedores de nuvem que entregam um `ca.pem` para baixar), aponte o app para o bundle PEM em vez de desligar a validação:

```ini
MYSQL_SSL_CA=/certs/mysql-ca.pem        # ou DATABASE_URL=mysql://...?sslca=/certs/mysql-ca.pem
```

O arquivo pode conter um ou vários certificados (uma cadeia). Definir essa variável implica TLS com validação completa, então `MYSQL_SSL` pode ficar vazia. Com a stack do compose, coloque o arquivo ao lado do `.env` e monte-o no container do app por um `docker-compose.override.yml`:

```yaml
services:
  app:
    volumes:
      - ./certs/mysql-ca.pem:/certs/mysql-ca.pem:ro
```

O app se recusa a iniciar se o arquivo estiver faltando ou não for um certificado PEM, então um erro de digitação aparece no boot em vez de virar um fallback silencioso.

**Último recurso.** `?ssl=skip-verify` / `MYSQL_SSL=skip-verify` criptografa a conexão, mas não verifica o certificado; use só temporariamente enquanto obtém o arquivo da CA.

## Migrations

Mudanças de esquema são distribuídas como **migrations aditivas e numeradas** em `server/db/migrations/` (`001_init`, `002_maps`, `003_avatar`, `004_desk_decor`, `005_telemetry`, …), embutidas no build do servidor.

- Elas rodam **automaticamente na inicialização** (`server/index.ts`) e sob demanda com `node dist/server/cli.js migrate` (`npm run cli -- migrate` a partir do código-fonte).
- As versões aplicadas são registradas em `office_migrations`. Um named lock do MySQL (`GET_LOCK('office_migrate', 30)`) impede que dois processos (por exemplo o app e a CLI) migrem ao mesmo tempo.
- Cada migration executa suas instruções em ordem e registra a versão no fim; DDL faz commit implícito no MySQL, então uma migration interrompida é simplesmente reexecutada do início na próxima vez. As migrations são escritas para que isso seja seguro.
- Migrations nunca são editadas depois do release e nunca removem colunas, e é por isso que **voltar para uma versão anterior do app não exige rollback de esquema**: uma versão mais antiga ignora colunas que não conhece. Veja [Atualização](upgrading.md).

Se o app falha ao migrar, ele registra o erro e encerra; `docker compose logs app` mostra a instrução que falhou. As causas usuais são privilégios insuficientes (`CREATE`/`ALTER`/`REFERENCES` faltando) ou um banco criado com um padrão diferente de `utf8mb4` por um serviço gerenciado.

## Dimensionamento

O banco de dados é pequeno. Tamanhos aproximados por item:

| Dado | Tamanho | Observações |
|---|---|---|
| usuário | ~2 KB | inclui o JSON de aparência e configurações |
| mensagem de chat | ~0,3 KB | limitada a 1000 caracteres de texto; o histórico cresce para sempre |
| versão de mapa | 50–500 KB | um documento JSON por versão publicada |
| evento de telemetria | ~0,3–1 KB | limpo depois de 14 dias; um usuário ativo produz algumas centenas por dia |

Uma equipe de 50 pessoas produz bem menos de 1 GB por ano, incluindo a rotatividade da telemetria. Os padrões bastam: buffer pool de `256M`, 5 conexões no pool do app (`connectionLimit` em `server/db/pool.ts`), `max-connections=100`. Aumente `MYSQL_BUFFER_POOL` para `512M`–`1G` em um host de 8 GB para consultas mais rápidas de histórico de chat e telemetria. O tamanho do pool de conexões não é configurável pelo ambiente; uma réplica do app nunca precisa de mais do que um punhado.

Crescimento de disco a observar: `chat_messages` (não há limpeza automática; apague linhas antigas manualmente se precisar) e os binary logs do MySQL, se você mesmo os habilitou (a imagem incluída roda com os padrões).

## Backups

O `scripts/backup.sh` faz o dump do banco incluído com `mysqldump --single-transaction` em `backups/oficio-<timestamp>.sql.gz`, mantém os últimos 14 arquivos e, opcionalmente, envia para um armazenamento compatível com S3. O `scripts/restore.sh` para o app, carrega um dump e o inicia de novo. Serviços gerenciados têm seus próprios recursos de snapshot; ainda assim mantenha um dump lógico que você controle. Procedimento completo: [Backup e restauração](backup-restore.md).

## Relacionado

- [Configuração → Banco de dados MySQL](configuration.md#banco-de-dados-mysql)
- [Solução de problemas → `/api/health` mostra `db: error`](troubleshooting.md#apihealth-mostra-db-error)
