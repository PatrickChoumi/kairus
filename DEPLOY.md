# Déployer Kairus

Un conteneur, un service, un volume. Le serveur sert l'API, les WebSockets et
le client compilé depuis la même origine — il n'y a rien d'autre à héberger.

---

## Avant tout : une seule instance

Trois choses vivent dans le processus, pas dans une base partagée :

- **Le hub WebSocket** (`server/src/realtime.ts`) — une `Map` en mémoire. Deux
  instances, et deux personnes connectées sur des instances différentes ne se
  voient plus : les messages passent en base mais ne sont jamais diffusés.
- **La base SQLite** — un fichier sur un volume local, pas un service réseau.
- **La limitation de débit** — des compteurs en mémoire, donc par instance.

**Ne mettez jamais Kairus à l'échelle horizontale.** Une instance, verticalement
dimensionnée. C'est amplement suffisant pour des milliers d'utilisateurs, mais
c'est une limite d'architecture, pas un réglage : la contourner demanderait
Postgres et un bus de messages (Redis) — ce n'est pas fait.

---

## Étape 1 — fabriquer le secret

```bash
openssl rand -hex 32
```

Gardez la sortie. C'est `JWT_SECRET`. Sans lui le serveur **refuse de démarrer
en production** — délibérément : un secret par défaut laisserait n'importe qui
forger des jetons.

Le changer déconnecte tout le monde. Ce n'est pas grave, mais ce n'est pas
silencieux.

---

## Étape 2 — choisir un hôte

### A. Railway — le plus court chemin

`railway.json` est déjà dans le dépôt : il pointe sur le `Dockerfile` et sur la
sonde `/api/health`.

