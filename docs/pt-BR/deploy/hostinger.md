# Deploy na Hostinger

Os planos de VPS KVM da Hostinger se encaixam bem no Oficio: um IPv4 público, um template de sistema operacional que já vem com Docker, firewall e DNS no mesmo painel (hPanel). Este guia cobre os cliques específicos da Hostinger e depois passa a bola para o [guia de referência para VPS](docker-compose-vps.md) para os comandos.

| | |
|---|---|
| **O que você obtém** | A stack completa (app, MySQL, LiveKit auto-hospedado, Caddy com HTTPS) em um VPS da Hostinger. |
| **Custo mensal** | Cerca de US$ 5–20 para um plano de KVM 1 a KVM 4 em contrato de longo prazo; renovações e prazos curtos custam mais. Os preços mudam, confira em hostinger.com. |
| **Tempo necessário** | Cerca de 40 minutos. |
| **Áudio/vídeo** | LiveKit auto-hospedado no mesmo VPS. [LiveKit Cloud](livekit-cloud.md) é opcional. |
| **Banco de dados** | Container MySQL 8 no mesmo VPS, com backup pelo `scripts/backup.sh` mais os snapshots da Hostinger. |

Os nomes de menu abaixo são como aparecem no hPanel no fim de 2026; a Hostinger renomeia coisas de tempos em tempos, então procure a opção mais parecida se algum rótulo for diferente.

## 1. Escolha um plano

| Equipe (online ao mesmo tempo) | Plano Hostinger | Especificações |
|---|---|---|
| até ~15 | KVM 1 | 1 vCPU, 4 GB RAM, 50 GB NVMe |
| até ~50 | KVM 2 | 2 vCPU, 8 GB RAM, 100 GB NVMe |
| até ~150 | KVM 4 | 4 vCPU, 16 GB RAM, 200 GB NVMe |

Todos os planos KVM incluem um endereço IPv4 dedicado, de que o LiveKit precisa. Qualquer localização de data center funciona; escolha a mais próxima da maior parte da equipe (a latência do áudio acompanha o servidor).

## 2. Crie o VPS com o template Docker

1. Compre o plano. No hPanel, vá em **VPS** no menu superior e clique em **Setup** no novo servidor (ou **Manage** se ele já estiver rodando).
2. Quando for perguntado o sistema operacional, abra a aba **Applications** (ou "OS with panel / app") e escolha **Ubuntu 24.04 with Docker** (a Hostinger também publicou o template como "Docker" ou "Ubuntu 22.04 with Docker" em algumas regiões; qualquer um serve). Se não encontrar, escolha o **Ubuntu 24.04** puro e instale o Docker no passo 3 do guia de VPS.
3. Defina a **root password** e, se tiver, cole sua **SSH key**. Conclua o assistente. O provisionamento leva alguns minutos.
4. Na página **Overview** do servidor, anote o **IP address** (usamos `203.0.113.10` abaixo) e os dados de login SSH.

Para trocar o SO depois: **VPS > Manage > Settings > OS & Panel > Operating System**, escolha o template Docker e confirme (isso apaga o disco).

Verifique o Docker a partir do seu terminal:

```sh
ssh root@203.0.113.10
docker --version
docker compose version
```

Esperado: `Docker version 2x.x` e `Docker Compose version v2.x`. Se `docker compose` estiver faltando, instale com `apt install docker-compose-plugin`.

## 3. Firewall no hPanel

O firewall da Hostinger fica na frente do VPS e é independente do `ufw`. O Docker publica portas por fora do `ufw`, então este é o firewall que de fato protege você.

1. **VPS > Manage > Security > Firewall** (em layouts antigos: **Settings > Security > Firewall**).
2. Clique em **Create firewall configuration**, dê um nome (`oficio`) e abra a configuração.
3. Adicione uma regra por linha com **Add rule**. Ação **Accept**, origem **Anywhere**:

   | Protocolo | Porta |
   |---|---|
   | TCP (ou o preset "SSH") | 22 |
   | TCP (ou "HTTP") | 80 |
   | TCP (ou "HTTPS") | 443 |
   | TCP | 7881 |
   | UDP | 7882 |

4. Clique em **Activate** (ligue a chave da configuração) para que ela se aplique a este VPS.

O firewall da Hostinger descarta tudo que não for explicitamente aceito assim que uma configuração está ativa, então garanta que a regra de SSH está lá antes de ativar. As regras valem só para novas conexões. Não adicione regra para 3306: o MySQL fica interno.

No servidor você pode, adicionalmente, rodar os comandos `ufw` do guia de VPS; não é obrigatório.

## 4. DNS

### Domínio registrado na Hostinger

1. No menu superior do hPanel, **Domains**, clique em **Manage** ao lado do seu domínio e depois em **DNS / Nameservers** na barra lateral.
2. Em **Manage DNS records**, adicione dois registros:

   | Tipo | Nome | Aponta para | TTL |
   |---|---|---|---|
   | A | `office` | `203.0.113.10` | 14400 (ou menor) |
   | A | `livekit` | `203.0.113.10` | 14400 (ou menor) |

