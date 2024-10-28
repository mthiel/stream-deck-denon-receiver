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
		const connection = this.avrConnections[this.actionReceiverMap[ev.action.id]];
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
		const connection = this.avrConnections[this.actionReceiverMap[ev.action.id]];
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
		Promise.all(
			ev.actions.map(async (action) => {
				// Filter any non-key actions and zones that don't match the event zone
				if (action.isKey() === false) return;
				const actionZone = (/** @type {ActionSettings} */ (await action.getSettings())).zone || 0;
				if (actionZone !== ev.zone) return;

				action.setState(ev.connection.status.zones[actionZone].power ? 0 : 1);
			})
		);
	}
}

/**
 * Update the state of an action based on the receiver's power status.
 * @param {Action} action - The action object.
 * @param {AVRConnection} connection - The receiver connection object.
 * @param {number} [zone] - The zone that the power status changed for
 */
async function updateActionState(action, connection, zone) {
	const actionZone = (/** @type {ActionSettings} */ (await action.getSettings())).zone || 0;
	if (action.isKey() === false) return;

	if (zone !== undefined && zone === actionZone) {
		action.setState(connection.status.zones[zone].power ? 0 : 1);
	} else {
		action.setState(connection.status.zones[actionZone].power ? 0 : 1);
	}
}
