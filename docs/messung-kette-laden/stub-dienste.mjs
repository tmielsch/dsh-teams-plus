/**
 * Wegwerf-Attrappe für die Probe "Eltern-Sitzung laden": der Session-Controller des Web-Profils verlangt den Dienst
 * `fileUploads`, den nur das Web-Profil (mit Webserver) liefert. Die Probe hat keinen Webserver und keinen Port;
 * dieser Stummel stellt die vier Methoden, die der Controller aufruft, ohne etwas zu tun.
 */
export const name = "probe-stub-dienste";
export function apply(ctx) {
	ctx.provide("fileUploads", {
		registerAgentResolver: () => () => {},
		resolve: () => undefined,
		bindPrompt: () => ({ [Symbol.dispose]() {} }),
		retirePrompt: () => {}
	});
}
