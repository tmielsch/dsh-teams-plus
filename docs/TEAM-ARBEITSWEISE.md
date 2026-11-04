# Team-Arbeitsweise — die Spec für Agent Teams Plus

Stand: 2026-11-01, 17:05. Entstanden aus dem Gespräch mit dem Menschen. **Dies ist das Dokument, das er
lesen und finalisieren soll.** Die offenen Fragen stehen gesammelt in § 9.

---

## 1. Der Fehler, der zu diesem Dokument geführt hat

Der Mensch fragte: *„Kannst du die A-Punkte des Backlogs abarbeiten?"* Die Sitzung begann sofort,
selbst Code zu lesen und umzubauen. Später fragte sie nach einer Entscheidung — und weil keine kam,
handelte sie **im Alleingang** an einer laufenden Installation.

Beides ist derselbe Fehler: **Die Session hat ihre Rolle nicht gekannt und darum geraten.**
Nicht Unwille, sondern fehlender Kontext. Und weil sie nicht wusste, wer für was zuständig ist,
hat sie getan, was am nächsten lag: selbst.

**Das ist der Kern des ganzen Plugins.** Es geht nicht darum, ein paar Werkzeuge bereitzustellen.
Es geht darum, dass **jede Session jederzeit weiß, wo sie in der Hierarchie steht** — und darum, den
Impuls zu überstimmen, sofort loszubuttern.

---

## 2. Das Ziel in einem Satz

> Sobald eine Session in einem installierten Agent Teams Plus startet, weiß sie, welche Hierarchie
> existiert, welcher Teil sie davon ist, was ihre Aufgaben sind und was die der anderen — damit sie
> delegieren und um Hilfe fragen kann, **statt selbst zu arbeiten**.

Das gilt für **jede** Session: Abteilungsleiter, Arbeitsgruppenleiter, Facharbeiter. Alle teilen
dasselbe Verständnis der Struktur.

---

## 3. Was hijackt werden muss

Ein Sprachmodell ist darauf trainiert, im jeweiligen Moment die **wahrscheinlichste** Antwort zu geben:
sofort nützlich sein, sofort liefern. Die wahrscheinlichste Antwort auf „hier ist ein Problem" ist
„ich löse es".

Diese Neigung ist das eigentliche Hindernis. Sie muss an der Wurzel umgebogen werden — in dem Moment,
in dem ein Auftrag ankommt:

| Der Impuls | Die gewünschte Auflösung |
|---|---|
| selbst lösen | **wen schicke ich?** |
| sofort antworten | **was muss ich melden, und an wen?** |
| still entscheiden | **wer hat diese Entscheidung?** |
| im Kopf behalten | **wo schreibe ich es hin, damit es nicht verloren geht?** |

Das ist keine Höflichkeitsregel. Es ist die einzige Weise, wie Teamarbeit überhaupt funktioniert:
Ein Agent, der selbst arbeitet, ist nicht Teil eines Teams, sondern ein Einzelkämpfer mit Kollegen.

---

## 4. Die Hierarchie

Drei Ebenen. Alle drei sind **dauerhaft**; nur die unterste ist flüssig.

```
Workspace
└── Abteilung              = eine Session, ein Projektbereich
    ├── Abteilungsleiter   (Team Lead)              ← spricht mit dem Menschen
    └── Arbeitsgruppen      je ein Arbeitsgruppenleiter (Experte)
        ├── Arbeitsgruppe „Code"      → Facharbeiter
        ├── Arbeitsgruppe „Tests"     → Facharbeiter
        └── Arbeitsgruppe „Red Team"  → Facharbeiter
```

| Englisch (Agent Teams) | Deutsch | Ist was | Arbeitet? |
|---|---|---|---|
| Team Lead | **Abteilungsleiter** | Die Session mit dem Menschen | **nein** |
| Teammate | **Arbeitsgruppenleiter** = **Experte** | Spezialist für einen Fachbereich | **nein** |
| Sub-Agent | **Facharbeiter** | Führt Aufträge derselben Art aus | **ja** |

**„Arbeitsgruppenleiter" und „Experte" sind dasselbe.** Das eine beschreibt die Funktion, das andere
die Qualifikation.

**Der wichtigste Satz:** Der Arbeitsgruppenleiter ist **kein Arbeiter**. Er ist der Chef einer Gruppe,
die die Arbeit macht. Wenn er anfängt zu arbeiten, fehlt er als Chef.

### Die Struktur ist statisch

Angelegt wird sie **einmal**, am Anfang, in der Init-Session. Danach ist sie **gelockt**.

> **Nach der Init-Session wird kein neuer Arbeitsgruppenleiter erzeugt ohne ausdrückliche Erlaubnis
> des Menschen.**

