import streamDeck, { action } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").KeyDownEvent} KeyDownEvent */

import { PluginAction } from "./action";
/** @typedef {import("./action").VisibleAction} VisibleAction */

/** @typedef {import("../modules/denonavr").DenonAVR} DenonAVR */

/**
 * The Power action class.
 * @extends {PluginAction}
 */
@action({ UUID: "com.mthiel.denon-controller.power" })
export class PowerAction extends PluginAction {
	/**
	 * Toggle the power state when the key is pressed
	 * @param {KeyDownEvent} ev - The event object.
	 */
	onKeyDown(ev) {
		// TODO: Make options for explicit on/off vs. toggle
		this.getConnectionForAction(ev.action)
			.then((connection) => {
				connection?.togglePower() || ev.action.showAlert();
			});
	}

	/**
	 * Handle a receiver power changing.
	 * @override
	 * @param {DenonAVR} connection - The receiver connection.
	 */
	onReceiverPowerChanged(connection) {
		this.connectedReceivers
		.filter((receiver) => receiver.connection === connection)
		.forEach((receiver) => {
			this.visibleActions
			.filter((visibleAction) => visibleAction.uuid === receiver.uuid)
			.forEach((visibleAction) => {
				const action = streamDeck.actions.getActionById(visibleAction.id);
				action?.isKey() && action.setState(connection.power ? 0 : 1);
			});
		});
	}
}