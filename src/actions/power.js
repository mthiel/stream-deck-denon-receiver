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
	 * Toggle the power state when the key is pressed
	 * @param {KeyDownEvent} ev - The event object.
	 */
	onKeyDown(ev) {
		const connection = this.avrConnections[this.actionReceiverMap[ev.action.id]];
		if (!connection) return;

		ev.action.getSettings()
		.then((settings) => {
			const zone = parseInt("" + settings.zone) || 0;

			switch (settings.powerAction) {
				case "toggle":
					connection.setPower(undefined, zone) || ev.action.showAlert();
					break;
				case "on":
					connection.setPower(true, zone) || ev.action.showAlert();
					break;
				case "off":
					connection.setPower(false, zone) || ev.action.showAlert();
					break;
			}
		});
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
