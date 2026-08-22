# 🎧 Blind Test multijoueur

Jeu de blind test temps réel façon Kahoot. **L'hôte** joue sur un ordinateur (c'est lui
qui diffuse le son), **les joueurs** buzzent depuis leur téléphone.

👉 https://gmingin2023.github.io/blindtest/

## Comment jouer

1. **Hôte** → « Créer une partie » → règle le mode et les options → il obtient un code.
2. **Joueurs** → « Rejoindre une partie » → code + pseudo + avatar.
3. L'hôte lance la sélection : chacun choisit ses chansons (recherche iTunes/Deezer)
   et personnalise son extrait (durée, position, vitesse, sans voix, radio, pitch…).
4. Quand tout le monde a fini, la partie démarre automatiquement.
5. L'hôte lance l'extrait, les joueurs buzzent et tapent le titre. Podium à la fin.

## Les 4 modes

| Mode | Principe |
|---|---|
| **Standard** | Buzzer puis taper le titre |
| **Instru** | Chanson sans voix, points ×1,5 |
| **Playlist** | Deviner à qui appartient la chanson (vote) — l'hôte est observateur |
| **Paroles** | 2 lignes de paroles révélées mot à mot, deviner la chanson |

**Score** : 100 pts sous 3 s, puis dégressif jusqu'à 20 pts minimum.
Mauvaise réponse : −10 pts (1ʳᵉ fois), −20 pts ensuite.

## Fichiers

```
index.html         accueil
config.html        réglages + création de la room
host-lobby.html    code + liste des joueurs (appui long = renommer/expulser)
player-lobby.html  rejoindre une partie
selection.html     recherche + personnalisation des extraits
waiting.html       attente, fusion et mélange des sélections
game.html          la partie (buzzer, votes, scores, révélation)
podium.html        classement final + recommencer
js/audio-engine.js MOTEUR AUDIO PARTAGÉ — même son dans l'aperçu et dans le jeu
js/firebase-init.js  js/state.js  js/utils.js  css/style.css
```

> ⚠️ Toute la logique de lecture audio vit dans `js/audio-engine.js`.
> Ne la dupliquez pas : l'aperçu de `selection.html` et la partie dans `game.html`
> appellent exactement la même fonction `AudioEngine.playAudioClip(song)`.