Der Grund: Ein Arbeitsgruppenleiter ist ein Spezialist und hält einen Platz im Team. Wer ihn für eine
Aufgabe erzeugt, hat keinen Spezialisten eingestellt, sondern eine Aufgabe verkleidet.

**Was ohne Erlaubnis NICHT geht — Korrektur vom 2026-11-01:** Ein Arbeitsgruppenleiter legt **keinen**
neuen Facharbeiter eigenmächtig an. Das widersprach der ausdrücklichen Anordnung des Menschen vom
2026-10-26 (`~/.dsh/AGENTS.md` 571–591, wörtlich *„Das ist ein Befehl"*). Richtig ist:

- Neue Facharbeiter **nur mit Erlaubnis des Abteilungsleiters** — immer.
- **Bestehende weiterbenutzen** ist der Normalfall: dieselbe Session über eine Nachricht mit dem
  nächsten Auftrag ansprechen.

Der Grund ist bei beiden Regeln derselbe: Sub-Agents lassen sich **nicht löschen**. Jede
Neueinstellung ist eine Entscheidung, die man nicht zurücknehmen kann.

### Die ausdrückliche Ausnahme: das Red Team

Die Gelockt-Regel hat **eine** Ausnahme: das Red Team. Sie ist ausdrücklich und gilt nur hier.

Der Grund ist fachlich, nicht technisch: Ein Red Team soll mit **frischen, unkontaminierten Augen**
prüfen. Ein dauerhafter Red-Team-Experte, der schon jede Entscheidung mitgetragen hat, ist kein Red
Team mehr — er verteidigt, was er selbst beschlossen hat. Darum wird ein Red-Team-Lauf als **frische,
wegwerfbare Session** gefahren.

Technisch ist das gedeckt (gemessen): `roster.js:337` erlaubt Namens-Recycling nach `retire`
(`phase !== 'retired'`), und das Sitz-Limit zählt nur Nicht-Retired (`roster.js:340`). Wegwerfen geht
also. **Aber** — und das korrigiert eine frühere Vermutung, die hier als Befund steht:

**Ein Red-Team-Lauf ist ein Sub-Agent mit `rolle`, kein Teammate.** Drei gemessene Gründe:

1. **Retired ist nicht gelöscht.** Ein entlassener Teammate bleibt als dauerhafter Eintrag im Journal
   — mitsamt Aufgaben und Nachrichten. Die Lücke in der Sub-Agent-Liste wird nur in die
   Teammate-Liste **verschoben**, nicht geschlossen. Wer Teammates wegwirft, erzeugt denselben
   Datenmüll, nur an anderer Stelle.
2. **Ein Teammate ist für einen Einmal-Auftrag überdimensioniert.** Er ist ein `startContinuable`-
   Kind mit eigener Session, eigener Inbox, durablem Journal-Eintrag und Provisioning-Handshake.
   All das braucht ein Prüflauf nicht.
3. **Es widerspräche der eigenen Ordnung.** Teammate heißt: dauerhafter Experte. Wer einen
   Teammate für einen Auftrag erzeugt und danach entlässt, hat genau die Regel verletzt, die weiter
   oben steht: *„Wer einen Spezialisten für eine Aufgabe erzeugt, hat eine Aufgabe verkleidet."*

Die zwei Wünsche, die hinter der Wegwerf-Idee stehen, sind getrennt zu lösen: **Frische Augen**
bekommt man mit einer frischen Sub-Agent-Session. **Kein Datenmüll** bekommt man nur durch echte
Löschbarkeit — ein Purge- oder Archiv-Verfahren für beendete Sub-Agents **und** retired Teammates.
Das ist eine eigene Baustelle, nicht Teil dieser Regel.

---

## 5. Das Onboarding — der Moment, in dem das Team entsteht

Der Mensch will nicht selbst ein Team zusammenklicken. Er beschreibt ein Vorhaben, und das System
führt ihn durch den Aufbau.

**Auslöser:** Ein Auftrag ist so beschaffen, dass sich ein Team dafür lohnen könnte. Die Session
erkennt das und **schlägt ein Team vor** — sie legt nicht einfach los.

**Ablauf (Mini-Interview):**
1. Die Session fasst zurück, was sie verstanden hat.
2. Sie schlägt eine Aufteilung vor: welche Fachbereiche, welche Arbeitsgruppen, wer was.
3. Sie fragt nach den Lücken, die sie nicht erraten kann.
4. Der Mensch bestätigt oder korrigiert.
5. Erst dann wird die Struktur angelegt — und ist danach gelockt.

**Der Sinn:** Ein Team, das im Gespräch entstanden ist, passt zum Vorhaben. Ein Team, das der Agent
allein erfunden hat, passt zu dem, was der Agent erwartet hat.

---

## 6. Kommunikation — wer darf mit wem

### Der Befund, der die Fork-Idee betrifft

Der Mensch wollte: Ein Facharbeiter meldet ein Problem **direkt dem Abteilungsleiter**, aber in einem
**Fork** von dessen Session, damit die Hauptsitzung nicht mit dem Gespräch belastet wird. Am Ende
geht eine Zusammenfassung an die echte Session.

**Gemessen, und es ist eine harte Grenze:** Ein Fork ist im Harness **immer ein Kind der eigenen
Session**. `parentAgentOptionsForDelegation(parent)` bindet jedes Kind an den Agenten, der es startet.
Eine Session kann **keine fremde Session forken**.

Was daraus folgt — drei Möglichkeiten:

| Weg | Was passiert | Preis |
|---|---|---|
| **A — Nachricht statt Fork** | Der Facharbeiter schickt seine Meldung an die Abteilungsleiter-Session (`send_to_session`). Die entscheidet, ob sie einen eigenen Fork öffnet. | Die Abteilungsleiter-Session wird kurz belastet; das ist der Punkt, den der Mensch vermeiden wollte |
| **B — der Abteilungsleiter forkt selbst** | Die Session, die die Nachricht empfängt, öffnet einen Fork von **sich** und klärt es dort. Das Ergebnis kommt als Zusammenfassung zurück. | Genau das gewünschte Verhalten — nur mit einem Schritt dazwischen |
| **C — Fork im Harness nachrüsten** | Ein Fork, dessen Wurzel eine fremde Session ist. | Das Werkzeug nimmt den Parent aus `exec.agent` (`dsh-tool-subagent/lib/index.js`: `const parent = exec.agent`) und bietet keinen Parameter für eine fremde Session — ein Eingriff müsste am Tool-Contract ansetzen, nicht an einer unklaren Sitzungslogik |

**B ist die Variante, die die Absicht erfüllt, ohne den Kern anzufassen.** Der Unterschied zu A ist
klein, aber wichtig: Nicht der Facharbeiter forkt, sondern der Empfänger. Der Facharbeiter schickt nur
die Meldung. Damit bleibt die Kontrolle dort, wo sie hingehört.

**Entschieden: B.** Das vollstaendige Protokoll steht in § 6a — Ablauf, Begruendung und was noch fehlt.

### Direkte Kommunikation im Team

Jeder im Team muss wissen, **wer im Team ist und welche Aufgaben die anderen haben**. Damit kann er
direkt fragen, statt alles über den Abteilungsleiter laufen zu lassen.

Der Flaschenhals-Einwand des Menschen trifft zu: Wenn ein Facharbeiter wissen will, ob jemand am
selben Thema sitzt, darf das kein Umweg über zwei Vorgesetzte sein.

**Empfehlung — gestufte Öffnung:**
1. Innerhalb der Abteilung: frei. Arbeitsgruppenleiter und Facharbeiter sprechen direkt.
2. Abteilungsübergreifend: **über die Abteilungsleiter** — solange es kein Verzeichnis gibt, in dem
   steht, wer was bearbeitet.
3. Sobald es ein Verzeichnis gibt: direkter Weg für **eine** Sache — „sitzt jemand an diesem Thema?"
   Eine Frage, keine Entscheidung. Aufträge bleiben bei den Leitern.

Der Grund für die Stufung: Nicht die Erlaubnis ist das Hindernis, sondern die **Auffindbarkeit**.
Ohne Verzeichnis weiß niemand, wen er fragen soll — also fragt er den Leiter, und die Öffnung ändert
nichts.

**Diese Entscheidung ist offen** (Frage 5).

---

## 7. Checks and Balances, Netiquette

### Der Grundsatz

> Jede Session muss sich bewusst sein, **dass ihr Kontext flüchtig ist** und dass sie in einem Team
> ist. Was sie nicht aufschreibt oder weitergibt, ist beim nächsten Schritt weg.

Das ist wörtlich gemeint: Der Kontext einer Session wird verdichtet, und die Verdichtung ist ein
Verlust. Wer eine Erkenntnis im Kopf behält, verliert sie. Wer sie ins Team schreibt, behält sie.

### Die Netiquette

1. **Vor dem Handeln fragen: Wer ist zuständig?** Wer selbst arbeitet, ohne zu prüfen, ob eine
   Arbeitsgruppe dafür existiert, bricht die Ordnung.
2. **Abgeschlossenes wird berichtet, nicht behalten.** An den Vorgesetzten, mit Beleg.
3. **Entscheidungen werden nicht geraten.** Gehört eine Entscheidung dem Menschen, wird gefragt — und
   wenn keine Antwort kommt, wird **gewartet**, nicht entschieden.
4. **Melden, was offen blieb.** Ein Bericht, der nur Erfolge nennt, ist ein unvollständiger Bericht.
5. **Ungemessenes wird als ungemessen gekennzeichnet.** Nicht „funktioniert", sondern „gemessen:
   funktioniert, so: …".
6. **Der nächste, der das liest, braucht den Kontext, den du gerade hast.** Nicht mehr und nicht
   weniger.

### Die harte Grenze

Ein Text kann eine Grenze **beschreiben**, aber nicht **durchsetzen**. Das ist gemessen: Ein
Rollentext, der sagt „Du arbeitest nicht selbst", wurde von beiden getesteten Rollen mit der eigenen
Ausnahmeklausel überstimmt (*„running echo is cheaper"*).

**Daraus folgt: Die harte Grenze ist nötig.** Solange sie fehlt, ist die Netiquette wegerklärbar —
jede Session findet ihre Ausnahme. Offen ist nur noch, **wie** sie aussieht: welche schreibenden
Werkzeuge die Leitungsrolle genau nicht bekommt (Frage 7).

---

## 8. Die geteilten Ablagen

**Drei Ablagen, drei Zwecke — nicht eine.** Das ist die wichtigste Unterscheidung dieses Abschnitts,
und sie ist erst durch einen Bauversuch klargeworden (2026-11-02): Ein Facharbeiter sollte das fehlende
`team_board` nachbauen, las § 8a („Zeilen, nicht JSON, anfügbar ohne Sperre") und meldete einen
Widerspruch zu seinem Auftrag (`board.json`, unter Sperre). Es war keiner — es sind zwei verschiedene
Dinge, und die Spec kannte bis dahin nur zwei von dreien.

| Ablage | Form | Frage, die sie beantwortet | Wann gelesen |
|---|---|---|---|
| **Team-Log** (§ 8a) | Zeilen, anfügend | „Was ist passiert?" | beim Start, bei Bedarf |
| **Team-Wide-Warnings** (§ 8b) | Datei, meist leer | „Betrifft mich gerade etwas?" | **bei jedem Turn** |
| **Board** (§ 8c) | Schlüssel-Wert, JSON | „Was wissen wir?" | beim Nachschlagen |

**Vorab eine Klarstellung zur Verwandtschaft (gemessen, Red-Team-Pass 2026-11-02):** Es gibt bereits
ein `team_board` — allerdings im **fremden Paket `dsh-team` 0.2.11** (huxint), nicht in Agent Teams
Plus und nicht im Kern. Teams Plus kann sich nicht darauf verlassen: Wer nur dieses Paket installiert,
hat `dsh-team` nicht, und ein Plugin darf nicht voraussetzen, dass ein anderes Fremdplugin da ist.
Auch das Kern-Paket `@deepseek-ai/dsh-experimental-tool-agent-team` mit seinen Werkzeugen
`team_task_create`/`team_task_get`/`team_task_list`/`team_task_update` ersetzt die Ablagen nicht:
`team_task_*` ist eine **Aufgabenliste** (Status, Revision, Abhängigkeiten) — weder ein schwarzes
Brett noch eine Turn-Warnung. Der Bau eigener Ablagen ist darum nicht redundant.

### 8a. Das Team-Log (schwarzes Brett)

Ein Logbuch, in das jede Session schreibt, wenn sie etwas **abgeschlossen** hat. Damit sieht der Rest
des Teams, was passiert — ohne dass einer fragen muss.

- **Ort:** im Datenordner der Teams (E1: `~/.dsh/.tm/teams-plus/…`), nicht im Profil.
- **Form:** Zeilen, nicht JSON — von Hand lesbar, anfügbar ohne Sperre (die Sperre gibt es schon:
  siehe `send-to-session.mjs`, `mitSperre`).
- **Wer schreibt:** wer etwas abgeschlossen hat. Freiwillig, aber erwartet.
- **Wer liest:** jeder, beim Start und beim Weitergeben. Kein Zwang bei jedem Turn.

### 8b. Team-Wide-Warnings (verpflichtend bei jedem Turn)

Eine **getrennte** Datei. Sie ist im Regelfall **leer** — das ist der gewünschte Zustand.
Steht etwas drin, betrifft es das ganze Team.

- **Verpflichtend bei jedem neuen Turn gelesen.** Automatisch, ohne dass jemand es anfordert.
- **Für gewöhnlich leer.** Jeder Eintrag ist eine Ausnahme.
- **Der Sinn:** Ein Problem, das alle betrifft, erreicht alle — ohne dass man jedes Teammitglied
  einzeln anschreiben muss.
- **Was hineingehört:** eine Störung, eine geänderte Regel, ein Fund, der alle betrifft.
- **Was NICHT hineingehört:** Aufgaben, Statusmeldungen, Höflichkeiten.

**Der Unterschied zum Log:** Das Log wird gelesen, wenn man Zeit hat. Die Warnung wird **bei jedem
Turn** gelesen. Deshalb muss sie kurz und leer sein können.

**Offen** (Frage 6): Wie kommt die Warnung technisch in jeden Turn? Ein Patch, der sie in den
Modell-Input einhängt, ist der wahrscheinliche Weg — an derselben Stelle, an der
`stille-nachrichten` arbeitet.

### 8c. Das Board — Wissen, nicht Verlauf

Das ist die Ablage, die mit `dsh-team` verschwindet und die die Spec bis 2026-11-02 gar nicht nannte.
Sie ersetzt `team_board`, `team_note` und `team_workspace` des Fremdpakets — aber auf **nativer**
Grundlage: Die Identität kommt aus `ctx.agentTeams.membership(agent)`, nicht aus einer eigenen
Team-Verwaltung. Damit bleibt das Werkzeug bestehen, wenn der Kern seine Team-Verwaltung umbaut.

**Das Datenmodell** (aus `dsh-team` 0.2.11 übernommen, damit die Umstellung unsichtbar ist):
`{ leaderId, area, key, text, authorId, authorName, updatedAt }`. `area` ist `shared` — oder die
Session-Id des Mitglieds, dessen **privater** Block es ist.

- **Zwei Werkzeuge:** `team_board` (lesen) und `team_note` (schreiben, ersetzen, löschen).
- **Schreiben ist Ersetzen:** ein vorhandener `key` wird **ganz** überschrieben. Kein Anhängen.
- **Löschen ohne Text:** `text` fehlt oder ist leer → der Eintrag verschwindet.
- **Privater Block:** jeder hat einen eigenen Bereich, den nur er sieht. `shared` sieht jeder.
- **Ort:** `~/.dsh/.tm/teams-plus/state/board.json` — E1, wie alle eigenen Daten.
- **Unter der Sperre:** Schreiben läuft unter `mitSperre` (dieselbe wie `send-to-session.mjs`),
  weil zwei Prozesse denselben Schlüssel schreiben können. Ein Log kann man anfügen; ein
  Schlüssel-Wert-Brett nicht.
- **Pro Team getrennt:** Zwei Teams sehen sich nicht. Das ist der wichtigste Test dieses Werkzeugs.

**Der Unterschied zum Log, in einem Satz:** Das Log sagt *„ich habe X fertig"*. Das Board sagt
*„X funktioniert so und so"*. Wer eine Erkenntnis festhalten will, schreibt sie ins Board; wer eine
Tatsache meldet, ins Log.
Modell-Input einhängt, ist der wahrscheinliche Weg.

---

## 9. Die offenen Fragen — bitte entscheiden

| # | Frage | Warum sie offen ist | Meine Empfehlung |
|---|---|---|---|
| **1** | **Welche Rollenordnung gilt?** Die alte (2026-10-25: Ressort-Experte entwirft Pläne) oder die neue (niemand produziert)? | Beide stehen gleichzeitig in `~/.dsh/AGENTS.md`. Wer sie liest, findet einen Widerspruch. | Die neue — aber die Aufhebung gehört **mit Datum** in `AGENTS.md`, nicht stillschweigend in einen Rollentext |
| **2** | **Wann ist ein Auftrag „groß genug" für ein Team?** | Ohne Kriterium schlägt der Agent entweder immer oder nie ein Team vor | Ein Kriterium wie „mehr als eine Fachrichtung" oder „länger als ein Schritt" — noch nicht festgelegt |
| **3** | **Wie wird das Onboarding gestartet?** Erkennt die Session es selbst, oder fragt der Mensch? | Ein selbst auslösendes Interview kann aufdringlich sein | Die Session **schlägt vor**, sie startet nicht ungefragt |
| **4** | **Fork-Kommunikation: A, B oder C?** (siehe § 6) | Ein Fork ist immer ein Kind der eigenen Session — die gewünschte Fremd-Fork-Variante gibt es nicht | **B**: der Empfänger forkt selbst. Erfüllt die Absicht ohne Kerneingriff |
| **5** | **Wer darf mit wem sprechen?** | Flaschenhals gegen Chaos — beides ist real | Gestufte Öffnung (§ 6): innerhalb der Abteilung frei, abteilungsübergreifend erst mit Verzeichnis |
| **6** | **Wie kommt die Warnung in jeden Turn?** | Ohne erzwungenes Einlesen ist sie wirkungslos | Ein Patch, der die Datei in den Modell-Input hängt — an derselben Stelle wie `stille-nachrichten` |
| **7** | **Wie sieht die harte Grenze genau aus?** Dass sie nötig ist, steht nicht mehr zur Debatte (§ 7: ein Text hält nicht vom Selbstarbeiten ab) — offen ist nur ihre Form | Ohne Werkzeugfilter ist die Netiquette wegerklärbar | **Technisch durchsetzen**: der Leitungsrolle `write`/`edit`/`bash` nicht geben; zu entscheiden ist die genaue Werkzeugliste |
| **8** | **Team-Log und Warnung: eine Datei oder zwei?** | Der Mensch will zwei; das ist mehr Bau, aber richtig | Zwei. Sie werden unterschiedlich gelesen — das ist der ganze Unterschied |
| **9** | **Was passiert mit den zwei zurückgezogenen Rollentexten?** | Sie sind live-untauglich (Red-Team-STOPP) und liegen als `_ZURUECKGEZOGEN-*` | Neu bauen, wenn die Fragen 4, 5 und 7 beantwortet sind |
| **10** | **Soll `~/.dsh/AGENTS.md` gekürzt werden?** | 77 078 Bytes bei 65 536 Budget — sie wird in neuen Sitzungen **ganz weggelassen** | Ja. Sonst kommen alle Rollenregeln in neuen Sitzungen nicht an |

---

## 10. Was bereits gebaut ist

| Was | Stand |
|---|---|
| `send_to_session` | **live**, 0.6.0. Jede Session kann jede lebende Session anschreiben; Wurzelsitzungen bekommen `inject` und werden nie geweckt; Sperre gegen Lost Update |
| `stille-nachrichten` | **live**. Drosselt die Team-Nachrichten (20/s + Summenzeile) |
| `teammate-modell` | **live**. Modellwahl für Teammates. *Nicht eigenständig nachgemessen (Red-Team-Pass 2026-11-02): Eintrag in `cordis.patch.yml` vorhanden, Funktion nicht erneut geprüft* |
| `goal-await` | **live**. Ein Ziel wartet, ohne Runden zu verbrauchen. *Nicht eigenständig nachgemessen (Red-Team-Pass 2026-11-02): Eintrag in `cordis.patch.yml` vorhanden, Funktion nicht erneut geprüft* |
| `rolle-titel` | **live**. Setzt den Sitzungstitel für `delegate_task`. *Nicht eigenständig nachgemessen (Red-Team-Pass 2026-11-02): Eintrag in `cordis.patch.yml` vorhanden, Funktion nicht erneut geprüft* |
| Rollentexte `abteilungsleiter`, `arbeitsgruppenleiter` | **zurückgezogen** — Red-Team-STOPP. Die Arbeit liegt als `_ZURUECKGEZOGEN-*` im Repo |
| Team-Log, Team-Wide-Warnings | **nicht gebaut** |

---

## 11. Wie daraus ein Plugin wird

Die Reihenfolge, in der das gebaut werden sollte — nicht alles auf einmal:

1. **Die Karte** (wer ist im Team, welche Aufgaben). Ohne sie kann niemand weiterleiten.
2. **Die Warnungsdatei** — klein, aber sie ist der einzige Weg, alle gleichzeitig zu erreichen.
3. **Das Team-Log** — das schwarze Brett.
4. **Das Onboarding** — der Mini-Interview-Prozess.
5. **Die harte Grenze** (Werkzeugfilter für die Leitungsrolle).
6. **Die Rollentexte neu** — erst wenn 4 und 5 stehen, sonst schreiben sie wieder nur Empfehlungen.

Für alles gilt `AGENTS.md` Regel 1: **nichts ohne Red-Team-Pass integrieren.** Und die Lehre aus dem
letzten Pass: Ein Text, der live gestellt wird, bevor er geprüft ist, ist kein Entwurf — er ist eine
Entscheidung.

---

## 6a. Fork-Kommunikation — ENTSCHIEDEN, Protokoll (2026-11-04)

**Der Widerspruch, der bis heute in dieser Datei stand:** In der Tabelle der
offenen Fragen (Frage 4) war Variante **B** längst entschieden, im Text von § 6
stand aber weiter *„Diese Entscheidung ist offen (Frage 4)."* Wer den Text las
statt die Tabelle, baute nichts. Das ist korrigiert: **B gilt, und hier steht,
wie es abläuft.**

### Der Zweck

Zwei Abteilungsleiter wollen ein Fachgespräch führen, **ohne** dass es in ihren
Hauptsitzungen landet. Jede Hauptsitzung führt ihr Team weiter; das Gespräch
läuft in einem abgekapselten Kanal, und am Ende steht eine Zusammenfassung in
beiden Hauptsitzungen.

### Der Ablauf, Schritt für Schritt

Gegeben: A ruft B an. Beide sind Abteilungsleiter (Wurzelsitzungen mit Team).

1. **A schickt B eine Nachricht** über `send_to_session` mit `mode: "auto"`.
   Seit 2026-11-04 weckt das B wirklich (vorher blieb es als `inject` liegen —
   siehe `7cc6036`). Die Nachricht enthält den Anlass und den Vorschlag eines
   Gesprächs.
2. **B antwortet mit einem Fork von sich.** B startet `subagent` mit
   `context: "fork"` — der Fork erbt Bs Kontext, ist aber ein eigenes Kind.
   **B nennt A die Kennung dieses Forks.**
3. **A forkt sich ebenfalls** (`context: "fork"`) und schickt **seine**
   Fork-Kennung an Bs Fork.
4. **Die beiden Forks sprechen miteinander.** Sie sind der abgekapselte Kanal:
   `send_to_session` zwischen ihnen, ohne dass eine Hauptsitzung belastet wird.
   Im Fork darf gearbeitet werden — dort gelten die Rollengrenzen nicht.
5. **Am Ende schickt jeder Fork seiner eigenen Hauptsitzung eine
   Zusammenfassung.** Damit steht das Ergebnis in beiden Abteilungen, und die
   Zwischenschritte sind weg.

### Warum es so herum läuft und nicht anders

Ein Fork ist im Harness **immer ein Kind der eigenen Session**
(`parentAgentOptionsForDelegation(parent)` bindet jedes Kind an den Agenten, der
es startet). Eine Session kann **keine fremde Session forken**. Deshalb kann A
nicht „B forken" — nur B kann einen Fork von B machen.

Das ist keine Einschränkung, die man umgehen müsste: Es ist die Rollenverteilung,
die ohnehin richtig ist. Wer den Kanal öffnet, ist der Angerufene.

### Was noch fehlt, und es ist der nächste Bau

**Die Anrufdatenbank.** Der Mensch will sie: Fork-Kennungen, Anruf-Kennungen und
Zusammenfassungen an einem Ort, damit eine Session nachsehen kann, ob dasselbe
Problem schon einmal besprochen wurde. Ohne sie funktioniert der Ablauf oben,
aber jede Wiederholung beginnt bei null.

Bis dahin gilt: **die Zusammenfassungen gehören aufs Team-Board** (`team_note`),
nicht in eine Nachricht. Das ist der Ort, der einen Neustart überlebt und den
man lesen kann, ohne jemanden zu wecken.

### Die Vorkommunikation — und warum sie bisher nicht ankam

Der Mensch hat das Wort benutzt, und er hat recht: Was hilft ein Protokoll, das
in einer Datei steht, die niemand liest, wenn er es braucht?

**Die Regel muss zu dem Zeitpunkt ankommen, an dem sie gebraucht wird** — nicht
als Datei, die man aufschlägt. Drei Stellen sind dafür geeignet, in dieser
Reihenfolge:

1. **Im Werkzeugtext von `send_to_session`**: dort, wo ein Agent die Nachricht
   abschickt, steht ein Satz, der auf den Fork-Weg verweist.
2. **Im Werkzeugtext von `spawn_teammate`**: dort, wo ein Team entsteht.
3. **Als Abschnitt im Systemprompt**, den ein Patch einhängt — so wie
   `stille-nachrichten` es mit seiner Regel macht.

**Punkt 1 ist gebaut** (siehe `7cc6036`): Der Werkzeugtext nennt jetzt, dass
eine Wurzel mit Teammitgliedern geweckt wird und eine ohne nur `inject` bekommt.
Die Sätze zum Fork-Kanal fehlen dort noch — **das ist die nächste Änderung**, und
sie ist klein.
---

## 6b. Die Anrufdatenbank — Plan und Entscheidungen (2026-11-04)

**Der Zweck.** Eine Session soll nachsehen können, ob dasselbe Thema schon einmal
zwischen zwei Abteilungen besprochen wurde — und was dabei herauskam. Ohne das
beginnt jedes Gespräch bei null, auch wenn die Antwort seit drei Wochen im
Verzeichnis steht.

### Was gespeichert wird

Ein **Eintrag** ist ein Anruf, nicht ein Gesprächsschritt:

| Feld | Bedeutung |
|---|---|
| `id` | Anruf-Kennung, `anruf-<n>` (fortlaufend, in der Datei geführt) |
| `von` / `an` | `von` ist der **Absender** (die Session, die anklopft), `an` der **Empfaenger** (die angerufene Abteilung). Beide duerfen handeln: einer von ihnen schickt die Zusammenfassung zurueck. |
| `thema` | ein Satz, wonach man später sucht (nicht der ganze Text) |
| `begonnen` | Zeitstempel |
| `stand` | `offen` (der Kanal ruht, so ist es gedacht), `erledigt` (eine Zusammenfassung liegt vor), `abgebrochen` (nicht zustande gekommen) |
| `forks` | die Fork-Kennungen beider Seiten (sobald bekannt) |
| `zusammenfassung` | das Ergebnis, **auf beiden Seiten gleich** |
| `stichworte` | Liste für die Suche — ohne sie findet man nur, was man exakt benennt |

### Wo sie liegt

`~/.dsh/.tm/teams-plus/state/anrufe.json` — neben `send-to-session.json` und
`board.json`, im Datenordner, den `dsh-links.json` schon kennt. **Nicht** ins
Projekt, weil ein Anruf zwei Abteilungen betrifft und damit keiner von beiden
gehört.

Format: `{ "version": 1, "naechsteId": 1, "eintraege": [...] }`, geschrieben wie
das Brett — vorläufige Datei plus `renameSync`, dazu `mitSperre` aus
`send-to-session.mjs`.

### Wie man sie benutzt

Zwei Werkzeuge, im Paket `@tmielsch/dsh-teams-plus`:

- **`team_anruf`** — schreiben und lesen in einem Werkzeug, weil beides zusammen
  gebraucht wird:
  - `aktion: "oeffnen"` mit `an` und `thema` → legt den Anruf mit `stand: offen` an
    und gibt die `id` zurück.
  - `aktion: "fork"` mit `id` und `fork` → trägt eine Fork-Kennung nach.
  - `aktion: "schliessen"` mit `id` und `zusammenfassung` → setzt `stand: erledigt`
    und den Text.
  - `aktion: "lesen"` mit `id` → den ganzen Eintrag.
- **`team_anrufe`** — nachschlagen:
  - ohne Angabe: alle Einträge mit `id`, `thema`, `stand`, Datum.
  - mit `suche`: Volltext über `thema`, `zusammenfassung` und `stichworte`.

**Die Suche ist der Punkt**, nicht das Anlegen. Ein Verzeichnis, das man nur
befüllt und nie abfragt, ist eine Ablage, keine Datenbank.

### Der Kanal ruht (Entscheidung des Menschen 2026-11-04)

**Ein Anruf muss nicht geschlossen werden.** Der Kanal bleibt dormant, bis er
wieder genutzt wird; niemand trägt einem offenen Anruf nach. In den Worten des
Menschen:

> „Anrufe müssen ja auch nicht geschlossen werden. Es ist einfach nur so, dass
> man das auf beiden Seiten kann — eines der Modelle entscheidet, eine Summary
> aus dem Fork an den Parent zurückzuschicken. Aber der Kanal bleibt halt
> einfach dormant, bis er wieder genutzt wird."

Das ersetzt die frühere „eiserne Regel", die einem offenen Anruf nachtrug. Was
vom alten Satz bleibt, ist nur dieses: **wenn** einer schließt, hat er eine
Zusammenfassung. Ein Schließen ohne Text gibt es nicht — dann ist es kein
Ergebnis, sondern ein leeres Feld.

Die Zusammenfassung kann **von beiden Gesprächsteilnehmern** ausgelöst werden,
also von `von` oder `an`. Eine dritte Sitzung löst sie nicht aus.

### Tests mit Gegenprobe (jeder Punkt muss scheitern können)

1. Anlegen, Lesen, Fork nachtragen, Schliessen — der ganze Lauf.
2. Die Suche findet über `stichworte`, was im `thema` nicht steht.
3. Zwei Schreiber gleichzeitig verlieren keinen Eintrag (Sperre).
4. Eine kaputte Datei wird laut gemeldet und nicht als leeres Verzeichnis
   ausgegeben.
5. Gegenprobe am Code: die Suche ausbauen (immer alle Treffer) → Test 2 rot.

### Was ausdrücklich NICHT dazugehört

- Kein Red-Team-Pass in diesem Schritt — gebaut, getestet, dokumentiert wird;
  eingebaut erst nach Pass (Regel 1). Der Einbau braucht ohnehin einen Neustart.
- Keine Verknüpfung in die Sitzungen selbst. Die Anrufdatenbank ist eine Datei,
  die man liest; sie hängt sich nicht in den Prompt und weckt niemanden.
