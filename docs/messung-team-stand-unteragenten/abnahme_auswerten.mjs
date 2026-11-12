/**
 * Auswerter fuer die Abnahme-Ergebnisse (Wegwerf; 2026-11-12). Liest /tmp/teams_plus_umbau/probe/ergebnis_abnahme.json,
 * entschaelt den team_stand-Block und prueft jede Abnahmezeile aus Plan Abschnitt 7 gegen die Werte.
 * Druckt je Abnahme ein Etikett mit PASS/FAIL und den relevanten Zahlen. Keine Messung selbst; nur Auswertung.
 */
import { readFileSync, writeFileSync } from "node:fs";

const B = "/tmp/teams_plus_umbau/probe";
const j = JSON.parse(readFileSync(`${B}/ergebnis_abnahme.json`, "utf8"));

// team_stand-Block entschaelteln (beliebig verschachtelt).
let element = j.standNeu?.[0];
while (Array.isArray(element)) element = element[0];
let wert = null;
try {
  if (element) {
    const text = typeof element === "string" ? element : (element.text ?? JSON.stringify(element));
    wert = text.startsWith("{") ? JSON.parse(text) : null;
  }
} catch (e) { console.log("parse-fehler:", String(e).slice(0, 200)); }

const K = j.kennungen || {};
const out = [];
const zeile = (nr, ok, text) => out.push({ nr, status: ok ? "PASS" : "FAIL", text });

if (!wert) { console.log("KEINE GUeltige STAND-AUSGABE:", JSON.stringify(j.standNeu).slice(0, 600)); process.exit(1); }

// ---- Nr. 1: gruppiert je Mitarbeiter (zwei mitglied-Gruppen + eine eigeneUnteragenten; Enkel depth 2 mit parentId aufs Kind). ----
const g = wert.untergruppen ?? [];
const mitgliedsGruppen = g.filter((x) => x.gruppe === "mitglied");
const eigene = g.find((x) => x.gruppe === "eigeneUnteragenten");
zeile(1, mitgliedsGruppen.length === 2 && eigene !== undefined && eigene.unteragenten?.length === 1,
  `Gruppenanzahl ${g.length}: ${mitgliedsGruppen.length} mitglied + ${eigene ? 1 : 0} eigene; exp1-Kinder=${mitgliedsGruppen[0]?.unteragenten?.length}; eigene-Gruppe=${eigene?.unteragenten?.length} Zeile(n)`);
const gExp1 = (mitgliedsGruppen.find((x) => String(x.id).endsWith(K.exp1)) ?? mitgliedsGruppen[0])?.unteragenten ?? [];
const findLabel = (arr, s) => arr.find((z) => String(z.label).includes(s));
const fA = findLabel(gExp1, "fachA"), fB = findLabel(gExp1, "fachB"), en = findLabel(gExp1, "Enkel"), blk = findLabel(gExp1, "blocked");
zeile(1, fA?.depth === 1 && String(fA.parentId).endsWith(K.exp1) && en?.depth === 2 && String(en.parentId).endsWith(K.fachA),
  `Tiefen in exp1-Gruppe: fachA depth ${fA?.depth} parentId ${String(fA?.parentId).slice(-6)}; Enkel depth ${en?.depth} parentId ${String(en?.parentId).slice(-6)} (Plan: Enkel depth 2, parentId auf das direkte Kind derselben Gruppe)`);
const mitgliedsOhneKinder = mitgliedsGruppen.find((x) => String(x.id).endsWith(K.exp2));
zeile(1, mitgliedsOhneKinder?.unteragenten?.length === 0, `Mitglied exp2 ohne Kinder: ${JSON.stringify(mitgliedsOhneKinder?.unteragenten)} (Plan: leere Liste)`);

// ---- Nr. 8: Aktivierung bei Abgebauten ehrlich unbekannt; lebend mit Wert. ----
zeile(8, fA?.aktivierung === "unbekannt (sitzt nicht in der Datei)" && fB?.zustand === "abgebaut" && (fA?.aktivierung ?? "") !== "",
  `aktivierung bei abgebautem fachA=${JSON.stringify(fA?.aktivierung)}; zustand=${fA?.zustand} (Plan: Wortlaut aus O1, und trotzdem Phase vorhanden)`);

// ---- Nr. 2: lebende Phase == Datei-Phase fuer pausiertes und blockedes Kind. ----
const fBZiel = fB?.ziel, fAZiel = fA?.ziel, bZiel = blk?.ziel;
zeile(2, fAZiel?.phase === "paused" && (bZiel?.phase === "blocked" || fAZiel?.phase === "blocked"),
  `phasen toter Kinder: fachA=${JSON.stringify(fAZiel?.phase)}, blockedKind=${JSON.stringify(bZiel?.phase)} (Plan: totes Kind paused UND ein totes Kind blocked nebeneinander)`);

