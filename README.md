# Kairus

Une messagerie qui fait l'essentiel, et rien autour.

Kairus fait ce que fait Telegram — conversations en temps réel, groupes,
fichiers, réponses, présence, accusés de lecture, recherche, notifications —
dans la disposition que tout le monde connaît déjà : une liste de
conversations, des bulles, un avatar et un nom. Ce qui le distingue n'est pas
une grammaire à réapprendre, c'est ce qu'on a retiré.

---

## Le parti pris

**La disposition que vous connaissez.** Deux volets sur un écran large — la
liste à gauche, la conversation à droite ; un seul volet à la fois sur un
téléphone, avec la flèche de retour et le balayage attendus. Vos messages à
droite, ceux d'en face à gauche. Aucune de ces décisions n'est à découvrir.

**Moins de surfaces.** Pas d'écran de réglages, pas de barre d'outils : quatre
icônes au-dessus de la liste, trois dans l'en-tête d'un fil, et c'est tout.
L'heure et l'accusé de lecture n'apparaissent qu'en fin de prise de parole. Le
filet sous l'en-tête n'existe que s'il y a quelque chose de défilé en dessous.

**Le Curseur.** `⌘K` (ou `Ctrl+K`) ouvre le point de commande de
l'application — le même que les boutons visibles ouvrent en le pointant déjà
sur ce que vous avez choisi. Il cherche vos conversations, trouve des
personnes, fouille vos messages, change de thème, bascule en mode lecture, vous
déconnecte. Les commandes qui demandent plus qu'un nom — changer sa phrase
secrète, réunir un groupe — posent leurs questions une à une dans ce même
champ. C'est ce qui remplace l'écran de réglages.

**Du mouvement physique.** Chaque transition d'état est un ressort intégré
image par image (`client/src/motion/spring.ts`), pas une courbe de Bézier. Un
ressort est interruptible : si vous changez d'avis à mi-parcours, le mouvement
repart de sa position et de sa vitesse réelles au lieu de sauter. Quand vous
ouvrez un fil, l'avatar quitte sa ligne dans la liste et se pose sur
l'en-tête — un même objet qui se déplace, pas deux copies.

**Des gestes en plus des boutons.** Ce qu'on peut faire à un message apparaît à
côté de lui, au survol ou après un appui long : répondre, et, si c'est le
vôtre, modifier ou retirer. Les gestes sont un raccourci, pas la seule voie :
tirer un message vers le centre y répond, tirer le fil vers la droite le
referme, double-cliquer répond aussi, `↑` dans un champ vide rouvre votre
dernier message pour le corriger.

**Vélin.** Un papier qui prend l'encre, de jour comme de nuit. Les noms sont
composés dans un romain à empattements — et rien d'autre ne l'est : un seul
geste typographique, à deux endroits, sépare l'élégant du costume. Le corps des
messages reste en linéale. Les bulles sont rondes des deux côtés, sans aucune
bordure : le contraste vient de la surface. Un seul indigo porte l'accent, un
vert dit la présence, un rouge sourd ce qui se retire ou raccroche.

Les deux thèmes sont traités à égalité : le sombre n'est pas le clair inversé,
ses fonds sont choisis et l'accent y est **repris à une clarté qui tient sur
eux**, à la même teinte, de sorte qu'on reconnaît le même produit.
`prefers-reduced-motion` est respecté.

---

## Ce qui marche

- Inscription et connexion (JWT, mots de passe hachés en bcrypt)
- Conversations directes, créées en tapant un nom d'usage
- **Groupes** : un nom, des noms d'usage, et c'est ouvert. Qui parle est dit en
  tête de chaque prise de parole, dans sa propre couleur. Quelqu'un ajouté
  aujourd'hui **ne lit pas ce qui s'est dit avant** — ni dans le fil, ni dans la
  recherche. On les quitte ; le dernier sorti emporte le groupe avec lui
