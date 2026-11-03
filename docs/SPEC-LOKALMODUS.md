# Spec — Lokalmodus als Protokoll

Stand: 2026-11-03, 21:35. Worte des Menschen, sinngemäß wörtlich, darunter die
Umsetzungsentscheidungen. **Diese Datei gewinnt** gegen jeden Plan, jeden Bericht
und jede Zusammenfassung.

## Was der Mensch will (seine Worte)

> „Lokal sollte halt wie ein Boolean sein, so der im Prinzip ist es ein Protokoll,
> es kann kein Boolean sein. Es ist ein Protokoll, wie man da reinkommt und wie man
> da rauskommt."

> „Jeder auf jeder Hierarchie-Ebene, also es gibt dann ein Modell pro
> Hierarchie-Ebene. Lokal ist es immer Swift 1.5 XS IQ2. Und Cloud ist es halt ja
> bei Default erstmal Deep Seek V4 Flash. Und das kann ich dann vielleicht, also
> das sollte dann in jedem, es sollte ein Default geben. Und das kann man dann pro
> Workspace mit Overrides überschreiben, einfach wie man das mit Config so machen
> kann."

> „Es sollte das als Möglichkeit geben, vielleicht kann man ein Tool bauen oder
> sonst was, das sagt so, switch to local Mode und dann werden alle Sessions auf
> Swift gestellt oder halt auf das Modell, was in dem Lokal-Ding konfiguriert ist.
> Und dann werden alle auf die Online-Modelle gestellt, die vorher definiert
> wurden, wenn man wieder zurück will."

> „Weil der User, ich schalte das halt manuell ein- und aus."

> „Lokal-Modus heißt halt so, hey, einmal alle Sessions anschreiben, wenn ihr über
> 300.000 seid, bitte kondensiert es runter auf 300.000. Mindestens so, besser
> 150.000. Und wenn das dann abgeschlossen ist, dann müssen die Modelle umgestellt
> werden."

## Die tragenden Entscheidungen

**1. Es ist kein Schalter, es ist ein Protokoll.** Vier Schritte, in dieser
Reihenfolge, und die Reihenfolge ist der Punkt:

1. Mensch schaltet ein.
2. **Alle** laufenden Sitzungen werden angeschrieben: *„Wenn du über 300 000 Token
   bist, verdichte auf 300 000 — besser 150 000."*
3. **Warten, bis das erledigt ist.**
4. **Erst dann** werden die Modelle umgestellt.

Der Grund für die Reihenfolge: Ein Modellwechsel bei 800 000 Token Kontext
zwingt jedes der lokalen Modelle, den ganzen Kontext durchzuarbeiten. Verdichtet
wird **vor** dem Wechsel, nicht danach.

**Zurück** genauso in umgekehrter Ordnung: Modelle zurück auf Cloud, keine
Verdichtung nötig (Cloud-Modelle tragen den Kontext).

**2. Ein Modell je Hierarchie-Ebene.** Lokal ist es auf jeder Ebene dasselbe
(Swift 1.5 XS IQ2), Cloud ist es auf jeder Ebene DeepSeek V4 Flash, aber die
Zuordnung ist **eine Tabelle**, keine Konstante im Code — sonst lässt sie sich
nicht überschreiben.

**3. Default und Overrides je Workspace.** Wie bei einer Config: ein Default, den
man pro Workspace überschreiben kann. Der Workspace ist die Einheit, weil
`findWorkspace` schon existiert und weil Projekt A lokal laufen kann, während
Projekt B in der Cloud arbeitet.

**4. Der Mensch schaltet von Hand.** Kein Automatismus, keine Schwelle, kein
„merkt selbst". Ein Werkzeug, das er aufruft.

## Was der Auslöser NICHT ist

