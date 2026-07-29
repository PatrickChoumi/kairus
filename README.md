# Kairus

Une messagerie où l'interface disparaît.

Kairus fait ce que fait Telegram — conversations en temps réel, réponses,
présence, accusés de lecture, recherche — mais refuse la grammaire habituelle
des applications de messagerie : pas de barre latérale, pas de barre d'outils,
pas d'écran de réglages, pas de menu contextuel. Il reste une surface, un geste,
et un champ.

---

## Le parti pris

**Une seule surface.** La liste et la conversation ne sont pas deux écrans mais
deux états d'une même surface. Quand vous ouvrez un fil, la marque de la
personne quitte sa ligne dans la liste et se pose sur l'en-tête du fil, portée
par un ressort. Rien d'autre ne bouge indépendamment : c'est ce qui fait lire
les deux vues comme un seul lieu plutôt que comme une navigation.

**Zéro chrome.** Au repos, aucun bouton n'est visible. Le bouton d'envoi
n'apparaît que lorsqu'il y a quelque chose à envoyer. L'heure d'un message
n'apparaît qu'en fin de groupe ou au survol. Le filet sous l'en-tête n'existe
que s'il y a quelque chose de défilé en dessous.

**Le Curseur.** `⌘K` (ou `Ctrl+K`) ouvre le seul point de commande de
l'application. Il cherche vos conversations, trouve des personnes, fouille vos
messages, change de thème, bascule en mode lecture, vous déconnecte. Les
commandes qui demandent plus qu'un nom — changer sa phrase secrète — posent
leurs questions une à une dans ce même champ. Il n'y a pas d'écran de réglages
parce qu'il n'y en a pas besoin.

**Du mouvement physique.** Chaque transition d'état est un ressort intégré
image par image (`client/src/motion/spring.ts`), pas une courbe de Bézier. Un
ressort est interruptible : si vous changez d'avis à mi-parcours, le mouvement
repart de sa position et de sa vitesse réelles au lieu de sauter.

**Des gestes plutôt que des boutons.** Tirer un message sur le côté y répond.
Tirer le fil vers la droite le referme. Double-cliquer répond aussi. `↑` dans un
champ vide rouvre votre dernier message pour le corriger. Clic droit — ou appui
long — révèle l'horodatage exact et le peu qu'on peut faire à un message :
répondre, et, si c'est le vôtre, modifier ou retirer.

**Une présence ambiante.** Pas d'étiquette « en ligne » : une aura qui pulse
lentement autour de la marque, et plus vite quand la personne écrit.

**Une seule couleur.** L'accent ne sert qu'à deux choses : ce que vous avez
écrit vous-même, et le focus. Tout le reste est monochrome, pour que l'œil
n'ait qu'un seul endroit où se poser. Thèmes clair et sombre, avec respect de
`prefers-reduced-motion`.

---

## Ce qui marche

- Inscription et connexion (JWT, mots de passe hachés en bcrypt)
- Conversations directes, créées en tapant un nom d'usage
- Messages en temps réel par WebSocket, avec envoi optimiste et réconciliation
- Correction et retrait d'un message, propagés aux deux côtés ; un message
  retiré garde sa place pour que les citations continuent de résoudre
- Réponses citées, avec saut vers le message cité
- Indicateur de frappe, présence, accusés de lecture, compteurs de non-lus
- Recherche dans l'historique sur un index FTS5 ; les personnes se trouvent par
  nom d'usage exact hors de votre cercle, librement à l'intérieur
- Blocage réciproque : plus de messages, plus de présence, plus de visibilité
  dans la recherche, dans les deux sens
- Historique paginé au défilement vers le haut
- Reconnexion automatique avec repli exponentiel, et file d'attente des envois
  pendant une coupure
- PWA installable, avec service worker (la coquille est mise en cache, jamais
  les messages)
- **Notifications hors de l'application** : quand personne n'est connecté au
  bout du fil, le serveur pousse le message au navigateur, qui l'affiche même
  l'onglet fermé. Onglet simplement caché, c'est la page elle-même qui le dit.
- **Journaux structurés et compteurs** : une ligne de JSON par événement, et un
  point de mesure derrière un jeton
- Clavier de bout en bout : `⌘K`, `↑`/`↓` ou `j`/`k`, `Entrée`, `Échap`, et `↑`
  dans un champ vide pour reprendre son dernier message

