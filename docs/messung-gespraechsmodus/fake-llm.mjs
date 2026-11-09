/**
 * Wegwerf-Probe (kein Teil des Plugins, nichts davon wird eingebaut):
 * ein Attrappen-Modell für die Probe-Instanz von DSH. Es antwortet immer mit einem
 * kurzen Text ("ACK n") und kostet nichts. Zwei Auslöser im letzten Nutzertext:
 *   [[FAIL]]   der Aufruf wirft einen Fehler (simulierter Anbieterfehler 402)
 *   [[SLOW]]   die Antwort kommt nach 400 ms
 * Stand: 2026-11-09, Messung M1-M3 für das Konzept Gesprächsmodus.
 */
import { LlmAdapter } from "@deepseek-ai/dsh-llm";

import { appendFileSync } from "node:fs";
export const name = "probe-fake-llm";
export const inject = ["llm"];

let zaehler = 0;
export const aufrufe = [];

function letzterText(messages) {
	// jüngste Nutzernachricht, die einen Marker [[...]] trägt (System-Hinweise stehen oft zuletzt)
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "user") continue;
		const teile = Array.isArray(m.content) ? m.content : [];
		const text = teile.filter((t) => t.type === "text").map((t) => t.text).join("\n");
		if (text.includes("[[")) return text;
	}
	return "";
}

class Attrappe extends LlmAdapter {
	providerInfo(provider) { return { id: provider, name: "Probe-Attrappe" }; }
	async listModels(provider) { return [{ provider, id: "m", name: "m" }]; }
	async resolveModel(provider, model) {
		return { provider, id: model, name: model, inputModalities: ["text"], context: { contextWindow: 100000 } };
	}
	async *stream(options) {
		const text = letzterText(options.messages);
		appendFileSync("/tmp/teams_plus_umbau/probe/llm-aufrufe.log", JSON.stringify({zeit:Date.now(), sitzung:String(options.sessionId??""), text:text.slice(0,50)})+"\n");
		aufrufe.push({ sitzung: String(options.sessionId ?? ""), zeit: Date.now(), vorschau: text.slice(0, 60) });
		if (text.includes("[[LONG]]")) await new Promise((r) => setTimeout(r, 3000));
		if (text.includes("[[SLOW]]")) await new Promise((r) => setTimeout(r, 400));
		if (text.includes("[[FAIL]]")) {
			const fehler = new Error("Insufficient Balance (simulierter Anbieterfehler 402)");
			fehler.code = "QUOTA";
			throw fehler;
		}
		const letzte = options.messages[options.messages.length - 1];
		const treffer = /\[\[TOOL:([a-z_]+):(\{.*?\})\]\]/s.exec(text);
		if (treffer && letzte?.role !== "tool") {
			const aufruf = { type: "tool-call", id: "call-" + Date.now(), name: treffer[1], arguments: treffer[2] };
			yield { type: "block-start", index: 0, blockType: "tool-call" };
			yield { type: "tool-call-delta", index: 0, id: aufruf.id, name: aufruf.name, argumentsDelta: aufruf.arguments };
			yield { type: "block-end", index: 0, block: aufruf };
			yield { type: "usage", usage: { inputTokens: 10, outputTokens: 2 } };
			yield { type: "finish", reason: { kind: "tool-calls" } };
			return;
		}
		zaehler += 1;
		const antwort = `ACK ${zaehler}`;
		yield { type: "block-start", index: 0, blockType: "text" };
		yield { type: "text-delta", index: 0, text: antwort };
		yield { type: "block-end", index: 0, block: { type: "text", text: antwort } };
		yield { type: "usage", usage: { inputTokens: 10, outputTokens: 2 } };
		yield { type: "finish", reason: "stop" };
	}
}

export function apply(ctx) {
	ctx.effect(() => ctx.llm.registerAdapter(["probe"], new Attrappe()), "probe-fake-llm");
}