- Messages en temps réel par WebSocket, avec envoi optimiste et réconciliation
- Correction et retrait d'un message, propagés aux deux côtés ; un message
  retiré garde sa place pour que les citations continuent de résoudre
- **Pièces jointes** : images et fichiers, par le sélecteur, un glisser-déposer
  ou un simple collage. Les images sont réduites dans le navigateur avant de
  partir, s'affichent à leurs proportions dès l'apparition de la bulle, et
  s'ouvrent en pleine surface
- **Messages vocaux** : un appui sur le micro, un compteur, et c'est parti. La
  forme d'onde est calculée avant l'envoi et voyage avec le message : la bulle
  a sa taille finale avant qu'un octet de son n'arrive, et un vocal qu'on
  n'écoute pas ne coûte rien à afficher. On clique dans l'onde pour s'y déplacer
- **Appels audio** : de navigateur à navigateur (WebRTC). Le serveur ne
  transporte que les présentations, jamais la voix — il décide seulement qui a
  le droit de sonner qui. Sonnerie, décrochage, micro coupé, durée, et une
  raison écrite quand ça se termine mal. À deux seulement : un groupe n'a
  personne en particulier à appeler
- Réponses citées, avec saut vers le message cité
- **Transfert** : on prend un message, on choisit où il va. Le transfert crédite
  **le premier auteur**, jamais le dernier relais — transférer un transfert
  porte l'origine plus loin. Un fichier voyage en copie de ses octets : deux
  messages qui partageraient un fichier s'emporteraient l'un l'autre au premier
  retrait
- **Messages épinglés** : une barre sous l'en-tête, un seul message à la fois
  même quand il y en a plusieurs — un compteur et un clic pour passer au
  suivant, parce qu'une barre qui grandit est une liste. Les épingles sont
  calculées **par lecteur** : quelqu'un arrivé hier dans un groupe n'y trouve
  pas ce qui s'est dit avant lui. Retirer un message décroche son épingle
- **Brouillons synchronisés** : ce qui reste à moitié écrit apparaît dans la
  liste, revient dans le champ quand on rouvre la conversation, et suit d'un
  appareil à l'autre. Il part sur une pause de frappe, pas sur une touche, et
  n'arrive jamais chez la personne à qui on écrit
- **Silence par conversation** : deux heures, ou jusqu'à nouvel ordre. Une
  conversation en silence continue d'arriver et continue de compter ses
  non-lus — c'est la sonnerie qui s'arrête, rien d'autre. Une durée expire
  d'elle-même : personne n'a à se souvenir de la défaire. C'est une décision
  personnelle, et l'autre bout n'en sait rien
- **Fichiers partagés** : tout ce qui a été joint à une conversation, en une
  grille, séparé en images, audio et documents. Les règles sont exactement
  celles du fil, `joined_at` compris — une seconde façon de regarder la même
  conversation, pas une seconde porte plus laxiste
- Indicateur de frappe, présence, accusés de lecture, compteurs de non-lus
- Recherche dans l'historique sur un index FTS5 ; les personnes se trouvent par
  nom d'usage exact hors de votre cercle, librement à l'intérieur
- Blocage réciproque : plus de messages, plus de présence, plus de visibilité
  dans la recherche, dans les deux sens
- **Signalement** : un message ou une personne, avec un motif. Le signalement
  **copie les mots** au moment où il est fait — l'auteur peut retirer son
  message, et un signalement qui pointe vers un trou n'est actionnable par
  personne. Il est transmis à qui administre le serveur et **rien ne se
  produit automatiquement** : aucun compte ne disparaît sur un nombre de
  signalements, parce qu'un système qui punit au compteur est un système que
  n'importe qui peut braquer sur n'importe qui. L'écran le dit