- **Keine Policy.** Es gibt eine Datei `policies/lokalmodus.md`; sie ist ein
  Prompt-Baustein und wirkt nur, wenn sie eingeschaltet ist. Gemessen am
  2026-11-03: `workspaces/` war auf **beiden** Maschinen leer, die Policy also
  nie aktiv. Selbst aktiv ist sie eine **Bitte** („der Lead spawnnt keine
  Teammates"), keine Sperre.
- **Kein Boolean.** Ein `lokal: true` irgendwo in einer JSON wäre wieder nur eine
  Empfehlung. Der Unterschied zwischen „lokal" und „nicht lokal" muss an einer
  Stelle **erzwungen** werden, sonst hilft er nicht.

## Der Stand der Technik (gemessen 2026-11-03)

| Was | Befund |
|---|---|
| `sessions.selectModel(request)` | existiert als HTTP-Endpunkt in `dsh-api-session-controller`, **nicht** als Host-Dienst |
| `setModel` am Agenten | **gibt es nicht** — das Modell wird bei der Erzeugung gesetzt |
| `ctx.agents.list()` / `roots()` | vorhanden, damit sind alle laufenden Sitzungen erreichbar |
| `member-model.mjs` | setzt heute schon ein Modell für ein **Teammitglied** (über den Controller) |
| Rolling-Compaction | als Paket installiert (`@tmielsch/rolling-compaction`) |

Daraus folgt: Das Umstellen ist **möglich**, aber es geht über den
Session-Controller, nicht über einen direkten Agenten-Aufruf.

## Offene Fragen — vor dem Bau zu klären

**F1. Woran erkennt das Protokoll, dass Schritt 2 fertig ist?**
Drei Wege wären denkbar: jede Sitzung meldet sich zurück; das Werkzeug liest die
Kontextgröße und wartet, bis alle unter 300 000 liegen; oder es wartet nur auf
„alle sind einmal fertig geworden" (idle), ohne die Größe zu prüfen.
Der dritte ist am einfachsten und am schwächsten — er würde eine Sitzung
durchlassen, die nicht verdichtet hat.

**F2. Was passiert mit einer Sitzung, die sich weigert oder nicht antwortet?**
Blockiert sie das ganze Umschalten? Gibt es eine Frist, nach der das Protokoll
weitermacht und die Ausnahme meldet?

**F3. Gilt „swift 1.5 iq2_xs" als Provider-Route genau so?**
Aus dem Modell-Katalog dieser Installation ist `homepc/swift-1.5-iq2_xs` eine
bekannte Route. Ist das die gemeinte? Und welche Provider-Route trägt DeepSeek
V4 Flash hier — `deepseek-official/deepseek-flash`?

**F4. Zählt die Grenze 300 000 den ganzen Kontext oder nur den Prompt?**
„Über 300.000 sein" ist ohne Bezugspunkt nicht prüfbar.

## Was ausdrücklich NICHT dazugehört

- **Kein automatisches Umschalten** bei einer Token-Schwelle.
- **Kein Erzwingen über Werkzeugentzug**, solange nicht geklärt ist, ob das
  Protokoll ohne auskommt. (Der Entzug bleibt eine Option für F2, nicht der
  erste Weg.)
- **Kein Umbau der bestehenden `policies/lokalmodus.md`.** Sie beschreibt das
  Verhalten *innerhalb* des Lokalmodus (der Lead cosplayt die Rollen). Das bleibt
  gültig und ist von diesem Protokoll unabhängig.

## Nächster Schritt

Die vier Fragen klären, dann bauen: einen Werkzeug-Aufruf `lokalmodus` mit den
beiden Aktionen `ein` und `aus`, einen Ablauf, der in der richtigen Reihenfolge
läuft, und einen Test, der beweist, dass die Reihenfolge eingehalten wird (eine
Gegenprobe, die bei umgekehrter Reihenfolge rot wird).

---

## Nachtrag 2026-11-03, 21:40 — die Präzisierung des Menschen

> „Es darf halt nur noch eine dann Zeit arbeiten. Das heißt, der Teamlead übergibt
> die Arbeit an jemanden und wird dann der andere. Und wenn der andere wiederum
> dann delegiert, dann wird er der. Das heißt, es gibt quasi nur einen Agent, der
> alle Rollen nacheinander spielt, wie in so einem Theaterstück, wo einer alleine
> mit sich Theater spielt — was ein bisschen traurig ist, aber ich habe leider nur
> eine Grafikkarte."

**Das ist der Kern des Lokalmodus, und es ist mehr als ein Modellwechsel.**
Gemeint ist nicht „die Sitzungen bekommen andere Modelle", sondern: **es läuft
immer nur ein Agent.** Wer delegiert, hört auf zu arbeiten und wird der andere;
wer wiederum delegiert, wird wieder der andere. Eine Rolle nach der anderen,
immer in derselben einen Sitzung.

Der Grund ist die Hardware: **eine Grafikkarte.** Sieben gleichzeitige Sitzungen
bedeuten, dass der Kontext jeder Sitzung aus dem Speicher verdrängt wird, bevor
sie wieder drankommt — jede Sitzung liest beim Aufwachen alles neu ein.
Sequenziell zu arbeiten ist auf dieser Maschine nicht Bescheidenheit, sondern
die einzige Art, den Modellzustand im Speicher zu halten.

### Was daraus folgt, und es ist unangenehm

Die bestehende `policies/lokalmodus.md` beschreibt genau das schon — aber sie
beschreibt es als **Haltung des Leads** („er cosplayt die Rollen selbst, er
spawnnt keine Teammates"). Das ist eine Bitte an ein Modell. Was der Mensch
braucht, ist der Zustand: **nie zwei Agenten gleichzeitig.**

Damit ist „nur einer aktiv" die schärfste Bedingung des ganzen Lokalmodus und
die einzige, die sich wirklich erzwingen lässt.

## Antworten auf die vier offenen Fragen (gemessen 2026-11-03, 21:40)

**F3 — die Provider-Routen: beantwortet, beide existieren genau so.**

```
homepc/swift-1.5-iq2_xs        = der genannte „Swift 1.5 XS IQ2"
deepseek-official/deepseek-flash = der genannte „DeepSeek V41 Flash"
```

Beide stehen im Katalog dieser Installation (`list_subagent_models`). Neben dem
Swift gibt es noch `homepc/swift-1.5-iq3_xxs` — eine Stufe größer. Die Spec nimmt
`iq2_xs` als Vorgabe, weil der Mensch sie so benannt hat.

**F4 — der Kontextbegriff: beantwortet, es gibt einen Messer.**

`ctx.get('tokenMeter')` liefert `surfaceTokens` — die tatsächliche Größe der
Oberfläche einer Sitzung in Token. Rolling-Compaction benutzt genau diesen Wert.
„Über 300 000" ist damit messbar und nicht schätzbar.

Wichtig aus dem Quelltext von Rolling-Compaction, wörtlich: *„a fixed number was
the wrong trigger, because 300000 tokens is 30 % of a 1000000-token window and
77 % of a 262144-token one"*. Die 300 000 sind also **kein Naturgesetz**, sondern
eine Zahl, die zum Fenster passt. Für Swift mit kleinem Fenster ist sie
möglicherweise zu groß — das ist beim Einbau zu prüfen und gegebenenfalls
herunterzusetzen.

**F1 — woran erkennt das Protokoll, dass verdichtet wurde: beantwortet, technisch.**

Es gibt einen Messer (F4) und es gibt `agent/status` mit `idle` ⇄ `running`. Das
Protokoll kann also nach dem Anschreiben **selbst nachsehen**: für jede Sitzung
`surfaceTokens` lesen und warten, bis alle unter der Grenze liegen. Das ist die
stärkste der drei Möglichkeiten und braucht kein Vertrauen in eine Rückmeldung.

**F2 — was bei einer Sitzung geschieht, die nicht verdichtet: offen, und das ist
eine Entscheidung des Menschen.**

Drei Wege, mit unterschiedlichem Preis:

1. **Blockieren, bis alle unter der Grenze sind.** Der Lokalmodus geht erst an,
wenn wirklich Platz ist. Gefahr: eine hängende Sitzung blockiert das Umschalten
für immer.
2. **Frist setzen und dann umschalten, mit Meldung.** Der Lokalmodus geht nach
einer Frist an, die Sitzung, die nicht verdichtet hat, wird namentlich gemeldet.
Gefahr: genau die Sitzung, die den Speicher sprengt, kommt durch.
3. **Frist, und wer nicht verdichtet hat, wird beendet.** Härteste Variante,
verliert aber möglicherweise Arbeit, die noch nicht geschrieben ist.

**Empfehlung: Weg 2, aber mit der Frist als Teil des Protokolls.** Ein Lokalmodus,
der nie angeht, weil eine Sitzung hängt, hilft niemandem; ein Lokalmodus, der
Arbeit wegwirft, ist schlimmer als einer, der zu spät kommt. Die Meldung ist der
Preis, und sie ist sichtbar.

## Die offene Frage, die bleibt — und sie ist die wichtigste

**„Nur einer aktiv" ist bisher nirgends erzwungen.** Der Lokalmodus kann heute nur
*sagen*, dass sequenziell gearbeitet wird. Was ihn zu einem Zustand macht, ist
eine Sperre: solange ein Agent `running` ist, darf kein zweiter starten.

Dafür gibt es zwei Wege, und sie unterscheiden sich grundlegend:

- **Weich:** Der Werkzeugtext von `spawn_teammate` und `delegate_task` sagt im
  Lokalmodus, dass gewartet werden muss. Das ist wieder eine Bitte.
- **Hart:** `spawn_teammate` wird im Lokalmodus **verweigert**, solange ein anderer
  Agent `running` ist, mit der Aufforderung, zu warten oder die Arbeit selbst zu
  tun. Das ist erzwingbar, weil es im Werkzeug liegt und nicht im Prompt.

Der harte Weg passt zu dem, was der Mensch beschrieben hat: „der Teamlead
übergibt die Arbeit an jemanden und wird dann der andere". Wenn der Lead die
Arbeit selbst tut, braucht er keinen zweiten Agenten — und genau das erlaubt der
harte Weg.

**Diese Entscheidung braucht den Menschen.** Sie ist der Unterschied zwischen
einem Lokalmodus, der empfiehlt, und einem, der gilt.
---

## Nachtrag 2026-11-03, 21:42 — Korrektur: nicht sperren, sondern begrenzen

> „Nee, es ist schon okay, dass ihr das macht. So, es muss nur so sein, dass es
> nicht mehr asynchron dann das Team funktionieren kann, weil meine Engine schafft
> so schon so zwölf Gespräche zu cachen. Das heißt, der Wechsel dauert auch nur so
> zwei Sekunden oder sowas. Das ist jetzt nicht schlimm. Aber wenn jetzt
> gleichzeitig zwei Agents sind, die Toolcalls hintereinander hämmern, so, dann ist
> das nicht so gut."

> „Jetzt, wo wir PTC haben, könnte es sein, dass es sich lohnt, zwei gleichzeitig
> zu haben. Weil ein gebatchter Toolcall halt auch länger braucht, bis er
> abgeschlossen ist und das Modell deswegen auch länger idle ist."

> „Deswegen könnte man sagen, okay, es dürfen maximal zwei aktive Sessions zurzeit
> im Team sein. Und die anderen müssen dann halt ihren Turn beenden und werden dann
> geweckt wieder, wenn die andere vorbei ist. Aber es muss halt immer irgendwie ein
> Bewusstsein dafür sein, wie viele Aktive sind gerade da."

**Das ersetzt den Vorschlag „hart verweigern" aus dem vorigen Abschnitt.** Kein
Verbot, sondern eine **Obergrenze** mit Warteschlange. Der Grund steht in den
Zahlen: die Engine cached zwölf Gespräche, ein Wechsel kostet rund zwei Sekunden.
Der Wechsel ist billig — teuer ist, wenn zwei Agenten gleichzeitig Toolcalls
hämmern.

**Und PTC ändert das Optimum.** Ein gebatchter Toolcall läuft lange; das Modell
ist währenddessen untätig. In dieser Zeit kann ein zweiter Agent rechnen, ohne
dass der erste darunter leidet. Zwei gleichzeitig sind deshalb nicht mehr
schädlich, sondern **nützlich**. Die Grenze ist also nicht 1, sondern 2 — und
zwar weil ein Toolcall lang ist, nicht weil zwei Modelle sich stören.

### Was das technisch verlangt

| Baustein | Befund (gemessen 2026-11-03) |
|---|---|
| Wer ist aktiv? | `agent/status` mit `idle` ⇄ `running`; ein weckender Eingang geht **synchron** in `running` |
| Wie viele? | `ctx.agents.list()` und der Zähler aus den Status-Ereignissen |
| Aus dem Weg gehen | `goals.disarm(agent)` beendet die Rundenfolge; `goals.resume` weckt wieder |
| Warten ohne Runden | `await_goal_dependency` tut genau das schon |

Alle vier Bausteine sind vorhanden. Es fehlt der **Zähler und die Warteschlange
davor**, nicht ein neuer Mechanismus.

### Die ehrliche Grenze

Was sich **nicht** sauber erzwingen lässt: einen Agenten daran hindern, einen
Turn zu **beginnen**, sobald eine Nachricht in seinem Eingang liegt. Ein weckender
Eingang setzt ihn synchron auf `running`. Erzwungen werden kann nur, was danach
kommt: dass er **keine weitere Runde** bekommt (Ziel entwaffnen) und dass die
nächste Nachricht erst fließt, wenn ein Platz frei ist.

Das heißt praktisch: Die Grenze wirkt **zwischen** den Zügen, nicht in der Mitte
eines Zuges. Für den beschriebenen Fall genügt das — zwei Agenten, die
gleichzeitig Toolcalls hämmern, entstehen dadurch, dass beide Ziele scharf sind
und beide Runden nachgeschoben bekommen. Genau dort greift der Zähler.

### Die Grenze ist zwei, nicht eins — vielleicht

„Maximal zwei" ist eine **Vermutung auf Grundlage der PTC-Überlegung**, keine
Messung. Ob zwei gleichzeitig wirklich schneller sind als einer, hängt an der
Länge der Toolcalls und daran, wie die Engine mit zwei aktiven Modellen umgeht.

**Das ist messbar** und sollte vor der Festlegung gemessen werden: eine Aufgabe
mit einem langen gebatchten Toolcall, einmal mit einem Agenten und einmal mit
zwei, und die Uhr daneben. Solange das nicht gemessen ist, bleibt die Grenze eine
Einstellung (Vorgabe 2), die man herunter- und hochstellen kann — keine
Behauptung.
---

## Nachtrag 2026-11-03, 22:10 — F4 endgültig beantwortet

> „Swift kann 384k. 300k ist natürlich viel, aber Swift wird dann schon weiter
> compacten wenn nötig."

**Damit sind die 300 000 keine harte Grenze, sondern eine weiche.** Das Fenster
ist 384 000; bei 300 000 sind noch 84 000 Token Luft, und Rolling-Compaction
greift ohnehin weiter, wenn es eng wird. Die Aufforderung muss also nicht
»verdichte auf genau 300 000« lauten, sondern: *wenn du darüber bist, verdichte —
Swift schafft den Rest selbst.*

Das ist wichtig für den Ton des Anschreibens: Eine harte Zahl, die man erzwingen
muss, wäre ein Eingriff. Eine weiche Grenze, unter der das Modell selbst
weitermacht, ist eine Bitte um Vorarbeit — und die ist billig.

### Was damit feststeht

| Frage | Antwort |
|---|---|
| F3 Provider-Routen | `homepc/swift-1.5-iq2_xs` (lokal), `deepseek-official/deepseek-flash` (Cloud) |
| F4 Kontextgrenze | 300 000 weich; Fenster 384 000; Swift verdichtet selbst weiter |
| F1 Fertig-Erkennung | `ctx.get('tokenMeter')` liefert `surfaceTokens`, das Protokoll sieht selbst nach |
| F2 Sitzung verdichtet nicht | **offen** — Empfehlung bleibt: Frist plus Meldung |
| Aktive Agenten | Vorgabe 2, Einstellung, nicht gemessen |

Nur F2 ist noch nicht entschieden. Alles andere ist gebautauglich.