## Sécurité

Ce qui est en place, et pourquoi.

**Limitation de débit.** Token buckets, tous déclarés au même endroit
(`server/src/limiter.ts`), appliqués côté HTTP *et* côté WebSocket. La
connexion est limitée deux fois : par adresse, et **par nom d'usage** — c'est
la seconde qui empêche un parc d'adresses tournantes de contourner la
première. Une connexion réussie efface le soupçon accumulé, pour qu'un
utilisateur légitime ne se verrouille pas lui-même. Un 429 dit toujours combien
de temps attendre.

**Révocation.** Chaque compte porte un `token_version` inclus dans le jeton.
Changer sa phrase secrète — ou choisir « fermer les autres sessions » —
l'incrémente : tous les jetons émis avant cessent d'être acceptés, et les
WebSockets qu'ils tenaient encore ouverts sont fermés dans la foulée.

**Récupération de compte.** Kairus n'a ni email ni téléphone. À l'inscription,
une phrase de secours est générée et affichée une seule fois ; le serveur n'en
garde qu'un hash bcrypt. Elle permet de reprendre le compte, et se remplace en
étant utilisée. On peut en demander une nouvelle à tout moment depuis le
Curseur.

**En-têtes HTTP.** Chaque réponse — API et client — porte une
`Content-Security-Policy` sans `unsafe-inline` ni `unsafe-eval`, plus
`nosniff`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`,
`Permissions-Policy` et les en-têtes d'isolation d'origine. `HSTS` n'est posé
que sur une connexion réellement chiffrée. Le seul script inline de
l'application — la bascule de thème avant le premier rendu — est **haché au
démarrage** et autorisé par son empreinte, plutôt que d'ouvrir la politique.
C'est la vraie parade au vol de jeton par injection.

**Durée de vie des jetons.** Sept jours, pas trente, avec renouvellement
silencieux à mi-vie : un jeton volé a une fenêtre bornée, et personne n'a à se
reconnecter pour autant.

**Pas d'annuaire.** On ne peut pas énumérer les comptes. Hors des personnes avec
qui vous avez déjà une conversation, seul un **nom d'usage exact** résout —
il faut vous l'avoir donné. Un annuaire parcourable plus une boîte ouverte,
c'est un outil de harcèlement clé en main.

**Blocage.** Réciproque et immédiat : il ferme aussi les conversations déjà
ouvertes, coupe la présence et la frappe dans les deux sens, et rend chacun
invisible à la recherche de l'autre. Un blocage se présente comme une absence :
tenter d'ouvrir une conversation avec quelqu'un qui vous a bloqué répond
« personne ne porte ce nom » — confirmer l'existence du compte renseignerait le
harceleur.

**Notifications.** Le contenu poussé est chiffré de bout en bout entre le
serveur et le navigateur : le service de push au milieu relaie des octets qu'il
ne peut pas lire. `PUSH_PREVIEW=0` retire quand même l'expéditeur et le texte
de l'écran verrouillé, pour qui préfère. Un abonnement que le service déclare
périmé est supprimé aussitôt ; un qui échoue trois fois de suite est abandonné.
La permission n'est **jamais** demandée au chargement — seulement quand on la
choisit depuis le Curseur, parce qu'une demande non sollicitée se fait refuser
une fois et bloque la fonctionnalité pour de bon.

**Sauvegardes.** Avec `BACKUP_DIR`, le serveur prend un instantané cohérent au
démarrage puis toutes les 24 h, et ne garde que les sept derniers. Une
sauvegarde qui tourne sans qu'on y pense vaut mieux qu'une procédure
documentée que personne n'exécute.

**CORS.** Sans `CORS_ORIGIN`, seule l'origine qui sert l'application est
acceptée — pas « n'importe laquelle ». Le déploiement en un conteneur n'a
jamais besoin d'autre chose.

**Adresse du client.** `X-Forwarded-For` n'est lu que si `TRUST_PROXY` indique
combien de proxys sont devant. Sinon n'importe qui forgerait une adresse et
s'offrirait un budget neuf à chaque requête.

**Ce qui reste un compromis assumé.** Le jeton vit dans `localStorage`. Trois
choses en limitent la portée : la CSP, qui empêche l'exécution du script qui le
volerait ; la durée de vie de sept jours ; et la révocation, qui tue un jeton
volé dès qu'on change sa phrase secrète. Un cookie `httpOnly` resterait plus
solide, mais imposerait une protection CSRF et compliquerait le déploiement
multi-origine ; ce n'est pas fait.

**Ce qui n'existe toujours pas.** Pas de second facteur, et une phrase secrète
n'a d'autre contrainte que huit caractères — pas de vérification contre les
fuites connues. C'est en dessous de ce qu'on attend en 2026.

---

## Démarrer

```bash
npm install                # outils de la racine
npm run install:all        # dépendances serveur et client
npm run dev                # serveur sur :4000, client sur :5173
```

Ouvrez http://localhost:5173. Créez deux comptes dans deux fenêtres pour voir
le temps réel. En développement, `JWT_SECRET` est généré à chaud si absent : les
sessions ne survivent pas à un redémarrage, ce qui est le comportement correct
pour une clé jetable.

### Build

```bash
npm run build              # compile le client puis le serveur
npm start                  # sert l'API, les WebSockets et le client compilé
```

### Tests

```bash
npm test                   # 104 tests : 62 côté serveur, 42 côté client
npm run typecheck          # serveur et client
```

**Serveur** (`node:test`, serveur réel, base en mémoire) : limitation de débit,
révocation de jeton, récupération de compte, permissions sur les messages — on
ne réécrit pas les mots d'un autre —, recherche et sa robustesse, blocage,
en-têtes de sécurité, sauvegardes, abonnements push et compteurs, et le
WebSocket sous charge et à l'éviction.

**Client** (`vitest`, jsdom) : la souscription aux notifications, le lien temps
réel et la réconciliation optimiste, c'est-à-dire les endroits où une messagerie
casse en silence —
la file d'attente hors ligne, le repli exponentiel, la reprise au réveil de
l'onglet, le remplacement du message optimiste par son écho, la déduplication,
et le fait qu'une correction ne re-trie pas la liste ni ne marque quoi que ce
soit comme non lu.

En production le serveur sert `client/dist` : une seule origine, donc aucun CORS
à configurer.

---

## Déployer

Un conteneur, un service, un volume. **Une seule instance** : le hub WebSocket,
les compteurs de limitation et la base SQLite vivent dans le processus, donc
deux répliques cesseraient de se voir.

```bash
docker build -t kairus .
docker run -p 4000:4000 -e JWT_SECRET=... -e TRUST_PROXY=1 -v kairus-data:/data kairus
```

**[DEPLOY.md](DEPLOY.md) donne la marche à suivre pas à pas** — Railway, Fly.io
ou un VPS — avec la configuration du reverse proxy, la liste de vérification
après mise en ligne, et la bonne façon de sauvegarder une base en mode WAL.

### Variables d'environnement

| Variable      | Rôle                                                              |
| ------------- | ----------------------------------------------------------------- |
| `JWT_SECRET`  | **Obligatoire en production.** Le serveur refuse de démarrer sans. |
| `DATA_DIR`    | Emplacement de la base SQLite. `data` par défaut.                  |
| `PORT`        | `4000` par défaut.                                                 |
| `CORS_ORIGIN` | Seulement si le client est servi depuis une autre origine.         |
| `CLIENT_DIST` | Chemin du client compilé. Déduit du dossier du serveur par défaut. |
| `BACKUP_DIR`  | Active les sauvegardes automatiques. Non défini, il n'y en a aucune. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Activent les notifications hors application. `npm run vapid --prefix server` les génère. Absentes, le push est simplement éteint. |
| `PUSH_PREVIEW` | `0` pour ne rien révéler sur l'écran verrouillé.                  |
| `METRICS_TOKEN` | Ouvre `/api/metrics`. Non défini, la route répond 404.           |
| `LOG_LEVEL`, `LOG_FORMAT` | `info` par défaut ; `LOG_FORMAT=pretty` pour un terminal. |
| `TRUST_PROXY` | Nombre de proxys devant le serveur. `0` par défaut. Mettre `1` derrière Railway, Fly ou un reverse proxy, sinon la limitation de débit voit une seule adresse pour tout le monde. |

Côté client, `VITE_API_URL` n'est utile que pour un déploiement séparé du
front ; laissé vide, tout passe par la même origine.

---

## Architecture

```
client/
  src/motion/    ressorts, boucle d'animation partagée, gestes au pointeur
  src/net/       client HTTP, lien WebSocket qui se reconnecte seul
  src/state/     un store zustand, source unique de vérité
  src/views/     Stage (la surface), Rail, Thread, Composer, Cursor, Flight
  src/styles/    jetons de design, base, feuille de l'application
