import streamDeck, { action } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").Action} Action */
/** @typedef {import("@elgato/streamdeck").KeyDownEvent} KeyDownEvent */
/** @typedef {import("@elgato/streamdeck").WillAppearEvent} WillAppearEvent */

import { PluginAction } from "./action";
/** @typedef {import("./action").ActionSettings} ActionSettings */

/** @typedef {import("../modules/connection").AVRConnection} AVRConnection */
/** @typedef {import("../modules/connection").ReceiverEvent} ReceiverEvent */

/**
 * The Power action class.
 * @extends {PluginAction}
 */
@action({ UUID: "com.mthiel.denon-controller.power" })
export class PowerAction extends PluginAction {
	/**
	 * Handle the action appearing on the Stream Deck.
	 * @param {WillAppearEvent} ev - The event object.
	 */
	async onWillAppear(ev) {
		await super.onWillAppear(ev);

		// If there's no connection yet, there's nothing to do
		const connection = this.avrConnections[this.actionReceiverMap[ev.action.id]?.uuid];
		if (!connection) return;

		// Set the initial state of the action based on the receiver's power status
		if (ev.action.isKey()) {
			const zone = /** @type {number} */ (ev.payload.settings.zone) || 0;
			ev.action.setState(connection.status.zones[zone].power ? 0 : 1);
		}
	}

	/**
	 * Perform the configured power action when the key is pressed.
	 * @param {KeyDownEvent} ev - The event object.
	 */
	onKeyDown(ev) {
		const connection = this.avrConnections[this.actionReceiverMap[ev.action.id].uuid];
		if (!connection) return;

		const settings = ev.payload.settings;
		const zone = /** @type {number} */ (settings.zone) || 0;
		const powerAction = settings.powerAction || "toggle";

		const actionMap = {
			toggle: undefined,
			on: true,
			off: false,
		};

		connection.setPower(actionMap[powerAction], zone) || ev.action.showAlert();
	}

	/**
	 * Handle a receiver power status changing, update actions accordingly.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	onReceiverPowerChanged(ev) {
		if (!ev.actions) return;

		Promise.all(
			ev.actions.map(async (action) => {
				// Filter any non-key actions that don't match the event zone
				if (action.isKey() === false) return;

				action.setState(ev.connection.status.zones[ev.zone || 0].power ? 0 : 1);
			})
		);
	}
}