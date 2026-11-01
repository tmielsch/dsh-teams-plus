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
| **C — Fork im Harness nachrüsten** | Ein Fork, dessen Wurzel eine fremde Session ist. | Eingriff in den Kern; technisch unklar, ob die Sitzungslogik das trägt |

**B ist die Variante, die die Absicht erfüllt, ohne den Kern anzufassen.** Der Unterschied zu A ist
klein, aber wichtig: Nicht der Facharbeiter forkt, sondern der Empfänger. Der Facharbeiter schickt nur
die Meldung. Damit bleibt die Kontrolle dort, wo sie hingehört.

**Diese Entscheidung ist offen** (Frage 4).

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

**Wahrscheinlich braucht es eine technische Grenze** — der Leitungsrolle die schreibenden Werkzeuge
gar nicht geben. Das ist eine offene Frage (Frage 7).

---

## 8. Die geteilten Ablagen

Der Mensch will zwei Dateien, die jeder liest:

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
| **7** | **Wird die Rolle technisch durchgesetzt oder nur beschrieben?** | Gemessen: ein Text hält nicht vom Selbstarbeiten ab | **Technisch**: der Leitungsrolle `write`/`edit`/`bash` nicht geben |
| **8** | **Team-Log und Warnung: eine Datei oder zwei?** | Der Mensch will zwei; das ist mehr Bau, aber richtig | Zwei. Sie werden unterschiedlich gelesen — das ist der ganze Unterschied |
| **9** | **Was passiert mit den zwei zurückgezogenen Rollentexten?** | Sie sind live-untauglich (Red-Team-STOPP) und liegen als `_ZURUECKGEZOGEN-*` | Neu bauen, wenn die Fragen 4, 5 und 7 beantwortet sind |
| **10** | **Soll `~/.dsh/AGENTS.md` gekürzt werden?** | 77 078 Bytes bei 65 536 Budget — sie wird in neuen Sitzungen **ganz weggelassen** | Ja. Sonst kommen alle Rollenregeln in neuen Sitzungen nicht an |

---

## 10. Was bereits gebaut ist

| Was | Stand |
|---|---|
| `send_to_session` | **live**, 0.6.0. Jede Session kann jede lebende Session anschreiben; Wurzelsitzungen bekommen `inject` und werden nie geweckt; Sperre gegen Lost Update |
| `stille-nachrichten` | **live**. Drosselt die Team-Nachrichten (20/s + Summenzeile) |
| `teammate-modell` | **live**. Modellwahl für Teammates |
| `goal-await` | **live**. Ein Ziel wartet, ohne Runden zu verbrauchen |
| `rolle-titel` | **live**. Setzt den Sitzungstitel für `delegate_task` |
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