server/
  src/model.ts     accès aux données, requêtes SQL explicites
  src/limiter.ts   token buckets, et toute la politique de limites en un lieu
  src/headers.ts   CSP et en-têtes de sécurité, hachage du script inline
  src/backup.ts    instantanés cohérents, planifiés et élagués
  src/push.ts      Web Push : abonnements, envoi, élagage des appareils morts
  src/log.ts       journaux JSON et compteurs, sans dépendance
  src/router.ts    routes HTTP sur node:http, sans framework
  src/realtime.ts  hub WebSocket : présence, diffusion, battement de cœur
  src/static.ts    service du client compilé en production
  test/            node:test, base en mémoire, serveur réel sur port éphémère
```

Le client pèse environ 57 ko compressés, dépendances comprises. Pas de
bibliothèque d'animation, pas de framework CSS, pas de routeur : il n'y a
qu'une seule surface, donc il n'y a rien à router.

### L'API HTTP

Les messages passent par le WebSocket, mais tout est aussi accessible en HTTP.

| Route                              | Rôle                                    |
| ---------------------------------- | --------------------------------------- |
| `POST /api/auth/register`, `login` | Obtenir un jeton                        |
| `POST /api/auth/recover`           | Reprendre un compte avec la phrase de secours |
| `GET /api/me`                      | L'identité derrière le jeton            |
| `GET`/`POST /api/conversations`    | Lister ou ouvrir une conversation       |
| `GET`/`POST /api/messages`         | Lire l'historique ou déposer un message |
| `POST /api/messages/revise`, `/retract` | Corriger ou retirer son propre message |
| `POST /api/read`                   | Marquer comme lu                        |
| `GET /api/people`, `/api/search`   | Chercher des personnes, des messages    |
| `POST /api/account/passphrase`     | Changer la phrase secrète               |
| `POST /api/account/recovery`       | Émettre une nouvelle phrase de secours  |
| `POST /api/account/revoke`         | Fermer toutes les autres sessions       |
| `GET`/`POST /api/blocks`           | Lister ou bloquer quelqu'un             |
| `POST /api/blocks/remove`          | Débloquer                               |
| `GET`/`POST /api/push`             | Clé publique, abonner ou désabonner un appareil |
| `GET /api/health`                  | Sonde de disponibilité                  |
| `GET /api/metrics`                 | Compteurs, derrière `METRICS_TOKEN`     |

### Le protocole WebSocket

Le client envoie `hello`, `send`, `revise`, `retract`, `typing`, `read`. Le
serveur renvoie `ready`, `message`, `revised`, `typing`, `read`, `presence`,
`conversation`, `error`. Un socket qui ne s'identifie pas en dix secondes est
fermé ; un socket muet est détecté par un `ping` toutes les trente secondes ;
un socket qui dépasse 600 trames par minute est coupé.

---

## Ce qui n'y est pas

Rien de tout cela n'est commencé, et il vaut mieux le savoir avant de compter
dessus :

- **Chiffrement de bout en bout.** Les messages sont en clair dans SQLite.
  Kairus protège l'accès, pas le contenu.
- **Pièces jointes.** Texte uniquement — ni image, ni fichier, ni voix.
- **Groupes.** Conversations à deux seulement.
- **Modération.** Le blocage existe désormais, mais il n'y a ni signalement, ni
  administration, ni recours.
- **Mise à l'échelle horizontale.** Le hub temps réel et les compteurs de
  limitation vivent dans le processus, la base est un fichier local : deux
  instances cesseraient de se voir. C'est un plafond d'architecture, pas un
  réglage.
- **Second facteur** et vérification des phrases secrètes contre les fuites.
- **Alerting.** Il y a désormais des journaux structurés et des compteurs, mais
  rien ne vous réveille : il faut brancher un collecteur dessus.
- **Récupération par email.** Toujours pas. Perdre la phrase de secours en même
  temps que la phrase secrète reste sans recours.
- **Appels.**