- **Retirer quelqu'un d'un groupe** : la seule asymétrie d'une application sans
  rôles — la personne qui a réuni le groupe peut en retirer un membre. Sans
  ça, un groupe avec un gêneur ne se dissout qu'en le quittant tous
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
- **Double authentification (TOTP)** : un code à six chiffres en plus de la
  phrase secrète, compatible avec n'importe quelle application
  d'authentification. Le secret n'entre en vigueur qu'une fois un code vérifié
  — une installation ratée n'enferme personne dehors. Le champ de code
  n'apparaît qu'une fois la phrase secrète acceptée : ceux qui n'ont pas de
  second facteur ne voient jamais rien de tout cela
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

**Blocage.** Il gouverne les conversations à deux. Dans un groupe, un blocage
entre deux membres ne fait pas taire toute la pièce — la sortie d'un groupe,
c'est de le quitter. Réciproque et immédiat : il ferme aussi les conversations déjà
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

**Fichiers.** Le risque n'est pas la réception, c'est le **service** : un
fichier choisi par quelqu'un d'autre, servi en ligne depuis votre propre
origine, est une injection de script qui attend. Seule une courte liste de
types d'images est affichée en place ; tout le reste part en téléchargement
opaque, avec un type que le navigateur n'essaiera pas d'interpréter — un SVG
n'est jamais rendu, il transporte du script. L'accès suit celui de la
conversation : un tiers reçoit 404, pas 403, pour ne pas confirmer l'existence
du fichier. Un envoi dont le message n'est jamais parti est balayé après une
heure ; un message retiré emporte son fichier du disque.

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

**Les appels.** La voix ne passe pas par le serveur : deux navigateurs
négocient un chemin direct et se parlent. Le serveur ne relaie que les
présentations, et il applique aux appels les mêmes règles qu'aux messages —
seuls les participants d'une conversation peuvent se sonner, un blocage coupe
la sonnerie dans les deux sens, et sonner en boucle est ralenti comme le reste.
Le trajet direct n'est en revanche **pas chiffré de bout en bout au sens de
Signal** : WebRTC chiffre le transport (DTLS-SRTP), ce qui protège du réseau,
pas d'un serveur qui aurait été remplacé par un autre.

**Second facteur.** TOTP, écrit ici plutôt qu'importé : soixante lignes de
HMAC et de base32, et une dépendance qui touche à l'authentification est une
dépendance qu'il faut croire pour toujours. La fenêtre tolère une horloge
décalée d'un pas de trente secondes, pas davantage. Ce qui rend un code à six
chiffres utile n'est pas le code — il n'y en a qu'un million — mais le seau de
jetons qui limite les essais ; c'est lui, la défense.

Il n'y a **pas de liste de codes de secours**, volontairement : Kairus a déjà
une porte de sortie, la phrase de secours, et une seconde liste de secrets à
perdre serait une seconde façon de perdre le compte. Reprendre le compte avec
la phrase désactive le second facteur — sinon la récupération serait une porte
qui ouvre sur un mur.

**Phrases secrètes déjà publiques.** Dix caractères au minimum, et surtout un
contrôle contre les fuites connues : la phrase est hachée en SHA-1 et seuls
les **cinq premiers caractères hexadécimaux** du hachage partent chez Have I
Been Pwned, qui renvoie tous les suffixes correspondants ; la comparaison se
fait ici. Ni la phrase ni son hachage complet ne quittent le processus. Le
contrôle **échoue ouvert** : une panne chez un tiers ne doit pas empêcher de
créer un compte, et `BREACH_CHECK=off` le désactive pour un serveur sans
réseau sortant.

