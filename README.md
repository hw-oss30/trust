# Trustreels Personal

Personal- und Projektsoftware für Trustreels, aufgebaut auf der Teamkartei-Vorlage (Glas-Design auf reinem Schwarz, optional hell).

## Funktionen

- **Login-Maske** beim Aufruf der Seite. Die Sitzung läuft über ein HttpOnly-Cookie, nach 12 Stunden muss man sich neu anmelden.
- **Admins** (`hendrikwendker`, `tomgerlitz`) sind die Einzigen, die Benutzer anlegen, Rechte vergeben und Passwörter setzen dürfen. Sie können auch weitere Admins anlegen.
- **Rechte und Rollen:** Beim Anlegen eines Benutzers wählst du die Rechte einzeln aus oder nimmst eine Rolle. Mit „Als Rolle speichern“ wird die aktuelle Auswahl zur Rolle (z. B. „Editor“), die du später anderen Benutzern zuweisen kannst. Änderst du eine Rolle, gilt das sofort für alle, die sie haben.
- **Kalender und Abwesenheiten:** Urlaub, Krankheit, Fortbildung, Dreh, Homeoffice usw. Ohne zusätzliche Rechte sieht jeder Mitarbeiter nur seine eigenen Stunden und Abwesenheiten. Admins sehen alles. Urlaubsanträge von Mitarbeitern landen als „Beantragt“ bei den Admins, Krankmeldungen gelten sofort.
- **Projekte** (dürfen standardmäßig nur Admins anlegen): Kunde, Projektnummer, Zeitraum und **Positionen mit geplanten Stunden** (z. B. Kameramann 20 h, Editor 40 h). Mitarbeiter buchen ihre Stunden auf eine Position.
- **Projektübersicht:** Stand aller laufenden Projekte als farbige Prozentzahl (grün unter 80 %, gelb 80–100 %, rot über Budget), gesamt und je Position. Mit dem Schalter „Prozent / Stunden“ siehst du stattdessen die Stunden.
- **Benutzereinstellungen:** Jeder kann sein eigenes Passwort ändern. Admins können zusätzlich jedes Passwort neu setzen.
- **Zeiterfassung als Kalender:** Monatsansicht mit gebuchten Stunden, Tagessoll und Abwesenheiten. Ein Klick auf einen Tag bucht Zeit. Alternativ gibt es die Listenansicht mit CSV-Export.
- **Projektoptionen:** „Internes Projekt“ für Zeiten ohne Kunde (Büro, Akquise …, Positionen optional) und „Archivieren“ (verschwindet aus Übersicht und Buchung, bleibt im Filter „Archiv“).
- **Statistiken:** Überstunden, Resturlaub, Urlaub genommen/beantragt, Krankheitstage und Krankmeldungen je Mitarbeiter. Das Soll zählt ab Konto-Anlage oder ab „Überstunden zählen ab“; ein Übertrag aus der Zeit davor lässt sich eintragen.
- **Mitarbeiter-Report als PDF:** Monat und Mitarbeiter wählen (Admins auch „Alle“), dann „Als PDF speichern“. Der Report enthält jeden Tag mit Status, Soll, Ist und Tätigkeiten, Summen, Abwesenheiten, Jahreswerte und Unterschriftsfelder.
- **Dunkel oder Hell:** in den Benutzereinstellungen wählbar („Wie Gerät“ folgt der Systemeinstellung), gespeichert pro Benutzer.
- Feiertage NRW, Urlaubskonto, läuft auch auf dem Handy.

### Rechte im Überblick

| Recht | Standardrolle „Mitarbeiter“ |
|---|---|
| Eigene Stunden buchen | ✓ |
| Eigene Abwesenheiten beantragen & Krankheit melden | ✓ |
| Mitarbeiterliste mit Kontaktdaten einsehen | – |
| Kalender: Abwesenheiten aller einsehen | – |
| Abwesenheiten aller eintragen & genehmigen | – |
| Stunden aller einsehen | – |
| Stunden für alle erfassen & bearbeiten | – |
| Projektübersicht & Projektstand einsehen | – |
| Projekte anlegen & bearbeiten | – |
| **Administrator** (alles + Benutzer/Rollen/Passwörter) | – |

