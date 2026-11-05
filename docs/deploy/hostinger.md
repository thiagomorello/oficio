# Deploy on Hostinger

Hostinger's KVM VPS plans are a good fit for Oficio: a public IPv4, an operating-system template that ships with Docker, a firewall and DNS in the same panel (hPanel). This guide covers the Hostinger-specific clicks and then hands over to the [VPS reference guide](docker-compose-vps.md) for the commands.

| | |
|---|---|
| **What you get** | The full stack (app, MySQL, self-hosted LiveKit, Caddy with HTTPS) on one Hostinger VPS. |
| **Monthly cost** | Roughly US$ 5–20 for a KVM 1 to KVM 4 plan on a long-term contract; renewals and short terms cost more. Prices change, check hostinger.com. |
| **Time needed** | About 40 minutes. |
| **Audio/video** | Self-hosted LiveKit on the same VPS. [LiveKit Cloud](livekit-cloud.md) is optional. |
| **Database** | MySQL 8 container on the same VPS, backed up by `scripts/backup.sh` plus Hostinger snapshots. |

Menu names below are as they appear in hPanel as of late 2026; Hostinger renames things from time to time, so look for the closest match if a label differs.

## 1. Choose a plan

| Team (online at once) | Hostinger plan | Specs |
|---|---|---|
| up to ~15 | KVM 1 | 1 vCPU, 4 GB RAM, 50 GB NVMe |
| up to ~50 | KVM 2 | 2 vCPU, 8 GB RAM, 100 GB NVMe |
| up to ~150 | KVM 4 | 4 vCPU, 16 GB RAM, 200 GB NVMe |

All KVM plans include a dedicated IPv4 address, which LiveKit needs. Any data-center location works; pick the one closest to most of your team (latency of the audio follows the server).

## 2. Create the VPS with the Docker template

1. Buy the plan. In hPanel, go to **VPS** in the top menu and click **Setup** on the new server (or **Manage** if it is already running).
2. When asked for the operating system, open the **Applications** (or "OS with panel / app") tab and choose **Ubuntu 24.04 with Docker** (Hostinger has also published the template as "Docker" or "Ubuntu 22.04 with Docker" in some regions; either is fine). If you do not find it, pick plain **Ubuntu 24.04** and install Docker in step 3 of the VPS guide.
3. Set the **root password** and, if you have one, paste your **SSH key**. Finish the wizard. Provisioning takes a few minutes.
4. On the server's **Overview** page, note the **IP address** (we use `203.0.113.10` below) and the SSH login details.

To change the OS later: **VPS > Manage > Settings > OS & Panel > Operating System**, pick the Docker template and confirm (this wipes the disk).

Verify Docker from your terminal:

```sh
ssh root@203.0.113.10
docker --version
docker compose version
```

Expected: `Docker version 2x.x` and `Docker Compose version v2.x`. If `docker compose` is missing, install it with `apt install docker-compose-plugin`.

## 3. Firewall in hPanel

Hostinger's firewall sits in front of the VPS and is independent of `ufw`. Docker publishes ports around `ufw`, so this is the firewall that actually protects you.

1. **VPS > Manage > Security > Firewall** (in older layouts: **Settings > Security > Firewall**).
2. Click **Create firewall configuration**, give it a name (`oficio`) and open it.
3. Add one rule per line with **Add rule**. Action **Accept**, source **Anywhere**:

   | Protocol | Port |
   |---|---|
   | TCP (or the preset "SSH") | 22 |
   | TCP (or "HTTP") | 80 |
   | TCP (or "HTTPS") | 443 |
   | TCP | 7881 |
   | UDP | 7882 |

4. Click **Activate** (toggle on the configuration) so it applies to this VPS.

Hostinger's firewall drops everything that is not explicitly accepted once a configuration is active, so make sure the SSH rule is there before activating. Rules apply to new connections only. Do not add a rule for 3306: MySQL stays internal.

On the server you can additionally run the `ufw` commands from the VPS guide; it is not required.