**Ce qui n'existe toujours pas.** Les appels de groupe et la vidéo.

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
npm test                   # 280 tests : 165 côté serveur, 115 côté client
npm run typecheck          # serveur et client
```

**Serveur** (`node:test`, serveur réel, base en mémoire) : limitation de débit,
révocation de jeton, récupération de compte, second facteur — la fenêtre de
dérive, le code qui ne suffit pas sans la phrase, les essais ralentis, et la
récupération qui lève le facteur —, phrases divulguées — seul le préfixe du
hachage sort, et une panne laisse passer —, permissions sur les messages — on
ne réécrit pas les mots d'un autre —, recherche et sa robustesse, blocage,
en-têtes de sécurité, sauvegardes, abonnements push et compteurs, pièces
jointes — qui peut les lire, ce qui n'est jamais affiché en place, ce qui est
balayé —, restauration de sauvegarde — un vrai serveur démarré sur un
instantané remis en place, qui doit encore accepter les sessions d'avant —,
groupes — l'historique qui ne s'hérite pas, la marque de lecture qui
attend le dernier, ce qu'un tiers ne peut pas faire, qui peut retirer qui —,
signalement — les mots conservés malgré un retrait, l'impossibilité de
signaler ce qu'on n'avait pas le droit de lire, la liste illisible sans le
jeton —, messages vocaux — la
durée et la forme conservées, une forme d'onde forgée refusée, le son servi en
place —, appels — la négociation relayée sans être lue, un inconnu qui ne peut
pas faire sonner le téléphone d'autrui, le blocage qui tient dans les deux sens,
le groupe qui refuse —, et le WebSocket sous charge et à l'éviction.

**Client** (`vitest`, jsdom, Testing Library) : les composants d'abord — ce
qu'une bulle laisse faire à un message et ce qu'elle en dit, le clavier du
composeur, l'écran de transfert, la barre d'épingle qui compte au lieu de
grandir, la ligne de liste et son ordre de priorité, le lecteur vocal qui ne
télécharge rien tant qu'on n'appuie pas. Puis la souscription aux
notifications, le lien temps réel et la réconciliation optimiste, c'est-à-dire
les endroits où une messagerie casse en silence —
la file d'attente hors ligne, le repli exponentiel, la reprise au réveil de
l'onglet, le remplacement du message optimiste par son écho, la déduplication,
et le fait qu'une correction ne re-trie pas la liste ni ne marque quoi que ce
soit comme non lu — plus le transfert, les épingles et les brouillons, où la
règle est la même partout : **le client demande, le serveur tranche**, et rien
n'est deviné localement.

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
| `MAX_UPLOAD_BYTES` | Taille maximale d'un fichier. 8 Mo par défaut.                |
| `FILES_DIR`   | Où vivent les pièces jointes. `<DATA_DIR>/files` par défaut.      |
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
  src/files.ts     pièces jointes : réception en flux, service, balayage
  src/push.ts      Web Push : abonnements, envoi, élagage des appareils morts
  src/log.ts       journaux JSON et compteurs, sans dépendance
  src/router.ts    routes HTTP sur node:http, sans framework
  src/realtime.ts  hub WebSocket : présence, diffusion, battement de cœur
  src/static.ts    service du client compilé en production
  test/            node:test, base en mémoire, serveur réel sur port éphémère
```

Le client pèse **80,6 ko compressés** — 73,8 ko de JavaScript et 6,8 ko de CSS,
dépendances comprises. Le chiffre sort de `npm run build --prefix client`, qui
l'imprime ; la CI l'imprime aussi à chaque exécution, pour qu'un écart se voie
sans qu'on ait à y penser. Pas
de bibliothèque d'animation, pas de framework CSS, pas de routeur : il n'y a
qu'une seule surface, donc il n'y a rien à router.

### L'API HTTP

Les messages passent par le WebSocket, mais tout est aussi accessible en HTTP.