Alle Rechte prüft der Server. Was jemand nicht sehen darf, wird gar nicht erst an den Browser geschickt.

## Auf Vercel betreiben (empfohlen)

Vercel führt die App als Serverless Functions aus. Dort gibt es keinen dauerhaften Speicher auf der Festplatte. Deshalb liegen die Daten auf Vercel in **Upstash Redis**, das du direkt in Vercel verbindest. Der kostenlose Tarif reicht für ein kleines Team.

1. Auf [vercel.com](https://vercel.com) **„Add New… → Project“** wählen und das GitHub-Repository `hw-oss30/trust` importieren.
2. Bei den Projekteinstellungen nichts ändern. Framework: „Other“, kein Build Command. `vercel.json` regelt den Rest.
3. Im Projekt unter **Storage** (bzw. **Marketplace**) **„Upstash for Redis“** hinzufügen und mit dem Projekt verbinden. Dabei setzt Vercel die Variablen `KV_REST_API_URL` und `KV_REST_API_TOKEN` (oder `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) automatisch.
4. Unter **Deployments** einmal **„Redeploy“** klicken, damit die neuen Variablen greifen.
5. Die Vercel-Adresse öffnen und mit `hendrikwendker` oder `tomgerlitz` anmelden. Beim ersten Aufruf werden Admins und Standardrollen in Redis angelegt.

HTTPS ist bei Vercel automatisch aktiv, die Cookies werden dann als `Secure` gesetzt. Ohne verbundenes Redis zeigt die Anmeldung den Hinweis „Keine Datenbank verbunden“.

**Datensicherung:** Alle Daten liegen im Redis-Schlüssel `trustreels:db`. In der Upstash-Konsole kannst du Backups aktivieren oder den Inhalt im Data Browser exportieren.

**Hinweis zum Branch:** Vercel baut standardmäßig den Haupt-Branch (`main`) als Produktion. Solange der Code nur auf `claude/trustreels-hr-software-rlvust` liegt, erstellt Vercel daraus eine Preview-Adresse. Für die feste Adresse den Branch nach `main` mergen.

## Lokal starten

Voraussetzung: Node.js 18 oder neuer. Weitere Abhängigkeiten gibt es nicht.

```bash
npm start
# → http://localhost:3000
```

Lokal liegen die Daten in `data/db.json`. Die Datei wird beim ersten Start angelegt und liegt nicht im Git. Sind die Redis-Variablen gesetzt, nutzt auch der lokale Start Redis.

Einstellungen über Umgebungsvariablen:

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | Port des Servers |
| `DATA_DIR` | `./data` | Ordner für die Datenbank |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | – | Upstash Redis statt Datei (auf Vercel Pflicht) |
| `REDIS_PREFIX` | `trustreels` | Präfix der Redis-Schlüssel, z. B. für eine Testumgebung |
| `TRUST_PROXY` | – | auf `1` setzen, wenn ein Reverse-Proxy `X-Forwarded-For` setzt (für die Login-Bremse je IP) |
| `COOKIE_SECURE` | – | auf `1` setzen, wenn die Seite per HTTPS läuft und kein Proxy `X-Forwarded-Proto` setzt |

### Alternativ: eigener Server mit Docker

```bash
docker build -t trustreels-personal .
docker run -d -p 3000:3000 -v trustreels-data:/app/data --name trustreels trustreels-personal
```

Betreibe die App auf einem eigenen Server hinter einem Reverse-Proxy mit HTTPS (z. B. Caddy, nginx oder Traefik). Ohne HTTPS gehen Passwörter unverschlüsselt durchs Netz.

## Erste Anmeldung

Beim ersten Start werden die beiden Admin-Konten angelegt. Im Code stehen die Passwörter nur als Hash. **Ändert beide Passwörter nach der ersten Anmeldung** unter „Benutzereinstellungen“ (Klick auf den eigenen Namen oben rechts), weil die Startpasswörter im Klartext weitergegeben wurden.

## Tests

```bash
npm test
```

Die Tests prüfen Anmeldung, Rechte, Sichtbarkeit, Passwortwechsel und den Schutz des letzten Admins. Außerdem prüfen sie den Redis-Speicher an einem nachgebauten Upstash-Server, so aufgerufen wie auf Vercel.
