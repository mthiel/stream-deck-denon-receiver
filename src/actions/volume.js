import streamDeck, { action, KeyDownEvent, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";

export let logger = streamDeck.logger;

action({ UUID: "com.matthew-thiel.denon-receiver-network-control.avrvolume" })(AVRVolume);

/**
 * The AVRVolume action class.
 */
export class VolumeAction extends SingletonAction {
	onWillAppear(ev) {
		return ev.action.setTitle(`${ev.payload.settings.count ?? 0}`);
	}

	async onKeyDown(ev) {
		// Update the count from the settings.
		const { settings } = ev.payload;
		settings.incrementBy ??= 1;
		settings.count = (settings.count ?? 0) + settings.incrementBy;

		// Update the current count in the action's settings, and change the title.
		await ev.action.setSettings(settings);
		await ev.action.setTitle(`${settings.count}`);
	}

	onWillDisappear(ev) {
		return ev.action.setTitle("");
	}
}