## 4. DNS

### Domain registered at Hostinger

1. hPanel top menu **Domains**, click **Manage** next to your domain, then **DNS / Nameservers** in the sidebar.
2. In **Manage DNS records**, add two records:

   | Type | Name | Points to | TTL |
   |---|---|---|---|
   | A | `office` | `203.0.113.10` | 14400 (or lower) |
   | A | `livekit` | `203.0.113.10` | 14400 (or lower) |

3. Click **Add record** for each.

### Domain registered elsewhere

Add the same two A records at your registrar or DNS provider. With Cloudflare, set both to **DNS only** (grey cloud).

Wait until `nslookup office.example.com` and `nslookup livekit.example.com` return the VPS IP from your computer.

## 5. Install Oficio

Follow the [VPS reference guide](docker-compose-vps.md) from **step 2** (connect and create a non-root user); step 3 (Docker) is already done if you used the Docker template. In short:

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

Then sign in at `https://office.example.com` with the temporary password printed by the last command.

## 6. Alternative: Hostinger Docker Manager

The Docker template also installs **Docker Manager**, a panel inside hPanel (**VPS > Manage > Docker Manager**) that can start a Compose project from a URL or from pasted YAML ("Compose", then **Compose from URL** or **Compose manually**), and shows containers, logs and a terminal per container.

It is possible to run Oficio from there, but with a catch: Oficio's `docker-compose.yml` reads its secrets and domains from a `.env` file, which Docker Manager does not manage for you. If you want to use it anyway:

1. Open **Compose > Compose manually**, name the project `oficio`.
2. Paste the contents of [`deploy/portainer/stack.yml`](../../deploy/portainer/stack.yml) (the self-contained variant of the stack) and replace every `${VARIABLE}` placeholder with real values in the YAML preview: domains, e-mail, and secrets generated on your computer with `openssl rand -hex 32` / `openssl rand -hex 24` (see the header of that file for the list).
3. Click **Deploy**, then open the `app` container's **Terminal** and run `node dist/server/cli.js create-admin --email you@example.com --name "Your Name"`.

Pasting secrets into a web form is less tidy than the `.env` route, and updating later means editing the YAML again; the SSH path above is what the rest of the documentation assumes.

## 7. Backups and snapshots

Two layers:

- **Database dumps** on the server: `scripts/backup.sh` with the cron line from the [VPS guide](docker-compose-vps.md#13-backups). These are small and you can restore them anywhere.
- **Hostinger backups/snapshots** of the whole VPS: **VPS > Manage > Backups & Snapshots** (sidebar). Hostinger keeps automatic weekly backups on KVM plans and lets you take one manual **Snapshot** at a time (taking a new one replaces the previous). Restoring a backup overwrites the whole disk, so use it for disaster recovery, not for undoing a single change. Check your plan's details: backup frequency and retention differ by plan and change over time.

## 8. Updating and uninstalling

Same as the VPS guide: `cd /opt/oficio && docker compose pull && docker compose up -d` to update, `docker compose down -v` to remove everything. If you used Docker Manager, use its **Update** / **Delete** actions on the project instead.

## Troubleshooting on Hostinger

- **Certificates never arrive** (`challenge failed` in `docker compose logs caddy`): either DNS still points elsewhere (check with `nslookup`) or the hPanel firewall is active without the 80/443 rules.
- **People can see each other but hear nothing**: 7882/udp missing in the hPanel firewall, or `LIVEKIT_NODE_IP` left empty on a server with several interfaces. Set it to the public IP from the Overview page and `docker compose up -d`.
- **SSH locked out after activating the firewall**: in hPanel, open the firewall configuration, add the TCP 22 rule, or deactivate the configuration temporarily. You can also use the **Browser terminal** button on the VPS Overview page.
- **`docker compose` says the file is invalid**: the Docker template may carry an older Compose; `apt update && apt install docker-compose-plugin` brings v2.2x+.

More: [../troubleshooting.md](../troubleshooting.md).
