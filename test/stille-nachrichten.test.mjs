/**
 * stille-nachrichten.test.mjs — der Fehler vom 2026-11-04 kommt nicht zurueck.
 *
 * Im Betrieb gemessen:
 *
 *   tool "send_message" returned invalid output:
 *   "value.note" is not a declared property (additionalProperties: false)
 *
 * Ursache: `erweitereDefinition` haengte an das Ergebnis ein Feld `note`. Das
 * Ausgabeschema von `send_message` hat `additionalProperties: false` und kennt
 * genau EIN Feld, `messageId`. Der Kern verwarf daraufhin das GANZE Ergebnis;
 * die Nachricht galt als nicht zugestellt, obwohl sie zugestellt wurde.
 *
 * Warum dieser Test einen ECHTEN Kern-Validator benutzt: Eine Nachbildung waere
 * eine Behauptung. Genau das war der Fehler — niemand hat das Ergebnis je gegen
 * das Schema geprueft. Ohne den Kern faellt der Test LAUT aus, nicht still.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const MODUL = join(HIER, "..", "patches", "stille-nachrichten.mjs");

// Den echten Kern-Validator aufloesen — er wohnt nur in der Installation.
const basis = [
	"/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai",
	join(homedir(), ".npm-global", "lib", "node_modules", "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai"),
	"/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"
].find((pfad) => existsSync(join(pfad, "dsh-tools", "lib", "index.js")));

if (basis === undefined) {
	throw new Error("der Kern-Validator @deepseek-ai/dsh-tools ist nicht auffindbar; ohne ihn prueft dieser Test eine Nachbildung — das soll LAUT scheitern, nicht still");
}

const { validateJsonSchemaValue } = await import(join(basis, "dsh-tools", "lib", "index.js"));
const { erweitereDefinition } = await import(MODUL);

/** Das Ausgabeschema von `send_message`, woertlich aus dem Kern. */
const AUSGABE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: { messageId: { type: "string" } },
	required: ["messageId"]
};

/** Eine Definition mit der Form des Team-Werkzeugs, samt Ausgabeschema und render. */
function nachbau() {
	return {
		name: "send_message",
		description: "Send one durable message to another Team member.",
		parameters: {
			type: "object",
			properties: {
				target: { type: "string", description: "Member target" },
				message: { type: "string", description: "The message." }
			},
			required: ["target", "message"],
			additionalProperties: false
		},
		output: {
			schema: AUSGABE_SCHEMA,
			render: (_args, wert) => [{ type: "text", text: `delivered ${wert.messageId}` }]
		},
		execute: async () => ({ messageId: "team-1" })
	};
}

test("das Ergebnis einer stillen Nachricht erfuellt das echte Ausgabeschema", async () => {
	const definition = nachbau();
	erweitereDefinition(definition, {
		protokoll: () => {},
		teams: () => ({
			membership: () => ({ name: "lead" }),
			sendMessage: async () => ({ messageId: "m2" })
		})
	});

	const ergebnis = await definition.execute(
		{ target: "experte", message: "hallo unter vier Augen", quiet: true },
		{ agent: { id: "s" } }
	);

	const verstoesse = validateJsonSchemaValue(AUSGABE_SCHEMA, ergebnis, "value");
	assert.deepEqual(verstoesse, [], `das Ergebnis muss schemakonform sein, sonst verwirft der Kern es: ${verstoesse.join("; ")}`);
	assert.equal(Object.hasOwn(ergebnis, "note"), false, "das Ergebnis darf kein Feld tragen, das das Schema nicht kennt");
});

test("der Hinweis an den Absender steht im gerenderten Text, nicht im Ergebnis", async () => {
	const definition = nachbau();
	erweitereDefinition(definition, {
		protokoll: () => {},
		teams: () => ({
			membership: () => ({ name: "lead" }),
			sendMessage: async () => ({ messageId: "m2" })
		})
	});

	const ergebnis = await definition.execute(
		{ target: "experte", message: "hallo", quiet: true },
		{ agent: { id: "s" } }
	);
	const teile = definition.output.render({ target: "experte" }, ergebnis);
	const text = teile.map((teil) => teil.text ?? "").join(" ");

	assert.match(text, /Lead/u, "der Absender muss im Text erfahren, dass er nicht an den Lead weiterleiten soll");
	// Und der Text ist weiterhin gueltige Ausgabe — render ist kein Schemafeld.
	assert.ok(text.length > 0);
});

test("GEGENPROBE: ein Ergebnis mit `note` wird vom echten Validator abgewiesen", () => {
	// Ohne diesen Fall waere der Test oben auch dann gruen, wenn das Schema
	// `note` erlauben wuerde — dann bewiese er nichts.
	const verstoesse = validateJsonSchemaValue(AUSGABE_SCHEMA, { messageId: "m", note: "egal" }, "value");
	assert.ok(verstoesse.length > 0, "mit einem fremden Feld muss der Validator anschlagen");
	assert.ok(
		verstoesse.some((v) => v.includes("value.note") && v.includes("not a declared property")),
		`die Meldung muss der aus dem Betrieb entsprechen, war: ${verstoesse.join("; ")}`
	);
});

test("GEGENPROBE: ein Ergebnis ohne messageId wird ebenfalls abgewiesen", () => {
	const verstoesse = validateJsonSchemaValue(AUSGABE_SCHEMA, {}, "value");
	assert.ok(verstoesse.length > 0, "ein leeres Ergebnis muss abgelehnt werden");
});

