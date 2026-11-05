# Login único (OpenID Connect)

O Oficio pode autenticar pessoas por um provedor de identidade OpenID Connect (Google Workspace, Microsoft Entra ID, Keycloak, Authentik ou qualquer outro compatível), ao lado das contas de e-mail/senha já existentes. Esta página explica como o fluxo funciona, cada variável `OIDC_*`, como registrar a aplicação nos provedores mais comuns, como as contas são vinculadas e criadas, como administradores são mapeados a partir de uma claim de grupo, como desligar o login por senha e o que cada erro na página de login significa.

O login único é opcional. Sem as três variáveis obrigatórias nada muda: a página de login mostra só o formulário de senha.

## Como funciona

1. A página de login lê `GET /api/config`. Quando `oidc.enabled` é verdadeiro, ela mostra um botão **Continuar com &lt;rótulo&gt;** apontando para `GET /api/auth/oidc/start`.
2. `start` gera um `state`, um `nonce` e um verificador PKCE (S256) aleatórios, guarda-os num cookie de vida curta (`office_oidc`, 10 minutos, `HttpOnly`, `SameSite=Lax`, `Secure` a menos que `OFFICE_COOKIE_SECURE=0`, assinado com `OFFICE_JWT_SECRET`) e redireciona o navegador ao endpoint de autorização do provedor. Um `?next=/caminho` opcional (só caminhos internos) vai junto.
3. O provedor autentica a pessoa e redireciona de volta para `GET /api/auth/oidc/callback?code=…&state=…`.
4. O callback confere o `state` com o cookie, troca o código (com o verificador PKCE e o client secret), valida o ID token (assinatura, issuer, audiência, expiração, `nonce`), lê as claims (`sub`, `email`, `email_verified`, `name` e a claim de admin, se configurada; o endpoint userinfo é consultado quando o ID token não traz o e-mail ou a claim de admin), aplica as [regras de conta](#regras-de-vínculo-e-criação-de-conta), emite o cookie de sessão normal (`office_session`, 30 dias) e redireciona para `/` ou para o caminho `next`.
5. Qualquer falha redireciona para `/login?error=<código>`; a página de login traduz o código (veja [Solução de problemas](#solução-de-problemas)). Tokens e códigos de autorização nunca vão para o log.

Os metadados do provedor são buscados sob demanda em `OIDC_ISSUER/.well-known/openid-configuration` no primeiro login e guardados em memória; uma descoberta que falhou não fica em cache, então uma indisponibilidade do provedor dura só enquanto ela existir. O servidor nunca cai por causa do provedor: erros de descoberta aparecem como `error=oidc_unavailable`.

Limites: 30 inícios de login por IP a cada 10 minutos, e callbacks que falham contam na mesma janela (`error=oidc_rate_limited`). Atrás de um proxy defina `TRUST_PROXY=1` para que o IP real do cliente seja usado.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OIDC_ISSUER` | não definido | URL do issuer do provedor, a base de `/.well-known/openid-configuration`. Precisa ser `https://` (`http://` puro só é aceito em `--dev`). |
| `OIDC_CLIENT_ID` | não definido | Client ID da aplicação registrada no provedor. |
| `OIDC_CLIENT_SECRET` | não definido | Client secret. Fica no `.env`, nunca no repositório. |
| `OIDC_SCOPES` | `openid email profile` | Escopos separados por espaço. `openid` é acrescentado se faltar. Adicione um escopo de grupos quando o provedor exigir (exemplos de Keycloak e Authentik abaixo). |
| `OIDC_BUTTON_LABEL` | nome do provedor derivado do host do issuer (`Google`, `Microsoft`, `Keycloak`, `Authentik` ou o domínio com inicial maiúscula), senão `Single sign-on` | Texto mostrado em "Continuar com …" na página de login. Máximo de 40 caracteres. |
| `OIDC_AUTO_CREATE` | `1` | Cria a conta no primeiro login. Com `0`, só quem já tem conta (local, importada ou vinculada antes) consegue entrar; os demais veem `error=oidc_no_account`. |
| `OIDC_ALLOWED_DOMAINS` | vazio (qualquer) | Domínios de e-mail aceitos, separados por vírgula, por exemplo `acme.com,acme.com.br`. Conferido contra a claim `email`, sem diferenciar maiúsculas. Os demais veem `error=oidc_domain`. |
| `OIDC_ADMIN_CLAIM` | não definido | Nome da claim cujo valor (string ou lista) marca administradores, por exemplo `groups` ou `roles`. Deve ser definida junto com `OIDC_ADMIN_VALUES`. |
| `OIDC_ADMIN_VALUES` | não definido | Valores dessa claim, separados por vírgula, que concedem acesso de administrador, por exemplo `oficio-admins`. |
| `OIDC_PASSWORD_LOGIN` | `1` | Com `0`, e o login único ativo, a página de login esconde o formulário de e-mail/senha e `POST /api/auth/login` responde `403`. Ignorado (com aviso) quando o login único não está ativo. |

O login único só fica ativo quando `OIDC_ISSUER`, `OIDC_CLIENT_ID` e `OIDC_CLIENT_SECRET` estão todos definidos. Se só alguns estiverem, o servidor registra um aviso no boot e mantém o login único desligado. `GET /api/config` expõe `oidc: { enabled, label, passwordLogin }` e nada mais sobre o provedor.

A **URI de redirecionamento** a registrar no provedor é sempre:

```
https://<OFFICE_DOMAIN>/api/auth/oidc/callback
```

Ela é montada a partir de `OFFICE_PUBLIC_URL` quando definida (recomendado; o `docker-compose.yml` a deriva de `OFFICE_DOMAIN`), senão a partir do cabeçalho `Host` da requisição e de `X-Forwarded-Proto` (`TRUST_PROXY=1`).

Trecho de exemplo do `.env`:

```ini
OIDC_ISSUER=https://accounts.google.com
OIDC_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
OIDC_CLIENT_SECRET=<segredo do provedor>
OIDC_SCOPES=openid email profile
OIDC_BUTTON_LABEL=Google
OIDC_AUTO_CREATE=1
OIDC_ALLOWED_DOMAINS=acme.com
OIDC_ADMIN_CLAIM=
OIDC_ADMIN_VALUES=
OIDC_PASSWORD_LOGIN=1
```

Reinicie o app depois de alterar essas variáveis (`docker compose up -d`). Confirme com `curl -s https://office.example.com/api/config | grep oidc`.

## Registrando a aplicação no seu provedor

### Google Workspace

1. No console do Google Cloud, crie ou escolha um projeto, abra **APIs e serviços → Tela de consentimento OAuth**, escolha **Interno** (só contas do seu Workspace) e preencha o nome do app.
2. **Credenciais → Criar credenciais → ID do cliente OAuth**, tipo **Aplicativo da Web**. URI de redirecionamento autorizado: `https://<OFFICE_DOMAIN>/api/auth/oidc/callback`.
3. Copie o client ID e o secret.

```ini
OIDC_ISSUER=https://accounts.google.com
OIDC_SCOPES=openid email profile
OIDC_ALLOWED_DOMAINS=acme.com
```

O Google sempre envia `email` e `email_verified`. Ele não envia grupos no ID token nem no userinfo, então `OIDC_ADMIN_CLAIM` não está disponível com o Google: promova administradores no painel de administração (eles mantêm a flag; veja as regras abaixo). `OIDC_ALLOWED_DOMAINS` é a forma de restringir o acesso ao(s) domínio(s) do seu Workspace quando a tela de consentimento não é *Interna*.

### Microsoft Entra ID

1. **Entra ID → Registros de aplicativo → Novo registro**. Tipos de conta: *Somente contas neste diretório organizacional*. URI de redirecionamento (tipo **Web**): `https://<OFFICE_DOMAIN>/api/auth/oidc/callback`.
2. **Certificados e segredos → Novo segredo do cliente**; copie o *valor* (não o ID).
3. O issuer é `https://login.microsoftonline.com/<tenant-id>/v2.0` (o ID do diretório (locatário) está na página Visão geral do app). Não use `common` nem `organizations` como tenant: o issuer dos tokens não bateria.
4. Grupos opcionais: **Configuração de token → Adicionar declaração de grupos**, escolha *Grupos de segurança* (ou *Grupos atribuídos ao aplicativo*) e marque *ID do grupo* para o token de **ID**. A claim se chama `groups` e contém os object IDs dos grupos (GUIDs), então `OIDC_ADMIN_VALUES` é o GUID do seu grupo de admins. Se preferir nomes, use **Funções de aplicativo**: defina uma função (por exemplo `Oficio.Admin`), atribua-a a usuários ou grupos em *Aplicativos empresariais* e mapeie `OIDC_ADMIN_CLAIM=roles` / `OIDC_ADMIN_VALUES=Oficio.Admin`.

```ini
OIDC_ISSUER=https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0
OIDC_SCOPES=openid email profile
OIDC_ADMIN_CLAIM=groups
OIDC_ADMIN_VALUES=11111111-2222-3333-4444-555555555555
```

O Entra envia `email` para contas corporativas com caixa de correio; contas sem e-mail (`email` ausente) são recusadas com `error=oidc_no_email`. O Entra não envia `email_verified`, o que é aceito (a verificação só rejeita um `false` explícito).

### Keycloak

1. No seu realm: **Clients → Create client**. Tipo *OpenID Connect*, client ID por exemplo `oficio`. Ative **Client authentication** (cliente confidencial) e mantenha **Standard flow** ligado.
2. Valid redirect URIs: `https://<OFFICE_DOMAIN>/api/auth/oidc/callback`. Web origins: `https://<OFFICE_DOMAIN>`.
3. Aba **Credentials**: copie o client secret.
4. Grupos: em **Client scopes → `oficio-dedicated` → Add mapper → By configuration → Group Membership** do cliente. Token claim name `groups`, *Full group path* desligado, *Add to ID token* e *Add to userinfo* ligados. Depois `OIDC_ADMIN_CLAIM=groups` e `OIDC_ADMIN_VALUES=<nome do grupo>`.

```ini
OIDC_ISSUER=https://keycloak.acme.com/realms/office
OIDC_SCOPES=openid email profile
OIDC_ADMIN_CLAIM=groups
OIDC_ADMIN_VALUES=oficio-admins
```

O Keycloak envia `email_verified`; pessoas cujo e-mail não está verificado no Keycloak são recusadas (`error=oidc_email_unverified`). Marque o e-mail como verificado nos detalhes do usuário ou ative *Verify email* nas configurações de login do realm.

### Authentik

1. **Applications → Providers → Create → OAuth2/OpenID Provider**. Client type *Confidential*, fluxo de autorização *implicit consent* (ou explícito), redirect URI `https://<OFFICE_DOMAIN>/api/auth/oidc/callback`. Em *Advanced protocol settings* mantenha os escopos `openid`, `email`, `profile` e adicione **`authentik default OAuth Mapping: OpenID 'groups'`** se quiser mapear grupos. Subject mode: *Based on the User's hashed ID* (padrão) serve; não troque depois, o vínculo da conta é pelo `sub`.
2. **Applications → Create** e anexe o provider. O issuer aparece na página do provider como *OpenID Configuration Issuer*, normalmente `https://authentik.acme.com/application/o/<slug-da-aplicação>/`.
3. Copie o client ID e o secret da página do provider.

```ini
OIDC_ISSUER=https://authentik.acme.com/application/o/oficio/
OIDC_SCOPES=openid email profile groups
OIDC_ADMIN_CLAIM=groups
OIDC_ADMIN_VALUES=oficio-admins
```

O Authentik coloca a claim `groups` (nomes dos grupos) no ID token quando o escopo `groups` é pedido.

### Qualquer outro provedor

Você precisa de um cliente confidencial (client ID + secret) usando o fluxo authorization code com PKCE (S256), a URI de redirecionamento acima, os escopos `openid email profile` e a URL do issuer que serve `/.well-known/openid-configuration`. Provedores que só aceitam autenticação do cliente por `client_secret_basic` também funcionam (o `openid-client` negocia a partir dos metadados).

## Regras de vínculo e criação de conta

Em todo login bem-sucedido, nesta ordem:

1. O ID token precisa conter `sub` e `email`. Se o provedor enviar `email_verified: false`, o login é recusado (`oidc_email_unverified`). `email_verified` ausente é aceito.
2. Se `OIDC_ALLOWED_DOMAINS` estiver definido, o domínio do e-mail precisa estar na lista (`oidc_domain`).
3. A conta é procurada pela identidade: `external_id = "oidc:<issuer>|<sub>"` (o issuer conforme publicado nos metadados do provedor). Encontrada → essa conta é usada, mesmo que o e-mail no provedor tenha mudado.
4. Senão, é procurada pelo e-mail (sem diferenciar maiúsculas). Encontrada → a conta é **vinculada** definindo `external_id`; nome, senha e flag de admin ficam intactos, então quem foi convidado com senha temporária e depois usa o login único mantém a conta. Contas vindas do `import-json` mantêm o `external_id` da importação e são aceitas pelo e-mail a cada login (aparecem como `imported`, não `sso`).
5. Senão, com `OIDC_AUTO_CREATE=1` (padrão), uma conta nova é **criada**: nome a partir de `name` (ou `given_name` + `family_name`, `preferred_username` ou a parte local do e-mail), senha aleatória inutilizável, `must_change_password = false`. Com `OIDC_AUTO_CREATE=0` o login termina em `oidc_no_account`.
6. Contas desativadas não entram (`oidc_disabled`), exatamente como no formulário de senha.
7. **Mapeamento de administrador**: quando `OIDC_ADMIN_CLAIM`/`OIDC_ADMIN_VALUES` estão definidos e a claim contém um dos valores, a conta vira administradora (nova ou existente). Quando a claim não contém os valores, nada muda: uma conta promovida no painel de administração **mantém** o acesso de administrador. Rebaixe pessoas no painel; o Oficio nunca remove a flag pelo login único. Os grupos são lidos primeiro do ID token e do endpoint userinfo quando a claim não está lá.

No painel de administração, contas vinculadas aparecem com a origem **SSO**. Tudo o mais funciona como em qualquer conta: desativar, promover, redefinir a senha. Redefinir a senha de uma conta SSO dá a ela uma senha temporária (enviada por e-mail ou mostrada uma vez) e pede uma nova no próximo login, o que permite àquela pessoa voltar a usar o formulário de senha quando ele estiver ativo.

## Desativando o login por senha

Defina `OIDC_PASSWORD_LOGIN=0` (com o login único ativo). A página de login passa a mostrar só o botão de login único, e `POST /api/auth/login` responde `403 {code: "password_login_disabled"}`. O que continua funcionando:

- a CLI (`create-admin`, `reset-password`, `import-json`), porque fala direto com o banco;
- `LOGIN_MASTER_PASSWORD` em `--dev`, para desenvolvimento local;
- links de redefinição de senha e a página de troca obrigatória (um administrador ainda pode redefinir a senha de alguém; só o login com senha é bloqueado);
- as sessões existentes.

Antes de ligar, entre uma vez pelo provedor com uma conta que é (ou vai virar) administradora, para não ficar trancado fora do painel se o mapeamento de grupo não estiver certo. Para recuperar o acesso pelo formulário de senha, defina `OIDC_PASSWORD_LOGIN=1` e reinicie.

## Solução de problemas

Códigos que podem aparecer em `/login?error=…`:

| Código | Significado | O que conferir |
|---|---|---|
| `oidc_unavailable` | A descoberta ou o endpoint de token não pôde ser alcançado, ou os metadados são inválidos. | `OIDC_ISSUER` é exatamente o issuer que o provedor publica (abra `<issuer>/.well-known/openid-configuration` no navegador); o container alcança o provedor (DNS, firewall de saída, TLS). O log do app tem o erro de origem. |
| `oidc_state` | O cookie transitório está ausente, expirado (10 min) ou não bate com o `state` que voltou. | O callback precisa cair no mesmo host que iniciou o fluxo (`OFFICE_PUBLIC_URL`/`OFFICE_DOMAIN`); cookies precisam estar permitidos; em HTTP puro defina `OFFICE_COOKIE_SECURE=0` (só desenvolvimento). Reusar uma URL de callback do histórico do navegador também dá isso. |
| `oidc_failed` | A troca do código ou a validação do ID token falhou, ou o provedor devolveu um erro diferente de `access_denied`. | Client secret errado ou rotacionado; URI de redirecionamento registrada diferente (barra final, http vs https); relógio do servidor fora de hora; tenant errado no issuer do Entra. O log tem a mensagem do provedor. |
| `oidc_denied` | A pessoa cancelou no provedor ou não está atribuída à aplicação. | Atribua o usuário/grupo à aplicação (*Aplicativos empresariais* no Entra, bindings no Authentik). |
| `oidc_no_email` | Nenhuma claim `email` no ID token nem no userinfo. | Peça o escopo `email`; no Entra confira se a conta tem atributo de e-mail; no Keycloak confira se o usuário tem e-mail. |
| `oidc_email_unverified` | O provedor enviou `email_verified: false`. | Verifique o e-mail no provedor. |
| `oidc_domain` | Domínio do e-mail fora de `OIDC_ALLOWED_DOMAINS`. | Adicione o domínio ou use outra conta. |
| `oidc_no_account` | `OIDC_AUTO_CREATE=0` e não há conta com aquele e-mail. | Convide a pessoa no painel de administração primeiro. |
| `oidc_disabled` | A conta está desativada. | Reative-a no painel de administração. |
| `oidc_rate_limited` | Mais de 30 inícios (ou falhas repetidas) de um IP em 10 minutos. | Aguarde; atrás de um proxy defina `TRUST_PROXY=1` para que um IP do escritório não seja compartilhado por todo mundo. |
| `oidc_not_configured` | As rotas `/api/auth/oidc/*` foram chamadas com o login único desligado. | Defina as três variáveis obrigatórias e reinicie. |

Outras coisas úteis:

- **Botão ausente na página de login**: `curl -s https://office.example.com/api/config` precisa mostrar `"oidc":{"enabled":true,…}`. Se `enabled` for falso, leia os avisos do boot (`docker compose logs app | grep -i oidc`).
- **Loop de redirecionamento depois de entrar**: o cookie de sessão é `Secure`; você provavelmente está acessando o app por HTTP puro. Corrija o proxy/TLS em vez de desligar `OFFICE_COOKIE_SECURE`.
- **Ninguém virou administrador**: confira o nome e os valores da claim com o inspetor de tokens do provedor (*Evaluate* no Keycloak, *Configuração de token* no Entra, *Preview* no Authentik); os valores são comparados exatamente (IDs de grupo do Entra são GUIDs). Lembre que o mapeamento só concede; o primeiro admin também pode ser criado com `create-admin`.
- **Alguém trocou o e-mail no provedor**: a conta continua sendo encontrada pelo `sub`; atualize o e-mail no painel de administração se quiser que coincidam.
- **Troca de provedor** (por exemplo de um realm do Keycloak para outro): o `external_id` guardado inclui o issuer, então as pessoas serão revinculadas pelo e-mail no primeiro login com o novo provedor, desde que o e-mail seja o mesmo.

## Notas de segurança

- Fluxo authorization code com PKCE (S256) e `nonce`; assinatura, issuer, audiência, expiração e nonce do ID token são validados pelo `openid-client`.
- `state`, `nonce` e o verificador PKCE vivem só num cookie assinado, `HttpOnly`, de 10 minutos, restrito a `/api/auth/oidc`; o cookie é apagado em todo callback.
- O client secret e os access tokens nunca vão para o log nem saem do servidor; `GET /api/config` expõe só `enabled`, `label` e `passwordLogin`.
- O parâmetro `next` aceita só caminhos internos (nada de `//host`, nada de `/api/…`).
- O login único não enfraquece nada: contas desativadas continuam fora, o cookie de sessão e seus 30 dias são os mesmos, e as ações de admin (desativar, redefinir) valem igualmente.
