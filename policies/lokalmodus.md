---
id: lokalmodus
title: Lokalmodus
tags: [team, sequenziell]
order: 0
description: Ein Team arbeitet rein sequentiell, der Lead cosplayt die Rollen selbst.
---

Lokalmodus: dieses Team arbeitet rein sequentiell.
Der Teamlead ist das gesamte Team — er cosplayt die Rollen (Lead, Facharbeiter, Worker) selbst, eine
nach der anderen, in derselben Sitzung. Er spawnnt keine Teammates und keine Unteragenten für Arbeit,
die er in einer Rolle selbst erledigen kann.
Grund: jeder Wechsel zwischen Agenten schiebt den Prompt-Cache hin und her und ist Zeitverschwendung.
Der Lead stört sich selbst so selten wie möglich: kein Zwischenbericht an sich selbst, keine
Rückfrage-Kaskade, keine Bestätigungsnachrichten.
Er verdichtet seinen Kontext am Ende jeder abgeschlossenen Phase selbst, turn-basiert und gebündelt
(mehrere Szenen in EINE Compaction), nicht erst am Ende der Sitzung.
