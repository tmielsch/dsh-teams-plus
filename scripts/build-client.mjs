// Baut die beiden Ausgaben des Pakets: lib/client.js (Browser) und lib/index.js (Host).
//
// Zwei Buendel, zwei Ziele, ein Werkzeug (esbuild). Kein tsdown, kein zweiter Bundler.
//
//   lib/client.js  src/client/entry.tsx, format cjs, platform browser, jsx automatic,
//                  react external (die Seite liefert es ueber das ClientModuleSystem), und
//                  davor der Kopf `window.__ModuleLoader__.load({ id, factory })`. Ohne diesen
//                  Kopf laedt der Browser das Buendel nicht — er ist der Vertrag mit dem
//                  Client-Modullader von DSH.
//
//   lib/index.js   src/host/index.js, format esm, platform node. External sind NUR die
//                  @deepseek-ai-Pakete (die stellt DSH) und node:*-Module (die bringt Node).
//                  Alles andere wird gebuendelt, auch zod und die lokalen .ts-Module aus
//                  src/policy/ — dadurch loest sich `import ... from '../policy/store.ts'` beim
//                  Bauen auf, statt dass jemand Dateien kopiert und der relative Pfad bricht.
//
// Der Lauf ist idempotent: beide Dateien werden bei jedem Aufruf neu geschrieben.
import * as esbuild from 'esbuild'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const lib = join(root, 'lib')

/** Die Groesse einer geschriebenen Datei in Bytes (nicht Zeichen — Umlaute zaehlen doppelt). */
function stattGroesse(pfad) {
	try {
		return statSync(pfad).size
	} catch {
		return -1
	}
}

/** Esbuild meldet Fehler als Ausnahmen, sobald `write` an ist; hier einheitlich als Text. */
function baue(optionen, was) {
	try {
		return esbuild.buildSync(optionen)
	} catch (error) {
		const meldungen = Array.isArray(error?.errors) && error.errors.length > 0
			? error.errors.map((eintrag) => eintrag.text ?? String(eintrag)).join('\n')
			: error instanceof Error ? error.message : String(error)
		throw new Error(`${was} nicht gebaut:\n${meldungen}`)
	}
}

// --- lib/client.js: das Browser-Buendel mit dem Lader-Kopf --------------------------------

const client = baue({
	entryPoints: [join(root, 'src/client/entry.tsx')],
	bundle: true,
	write: false,
	format: 'cjs',
	platform: 'browser',
	target: 'es2020',
	jsx: 'automatic',
	// react bleibt external: die Seite reicht es ueber das ClientModuleSystem herein.
	external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
	logLevel: 'silent',
}, 'lib/client.js')

const body = client.outputFiles[0].text
// Byte-gleich der Kopf, den projectOS benutzt: daran erkennt der Client-Modullader das Buendel.
const bundle = `window.__ModuleLoader__.load({
	id: ${JSON.stringify(pkg.name)},
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${body}
		return module.exports;
	}
});
`

mkdirSync(lib, { recursive: true })
writeFileSync(join(lib, 'client.js'), bundle)

// --- lib/index.js: der Host-Teil, gebuendelt ---------------------------------------------

baue({
	entryPoints: [join(root, 'src/host/index.js')],
	outfile: join(lib, 'index.js'),
	bundle: true,
	write: true,
	format: 'esm',
	platform: 'node',
	target: 'es2022',
	// Nur was die Installation beziehungsweise Node selbst bereitstellt, bleibt external.
	external: ['@deepseek-ai/*', 'node:*'],
	logLevel: 'silent',
}, 'lib/index.js')

const groessen = [
	['lib/client.js', stattGroesse(join(root, 'lib/client.js'))],
	['lib/index.js', stattGroesse(join(lib, 'index.js'))],
]
console.log(`gebaut: ${groessen.map(([name, bytes]) => `${name} (${bytes} Bytes)`).join(', ')}`)