test("auch der Weg ueber agent_id liefert ein schemakonformes Ergebnis", async () => {
	// Der andere Zweig der Erweiterung — er hatte denselben Fehler.
	const definition = nachbau();
	definition.parameters.properties.agent_id = { type: "string" };
	erweitereDefinition(definition, {
		protokoll: () => {},
		teams: () => ({ sendMessage: async () => ({}) }),
		sessions: () => ({ get: (id) => (id === "kind1" ? { displayTitle: "Der Experte" } : undefined) })
	});

	const ergebnis = await definition.execute(
		{ agent_id: "kind1", message: "Nur unter uns.", quiet: true },
		{ agent: { id: "s" } }
	);
	const verstoesse = validateJsonSchemaValue(AUSGABE_SCHEMA, ergebnis, "value");
	assert.deepEqual(verstoesse, [], `der agent_id-Weg muss dasselbe leisten: ${verstoesse.join("; ")}`);

	const teile = definition.output.render({ agent_id: "kind1" }, ergebnis);
	const text = teile.map((teil) => teil.text ?? "").join(" ");
	assert.match(text, /kind1/u, "der Hinweis nennt die Kind-Sitzung — im Text");
});

/* -----------------------------------------------------------------------------
 * Der Hinweis ist pro DEFINITION geteilt, nicht pro Aufruf (`letzterHinweis` im
 * Patch). Im Betrieb gemessen am 2026-11-05: ein normaler Aufruf OHNE quiet-Feld
 * gab die Hinweiszeile eines FRUEHEREN quiet-Aufrufs in derselben Definition
 * zurueck — „quiet: die Nachricht ging nur an \"toolchain-audit\"", waehrend der
 * target exakt „workflow-expert" war; und mit ausdruecklich `quiet: false`
 * geschrieben, dieselbe Zeile. Die Zustellung landete am richtigen Ziel, die
 * Anzeige nannte einen fremden Namen, und auch der Empfinger sah die falsche
 * Adresse (seine eigene stille Zustellung stand in der geteilten Variable).
 * Diese Tests lassen den Fehler nicht zurueck: ein normaler Aufruf rendert nur,
 * was ihm gehoert.
 * --------------------------------------------------------------------------- */

/** Zwei Aufrufe an EINER Definition: erst still an `experte`, dann ein normaler
 *  an `auditor`. Jede Anzeige wird direkt nach IHRER Zustellung gerendert — der
 *  Hinweis ist pro Definition geteilt, ein spaeteres Rendern rueckt an der
 *  Vergangenheit, genau das ist der Defekt. Der Team-Dienst protokolliert seinen
 *  Aufruf, damit die Zustellung gemessen wird und nicht nur die Anzeige. */
async function zweiAufrufe(definition, zweiter) {
	const zustaellungen = [];
	erweitereDefinition(definition, {
		protokoll: () => {},
		teams: () => ({
			membership: () => ({ name: "lead" }),
			sendMessage: async (_sender, optionen) => {
				zustaellungen.push(optionen.target);
				return { messageId: `m-${zustaellungen.length}` };
			}
		})
	});

	const stille = await definition.execute(
		{ target: "experte", message: "hallo unter vier Augen", quiet: true },
		{ agent: { id: "s" } }
	);
	const stilleText = definition.output
		.render({ target: "experte" }, stille)
		.map((teil) => teil.text ?? "")
		.join(" ");

	const normale = await definition.execute(zweiter, { agent: { id: "s" } });
	const normaleText = definition.output
		.render(zweiter, normale)
		.map((teil) => teil.text ?? "")
		.join(" ");

	return { stilleText, normaleText, zustaellungen };
}

test("ein normaler Aufruf nach einer stillen rendert den fremden Hinweis NICHT", async () => {
	const definition = nachbau();
	const zweiter = { target: "auditor", message: "ganz normal, ohne quiet" };
	const { normaleText, zustaellungen } = await zweiAufrufe(definition, zweiter);

	assert.deepEqual(zustaellungen, ["experte"], "die stille Zustellung geht an ihren eigenen target; ein normaler Aufruf laeuft durch die Grund-execute und nicht durch den Team-Dienst");
	assert.ok(!/quiet/u.test(normaleText), `ein normaler Aufruf darf keinen fremden Hinweis rendiern: ${normaleText}`);
	assert.ok(!/experte/u.test(normaleText), "der Empfinger des frueheren stillen Aufrufs darf nicht in dieser Anzeige stehen");
	assert.match(normaleText, /delivered/u, "Positivkontrolle: die Grundanzeige selbst bleibt stehen");
});

test("POSITIVKONTROLLE: der stille Aufruf rendert seinen eigenen Hinweis weiter", async () => {
	const definition = nachbau();
	const { stilleText } = await zweiAufrufe(definition, { target: "auditor", message: "ganz normal" });

	assert.match(stilleText, /quiet/u, "der stille Aufruf muss seinen eigenen Hinweis zeigen — sonst beweist der erste Test nur das Loeschen");
	assert.match(stilleText, /experte/u, "und er nennt seinen eigenen Empfinger");
});

test("ein Aufruf mit quiet:false nach einer stillen rendert den fremden Hinweis NICHT", async () => {
	const definition = nachbau();
	const zweiter = { target: "auditor", message: "quiet explizit false", quiet: false };
	const { normaleText, stilleText } = await zweiAufrufe(definition, zweiter);

	assert.ok(!/quiet:/u.test(normaleText), `bei quiet:false darf kein Hinweis stehen, der von einem frueheren Aufruf stammt: ${normaleText}`);
	assert.match(normaleText, /delivered/u, "Positivkontrolle: die Grundanzeige bleibt stehen");
	assert.match(stilleText, /quiet:/u, "Gegenprobe: dieselbe Definition zeigt dem stillen Aufruf seinen Hinweis — das Loeschen gilt allein dem normalen Aufruf");
});