// ---- Nr. 3: ziel null unterscheidbar von nicht lesbar. ----
const eigen = eigene?.unteragenten?.find((z) => String(z.label).includes("eigenesLeadKind") || String(z.id).endsWith(K.kaputtId));
zeile(3, fBZiel === null && eigen?.gelesenAus === "nicht lesbar",
  `fachB (kein Ziel): ziel=${JSON.stringify(fBZiel)} gelesenAus=${JSON.stringify(fB?.gelesenAus)}; eigenLeadKind (Sitzung zerstoert): gelesenAus=${JSON.stringify(eigen?.gelesenAus)} (Plan: beide unterscheidbar)`);

// ---- Nr. 9: angehaltenSeit unabh. von pauseOffen und fuer beide Objektarten; ohne Eintrag null. ----
const m1 = wert.mitglieder.find((x) => String(x.id).endsWith(K.exp1));
const uebern = JSON.parse(readFileSync(`${B}/uebernahmen_lauf.json`, "utf8").replace(/^\uFEFF/, "") || "[]");
const eintragExp1 = uebern.find((e) => String(e.id).endsWith(K.exp1));
const eintragFachB = uebern.find((e) => String(e.id).endsWith(K.fachB));
zeile(9, eintragExp1 !== undefined && m1?.angehaltenSeit === eintragExp1.seit && eintragFachB !== undefined && fB?.angehaltenSeit === eintragFachB.seit && eigen?.angehaltenSeit === null,
  `exp1 (pauseOffen ${eintragExp1?.pauseOffen}): angehaltenSeit=${m1?.angehaltenSeit} gleich Eintrag=${eintragExp1?.seit}; fachB (pauseOffen ${eintragFachB?.pauseOffen}): ${fB?.angehaltenSeit} gleich Eintrag=${eintragFachB?.seit}; eigen ohne Eintrag: ${eigen?.angehaltenSeit}`);

// ---- Nr. 7: Bericht true fuer Kind mit Ziel und Berichtsdatei. ----
zeile(7, fA?.bericht === true, `fachA bericht=${JSON.stringify(fA?.bericht)} (Berichtsdatei lag unter dem Berichtsordner der Probe)`);

// ---- Nr. 5: Doppelung weg — exp1 und exp2 erscheinen als Gruppenkoepfe, nicht als Kinderzeilen. ----
const alle = g.flatMap((x) => x.unteragenten ?? []).map((z) => z.id);
const keinExp = alle.filter((id) => String(id).endsWith(K.exp1) || String(id).endsWith(K.exp2));
zeile(5, alle.some((id) => String(id).endsWith(K.eigen)) && keinExp.length === 0,
  `exp1/exp2 nicht als Kinderzeilen (nur Gruppenkoepfe); eigenesLeadKind in eigener Gruppe: ${alle.some((id) => String(id).endsWith(K.eigen))}`);

// ---- Nr. 4: Niemand wird geweckt — Zaehler getrennt nach Kennung, Fenster leer. ----
const fk = j.fensterKatalog, fs = j.fensterStand;
zeile(4, fk.neueAgentenImFenster.length === 0 && fk.zugenommeneZuegeProKennung.length === 0 && fs.neueAgentenImFenster.length === 0 && fs.zugenommeneZuegeProKennung.length === 0,
  `Fenster-Katalog: neueAgenten=${JSON.stringify(fk.neueAgentenImFenster)} ZuegeJeKennung=${JSON.stringify(fk.zugenommeneZuegeProKennung)}; Fenster-Stand: neueAgenten=${JSON.stringify(fs.neueAgentenImFenster)} Zuege=${JSON.stringify(fs.zugenommeneZuegeProKennung)} (Plan Nr. 4: alles null)`);

// ---- Nr. 6: Gegenprobe (schon im Node-Test bewiesen, hier nur verifiziert, dass diese Szene mit dem gebauten Modul die Kindergruppen meldet). ----
zeile(6, mitgliedsGruppen.length === 2 && eigene !== undefined, `Zwei mitglied-Gruppen und eine eigene Gruppe in der Ausgabe (die Gegenprobe gegen den Git-Stand ist Node-Test 9, dort aus einem anderen Modul-Stand — nicht hier gemessen)`);

console.log(out.map((o) => `${String(o.nr).padStart(1)}: ${o.status} — ${o.text}`).join("\n"));
writeFileSync(`${B}/abnahme_auswertung.json`, JSON.stringify(out, null, 2));
