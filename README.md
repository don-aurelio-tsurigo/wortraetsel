# Tsüri Rätsel

Newsletter-Rätsel (6iBrief, Tsüri, …) mit eigenem Backend. Läuft komplett auf
Cloudflare: ein Worker, D1 (Daten) und R2 (Logos). Unabhängig vom bestehenden
Wordle in `../Wordle`, das unverändert weiterläuft.

```
/{slug}             Spiel (öffentlich)
/{slug}/logo        Logo aus R2
/api/{slug}/state   Spielstand, Zugang, Texte (GET)
/api/{slug}/guess   Versuch (POST)
/api/{slug}/grace   «Ich bin schon Member» (POST)
/admin              Backend (Passwort-Login)
```

## Spielregeln

- Der Spielstand liegt auf dem Server (Tabelle `plays`), die Lösung kommt erst nach Spielende in den Browser.
- Ein Spiel = Person × Rätselwort. Es zählt ab dem ersten gültigen Versuch.
- Members spielen unbegrenzt und sehen keine Paywall- oder Trial-Texte.
- Nicht-Members, Ehemalige und Leute ohne Newsletter-Link: Trial (z.B. 20 Spiele), danach X Gratis-Rätsel pro Woche (Mo–So), sonst Paywall.
- Paywall-Modus «Testbetrieb»: niemand wird gesperrt, die Statistik zählt aber, wer gesperrt worden wäre.
- «Ich bin schon Member» schaltet 48 Stunden frei, höchstens einmal in 30 Tagen (WePublish synct nur täglich nach Mailchimp).
- Die `id` aus dem Link wird im Browser gespeichert und aus der Adresszeile entfernt, damit geteilte Links den Status nicht weitergeben.

## Lokal starten

```bash
npm install
npm run db:migrate:local
npm run dev          # http://127.0.0.1:8788/admin
```

`.dev.vars` enthält `DEV_ADMIN_BYPASS=1`, damit `/admin` lokal ohne Login geht.

Texte aus dem alten Wordle übernehmen (liest die alte Datei nur):

```bash
node scripts/seed-from-legacy.mjs ../Wordle/worker/public/index.html 6ibrief "6iBrief Worträtsel" > seed/6ibrief.sql
npx wrangler d1 execute raetsel --local --file seed/6ibrief.sql
```

## Backend

Pro Rätsel:
- **Allgemein:** Name, Slug, Spieltyp, Logo, Akzentfarbe, Wochentage mit neuem Wort, Pausen, Mailchimp-Link
- **Zugang:** Paywall (aus / Testbetrieb / aktiv), Gratis-Spiele, Gratis-Rätsel pro Woche, Membership- und Rückhol-Link
- **Texte & CTAs:** pro Gruppe (alle / Members / Nicht-Members / Ehemalige) Sieg-Titel, Sieg- und Niederlage-Sprüche, Trial-Hinweis, Paywall – je mit optionalem Button
- **Wörter:** Warteschlange mit voraussichtlichem Datum. Am ersten Aufruf eines Rätseltags wird das nächste Wort fix auf heute gesetzt; an anderen Tagen bleibt das letzte aktiv.

## Memberstatus

Mailchimp-Link: `https://<domain>/<slug>?id=*|MMERGE3|**|UNIQID|*`

| MMERGE3 | id-Länge | Status |
|---|---|---|
| `1` | 11 | Member |
| leer | 10 | Nicht-Member |
| `-1` | 12 | ehemalig |

Die Person ist immer die UNIQID (letzte 10 Zeichen).

## Erstes Deployment

```bash
npx wrangler login
npx wrangler d1 create raetsel        # ID in wrangler.toml eintragen
npx wrangler r2 bucket create raetsel-files
npm run db:migrate:remote
npm run deploy
```

Backend-Passwort setzen (liegt nur als Secret bei Cloudflare, nie im Code):

```bash
npx wrangler secret put ADMIN_PASSWORD
```

Mit demselben Befehl wird es geändert; alle Sitzungen werden dabei automatisch
abgemeldet. Nach 5 Fehlversuchen ist das Login pro IP für 15 Minuten gesperrt.
Optional lässt sich stattdessen Cloudflare Access nutzen (`ACCESS_TEAM_DOMAIN` und
`ACCESS_AUD` in `wrangler.toml`), dann gilt das Passwort nicht mehr.

Deployt wird automatisch bei jedem Push auf `main` (Cloudflare Workers Builds).
Neue Migrationen vorher mit `npm run db:migrate:remote` anwenden.
