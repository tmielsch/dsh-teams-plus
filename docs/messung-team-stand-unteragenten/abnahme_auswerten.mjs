/**
 * Auswerter der Plan-Abnahmen 1 bis 9 (Abschnitt 7) gegen einen Team-Modus-an-Lauf (2026-11-12).
 *
 * Aufruf:  node abnahme_auswerten.mjs <ergebnis_teamaktiv_2026-11-12.json> [<ergebnis_lebend_2026-11-12.json>]
 *
 * Liest die Stand-Ausgabe aus dem Ergebnis (`standNeu`), die Übernahme-Einträge aus dem Lauf
 * (`uebernahmen`, falls vorhanden) und die Lebend-Messung. Druckt je Planzeile PASS/FAIL mit den
 * tatsächlichen Werten und schreibt `abnahme_auswertung.json` neben die Eingabedatei. Keine
 * festen Zeitstempel aus anderen Läufen: alle Vergleiche laufen gegen Werte aus DIESEM Ergebnis.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const eingabe = process.argv[2];
if (!eingabe) { console.error("Aufruf: node abnahme_auswerten.mjs <ergebnis.json> [lebend.json]"); process.exit(2); }
const ergebnis = JSON.parse(readFileSync(eingabe, "utf8"));
const lebend = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : null;

// Den team_stand-Block entschachteln (der Lauf speichert ihn verschachtelt).
let element = ergebnis.standNeu?.[0];
while (Array.isArray(element)) element = element[0];
const text = typeof element === "string" ? element : (element?.text ?? "");
if (!text.startsWith("{")) { console.error("KEINE team_stand-Ausgabe im Ergebnis"); process.exit(1); }
const wert = JSON.parse(text);

const K = ergebnis.kennungen ?? {};
const endet = (id, kennung) => typeof id === "string" && kennung && id.endsWith(kennung);
const zeilen = [];
const zeile = (nr, ok, etikett, detail) => zeilen.push({ nr, status: ok ? "PASS" : "FAIL", etikett, detail });

const gruppen = wert.untergruppen ?? [];
const mitglied = gruppen.filter((g) => g.gruppe === "mitglied");
const eigene = gruppen.find((g) => g.gruppe === "eigeneUnteragenten");
const gExp1 = mitglied.find((g) => endet(g.id, K.exp1)) ?? mitglied[0];
const kinderExp1 = gExp1?.unteragenten ?? [];
const finde = (liste, teil) => liste.find((z) => String(z.label ?? "").includes(teil));
const fachA = finde(kinderExp1, "fachA");
const fachB = finde(kinderExp1, "fachB");
const enkel = finde(kinderExp1, "Enkel");
const blockiert = finde(kinderExp1, "blockedKind");
const eigenesKind = finde(eigene?.unteragenten ?? [], "eigenesLeadKind");
const exp1Mitglied = wert.mitglieder?.find((m) => endet(m.id, K.exp1));
const exp2Gruppe = mitglied.find((g) => endet(g.id, K.exp2));

// Nr. 1: gruppiert je Mitarbeiter; Enkel depth 2 mit parentId aufs direkte Kind.
zeile(1, mitglied.length === 2 && eigene !== undefined && fachA?.depth === 1 && enkel?.depth === 2 && endet(enkel?.parentId, K.fachA) && (exp2Gruppe?.unteragenten?.length ?? -1) === 0,
  "MESSUNG",
  `Gruppen mitglied=${mitglied.length}, eigene=${eigene ? 1 : 0}; fachA depth ${fachA?.depth}; Enkel depth ${enkel?.depth} parentId ${String(enkel?.parentId).slice(-6)}; exp2 Kinder ${exp2Gruppe?.unteragenten?.length}`);

// Nr. 2: Phase eines abgebauten Kindes = Phase aus der Datei; zwei Lagen: paused und blocked.
zeile(2, fachA?.ziel?.phase === "paused" && blockiert?.ziel?.phase === "blocked",
  "MESSUNG",
  `fachA paused=${fachA?.ziel?.phase}; blockedKind=${blockiert?.ziel?.phase} (zwei Lagen je Phase)`);

// Nr. 3: kein Ziel (null) und nicht lesbar unterscheidbar.
zeile(3, fachB?.ziel === null && eigenesKind?.gelesenAus === "nicht lesbar",
  "MESSUNG",
  `fachB ziel=${JSON.stringify(fachB?.ziel)} gelesenAus=${fachB?.gelesenAus}; eigenesLeadKind gelesenAus=${eigenesKind?.gelesenAus}`);

// Nr. 4: Zähler bleibt beim Lesen still (Fenster aus dem Lauf). Fehlende Fensterfelder sind FAIL.
const fenster = ergebnis.fensterStand;
const fensterKat = ergebnis.fensterKatalog;
const fensterVollstaendig = fenster !== undefined && fensterKat !== undefined
	&& Array.isArray(fenster.neueAgentenImFenster) && Array.isArray(fenster.zugenommeneZuegeProKennung)
	&& Array.isArray(fensterKat.neueAgentenImFenster) && Array.isArray(fensterKat.zugenommeneZuegeProKennung);
zeile(4, fensterVollstaendig && fenster.neueAgentenImFenster.length === 0 && fenster.zugenommeneZuegeProKennung.length === 0 && fensterKat.neueAgentenImFenster.length === 0 && fensterKat.zugenommeneZuegeProKennung.length === 0,
  "MESSUNG (eingeschraenkt: abgebaute Kinder)",
  fensterVollstaendig
    ? `Fenster Stand: neue=${JSON.stringify(fenster.neueAgentenImFenster)} Zuege=${JSON.stringify(fenster.zugenommeneZuegeProKennung)}; Fenster Katalog: neue=${JSON.stringify(fensterKat.neueAgentenImFenster)} Zuege=${JSON.stringify(fensterKat.zugenommeneZuegeProKennung)}`
    : "FEHLT: fensterStand/fensterKatalog nicht vollständig im Ergebnis (kein Standardwert eingesetzt)");

// Nr. 5: Teammitglieder nur als Gruppenköpfe, nie als Kinderzeile.
const alleKinder = gruppen.flatMap((g) => g.unteragenten ?? []).map((z) => String(z.id));
const mitgliedAlsKind = alleKinder.some((id) => endet(id, K.exp1) || endet(id, K.exp2));
zeile(5, !mitgliedAlsKind && alleKinder.some((id) => endet(id, K.eigen)),
  "MESSUNG",
  `Teammitglieder als Kinderzeile: ${mitgliedAlsKind}; eigenesLeadKind in eigener Gruppe: ${alleKinder.some((id) => endet(id, K.eigen))}`);

// Nr. 6: die Gruppen tragen echten Inhalt: beide Mitglieder-Gruppen sind da, die eigene Gruppe trägt das
// Leadkind, und mindestens eine Gruppe trägt ein Kind. Leere Gruppen allein beweisen nichts.
const gruppenMitInhalt = gruppen.filter((g) => (g.unteragenten ?? []).some((z) => !z.marke));
const leadkindInEigener = (eigene?.unteragenten ?? []).some((z) => endet(z.id, K.eigen));
zeile(6, mitglied.length === 2 && eigene !== undefined && gruppenMitInhalt.length >= 1 && leadkindInEigener,
  "MESSUNG (Gegenprobe Node-Test 9)",
  `Mitglieder-Gruppen ${mitglied.length}; Gruppen mit Kindern ${gruppenMitInhalt.length}; Leadkind in eigener Gruppe: ${leadkindInEigener}. Der Vergleich mit dem Git-Stand steht im Node-Test.`);

// Nr. 7: Berichtsweg für abgebaute Kinder; lebende Variante ist nur in der Lebend-Messung.
zeile(7, fachA?.bericht === true,
  "MESSUNG (nur abgebaut)",
  `fachA bericht=${fachA?.bericht}; lebende Variante ungemessen (siehe Messblatt)`);

// Nr. 8: Aktivierung bei Abgebauten „unbekannt“, Phase vorhanden.
zeile(8, fachA?.aktivierung === "unbekannt (sitzt nicht in der Datei)" && fachA?.zustand === "abgebaut",
  "MESSUNG",
  `fachA aktivierung=${JSON.stringify(fachA?.aktivierung)} zustand=${fachA?.zustand}`);

// Nr. 9: angehaltenSeit = Zeitstempel des eigenen Eintrags (Datei aus dem Lauf, nicht fest).
const uebern = ergebnis.uebernahmen ?? [];
const eintragExp1 = uebern.find((e) => endet(e.id, K.exp1));
const eintragFachB = uebern.find((e) => endet(e.id, K.fachB));
zeile(9, eintragExp1 !== undefined && exp1Mitglied?.angehaltenSeit === eintragExp1.seit && eintragFachB !== undefined && fachB?.angehaltenSeit === eintragFachB.seit && eigenesKind?.angehaltenSeit === null,
  "MESSUNG",
  `exp1 angehaltenSeit=${exp1Mitglied?.angehaltenSeit} gleich Eintrag=${eintragExp1?.seit}; fachB=${fachB?.angehaltenSeit} gleich Eintrag=${eintragFachB?.seit}; eigenes Kind ohne Eintrag=${eigenesKind?.angehaltenSeit}`);

// Lebend-Messung (Abnahme 7 und 4, eingeschraenkt), nur wenn die Datei vorliegt.
if (lebend) {
  zeile("7-lebend", lebend.lesung?.kindLebtVorLesung === true,
    "MESSUNG (Registry, nicht Werkzeug)",
    `kindLebtVorLesung=${lebend.lesung?.kindLebtVorLesung} status=${lebend.lesung?.kindStatus} zielPhase=${lebend.lesung?.zielPhase}`);
}

for (const z of zeilen) console.log(`${z.nr}: ${z.status} [${z.etikett}] — ${z.detail}`);
const ausgabe = join(dirname(eingabe), `abnahme_auswertung_${eingabe.replace(/^.*\//, "").replace(/\.json$/, "")}.json`);
writeFileSync(ausgabe, JSON.stringify(zeilen, null, 2));
console.log("geschrieben:", ausgabe);
