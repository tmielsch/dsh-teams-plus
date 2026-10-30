# Entscheidungen — dsh-teams-plus

Dieses Dokument hält fest, was der Mensch entschieden hat, mit Datum und in seinen Worten.
Es ist die Spec dieses Repos. Wer hier arbeitet, liest es vollständig, bevor er etwas tut.
Eine Zusammenfassung gibt es nie mit eigenen Worten wieder; sie nennt Pfad und Stand.

Es gibt keine Vermutung in diesem Dokument. Was ein Vorschlag ist, steht als Vorschlag da und
ist als solcher gekennzeichnet.

---

## E1 — Der Ort für alle eigenen Plugins (2026-10-30)

> „bitte in ~/.dsh/.tm/pluginName - das wird ab jetzt der ort für alle meine plugins, und deren plugin data."

Entschieden: Jedes eigene Plugin legt seine Daten unter `~/.dsh/.tm/<pluginName>/` ab. Für dieses
Paket ist das `~/.dsh/.tm/teams-plus/`.

Daraus folgen drei Regeln, die für jedes künftige Plugin gelten:

1. **Code und Daten sind getrennt.** Der Code liegt im Paket (in `node_modules`), die Daten liegen
   unter `~/.dsh/.tm/<pluginName>/`. Ein Paket-Update darf niemals die Daten des Menschen
   überschreiben.
2. **Die Daten sind von Hand lesbar.** Dateien, keine undurchsichtigen Datensätze, damit er sie in
   einem Editor öffnen, in Git sichern und in einer Sitzung zitieren kann.
3. **Der Plugin-Name ist der Ordnername.** Kein Sammelordner für mehrere Plugins, keine Ausnahmen.

Bestehende Plugins bleiben vorerst, wo sie sind. Sie ziehen um, wenn sie ohnehin angefasst werden.

---

## E2 — Die Rolle `user` darf alles (2026-10-30)

> „es sollte eine role 'user' geben, die alles darf"

Entschieden: Es gibt eine Rolle `user`. Sie steht **über** dem Teamleiter und ist die Rolle des
Menschen. Sie darf alles.

**Was das heißt.** Jede Handlung, die ein Abteilungsleiter darf, darf `user` auch — und zwar ohne
die Begründung, die ein Agent liefern müsste. Dazu kommen Handlungen, die **nur** `user` darf:
ein Issue endgültig schließen, ein Mitglied endgültig entlassen, eine Sitzung löschen, eine
Arbeitsgruppe auflösen.

**Was daraus folgt, und das ist der harte Teil:**

1. **`user` ist nicht einschränkbar.** Keine Policy, kein Profil und kein Agent kann `user` Rechte
   entziehen. Wer eine Regel schreibt, die auch für `user` gilt, schreibt sie falsch.
2. **`user` vererbt nicht.** Ein Agent erbt von `user` nichts. Die Rechte eines Agenten stammen aus
   seiner Arbeitsgruppe und seiner Abteilung, nie aus der Rolle des Menschen. Das ist der
   Unterschied zu allen anderen Ebenen.
3. **`user` ist der Ursprung jeder Erlaubnis.** Was ein Agent darf, ist immer eine ausdrückliche
   Übertragung durch `user` — nicht ein Vorgabewert, der zufällig entstanden ist.
4. **`user` hinterlässt keine Kaskade.** Eine Handlung von `user` löst keine Antwortkette aus. Der
   Teamleiter erfährt davon nur, wenn `user` es will. Das ist die Regel aus der stillen Nachricht
   (`quiet`) und gilt hier als Grundsatz, nicht als Ausnahme.

**Der technische Punkt, den man kennen muss.** Der Mensch hat keine Sitzung, also gibt es keinen
Agenten, der „als user" handelt. Darum gilt: `teams-plus` führt die Handlung im Namen von `user`
aus und benutzt dabei die Leitungssitzung als Ausführenden. Die **Erlaubnis** kommt von der Rolle
`user`, die **Ausführung** vom Teamleiter. Wer das verwechselt, baut einen Weg, auf dem ein Agent
sich selbst Rechte gibt.

