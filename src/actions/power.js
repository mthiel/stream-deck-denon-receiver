import streamDeck, { action } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").Action} Action */
/** @typedef {import("@elgato/streamdeck").KeyDownEvent} KeyDownEvent */

import { PluginAction } from "./action";

/** @typedef {import("../modules/connection").AVRConnection} AVRConnection */
/** @typedef {import("../modules/connection").ReceiverEvent} ReceiverEvent */

/**
 * The Power action class.
 * @extends {PluginAction}
 */
@action({ UUID: "com.mthiel.denon-controller.power" })
export class PowerAction extends PluginAction {
	async onWillAppear(ev) {
		await super.onWillAppear(ev);

		// Set the initial state of the action based on the receiver's power status
		const connection = this.avrConnections[this.actionReceiverMap[ev.action.id]];
		if (connection) {
			updateActionState(ev.action, connection);
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
		Promise.all(ev.actions.map((action) => updateActionState(action, ev.connection, ev.zone)));
	}
}

/**
 * Update the state of an action based on the receiver's power status.
 * @param {Action} action - The action object.
 * @param {AVRConnection} connection - The receiver connection object.
 * @param {number} [zone=0] - The zone that the power status changed for
 */
async function updateActionState(action, connection, zone = 0) {
	const actionZone = parseInt("" + (await action.getSettings()).zone) || 0;
	if (action.isKey() && actionZone === zone) {
		action.setState(connection.status.zones[zone].power ? 0 : 1);
	}
}
