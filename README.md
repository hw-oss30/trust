# Trustreels Personal

Personal- und Projektsoftware für Trustreels, aufgebaut auf der Teamkartei-Vorlage (gleiches Dunkel-/Glas-Design).

## Funktionen

- **Login-Maske** beim Aufruf der Seite. Die Sitzung läuft über ein HttpOnly-Cookie, nach 12 Stunden muss man sich neu anmelden.
- **Admins** (`hendrikwendker`, `tomgerlitz`) sind die Einzigen, die Benutzer anlegen, Rechte vergeben und Passwörter setzen dürfen. Sie können auch weitere Admins anlegen.
- **Rechte und Rollen:** Beim Anlegen eines Benutzers wählst du die Rechte einzeln aus oder nimmst eine Rolle. Mit „Als Rolle speichern“ wird die aktuelle Auswahl zur Rolle (z. B. „Editor“), die du später anderen Benutzern zuweisen kannst. Änderst du eine Rolle, gilt das sofort für alle, die sie haben.
- **Kalender und Abwesenheiten:** Urlaub, Krankheit, Fortbildung, Dreh, Homeoffice usw. Ohne zusätzliche Rechte sieht jeder Mitarbeiter nur seine eigenen Stunden und Abwesenheiten. Admins sehen alles. Urlaubsanträge von Mitarbeitern landen als „Beantragt“ bei den Admins, Krankmeldungen gelten sofort.
- **Projekte** (dürfen standardmäßig nur Admins anlegen): Kunde, Projektnummer, Zeitraum und **Positionen mit geplanten Stunden** (z. B. Kameramann 20 h, Editor 40 h). Mitarbeiter buchen ihre Stunden auf eine Position.
- **Projektübersicht:** Stand aller laufenden Projekte als farbige Prozentzahl (grün unter 80 %, gelb 80–100 %, rot über Budget), gesamt und je Position. Mit dem Schalter „Prozent / Stunden“ siehst du stattdessen die Stunden.
- **Benutzereinstellungen:** Jeder kann sein eigenes Passwort ändern. Admins können zusätzlich jedes Passwort neu setzen.
- Feiertage NRW, Urlaubskonto, CSV-Export der Stunden, läuft auch auf dem Handy.

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

## Starten

Voraussetzung: Node.js 18 oder neuer. Weitere Abhängigkeiten gibt es nicht.

```bash
npm start
# → http://localhost:3000
```

Die Daten liegen in `data/db.json`. Die Datei wird beim ersten Start angelegt und liegt nicht im Git. **Sichere sie regelmäßig.**

Einstellungen über Umgebungsvariablen:

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | Port des Servers |
| `DATA_DIR` | `./data` | Ordner für die Datenbank |
| `COOKIE_SECURE` | – | auf `1` setzen, wenn die Seite per HTTPS läuft und kein Proxy `X-Forwarded-Proto` setzt |

### Mit Docker

```bash
docker build -t trustreels-personal .
docker run -d -p 3000:3000 -v trustreels-data:/app/data --name trustreels trustreels-personal
```

### Im Internet betreiben

Betreibe die App hinter einem Reverse-Proxy mit HTTPS (z. B. Caddy, nginx oder Traefik). Ohne HTTPS gehen Passwörter unverschlüsselt durchs Netz.

## Erste Anmeldung

Beim ersten Start werden die beiden Admin-Konten angelegt. Im Code stehen die Passwörter nur als Hash. **Ändert beide Passwörter nach der ersten Anmeldung** unter „Benutzereinstellungen“ (Klick auf den eigenen Namen oben rechts), weil die Startpasswörter im Klartext weitergegeben wurden.

## Tests

```bash
npm test
```

Die Tests prüfen Anmeldung, Rechte, Sichtbarkeit, Passwortwechsel und den Schutz des letzten Admins.