**Wo das heute blockiert.** Die Management-Methoden des Team-Plugins (`retire`, `rest`, `wake`,
`interrupt`) verlangen ausnahmslos `role === "lead"` und werfen sonst `TEAM_LEAD_REQUIRED`
(gemessen in `dsh-experimental-agent-team/lib/index.js`, Zeilen 504–612). `user` ist dort unbekannt.
Ein Knopf „Pausieren" oder „Entlassen" braucht deshalb eine der beiden folgenden Umsetzungen:

- **Regelweg:** `teams-plus` bietet einen eigenen Dienst, der die Handlung mit der Leitungssitzung
  als Aufrufer ausführt und die Erlaubnis aus `user` ableitet. Kein Eingriff in das Team-Plugin.
- **Eingriffsweg:** ein Patch am Team-Plugin, der `user` als dritte Rolle kennt — nötig erst dann,
  wenn eine Handlung über das hinausgeht, was der Dienst schon hergibt (Beispiel: ein einzelnes
  Mitglied pausieren, denn `rest()` ist immer eine Sammelhandlung).

Der Regelweg ist der erste. Ein Eingriff nur, wenn er gemessen notwendig ist.

---

## E3 — Policies sind Prompts mit Tags (2026-10-30)

> „erst mal reicht das, dass man die Policies einfach nur als Tags anlegt und quasi ein standardisiertes Schema hat, wie so Policies auszusehen haben"

Entschieden: Eine Policy ist ein Prompt-Baustein. Sie liegt als Datei unter
`~/.dsh/.tm/teams-plus/policies/<id>.md`, oben ein flacher Kopfblock, darunter der Text. Tags sind
freie Wörter, kein festes Vokabular. Eine Policy ist pro Workspace an- oder abschaltbar.

Der ausführliche Entwurf steht in der Aufgabe `task-2` und in der Umsetzung unter `src/policy/`.

---

## E4 — ProjectOS tritt zurück, AgentTeams+ ist der Schwerpunkt (2026-10-30)

> „AgentTeams+ ist unser hauptfokus hier. Alles gescatterte darein zusammenführen, nichts neu schreiben, sondern vorhandenes integrieren. So, dass es ein einfaches package werden kann"

Entschieden: AgentTeams+ wird das Paket, in dem die Team-Infrastruktur zusammenläuft. ProjectOS
bleibt die Oberfläche (Brett, Graph) und wird vorerst nicht weitergebaut. ProjectOS hängt künftig
am selben Policy-Vertrag wie jede andere Ansicht, besitzt aber die Engine nicht mehr.

Die Patches und Rollen sind mit Schnitt 1 bereits umgezogen.

---

## E5 — Ansichten sind austauschbar (2026-10-30)

> „dass es einfach nur so Data View, View-Modes oder View-Layer oder sowas sind […] dass die alle miteinander sprechen können, dass die alle miteinander einfach verbunden werden können, ohne sich aber auch gegenseitig auf die Füße zu treten"

Entschieden: Jede Ansicht — Rechtsklick-Menü, Tab, ProjectOS-Brett, ein künftiges zweites
Menü-Plugin — liest und schreibt ausschließlich über den Dienst `teamsPlus`. Keine Ansicht kennt
einen Dateipfad. Damit kann eine zweite Ansicht danebentreten, ohne die erste zu stören.

---

## Offene Fragen

1. **Wie erreicht `user` eine Handlung technisch?** Der Regelweg oben ist beschrieben, aber nicht
   gebaut. Erste zu bauende Stelle, sobald das Steering-Thema beginnt.
2. **Darf ein Agent im Namen von `user` handeln, wenn `user` es einmal erlaubt hat?** Das ist die
   Frage nach der dauerhaften Übertragung („der Mensch gibt einer Gruppe die Berechtigung",
   ProjectOS-Spec A13 Punkt 5). Nicht entschieden.
3. **Verschachtelte Teams:** Die ProjectOS-Spec will mehrere Ebenen (Abteilungsleiter sprechen
   miteinander, ein „CEO" ganz oben). Ob `user` dann nur einmal existiert oder je Workspace,
   ist nicht entschieden.

---

## Stand

2026-10-30, angelegt vom Abteilungsleiter DSH-Modding. Vor dem Weiterarbeiten vollständig lesen.
