# SUPER NOVUS — Audit de sécurité

_Dernière revue : 2026-07-20. Revue indépendante (lecture seule) de tout le code :
les 5 migrations SQL, les 3 fonctions serveur (Edge Functions), `supabase/config.toml`,
et tout le client (`src/**`)._

Ce document est écrit pour un fondateur non-technique. Verdict en une phrase :
**les fondations sont saines (aucun fonds à risque, base de données verrouillée,
aucun secret exposé), et les points faibles identifiés ont été corrigés ou sont
documentés ci-dessous avec leur niveau de risque réel.**

---

## ✅ Ce qui est solide (confirmé par l'audit)

- **Non-custodial** — l'application ne détient **aucune** clé privée ni fonds. Toute
  signature/paiement se fait dans le wallet de l'utilisateur. Il n'y a pas de
  « caisse » que quelqu'un pourrait vider depuis l'app.
- **Base de données verrouillée (RLS)** — la sécurité au niveau des lignes est
  activée sur **toutes** les tables. Le navigateur peut **lire** les données publiques
  (classement, paiements, revenus — transparence) mais ne peut **rien écrire ni
  modifier** directement. Toutes les écritures passent par les fonctions serveur
  (clé de service, jamais exposée).
- **Aucun secret côté client** — aucune clé privée ni clé de service dans le bundle.
  La clé « anon » Supabase et l'ID WalletConnect sont **publics par conception**
  (protégés par la RLS) — ce n'est pas une faille.
- **Calculs de montants sûrs** — les paiements CRO utilisent des entiers exacts
  (`BigInt`, 10^18), aucun arrondi flottant, aucune fuite de valeur.

---

## 🔧 Corrigé dans cette mise à jour

| # | Sévérité | Problème | Correctif |
|---|----------|----------|-----------|
| H1 | Élevé | `dust` n'avait **aucun plafond** : un tricheur pouvait gonfler le score à l'infini (et faire planter la colonne entière de la base). | Plafonds absolus ajoutés (`dust ≤ 500 000`, `score ≤ 20 000 000`) — très au-dessus de toute partie réelle, mais bloque l'absurde et l'overflow. |
| H2 | Élevé | `record-bigbang` acceptait une transaction **non confirmée** : on pouvait enregistrer un revenu puis annuler le paiement (remplacement de transaction), gonflant la cagnotte sans payer. | La fonction exige maintenant le **reçu on-chain confirmé** (`status = succès`) avant de compter un revenu. Une transaction en attente renvoie « réessaie ». |
| M1 | Moyen | L'URL d'avatar était injectée sans échappement (`<img src="…">`) — risque de **XSS stocké** le jour où les profils passeront côté serveur. | Échappement ajouté aux 4 endroits (classement + profil). Fermé avant que ce soit exploitable. |
| Compta | Important | `record-bigbang` **rejetait** les achats de packs (180/550/1500 CRO) : leur revenu n'était **jamais compté** dans la cagnotte ni la compta. | Les montants des packs sont désormais acceptés → revenu correctement enregistré. |
| L1/L2 | Faible | `record-payout` faisait confiance à un hash non vérifié + commentaires obsolètes. | `record-payout` **vérifie le paiement on-chain** (trésorerie → gagnant) et enregistre le **montant réel** ; commentaires corrigés. |

---

## ⚠️ Risque résiduel connu (à surveiller si la cagnotte grossit)

### Le score est calculé côté client (le point faible restant)
L'endpoint qui enregistre un score ne demande **pas** de signature (on l'a retiré
parce que, sur mobile, la demande de signature WalletConnect n'apparaissait jamais
dans le wallet — l'enregistrement était donc impossible). Conséquence : quelqu'un
de **techniquement compétent** peut soumettre un faux score sous une adresse qu'il
contrôle.

**Garde-fous en place aujourd'hui :** plafonds de valeurs (H1), fenêtre de temps de
±5 min, limite anti-spam par wallet, et surtout **validation manuelle des paiements**
— aucun prix ne part automatiquement, c'est toujours toi qui approuves depuis la
console admin.

**Tant que les prix restent modestes**, l'intérêt de tricher est faible. **Si les
gains deviennent importants**, la vraie parade (recommandée) est :
1. un **jeton de session signé côté serveur** émis au début de partie (HMAC, sans
   ouvrir le wallet — donc compatible mobile), exigé à l'enregistrement du score ; et/ou
2. un **score calculé côté serveur** (l'app envoie les évènements de jeu, le serveur
   recalcule le score). C'est le seul moyen d'avoir un anti-triche fort.

Ces deux chantiers sont **volontairement non faits pour l'instant** (ils dépassent le
cadre actuel et risquent de recasser l'enregistrement mobile s'ils sont bâclés). Ils
sont à programmer **avant** de promouvoir une grosse cagnotte.

### Limitation anti-abus par IP
Les fonctions serveur n'ont qu'une limite **par wallet** (pas par IP). Un attaquant
qui fait tourner les adresses peut spammer. Impact = coût/déni de service, pas de vol
de données. À gérer côté plateforme (Supabase/Vercel WAF) si nécessaire.

---

## 🛡️ Sécurité automatique en place

- **CodeQL** (analyse de failles GitHub) sur **chaque** modification.
- **`npm audit`** bloquant sur toute dépendance à faille grave. Aujourd'hui : **0 vulnérabilité**.
- HTTPS partout (Vercel) + protections plateforme (anti-DDoS Supabase/Vercel).

---

## Priorités si tu montes en échelle
1. **Anti-triche fort** (jeton de session serveur + score serveur) — avant une grosse cagnotte.
2. **Limitation par IP / WAF** sur les fonctions serveur.
3. Garder la **validation manuelle des paiements** (déjà le cas) — c'est le meilleur
   filet de sécurité contre un faux gagnant.
