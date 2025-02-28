import streamDeck, { action } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").Action} Action */
/** @typedef {import("@elgato/streamdeck").KeyDownEvent} KeyDownEvent */
/** @typedef {import("@elgato/streamdeck").WillAppearEvent} WillAppearEvent */

import { PluginAction } from "./action";
/** @typedef {import("./action").ActionSettings} ActionSettings */

/** @typedef {import("../modules/connection").AVRConnection} AVRConnection */
/** @typedef {import("../modules/connection").ReceiverEvent} ReceiverEvent */

/**
 * The Dynamic Volume action class.
 * @extends {PluginAction}
 */
@action({ UUID: "com.mthiel.denon-controller.dynvol" })
export class DynVolAction extends PluginAction {
	/**
	 * Handle the action appearing on the Stream Deck.
	 * @param {WillAppearEvent} ev - The event object.
	 */
	async onWillAppear(ev) {
		await super.onWillAppear(ev);

		// If there's no connection yet, there's nothing to do
		const connection = this.avrConnections[this.actionReceiverMap[ev.action.id]?.uuid];
		if (!connection) return;

		// Set the initial state of the action based on the receiver's dynamic volume status
		if (ev.action.isKey()) {
			const zone = 0;

			// TODO: Add dynamic volume states
			//ev.action.setState(connection.status.zones[zone].dynamicVolume ? 0 : 1);
		}
	}

	/**
	 * Perform the configured dynamic volume action when the key is pressed.
	 * @param {KeyDownEvent} ev - The event object.
	 */
	onKeyDown(ev) {
		const connection = this.avrConnections[this.actionReceiverMap[ev.action.id].uuid];
		if (!connection) return;

		const settings = ev.payload.settings;
		const dynVolAction = settings.dynVolAction;

		const actionMap = {
			hev: "HEV",
			med: "MED",
			lit: "LIT",
			off: "OFF"
		};

		connection.setDynamicVolume(actionMap[dynVolAction]) || ev.action.showAlert();
	}

	/**
	 * Handle a receiver dynamic volume status changing, update actions accordingly.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	onReceiverDynamicVolumeChanged(ev) {
		if (!ev.actions) return;

		Promise.all(
			ev.actions.map(async (action) => {
				// Filter any non-key actions
				if (action.isKey() === false) return;

				// TODO: Add dynamic volume states
				// action.setState(ev.connection.status.zones[0].dynamicVolume);
			})
		);
	}
}