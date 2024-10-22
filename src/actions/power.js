import { action } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").KeyDownEvent} KeyDownEvent */

import { PluginAction } from "./action";

/** @typedef {import("@elgato/streamdeck").Action} Action */
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
		// TODO: Make options for explicit on/off vs. toggle

		this.avrConnections[this.actionReceiverMap[ev.action.id]]?.togglePower() || ev.action.showAlert();
	}

	/**
	 * Handle a receiver power status changing, update actions accordingly.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	onReceiverPowerChanged(ev) {
		ev.actions.forEach((action) => {
			updateActionState(action, ev.connection);
		});
	}
}

/**
 * Update the state of an action based on the receiver's power status.
 * @param {Action} action - The action object.
 * @param {AVRConnection} connection - The receiver connection object.
 */
function updateActionState(action, connection) {
	if (action.isKey()) {
		action.setState(connection.power ? 0 : 1);
	}
}
