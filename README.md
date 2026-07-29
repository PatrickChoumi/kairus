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
messages, change de thème, bascule en mode lecture, vous déconnecte. Il n'y a
pas d'écran de réglages parce qu'il n'y en a pas besoin.

**Du mouvement physique.** Chaque transition d'état est un ressort intégré
image par image (`client/src/motion/spring.ts`), pas une courbe de Bézier. Un
ressort est interruptible : si vous changez d'avis à mi-parcours, le mouvement
repart de sa position et de sa vitesse réelles au lieu de sauter.

**Des gestes plutôt que des boutons.** Tirer un message sur le côté y répond.
Tirer le fil vers la droite le referme. Double-cliquer répond aussi. `↑` dans un
champ vide répond au dernier message reçu. Clic droit (ou appui long) révèle
l'horodatage exact.

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
- Réponses citées, avec saut vers le message cité
- Indicateur de frappe, présence, accusés de lecture, compteurs de non-lus
- Recherche dans les personnes et dans l'historique des messages
- Historique paginé au défilement vers le haut
- Reconnexion automatique avec repli exponentiel, et file d'attente des envois
  pendant une coupure
- PWA installable, avec service worker (la coquille est mise en cache, jamais
  les messages)
- Clavier de bout en bout : `⌘K`, `↑`/`↓` ou `j`/`k`, `Entrée`, `Échap`

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

En production le serveur sert `client/dist` : une seule origine, donc aucun CORS
à configurer.

---

## Déployer

Un conteneur, un service.

```bash
docker build -t kairus .
docker run -p 4000:4000 -e JWT_SECRET=... -v kairus-data:/data kairus
```

`railway.json` pointe sur ce Dockerfile et sur `/api/health`. Montez un volume
sur `/data` : c'est là que vit la base SQLite.

### Variables d'environnement

| Variable      | Rôle                                                              |
| ------------- | ----------------------------------------------------------------- |
| `JWT_SECRET`  | **Obligatoire en production.** Le serveur refuse de démarrer sans. |
| `DATA_DIR`    | Emplacement de la base SQLite. `data` par défaut.                  |
| `PORT`        | `4000` par défaut.                                                 |
| `CORS_ORIGIN` | Seulement si le client est servi depuis une autre origine.         |
| `CLIENT_DIST` | Chemin du client compilé. Déduit du dossier du serveur par défaut. |

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
  src/router.ts    routes HTTP sur node:http, sans framework
  src/realtime.ts  hub WebSocket : présence, diffusion, battement de cœur
  src/static.ts    service du client compilé en production
```

Le client pèse environ 57 ko compressés, dépendances comprises. Pas de
bibliothèque d'animation, pas de framework CSS, pas de routeur : il n'y a
qu'une seule surface, donc il n'y a rien à router.

### L'API HTTP

Les messages passent par le WebSocket, mais tout est aussi accessible en HTTP.

| Route                              | Rôle                                    |
| ---------------------------------- | --------------------------------------- |
| `POST /api/auth/register`, `login` | Obtenir un jeton                        |
| `GET /api/me`                      | L'identité derrière le jeton            |
| `GET`/`POST /api/conversations`    | Lister ou ouvrir une conversation       |
| `GET`/`POST /api/messages`         | Lire l'historique ou déposer un message |
| `POST /api/read`                   | Marquer comme lu                        |
| `GET /api/people`, `/api/search`   | Chercher des personnes, des messages    |
| `GET /api/health`                  | Sonde de disponibilité                  |

### Le protocole WebSocket

Le client envoie `hello`, `send`, `typing`, `read`. Le serveur renvoie `ready`,
`message`, `typing`, `read`, `presence`, `conversation`, `error`. Un socket qui
ne s'identifie pas en dix secondes est fermé ; un socket muet est détecté par un
`ping` toutes les trente secondes.

---

## Ce qui n'y est pas

Ni chiffrement de bout en bout, ni groupes, ni pièces jointes, ni appels. Les
messages sont stockés en clair dans SQLite : Kairus protège l'accès, pas le
contenu. C'est un choix de portée, pas un oubli — à traiter comme tel avant tout
usage sérieux.
