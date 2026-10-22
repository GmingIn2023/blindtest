# Blind Test — direction visuelle « Pochette de vinyle »

Monde : une soirée vinyle entre amis. Papier crème d'une pochette de disque, encre presque noire, un rouge tomate de bouton « REC », un jaune moutarde d'étiquette, un vert sapin pour « c'est gagné ». Imprimé, tactile, chaleureux. Pas de néon, pas de lueurs colorées, pas de dégradés violets.

## Couleurs (tokens dans `css/style.css`, `:root`)
| Token | Valeur | Usage |
|---|---|---|
| `--paper` | `#F3ECE0` | fond de page |
| `--card` | `#FFFBF4` | cartes, champs |
| `--sunk` | `#EAE1D2` | zones en creux, pistes de slider |
| `--ink` | `#1E1A16` | texte, bordures fortes |
| `--ink-2` | `#5A5148` | texte secondaire |
| `--ink-3` | `#8A7F73` | indices, placeholders (grand texte seulement) |
| `--line` | `#D9CDBB` | filets, séparateurs |
| `--tomato` | `#C8401C` | action principale, BUZZ (texte blanc dessus) |
| `--tomato-soft` | `#F6D9CC` | fond d'alerte douce |
| `--mustard` | `#E7B03A` | mise en avant, code de partie, podium |
| `--pine` | `#1F6B57` | succès, « prêt », bonne réponse |
| `--pine-soft` | `#D5E8DF` | fond de succès |
| `--berry` | `#9C2F45` | erreur, mauvaise réponse |

Thème unique clair (papier). Contraste texte ≥ 4,5:1 sur `--paper` et `--card`.

## Typographie (Google Fonts)
- **Fraunces** (titres, gros chiffres, code de partie) — serif doux et humain, `opsz` auto, graisse 600–800.
- **Instrument Sans** (tout le reste) — 400/500/600/700.
- Échelle : 13 / 15 / 17 / 21 / 28 / 40 / 56 px. Corps 17 px sur mobile (pas de zoom iOS sur les champs : ≥ 16 px).

## Formes
- Rayons : 12 px (champs, petits boutons), 18 px (cartes), 999 px seulement pour les pastilles et le BUZZ rond.
- Bordures : 1.5 px `--ink` pour les éléments interactifs principaux, 1 px `--line` pour le reste.
- Ombres : « papier posé » neutre et décalée, jamais colorée : `0 1px 0 var(--line), 0 10px 24px -14px rgba(30,26,22,.35)`. Bouton principal : ombre dure `0 3px 0 var(--ink)` qui s'écrase au clic (comme une touche).

## Composants
- **Bouton principal** : fond `--tomato`, texte blanc, bordure ink, ombre dure ; un seul par écran.
- **Bouton secondaire** : fond `--card`, texte ink, bordure ink.
- **Lien discret** : texte `--ink-2` souligné.
- **BUZZ** : grand disque tomate (min 220 px), texte Fraunces blanc, enfoncement au toucher.
- **Code de partie** : Fraunces 56 px, lettres espacées, sur étiquette moutarde.
- **Pastille joueur** : avatar + nom, fond card, bordure line.

## Mouvement
Court et physique : 120–180 ms, `cubic-bezier(.2,.8,.2,1)`. Enfoncement des boutons, apparition des cartes (fade + 6 px). Respect de `prefers-reduced-motion`.

## Règles
- Un geste évident par écran ; le reste est secondaire ou replié.
- Ne jamais changer les IDs ni la logique JS.
- Mobile d'abord (390 px), marge 16 px, aucune barre de défilement horizontale.
