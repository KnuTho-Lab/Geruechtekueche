# Risikomodell: Anbindung im Klassifizierungs-Workflow

Stand 2026-10-01. Für Thomas und seinen Claude-Assistenten. Das Modell (gbert-large v2, von Knut trainiert) bewertet, wie dringend ein Gerücht ist. Backend-Seite: Migration `20261001100000_risiko.sql`, `supabase/functions/_shared/risiko_logik.ts`, `klassifizierung_setzen` und `risiko_nachholen`.

## 1. Was sich für deinen Workflow ändert

Dein Klassifizierer ruft nach der Kategorisierung (Gemini) zusätzlich das Risikomodell auf und schickt den Wert **im selben `POST /klassifizierung_setzen`** mit, als neues optionales Feld `risiko`. Mehr ist nicht nötig, eine eigene Tabelle gibt es nicht: das Risiko ist eine Spalte des Gerüchts.

```
Webhook → Kategorien laden → Gemini → Ergebnis prüfen
                                   ↘ Risikomodell (HTTP Request, parallel)
                          Zusammenführen → POST klassifizierung_setzen (mit risiko)
```

Bewertet wird der **Text der ersten Meldung** (`body.text` des Webhooks), nicht die Kernaussage: das Modell wurde auf einzelnen Meldungstexten trainiert.

## 2. Der Modell-Aufruf

| | |
|---|---|
| URL | `https://desktop-4d4tfa1.taildd5fa7.ts.net/risiko` |
| Methode | POST |
| Header | `Authorization: Bearer <Token>` (das Token gibt Knut dir, in n8n als **Header-Auth-Credential** ablegen, nie in den Workflow-Text) |
| Body | `{"texte": ["<Text der ersten Meldung>"]}` (1 bis 50 Texte, je höchstens 2000 Zeichen) |
| Antwort 200 | `{"risiko": [0.88]}`, eine Zahl 0 bis 1 je Text, gleiche Reihenfolge. 0 = harmlos, 1 = dringend |

Fehlercodes: `401` Token falsch, `400` Body ungültig, `413` Body über 512 KB, `429` Modell ausgelastet (höchstens 2 Anfragen gleichzeitig). Der Texte-Parameter ist eine **Liste**, auch bei einem Text.

Zeitverhalten: rund 50 ms je Text auf der CPU (gemessen am Modell, ohne Netz), über den Funnel etwas mehr. Als Zeitlimit im HTTP-Request-Node reichen **30 Sekunden**.

## 3. Wichtig: das Modell läuft lokal und kann aus sein

Das Modell läuft in einem Docker-Container auf **Knuts privatem Rechner** und ist nur über einen Tailscale-Funnel erreichbar. Ist der Rechner aus oder der Container gestoppt, kommt **keine Antwort**: Verbindungsfehler, Zeitüberschreitung oder ein 5xx vom Funnel.

Dann gilt:

1. Im HTTP-Request-Node **„Continue on Fail" bzw. „On Error: Continue"** einschalten, damit der Workflow weiterläuft.
2. Bei `POST /klassifizierung_setzen` das Feld **`risiko` weglassen** (nicht 0, nicht null erfinden, nicht warten, nicht wiederholen).
3. Die Klassifizierung geht trotzdem durch. Das Backend setzt `risiko_status = 'queue'` und liefert das Risiko nach, wenn Knut `POST /risiko_nachholen` anstößt.

Ein Ausfall des Modells darf die Klassifizierung nie blockieren.

## 4. Was das Backend daraus macht

| Spalte in `geruechte` | Bedeutung |
|---|---|
| `risiko` | 0 bis 1, leer solange nicht berechnet |
| `risiko_status` | `ausstehend` = noch nicht klassifiziert, `berechnet` = Wert gesetzt, `queue` = klassifiziert, Modell hatte nicht geantwortet |
| `risiko_berechnet_am` | Zeitpunkt |
| `risiko_modell` | z. B. `gbert-large-v2` |

Die View `geruechte_uebersicht` zeigt die Spalten neben der Kategorie. `GET /calls` beschreibt das Feld `risiko` bei `klassifizierung_setzen` und den Modell-Aufruf unter `ausgehende_aufrufe` (Eintrag `risikomodell`).

Antwort von `POST /klassifizierung_setzen` enthält zusätzlich `risiko` (wie gespeichert, sonst `null`) und `risiko_status`.

## 5. Zum Testen

Ohne Schreiben in die Datenbank lässt sich der Modell-Aufruf allein prüfen (Beispiel mit curl):

```bash
curl -X POST https://desktop-4d4tfa1.taildd5fa7.ts.net/risiko \
  -H "Authorization: Bearer <Token>" -H "Content-Type: application/json" \
  --data-binary '{"texte":["Im Aufenthaltsraum gibt es neue Teebeutel.","Die Prüfungen der Druckbehälter wurden verfälscht."]}'
```

Erwartet (Modell v2): ungefähr `{"risiko":[0.04,0.88]}`. Antwortet nichts, ist Knuts Rechner oder der Container aus.

Das Modell ist ein Regressor mit rund 0,12 mittlerem Fehler auf neuen Meldungen. Harmlose, aber offiziell klingende Texte werden eher überschätzt. Der Wert ist eine Orientierung, kein Urteil.