1. Sur [railway.app](https://railway.app) : **New Project → Deploy from GitHub
   repo**, choisir `PatrickChoumi/kairus`, branche `claude/minimal-telegram-app-hzghz6`
   (ou la branche que vous aurez fusionnée).
2. Railway détecte le `Dockerfile` et construit. Laissez faire.
3. **Variables** → ajouter :
   - `JWT_SECRET` = la sortie de l'étape 1
   - `TRUST_PROXY` = `1`
4. **Settings → Volumes → New Volume**, point de montage **`/data`**.
   Sans ça, chaque redéploiement efface tous les comptes et tous les messages.
   Le `Dockerfile` ne déclare volontairement **pas** d'instruction `VOLUME` :
   Railway refuse de construire une image qui en contient une, et le montage se
   fait de toute façon depuis l'extérieur.
5. **Settings → Networking → Generate Domain** (ou brancher votre domaine).
6. Redéployer une fois, pour que le volume et les variables soient pris en
   compte.

> Le CLI Railway fait la même chose (`railway up`, `railway variables`,
> `railway volume`), mais ses options changent souvent d'une version à l'autre.
> L'interface web est le chemin stable.

### B. Fly.io — bon terrain pour SQLite

```bash
fly launch --no-deploy          # ne PAS accepter la base Postgres proposée
fly volumes create kairus_data --size 1 --region cdg
fly secrets set JWT_SECRET=<la sortie de l'étape 1>
fly deploy
```

Le `fly.toml` doit contenir ceci — les trois points qui comptent sont le port
interne, le montage, et le fait que la machine **ne doit pas s'endormir** :

```toml
app = "kairus"
primary_region = "cdg"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "4000"
  TRUST_PROXY = "1"
  DATA_DIR = "/data"

[mounts]
  source = "kairus_data"
  destination = "/data"

[http_service]
  internal_port = 4000
  force_https = true
  # Une machine qui s'arrête coupe toutes les WebSockets ouvertes.
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

[[http_service.checks]]
  grace_period = "10s"
  interval = "30s"
  method = "GET"
  path = "/api/health"
  timeout = "5s"

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1
```

Puis vérifiez qu'il n'y a bien qu'une machine :

```bash
fly scale count 1
fly status
```

### C. N'importe quel hôte Docker (VPS)

Le `Dockerfile` ne déclare pas de `VOLUME` (Railway l'interdit), donc le volume
se crée et se monte explicitement :

```bash
git clone <votre-dépôt> kairus && cd kairus
docker build -t kairus .
docker volume create kairus-data

docker run -d --name kairus --restart unless-stopped \
  -p 127.0.0.1:4000:4000 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e TRUST_PROXY=1 \
  -v kairus-data:/data \
  kairus
```

Le port n'est publié que sur `127.0.0.1` : c'est le reverse proxy qui fait face
à Internet et porte le TLS.

**Caddy** — le plus simple, il gère TLS et WebSockets sans rien dire :

```
kairus.example.com {
  reverse_proxy 127.0.0.1:4000
}
```

**nginx** — il faut passer l'`Upgrade` explicitement, sinon le temps réel ne
marche pas et l'application retombe silencieusement sur des reconnexions
perpétuelles :

```nginx
server {
  listen 443 ssl http2;
  server_name kairus.example.com;

  # ssl_certificate / ssl_certificate_key : certbot

  location / {
    proxy_pass         http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade           $http_upgrade;
    proxy_set_header   Connection        "upgrade";
    proxy_set_header   Host              $host;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    # Plus long que le battement de cœur du hub (30 s).
    proxy_read_timeout 3600s;
  }
}
```

---

## Étape 3 — les variables d'environnement

| Variable      | Valeur                        | Conséquence si vous vous trompez                                                                             |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `JWT_SECRET`  | 32 octets aléatoires          | Absent : le serveur refuse de démarrer. Changé : tout le monde est déconnecté.                                 |
| `TRUST_PROXY` | `1` derrière un proxy, `0` sinon | À `0` derrière un proxy, tous les visiteurs partagent un seul compteur et se font limiter les uns les autres. Trop haut, l'adresse devient falsifiable et la limitation se contourne. |
| `DATA_DIR`    | `/data`                       | Ailleurs que sur le volume : tout est perdu au redéploiement.                                                  |
| `PORT`        | fourni par l'hôte             | Railway et Fly l'injectent. Ne le figez pas.                                                                   |
| `NODE_ENV`    | `production`                  | Déjà posé par le `Dockerfile`.                                                                                 |
| `CORS_ORIGIN` | **laisser vide**              | Inutile ici : le client est servi par le même serveur. Ne le remplissez que pour un front hébergé ailleurs.     |

---

## Étape 4 — vérifier que c'est vraiment vivant

Remplacez `kairus.example.com`, puis passez la liste :

```bash
# 1. Le serveur répond
curl -s https://kairus.example.com/api/health          # {"ok":true}

# 2. Le client est bien servi
curl -sI https://kairus.example.com/ | head -1         # 200

# 3. Le refus par défaut du CORS tient
curl -sI -H 'origin: https://ailleurs.example' \
     https://kairus.example.com/api/health | grep -i access-control
# ↑ ne doit RIEN afficher

# 4. Un compte se crée
curl -s -X POST https://kairus.example.com/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"handle":"essai","name":"Essai","password":"une-phrase-assez-longue"}'
# ↑ renvoie un token et une recoveryPhrase

# 5. La limitation de débit mord
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code} " -X POST \
    https://kairus.example.com/api/auth/login \
    -H 'content-type: application/json' \
    -d '{"handle":"essai","password":"mauvais"}'
done; echo
# ↑ doit passer de 401 à 429 avant la douzième
```

Puis, dans un navigateur : ouvrez le site dans **deux fenêtres**, créez deux
comptes, écrivez de l'une à l'autre. Si le message arrive sans recharger la
page, les WebSockets passent le proxy. Si vous devez recharger, c'est l'`Upgrade`
du reverse proxy qui manque.

Le HTTPS n'est pas optionnel : sans lui, ni le service worker, ni l'installation
en PWA, ni le bouton « copier » de la phrase de secours ne fonctionnent.

---

## Sauvegardes

Le volume est le seul endroit où vivent vos données. La base est en mode WAL,
donc **copier `kairus.db` seul donne une copie potentiellement incohérente** —
les écritures récentes sont dans `kairus.db-wal`.

La bonne façon, avec ce qui est déjà dans l'image :

```bash
docker exec kairus node -e "
  const D = require('/app/server/node_modules/better-sqlite3');
  new D('/data/kairus.db', { readonly: true })
    .backup('/data/backup.db')
    .then(() => console.log('ok'))
"
docker cp kairus:/data/backup.db ./kairus-$(date +%F).db
```

Sur Railway ou Fly, la même commande via `railway run` / `fly ssh console`.
Mettez-la dans une tâche quotidienne.

---

## Mettre à jour

```bash
git pull
docker build -t kairus .
docker stop kairus && docker rm kairus
docker run -d --name kairus ... # même commande, même volume
```

Le schéma se migre tout seul au démarrage (`server/src/db.ts` ajoute les
colonnes manquantes). Le volume n'est jamais touché par une reconstruction
d'image.

Sur Railway et Fly, un `git push` sur la branche suivie suffit.

---

## Ce qui casse si on n'y prend pas garde

- **Pas de volume monté sur `/data`** — tout disparaît au premier redéploiement,
  et rien ne vous préviendra.
- **Deux instances** — les gens ne se voient plus en temps réel. Voir tout en
  haut de ce fichier.
- **`TRUST_PROXY` oublié derrière un proxy** — vos utilisateurs se limitent
  mutuellement et récoltent des 429 sans rien avoir fait.
- **`Upgrade` non transmis par nginx** — le temps réel meurt en silence, le
  client se reconnecte en boucle sans erreur visible.
- **Machine qui s'endort** (Fly `auto_stop_machines`, offres « scale to zero »)
  — toutes les WebSockets tombent à chaque assoupissement.
