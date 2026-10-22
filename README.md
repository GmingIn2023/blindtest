# 🎧 Blind Test entre amis

Un blind test façon Kahoot pour les soirées. **L'hôte** joue sur un ordinateur ou une télé (c'est lui qui diffuse le son), **les joueurs** buzzent depuis leur téléphone. Gratuit, sans compte, sans installation.

👉 https://gmingin2023.github.io/blindtest/

## Comment jouer

1. **Hôte** → « Créer une partie » → choisis le mode et le nombre de joueurs.
2. **Joueurs** → scannent le QR code (ou tapent le code) → pseudo + avatar.
3. Chacun choisit ses chansons (recherche iTunes/Deezer) et peut personnaliser son extrait : durée, position, vitesse, sans voix, radio, pitch…
4. Quand tout le monde est prêt, la partie démarre toute seule.
5. L'hôte lance l'extrait, les joueurs buzzent et tapent le titre. Podium à la fin.

## Les 4 modes

| Mode | Principe |
|---|---|
| **Standard** | Buzzer puis taper le titre |
| **Instru** | Chanson sans voix, points ×1,5 |
| **Playlist** | Deviner à qui appartient la chanson (vote) — l'hôte est observateur |
| **Paroles** | 1 ou 2 lignes de paroles révélées mot à mot, deviner la chanson |

**Score** : 100 pts sous 3 s, puis dégressif jusqu'à 20 pts minimum. Mauvaise réponse : −10 pts (1ʳᵉ fois), −20 pts ensuite. Pas de réponse dans les 20 s après un buzz : −10 pts.

## Fiabilité

- **Son sur iPhone** : l'extrait est rendu avec tous ses effets puis joué dans un lecteur audio classique, que iOS ne coupe pas (même avec le bouton silencieux). Si le navigateur exige un geste, l'hôte voit « Touche l'écran pour activer le son » et le son repart au premier toucher.
- **Liens qui expirent** : les extraits Deezer expirent au bout d'environ 15 min. Le jeu retrouve tout seul un lien frais pour la même chanson.
- **Réseau** : un bandeau prévient en cas de coupure ; joueurs et hôte peuvent reprendre leur partie après avoir fermé l'onglet.
- **Titres** : accents, majuscules, ponctuation et alphabets non latins sont tolérés.

## Fichiers

```
index.html         accueil
config.html        réglages + création de la partie
host-lobby.html    code, QR code, liste des joueurs
player-lobby.html  rejoindre une partie (?code=XXXXXX pré-remplit le code)
selection.html     recherche + personnalisation des extraits (dictaphone)
waiting.html       attente, fusion et mélange des sélections
game.html          la partie (buzzer, votes, scores, révélation)
podium.html        classement final + recommencer
js/audio-engine.js MOTEUR AUDIO PARTAGÉ — même rendu dans l'aperçu et dans le jeu
js/firebase-init.js  js/state.js  js/utils.js  css/style.css
PRODUCT.md  DESIGN.md   contexte produit et direction visuelle
```

> ⚠️ Toute la logique audio vit dans `js/audio-engine.js`. L'aperçu de `selection.html` et la partie
> dans `game.html` appellent exactement la même fonction `AudioEngine.playAudioClip(song)`.
