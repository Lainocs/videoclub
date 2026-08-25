# Videoclub 3D

Un videoclub en 3D (Three.js) construit a partir de ta watchlist Letterboxd : une etagere en
bois avec des boitiers DVD ranges par tranche. Clique sur un boitier pour le sortir, retourne-le
pour voir le synopsis, et valide pour l'ouvrir directement dans Stremio.

## Architecture

- **Backend** (`server.js`) : scrape ta watchlist Letterboxd publique, recupere jaquette/synopsis/
  note/IMDb ID via TMDb, expose tout via `/api/films`. Cache 15 minutes.
- **Frontend** (`public/`) : scene Three.js pure (pas de bundler), chargee via `<script type="module">`
  et un import map pointant vers Three.js sur un CDN.

## 1. Prerequis

- Ton profil Letterboxd doit etre **public**.
- Un compte TMDb (gratuit) avec une cle API.

## 2. Configuration

```bash
cp .env.example .env
```

Remplis `.env` avec `LETTERBOXD_USERNAME` et `TMDB_API_KEY`.

## 3. Installation et lancement en local (test)

```bash
npm install
npm start
```

Ouvre http://localhost:3000 dans ton navigateur.

## 4. Deploiement sur ton VPS Oracle

### a. Transferer le projet

Le plus simple : push sur GitHub, puis sur le VPS :
```bash
git clone TON_LIEN_GITHUB videoclub
cd videoclub
```

### b. Configurer et installer

```bash
cp .env.example .env
nano .env   # remplis LETTERBOXD_USERNAME et TMDB_API_KEY
npm install
```

### c. Lancer avec pm2 (comme le bot Discord)

```bash
pm2 start server.js --name videoclub
pm2 save
```

### d. Rendre le site accessible publiquement

Contrairement au bot Discord (qui ne fait que des requetes sortantes), ce site doit accepter
des connexions **entrantes** sur le port choisi (3000 par defaut). Sur Oracle Cloud, il faut
explicitement autoriser ce port :

1. Console OCI > **Networking > Virtual Cloud Networks** > ton VCN > ta **Security List** (ou
   **Network Security Group** si tu en utilises un).
2. **Add Ingress Rules** :
   - Source CIDR : `0.0.0.0/0` (tout internet) ou restreins si tu preferes un acces limite
   - Protocole : TCP
   - Destination Port Range : `3000` (ou le port choisi dans `.env`)
3. **Sur le VPS lui-meme**, verifie aussi le firewall local (iptables/ufw) :
   ```bash
   sudo ufw allow 3000/tcp
   ```
   (si `ufw` n'est pas actif, cette etape n'est pas necessaire)

Une fois fait, le site est accessible via `http://TON_IP_PUBLIQUE:3000`.

### e. (Optionnel) Passer par un nom de domaine + HTTPS

Pour un rendu plus propre (pas de `:3000` dans l'URL, HTTPS actif) :
1. Pointe un sous-domaine vers l'IP publique du VPS (enregistrement DNS de type A).
2. Installe Nginx comme reverse proxy (`sudo apt install nginx`) et configure-le pour rediriger
   le port 80/443 vers `localhost:3000`.
3. Utilise Certbot (`sudo apt install certbot python3-certbot-nginx`) pour un certificat HTTPS
   gratuit automatique.
4. Ouvre les ports 80 et 443 (au lieu de 3000) dans la Security List OCI.

Cette etape est optionnelle — le site fonctionne tres bien en HTTP simple sur le port 3000 pour
un usage perso.

## Utilisation

- **Clic sur un boitier** : le sort de l'etagere et l'amene devant la camera, jaquette face a toi.
- **Bouton "Retourner"** : fait pivoter le boitier pour voir le dos (synopsis, note).
- **Bouton "Valider"** : ouvre l'app Stremio directement sur la fiche du film (necessite que
  Stremio soit installe sur l'appareil et gere le protocole `stremio://`).
- **Bouton "Remettre en rayon"** : range le boitier et permet d'en choisir un autre.
- **Souris/tactile** : orbite autour de l'etagere (drag pour tourner, molette/pincer pour zoomer).

## Limites connues

- Si un film n'est pas trouve sur TMDb (titre ambigu, tres recent, tres rare), il apparait quand
  meme sur l'etagere mais sans jaquette ni bouton "Valider" actif.
- Le chargement initial peut prendre 10-30 secondes si la watchlist est grande (chaque film
  necessite un aller-retour TMDb), mais le cache de 15 minutes evite de repeter ce cout a chaque
  visite.
- Le scraping Letterboxd depend de la structure HTML actuelle du site ; si Letterboxd change son
  markup, il faudra ajuster le selecteur dans `server.js` (meme logique que pour le bot Discord).
