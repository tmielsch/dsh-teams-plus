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
