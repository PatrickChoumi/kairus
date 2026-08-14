# Kairus — architecture et implémentation

Ce document dit **ce qui est utilisé**, **pourquoi**, et **comment chaque
fonctionnalité est faite**. Il s'adresse à quelqu'un qui doit modifier le code
sans l'avoir écrit.

Il décrit l'état du dépôt à la date de sa dernière mise à jour. Les chiffres
(lignes, tests, poids) sont mesurés, pas estimés — s'ils vous semblent faux,
c'est qu'ils ont vieilli : `wc -l`, `npm test` et `npm run build` les
recalculent.

---

## Table

1. [Le parti pris](#1-le-parti-pris)
2. [Les technologies, et pourquoi celles-là](#2-les-technologies-et-pourquoi-celles-là)
3. [La forme du dépôt](#3-la-forme-du-dépôt)
4. [Le serveur, module par module](#4-le-serveur-module-par-module)
5. [La base de données](#5-la-base-de-données)
6. [Le client, module par module](#6-le-client-module-par-module)
7. [Les fonctionnalités, une par une](#7-les-fonctionnalités-une-par-une)
8. [Sécurité](#8-sécurité)
9. [Tests](#9-tests)
10. [Construction et déploiement](#10-construction-et-déploiement)
11. [Ce qui n'y est pas, et pourquoi](#11-ce-qui-ny-est-pas-et-pourquoi)
12. [Pièges rencontrés](#12-pièges-rencontrés)

---

## 1. Le parti pris

Trois règles ont décidé de presque tout le reste.

**Une seule origine, un seul processus.** Le serveur Node sert l'API, les
WebSockets *et* le client compilé. Pas de CORS à configurer, pas de second
déploiement, pas de CDN. Le prix : il ne se met pas à l'échelle
horizontalement — voir [§11](#11-ce-qui-ny-est-pas-et-pourquoi).

**Le moins de dépendances possible.** Cinq au runtime côté serveur, trois côté
client. Chaque dépendance est une décision qu'on délègue et une surface qu'on
n'audite pas. Ce qui tient en cent lignes lisibles est écrit ici : le limiteur
de débit, le TOTP, l'intégrateur de ressort, les icônes.

**Refuser plutôt que deviner.** Quand une opération est ambiguë, elle échoue
avec un message. Quand une donnée manque, la réponse est 404 plutôt qu'une
liste vide qui ressemble à une réponse.

---

## 2. Les technologies, et pourquoi celles-là

### Serveur

| Technologie | Version | Rôle | Pourquoi elle, et pas autre chose |
| --- | --- | --- | --- |
| **Node.js** | 22 | Exécution | LTS, `node:test` intégré, WebCrypto natif, support ESM mûr |
| **TypeScript** | ^5.7 | Langage | Le typage remplace la moitié des tests qu'on n'écrit pas |
| **`node:http`** | intégré | Serveur HTTP | Aucun framework. Voir ci-dessous |
| **`ws`** | ^8.18 | WebSocket | La seule vraie option en Node ; ~40 ko, pas de dépendances |
| **`better-sqlite3`** | ^11.7 | Base | **Synchrone** — pas de `await` sur une requête locale, donc pas de conditions de course entre lecture et écriture dans une même poignée de main |
| **`bcryptjs`** | ^2.4 | Hachage | Pur JS : pas de compilation native, donc pas d'image Docker qui casse à chaque montée de version de Node |
| **`jsonwebtoken`** | ^9.0 | Jetons | Signature HS256 vérifiée, avec `token_version` pour la révocation |
| **`web-push`** | ^3.6 | Notifications | Implémente VAPID et le chiffrement de la charge utile — à ne pas réécrire |

**Pas de framework HTTP.** Express, Fastify et Koa apportent un routeur, un
middleware et un analyseur de corps. Le routeur ici est une table plate de
`'MÉTHODE /chemin'` vers une fonction (`router.ts`) : quarante et une entrées
qu'on lit d'un coup d'œil, sans savoir dans quel ordre des intergiciels
s'exécutent. Le corps est lu en une fonction de quinze lignes qui refuse au-delà
de 64 ko. Ce qu'on perd — les routes paramétrées — n'est utilisé qu'une fois
(`/api/files/:id`), traité par un préfixe.

**Pas d'ORM.** Le SQL est écrit à la main, dans des requêtes préparées. Ce qui
est en jeu ici — `joined_at`, le blocage réciproque, les épingles par lecteur —
tient dans les clauses `WHERE`, et une couche d'abstraction rendrait ces règles
plus difficiles à voir, pas plus faciles.

### Client

| Technologie | Version | Rôle | Pourquoi |
| --- | --- | --- | --- |
| **React** | ^18.3 | Interface | Le modèle de rendu convient à une liste qui change en permanence |
| **Vite** | ^7.3 | Construction | Démarrage instantané en développement, sortie propre en production |
| **zustand** | ^5.0 | État | ~1 ko. Un magasin, des sélecteurs, aucun *provider*, aucune génération de code |
| **CSS écrit à la main** | — | Style | ~2 300 lignes avec jetons de conception. Voir ci-dessous |

**Pas de framework CSS.** Tailwind et consorts déplacent la complexité dans le
balisage. Ici les couleurs, rayons et espacements sont des variables CSS dans
`tokens.css`, redéfinies une fois pour le thème sombre ; le reste est du CSS
ordinaire avec des noms de classe stables.

**Pas de routeur.** Il y a une seule surface : la liste et la conversation. Le
passage de l'une à l'autre est un état, pas une URL.

**Pas de bibliothèque d'animation.** `motion/spring.ts` est un intégrateur de
ressort de 153 lignes. Framer Motion pèse plus que le reste du client réuni.

### Ce qui n'est pas une dépendance

Écrit à la main **parce que le faire coûtait moins cher que l'auditer** :

- **TOTP** (`totp.ts`, 120 lignes) — RFC 6238, base32, HMAC-SHA1 par WebCrypto
- **Limiteur de débit** (`limiter.ts`, 128 lignes) — seau à jetons, déclaré en un seul endroit
- **Icônes** (`Icon.tsx`, 220 lignes) — 29 SVG dessinés à la main, un seul poids de trait
- **Ressorts** (`spring.ts`) — intégration à pas fixe, `prefers-reduced-motion` respecté
- **Détection de liens** (`links.ts`, 109 lignes) — voir [§7.14](#714-liens-cliquables)

---

## 3. La forme du dépôt

```
kairus/
├── server/          4 518 lignes de TypeScript
│   ├── src/
│   │   ├── index.ts       amorçage, arrêt propre
│   │   ├── router.ts      1 031 — la table des routes
│   │   ├── model.ts       1 258 — toutes les requêtes SQL
│   │   ├── realtime.ts      593 — le concentrateur WebSocket
│   │   ├── files.ts         306 — téléversements, service, balayage
│   │   ├── db.ts            233 — schéma et migrations
│   │   ├── backup.ts        179 — instantanés
│   │   ├── push.ts          161 — Web Push
│   │   ├── limiter.ts       128 — seaux à jetons
│   │   ├── totp.ts          120 — second facteur
│   │   ├── headers.ts        97 — CSP et compagnie
│   │   ├── log.ts            87 — journaux JSON, compteurs
│   │   ├── static.ts         73 — service du client compilé
│   │   ├── env.ts            67 — configuration lue une fois
│   │   ├── breached.ts       56 — vérification k-anonyme
│   │   ├── token.ts          45 — JWT
│   │   └── cli/             vapid, backup
│   └── test/                19 fichiers, 187 tests
│
├── client/          9 500 lignes
│   ├── src/
│   │   ├── state/store.ts  1 078 — le magasin, et tout ce qui parle au réseau
│   │   ├── views/                 les écrans
│   │   ├── net/                   API, socket, fichiers, appels, push
│   │   ├── motion/                ressorts, gestes
│   │   ├── lib/                   temps, liens
│   │   ├── ui/                    icônes, sigils, avis
│   │   └── styles/                jetons, base, application
│   └── (13 fichiers de test, 161 tests)
│
├── Dockerfile            construction en deux étapes
├── railway.json          hôte
├── README.md             ce que c'est
├── DEPLOY.md             comment le mettre en ligne
└── ARCHITECTURE.md       ce document
```

---

## 4. Le serveur, module par module

### `index.ts` — l'amorçage

Crée le serveur `node:http`, y attache le concentrateur temps réel, monte le
service du client compilé, démarre le balayeur de fichiers orphelins et les
sauvegardes. `SIGTERM` ferme les sockets et la base avant de sortir : un
redéploiement ne doit pas couper une écriture en cours.

### `router.ts` — la table des routes

```ts
const routes: Record<string, (ctx: Ctx) => unknown | Promise<unknown>> = {
  'GET /api/health': () => ({ ok: true, build: builtVersion(), startedAt }),
  'POST /api/messages': async ({ userId, body }) => { … },
  …
}
```

Une entrée par route, la méthode dans la clé. `route(req, res)` :

1. applique les en-têtes de sécurité et le CORS ;
2. dépense un jeton du limiteur global (par adresse) ;
3. détourne les deux routes qui portent des octets plutôt que du JSON
   (`POST /api/files`, `GET /api/files/:id`) — le lecteur de corps les
   refuserait à 64 ko ;
4. vérifie le jeton si la route n'est pas publique, et le renouvelle
   silencieusement s'il vieillit ;
5. appelle la fonction, sérialise ce qu'elle renvoie ;
6. attrape `HttpError` et le traduit en statut + message français.

`HttpError` porte un `kind?: 'code'` : le seul refus que le client doit
*traiter* plutôt qu'afficher — « la phrase était bonne, maintenant le code ».

### `model.ts` — le SQL

Tout ce qui touche la base est ici, en requêtes préparées. Les fonctions
prennent toujours l'identité de l'appelant, jamais un drapeau « est admin ».
Trois règles reviennent dans presque toutes les requêtes :

- `AND m.created_at >= p.joined_at` — un arrivant ne lit pas le passé ;
- `AND m.deleted_at IS NULL` — un message retiré n'est ni lu, ni cherché, ni
  signalable, ni dans la galerie ;
- `isParticipant(conversation, user)` avant toute lecture.

### `realtime.ts` — le concentrateur

Un `WebSocketServer` sur le même serveur HTTP, chemin `/socket`.

**Entrant** : `hello`, `send`, `revise`, `retract`, `forward`, `pin`, `unpin`,
`draft`, `typing`, `read`, `call`, `ping`.
**Sortant** : `ready`, `message`, `revised`, `pinned`, `draft`, `typing`,
`read`, `presence`, `conversation`, `call`, `gone`, `end`, `error`.

Un socket qui ne s'identifie pas en dix secondes est fermé (`HANDSHAKE_MS`). Un
socket muet est détecté par un `ping` toutes les trente secondes
(`HEARTBEAT_MS`). Un socket qui dépasse 600 trames par minute est coupé
(`FRAMES_PER_MINUTE`).

Le concentrateur tient `Map<userId, Set<Socket>>` : plusieurs appareils par
personne, donc les brouillons vont à *vos* autres appareils et pas ailleurs.

### `files.ts`

Les octets vont sur le disque sous un UUID, jamais sous le nom fourni. Le type
MIME est pris de l'en-tête mais **ce qui est servi en ligne** est décidé par une
liste blanche (`isDisplayable`) ; tout le reste part en `attachment`. Un fichier
téléversé mais jamais envoyé est balayé au bout d'une heure.

### `limiter.ts`

Un seau à jetons par clé. Tous les seaux sont **déclarés au même endroit**, ce
qui rend la politique lisible d'un coup d'œil plutôt que dispersée dans les
routes. La connexion est limitée **deux fois** : par adresse *et* par nom
d'usage — le second est celui qu'un réseau de machines ne contourne pas en
changeant d'IP.

### `headers.ts`

CSP sans `unsafe-inline` : les scripts en ligne du `index.html` sont **hachés au
démarrage** (`inlineScriptHashes`) et leurs SHA-256 entrent dans la politique.
`frame-ancestors 'none'`, `object-src 'none'`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, `Permissions-Policy: microphone=(self)` (les
appels), `media-src 'self' blob:` (les vocaux).

### `log.ts`

Une ligne de JSON par événement, et des compteurs en mémoire exposés en format
Prometheus derrière `METRICS_TOKEN`.

---

## 5. La base de données

SQLite en mode **WAL**, un fichier dans `DATA_DIR`.

| Table | Ce qu'elle porte |
| --- | --- |
| `users` | identité, `password_hash`, `recovery_hash`, `token_version`, `totp_secret` |
| `conversations` | `kind` (`direct`/`group`), `title`, `created_by` |
| `participants` | `(conversation_id, user_id)` + `last_read_at`, `joined_at`, `draft`, `muted_until` |
| `messages` | corps, `reply_to`, `edited_at`, `deleted_at`, `forwarded_from` |
| `attachments` | `message_id` (nul tant que non envoyé), MIME, taille, `duration`, `peaks` |
| `pins` | `(conversation_id, message_id)`, `pinned_at`, `pinned_by` |
| `blocks` | `(blocker_id, blocked_id)` |
| `reports` | **copie des mots** au moment du signalement |
| `push_subscriptions` | point de terminaison, clés, compteur d'échecs |
| `messages_fts` | table virtuelle FTS5, synchronisée par déclencheurs |

**`participants` porte quatre colonnes qui pourraient être des tables.**
`last_read_at`, `joined_at`, `draft` et `muted_until` sont tous « cette
personne, dans cette conversation » — exactement ce qu'est une ligne de
participation. Pas de seconde table, pas de jointure, et tout disparaît avec la
conversation.

**Migrations.** Pas d'outil : `ensureColumn(table, colonne, définition)` lit
`PRAGMA table_info` et ajoute ce qui manque, au démarrage. Suffisant parce
qu'aucune migration n'a jamais eu besoin de *transformer* des données — que d'en
ajouter.

---

## 6. Le client, module par module

### `state/store.ts` — le magasin

Un seul magasin zustand. Tout ce qui parle au réseau passe par lui ; les vues ne
font jamais d'appel HTTP elles-mêmes, sauf `Sift` et `Gallery` qui lisent des
listes qu'aucun autre écran ne partage.

L'envoi est **optimiste** : le message apparaît avec `pending: true` et un
`nonce`, et la confirmation du serveur le remplace en s'appariant sur ce nonce.
Coupure réseau : les envois s'accumulent et repartent à la reconnexion.

### `net/socket.ts`

Reconnexion à repli exponentiel avec gigue. Le socket porte le jeton dans la
trame `hello`, jamais dans l'URL — une URL finit dans les journaux d'un proxy.

### `net/blobs.ts`

Les pièces jointes sont récupérées **avec le jeton** (donc pas via `<img src>`,
qui n'envoie pas d'en-tête), transformées en `blob:` et mises en cache par
identifiant. `useAttachment(id)` rend `{ url, failed }`.

### `motion/spring.ts`

Intégrateur de ressort à pas fixe. `useSpringTo(valeur, ressort, appliquer)`
appelle `appliquer(t)` à chaque trame et écrit **directement dans le DOM** —
animer par `setState` ferait rendre React soixante fois par seconde pour rien.
`prefers-reduced-motion` fait sauter directement à la valeur finale.

---

## 7. Les fonctionnalités, une par une

### 7.1 Comptes, connexion, jetons

**Inscription** — nom d'usage (`/^[a-z0-9_]{3,20}$/`), nom affiché, phrase secrète
de 10 caractères minimum vérifiée contre les fuites publiques. `bcrypt` coût 10.
Une **phrase de secours** est émise — quatre groupes de cinq caractères tirés
d'un alphabet sans sosies (`l`/`1`, `O`/`0` en sont absents) — montrée une seule
fois, et stockée hachée. La comparaison ignore la casse et les séparateurs :
qui la recopie à la main ne doit pas être puni d'un tiret oublié.

**Jeton** — JWT HS256, 7 jours, portant `sub`, `iat` et `tv` (`token_version`).
Renouvelé silencieusement quand il dépasse la moitié de sa vie : le nouveau
jeton part dans la réponse, le client le remplace sans que personne ne s'en
aperçoive.

**Révocation** — `POST /api/account/revoke` incrémente `users.token_version`.
Tout jeton portant l'ancienne valeur est refusé à la vérification suivante. Pas
de liste noire à balayer, pas d'état à faire expirer.

**Récupération** — la phrase de secours ouvre le compte, impose une nouvelle
phrase secrète, incrémente `token_version` et **lève le second facteur** : le
téléphone qui portait les codes est très souvent l'objet qu'on vient de perdre.

### 7.2 Second facteur (TOTP)

`totp.ts`, 120 lignes, RFC 6238 : base32 à la main, HMAC-SHA1 par WebCrypto,
fenêtre de ±1 pas (±30 s).

Le point important est l'ordre : `begin` frappe un secret et le **range sans le
mettre en vigueur** ; il ne devient actif que quand `confirm` vérifie un code
qui en sort. Une installation ratée — mauvais QR code, horloge déréglée —
n'enferme donc personne dehors.

À la connexion, le champ de code n'apparaît **qu'après** que la phrase secrète a
été acceptée (`HttpError.kind === 'code'`). Qui n'a pas de second facteur ne
voit jamais rien de tout cela. Le limiteur `code` (5 essais, puis un toutes les
10 s) est ce qui rend six chiffres défendables.

### 7.3 Conversations et groupes

Une conversation directe s'ouvre en tapant un nom d'usage ; la même paire ne
peut pas en ouvrir deux.

**Groupes** : un titre, des noms d'usage. `joined_at` est posé à l'instant de
l'ajout, et **toutes** les lectures le respectent — le fil, la recherche, les
épingles, la galerie, les fichiers, les signalements. Six chemins, une règle,
et chacun a son test.

Une seule asymétrie : **qui a réuni le groupe peut en retirer quelqu'un**
(`founderOf`). Sans ça, un groupe avec un gêneur ne se dissout qu'en le quittant
tous.

### 7.4 Messages

Envoi optimiste avec nonce ; correction et retrait propagés aux deux côtés. Un
message retiré **garde sa ligne** (`deleted_at`) pour que les citations
continuent de résoudre — un fil plein de « message introuvable » est pire que
des lacunes visibles.

### 7.5 Pièces jointes

Les images sont **réduites dans le navigateur** avant l'envoi (canvas, côté long
ramené à 1 600 px) et leurs dimensions voyagent avec le message : la bulle a sa taille
finale avant qu'un octet d'image n'arrive, donc le fil ne saute pas.

### 7.6 Messages vocaux

`MediaRecorder`, un compteur, un appui. La **forme d'onde est calculée avant
l'envoi** (`AudioContext.decodeAudioData`, 44 échantillons de crête) et voyage
dans `attachments.peaks`. Conséquence : un vocal qu'on n'écoute pas ne coûte pas
un octet de son à afficher, et on peut cliquer dans l'onde pour s'y déplacer.

### 7.7 Appels audio

WebRTC de navigateur à navigateur. Le serveur **ne transporte que les
présentations** — offre, réponse, candidats ICE — relayées par le concentrateur
WebSocket ; la voix ne passe jamais par lui. Ce qu'il décide, c'est qui a le
droit de sonner qui : participants de la même conversation directe, pas bloqués,
et le destinataire doit avoir un socket ouvert.

`ICE_SERVERS` porte les serveurs STUN/TURN. Sans TURN, deux réseaux
symétriquement traduits ne se joindront pas — c'est documenté dans `DEPLOY.md`
plutôt que caché.

### 7.8 Transfert

`POST /api/messages/forward`. Deux décisions :

- **Le premier auteur est crédité**, jamais le dernier relais. Transférer un
  transfert porte l'origine plus loin (`forwarded_from` suit la chaîne).
- **Les octets d'un fichier sont copiés**, pas partagés. Deux messages qui
  pointeraient le même fichier s'emporteraient l'un l'autre au premier retrait.

### 7.9 Messages épinglés

Une barre sous l'en-tête, **un seul message à la fois** même quand il y en a
plusieurs : un compteur, et un clic passe au suivant. Une barre qui grandit est
une liste, et une liste en haut du fil mange la conversation.

Les épingles sont calculées **par lecteur** (`joined_at`), plafonnées à 20.
Retirer un message décroche son épingle.

### 7.10 Brouillons synchronisés

Dans `participants.draft`. Envoyé sur une **pause de frappe**, pas sur une
touche. Diffusé à vos autres appareils seulement (`hub.broadcastDraft`) — jamais
à la personne à qui vous écrivez.

### 7.11 Silence par conversation

`participants.muted_until` : `0` jamais, `-1` jusqu'à nouvel ordre, sinon une
date. Deux formes offertes — 2 heures, ou jusqu'à nouvel ordre — parce qu'une
liste de six durées est une décision à prendre quand on voulait juste le calme.

Le point de conception est ce que le silence **ne** fait **pas** : les messages
arrivent, les non-lus comptent, la conversation ne bouge pas. Seul
`reachTheAbsent` consulte `isMuted` et saute la notification. Une durée expire
d'elle-même. Et c'est personnel : l'autre bout n'en sait rien.

### 7.12 Fichiers partagés

`GET /api/shared?conversation=…&kind=image|audio|file`. Une grille pour les
images, une liste pour le reste. Mêmes règles que le fil, `joined_at` compris :
c'est une seconde façon de regarder la même conversation, pas une seconde porte
plus laxiste.

### 7.13 Recherche

**Globale** — FTS5, index synchronisé par déclencheurs, repli sur `LIKE` si la
compilation SQLite n'a pas FTS5. Douze résultats.

**Dans une conversation** — même route, paramètre `conversation`. Soixante
résultats, en ordre de date : on sait déjà *où*, on demande *quand*.

Le paramètre est choisi par l'appelant, donc il **rétrécit** ce qu'on voit déjà
et n'ouvre rien : `isParticipant` d'abord, `joined_at` ensuite.

Mais la fonctionnalité n'est pas la liste, c'est **d'y atterrir**. Le message
est le plus souvent absent du fil, qui ne tient que la dernière page. `reach()`
remonte l'historique page par page jusqu'à l'avoir — borné à douze pages, au-delà
la réponse honnête est que c'est trop loin. Puis le message clignote une fois :
il répond à « lequel » et s'efface, contrairement à un surlignage qu'il faudrait
congédier.

### 7.14 Liens cliquables

`lib/links.ts` découpe le corps en morceaux, chacun soit du texte, soit un lien.
**Rien ne devient jamais du balisage** — React échappe les morceaux de texte, et
il n'existe aucun chemin d'un message vers `innerHTML`.

La grammaire est étroite : `http` et `https` seulement. `javascript:`, `data:`,
`file:` restent du texte **visible et inerte** plutôt que silencieusement avalés.
Le test est l'analyse elle-même : ce que `URL` refuse n'est pas un lien.

La vraie difficulté est la ponctuation. `(voir https://exemple.fr/a)` ne doit pas
manger la parenthèse fermante ; `…/Turing_(machine)` doit la garder. Une
parenthèse fermante n'est rendue à la phrase que si l'adresse ne porte pas déjà
sa partenaire ouvrante. Quatorze tests tiennent ce comportement.

### 7.15 La ligne « nouveaux messages »

Le compte **ne peut pas** venir de la conversation : entrer la marque comme lue,
donc il vaut déjà zéro au rendu et la ligne disparaîtrait sous les yeux. Le
magasin retient dans `fresh[conversationId]` ce qui attendait à l'instant
d'entrer, avant `markRead`. La frontière en est *déduite* — donc elle se replace
seule à mesure que l'historique charge en dessous.

### 7.16 Retour au présent

Un bouton quand le dernier message est à plus de 400 px sous le bord, avec le
nombre en attente. Mesuré **à chaque rendu**, pas seulement au défilement :
atterrir sur un résultat de recherche met le présent loin en dessous sans
qu'aucun événement de défilement ne se produise, et un bouton qui n'apparaît
qu'après un défilement manque exactement quand il servirait.

### 7.17 Blocage et signalement

**Blocage** réciproque : plus de messages, plus de présence, plus de visibilité
dans la recherche, **dans les deux sens**.

**Signalement** : le report **copie les mots** au moment où il est fait. L'auteur
peut retirer son message, et un signalement qui pointe vers un trou n'est
actionnable par personne. **Rien ne se produit automatiquement** — aucun compte
ne disparaît sur un nombre de signalements, parce qu'un système qui punit au
compteur est un système que n'importe qui peut braquer sur n'importe qui.
L'écran le dit en toutes lettres.

### 7.18 Notifications

Web Push (VAPID). Le serveur ne pousse **qu'aux gens sans socket ouvert** : qui
en a un voit déjà le message. Un onglet simplement caché lève sa propre
notification depuis la page.

Une souscription retirée par le service de push (404/410) est supprimée
aussitôt ; une qui échoue autrement a droit à quelques chances.

### 7.19 Sauvegardes

Instantané cohérent par l'API de sauvegarde de SQLite — un `cp` en mode WAL peut
donner un fichier déchiré.

Un instantané est **une paire** : `….db` et `….files/`. La base ne fait que
désigner les photos ; sauvegarder la base seule restaure quelque chose qui *a
l'air* de marcher — chaque image un rectangle gris — ce qui est pire qu'une perte
franche, parce que personne ne s'en aperçoit à temps.

Les fichiers ne sont jamais réécrits, donc l'instantané prend des **liens durs** :
la deuxième sauvegarde d'un gigaoctet de photos coûte quelques kilo-octets. Sur
un autre point de montage, les octets sont copiés.

**Les fichiers sont pris avant la base.** Dans l'autre sens, un envoi arrivant
entre les deux serait inscrit dans la base sans ses octets. Cet ordre-ci ne peut
produire que l'inverse : un fichier que personne ne réclame.

### 7.20 Identifiant de construction

`/api/health` répond avec un `build`, tiré du SHA du commit quand l'hôte en
fournit un, sinon d'une empreinte des fichiers émis. Le même identifiant est
dans `build.txt`, dans `<meta name="kairus-build">` et dans le **nom des caches
du service worker**.

Il existe parce que « je déploie et je vois l'ancienne version » a deux causes —
l'hôte qui n'a pas pris le code, le navigateur qui garde l'ancien — aux remèdes
opposés, et qu'il n'y avait aucun moyen de trancher sans deviner.

Le service worker a aussi deux défauts corrigés là : ses caches portaient des
noms fixes (la purge n'avait donc jamais rien à purger), et les fichiers dont le
nom ne change pas d'un build à l'autre — icônes, manifeste — étaient servis cache
d'abord, ce qui était un gel définitif.

---

## 8. Sécurité

| Ce qui est visé | Ce qui est fait |
| --- | --- |
| Vol de session | JWT 7 jours + `token_version` révocable, jamais dans l'URL |
| Devinette de phrase | Limite **par adresse et par nom d'usage** |
| Phrases déjà publiques | k-anonymité contre Have I Been Pwned — seuls les 5 premiers caractères du SHA-1 sortent ; **échoue ouvert** |
| XSS | CSP sans `unsafe-inline`, scripts en ligne hachés au démarrage ; aucun `innerHTML` |
| Liens hostiles | `http`/`https` seulement ; `noopener noreferrer nofollow ugc` |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` |
| Injection SQL | Requêtes préparées, sans exception |
| Fuite entre conversations | `isParticipant` + `joined_at` sur **six** chemins de lecture |
| Lien direct vers un fichier | `canReadMessage` — la même règle que le message qui le porte |
| Usurpation d'IP | `X-Forwarded-For` n'est lu que si `TRUST_PROXY` dit combien de proxys sont devant |
| CORS trop permissif | Sans liste, seule l'origine qui sert l'application est acceptée |
| Sondage de comptes | Signaler quelqu'un exige de partager une conversation avec lui |

`npm audit` : **0 vulnérabilité** sur les deux paquets, vérifié à la dernière
mise à jour de ce document. Ce chiffre vieillit tout seul — les avis paraissent
après le code. Il est à relancer, pas à croire.

---

## 9. Tests

**348 tests** — 187 serveur, 161 client. Zéro simulacre du sujet testé.

**Serveur** (`node:test` + tsx) : un vrai serveur HTTP sur un vrai port, base en
mémoire. Aucun simulacre de la base ni du routeur.

| Fichier | Tests | Ce qu'il tient |
| --- | --- | --- |
| `files.test.ts` | 21 | téléversement, service, balayage, `canReadMessage` |
| `relay.test.ts` | 21 | transfert, épingles, brouillons |
| `factor.test.ts` | 20 | TOTP : dérive, ordre, récupération qui lève le facteur |
| `groups.test.ts` | 18 | `joined_at` sur tous les chemins |
| `messages.test.ts` | 13 | permissions, correction, retrait |
| `moderation.test.ts` | 12 | signalements, exclusion, fichiers |
| `push.test.ts` | 12 | souscriptions, compteurs |
| `auth.test.ts` | 11 | jetons, révocation, renouvellement |
| `calls.test.ts` | 10 | qui a le droit de sonner qui |
| `blocking.test.ts` | 8 | réciprocité |
| `hardening.test.ts` | 7 | en-têtes, CSP, sauvegardes |
| `quiet.test.ts` | 6 | ce que le silence laisse intact |
| `realtime.test.ts` | 6 | poignée de main, limites de trames |
| `limiter.test.ts` | 5 | seaux |
| `shared.test.ts` | 5 | galerie et `joined_at` |
| `sift.test.ts` | 5 | recherche restreinte |
| `keepsafe.test.ts` | 3 | sauvegardes des fichiers, partage d'inode |
| `version.test.ts` | 3 | build annoncé, en-têtes de cache |
| `restore.test.ts` | 1 | **la procédure documentée, rejouée en entier** |

`restore.test.ts` mérite un mot : il prend un instantané, le remet en place, et
**démarre un vrai processus dessus** pour vérifier qu'il répond, que les sessions
d'avant fonctionnent encore et qu'il accepte des écritures. Une sauvegarde qu'on
n'a jamais restaurée n'est pas une sauvegarde.

**Client** (vitest + jsdom + Testing Library) : rendu réel, interactions par
`userEvent`. Les tests interrogent ce qu'un utilisateur voit — un rôle, un texte —
pas des classes CSS.

---

## 10. Construction et déploiement

**Docker en deux étapes.** La première installe la chaîne de compilation (pour
le module natif de SQLite), construit client et serveur, élague les dépendances
de développement. La seconde ne prend que `node_modules`, `dist` et le client
compilé.

Pas d'instruction `VOLUME` : Railway refuse de construire une image qui en
contient une, et tout hôte sérieux monte son volume de l'extérieur.

**Sortie** : 76,5 ko de JavaScript et 7,5 ko de CSS, compressés — soit **84 ko**
pour le client entier, React et zustand compris.

---

## 11. Ce qui n'y est pas, et pourquoi

**Hors du périmètre, par décision** : canaux, stories, bots, sondages, réactions
emoji, appels de groupe, chiffrement de bout en bout, autodestruction, IA,
géolocalisation, monétisation.

**Limites réelles, à connaître** :

- **Une seule instance.** SQLite est un fichier ; le concentrateur WebSocket est
  en mémoire. Deux processus ne partageraient ni l'un ni l'autre. Passer à
  l'échelle demanderait Postgres et un bus — un autre programme.
- **Pas de chiffrement de bout en bout.** Qui administre le serveur peut lire
  les messages. Le dire est plus honnête que de laisser croire l'inverse.
- **Pas de vidéo, pas d'appels de groupe.**
- **Pas d'i18n.** Tout est en français, en dur.

---

## 12. Pièges rencontrés

Ceux qui coûteraient à quelqu'un d'autre le même temps.

**`grid-template-rows` implicite.** Au-delà de 900 px, la grille n'en déclarait
pas : la rangée vaut `auto`, donc elle prend la hauteur du contenu. Une
conversation plus longue qu'un écran faisait grandir la colonne, `overflow:
hidden` la coupait, et le fil ne défilait plus — champ de saisie hors de l'écran
compris. Invisible tant qu'aucune conversation ne dépassait un écran.

**`min-block-size: 0`.** Le minimum par défaut d'un élément flex est son contenu.
Sans ça, `flex: 1` sur un conteneur défilant le fait *grandir* au lieu de
défiler.

**`Escape` et le focus.** Écouter la touche sur un panneau ne marche que s'il a
le focus. Trois écrans ont eu le bug avant qu'il soit compris : l'écouteur va sur
`window`, en capture.

**`KeyboardEvent` de React.** Il masque celui du DOM dans un fichier `.tsx`.
`globalThis.KeyboardEvent` pour l'écouteur natif.

**Un accent grave dans un commentaire SQL.** Il ferme le littéral de gabarit qui
porte tout le schéma.

**`get()` pendant la création du magasin zustand.** Pas encore appelable.

**`color-mix(in oklab, …)`** avec du transparent donne une bande plus claire.
`in srgb`.

**Le corps d'une réponse `fetch` ne se lit qu'une fois.** `assert.equal(r.status,
200, await r.text())` évalue le message **toujours**, et consomme le corps.

---

*Ce document décrit le code, pas une intention. Quand les deux divergent, c'est
le code qui a raison et ce document qui est à corriger.*