| Route                              | Rôle                                    |
| ---------------------------------- | --------------------------------------- |
| `POST /api/auth/register`, `login` | Obtenir un jeton                        |
| `POST /api/auth/recover`           | Reprendre un compte avec la phrase de secours |
| `GET /api/me`                      | L'identité derrière le jeton            |
| `GET`/`POST /api/conversations`    | Lister ou ouvrir une conversation à deux |
| `POST /api/groups`                 | Réunir un groupe                        |
| `POST /api/groups/members`, `/leave`, `/rename` | Ajouter, quitter, renommer |
| `GET`/`POST /api/messages`         | Lire l'historique ou déposer un message |
| `POST /api/messages/revise`, `/retract` | Corriger ou retirer son propre message |
| `POST /api/read`                   | Marquer comme lu                        |
| `POST /api/mute`                   | Silencer une conversation, ou la rallumer |
| `GET /api/shared`                  | Les fichiers d'une conversation         |
| `GET /api/people`, `/api/search`   | Chercher des personnes, des messages    |
| `POST /api/account/passphrase`     | Changer la phrase secrète               |
| `POST /api/account/recovery`       | Émettre une nouvelle phrase de secours  |
| `POST /api/account/revoke`         | Fermer toutes les autres sessions       |
| `GET`/`POST /api/blocks`           | Lister ou bloquer quelqu'un             |
| `POST /api/blocks/remove`          | Débloquer                               |
| `POST /api/files`, `GET /api/files/:id` | Envoyer un fichier, le récupérer   |
| `GET`/`POST /api/push`             | Clé publique, abonner ou désabonner un appareil |
| `GET /api/health`                  | Sonde de disponibilité, et l'identifiant du build |
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
  Kairus protège l'accès, pas le contenu. Les appels sont chiffrés en
  transport (DTLS-SRTP), ce qui protège du réseau, pas du serveur.
- **Suite donnée aux signalements.** Ils sont enregistrés et lisibles derrière
  `MODERATION_TOKEN`, mais il n'existe aucun outil pour agir : pas de
  suspension, pas de recours, pas d'historique de décision. Quelqu'un doit
  lire la liste et faire quelque chose à la main.
- **Mise à l'échelle horizontale.** Le hub temps réel et les compteurs de
  limitation vivent dans le processus, la base est un fichier local : deux
  instances cesseraient de se voir. C'est un plafond d'architecture, pas un
  réglage.
- **Alerting.** Il y a des journaux structurés et des compteurs, mais rien ne
  vous réveille : il faut brancher un collecteur dessus.
- **Récupération par email.** Perdre la phrase de secours en même temps que la
  phrase secrète reste sans recours.
- **Appels de groupe et vidéo.** Les appels sont à deux, et audio seulement.
- **Tests de bout en bout.** Les composants sont couverts un par un, mais
  aucun test automatique ne fait parler deux navigateurs réels. Les parcours
  complets — inscription, vocal, appel, transfert — sont rejoués à la main
  dans Chromium à chaque changement, ce qui dépend de quelqu'un qui y pense.
- **Test de charge.** L'affirmation « une instance tient quelques milliers
  d'utilisateurs » est une estimation, pas une mesure.
- **Les sauvegardes ne couvrent pas les fichiers.** `BACKUP_DIR` prend un
  instantané de la base, et rien d'autre : restaurer après la perte du volume
  rendrait toutes les conversations avec des pièces jointes et des vocaux
  morts. `DEPLOY.md` le disait déjà ; ce document donnait l'impression du
  contraire. À sauvegarder à part en attendant.
- **Internationalisation.** L'interface est en français, en dur.

---

## Journal des corrections de ce document

Ce fichier a menti une fois : il a listé les messages vocaux et les appels
comme « pas commencés » alors qu'ils étaient construits, testés et en service.
La cause était bête — les sections ont été mises à jour une par une, jamais
relues ensemble. Pour un document qui se vend sur l'honnêteté de ses limites,
c'est le seul endroit où l'erreur n'est pas rattrapable par le lecteur.

La règle depuis : **toute fonctionnalité ajoutée se relit dans les deux
sens** — ce qu'on ajoute à « ce qui marche » doit disparaître de « ce qui n'y
est pas », et les chiffres cités (poids du bundle, nombre de tests) se
regénèrent, ils ne se recopient pas.