3. Clique em **Add record** para cada um.

### Domínio registrado em outro lugar

Adicione os mesmos dois registros A no seu registrador ou provedor de DNS. Com Cloudflare, deixe os dois como **DNS only** (nuvem cinza).

Espere até que `nslookup office.example.com` e `nslookup livekit.example.com` devolvam o IP do VPS a partir do seu computador.

## 5. Instale o Oficio

Siga o [guia de referência para VPS](docker-compose-vps.md) a partir do **passo 2** (conectar e criar um usuário não-root); o passo 3 (Docker) já está feito se você usou o template Docker. Em resumo:

```sh
ssh root@203.0.113.10
adduser deploy && usermod -aG sudo,docker deploy
su - deploy
sudo mkdir -p /opt/oficio && sudo chown $USER:$USER /opt/oficio
git clone https://github.com/thiagomorello/oficio.git /opt/oficio && cd /opt/oficio
./scripts/gen-secrets.sh
nano .env          # OFFICE_DOMAIN, LIVEKIT_DOMAIN, ACME_EMAIL, LIVEKIT_NODE_IP=203.0.113.10
docker compose up -d
docker compose logs -f     # wait for "certificate obtained successfully" (Ctrl+C to leave)
curl -s https://office.example.com/api/health
./scripts/first-admin.sh you@example.com "Your Name"
```

Depois entre em `https://office.example.com` com a senha temporária impressa pelo último comando.

## 6. Alternativa: Docker Manager da Hostinger

O template Docker também instala o **Docker Manager**, um painel dentro do hPanel (**VPS > Manage > Docker Manager**) que consegue iniciar um projeto Compose a partir de uma URL ou de YAML colado ("Compose", depois **Compose from URL** ou **Compose manually**), e mostra containers, logs e um terminal por container.

É possível rodar o Oficio por ali, mas com um porém: o `docker-compose.yml` do Oficio lê segredos e domínios de um arquivo `.env`, que o Docker Manager não gerencia para você. Se quiser usá-lo mesmo assim:

1. Abra **Compose > Compose manually**, nomeie o projeto `oficio`.
2. Cole o conteúdo de [`deploy/portainer/stack.yml`](../../../deploy/portainer/stack.yml) (a variante autocontida da stack) e substitua cada placeholder `${VARIABLE}` por valores reais na prévia do YAML: domínios, e-mail e segredos gerados no seu computador com `openssl rand -hex 32` / `openssl rand -hex 24` (veja o cabeçalho daquele arquivo para a lista).
3. Clique em **Deploy**, depois abra o **Terminal** do container `app` e rode `node dist/server/cli.js create-admin --email you@example.com --name "Your Name"`.

Colar segredos em um formulário web é menos organizado que o caminho do `.env`, e atualizar depois significa editar o YAML de novo; o caminho via SSH acima é o que o resto da documentação assume.

## 7. Backups e snapshots

Duas camadas:

- **Dumps do banco de dados** no servidor: `scripts/backup.sh` com a linha de cron do [guia de VPS](docker-compose-vps.md#13-backups). São pequenos e você consegue restaurá-los em qualquer lugar.
- **Backups/snapshots da Hostinger** do VPS inteiro: **VPS > Manage > Backups & Snapshots** (barra lateral). A Hostinger mantém backups semanais automáticos nos planos KVM e permite tirar um **Snapshot** manual por vez (tirar um novo substitui o anterior). Restaurar um backup sobrescreve o disco inteiro, então use-o para recuperação de desastres, não para desfazer uma única alteração. Confira os detalhes do seu plano: frequência e retenção dos backups variam por plano e mudam com o tempo.

## 8. Atualizando e desinstalando

Igual ao guia de VPS: `cd /opt/oficio && docker compose pull && docker compose up -d` para atualizar, `docker compose down -v` para remover tudo. Se você usou o Docker Manager, use as ações **Update** / **Delete** no projeto.

## Solução de problemas na Hostinger

- **Os certificados nunca chegam** (`challenge failed` em `docker compose logs caddy`): ou o DNS ainda aponta para outro lugar (confira com `nslookup`) ou o firewall do hPanel está ativo sem as regras de 80/443.
- **As pessoas se veem, mas não ouvem nada**: 7882/udp faltando no firewall do hPanel, ou `LIVEKIT_NODE_IP` deixado vazio em um servidor com várias interfaces. Defina-o com o IP público da página Overview e rode `docker compose up -d`.
- **SSH bloqueado depois de ativar o firewall**: no hPanel, abra a configuração do firewall, adicione a regra TCP 22 ou desative a configuração temporariamente. Você também pode usar o botão **Browser terminal** na página Overview do VPS.
- **`docker compose` diz que o arquivo é inválido**: o template Docker pode trazer um Compose mais antigo; `apt update && apt install docker-compose-plugin` traz a v2.2x+.

Mais: [../troubleshooting.md](../troubleshooting.md).
