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
class PowerAction extends PluginAction {
	/**
	 * Toggle the power state when the key is pressed
	 * @param {KeyDownEvent} ev - The event object.
	 */
	onKeyDown(ev) {
		// TODO: Make options for explicit on/off vs. toggle
		this.getReceiverForAction(ev.action)
		.then((receiver) => {
			if (!receiver) {
				ev.action.showAlert();
				return;
			}

			if (!receiver?.togglePower()) {
				ev.action.showAlert();
				}
			});
	}

	/**
	 * Handle a receiver power changing.
	 * @override
	 * @param {DenonAVR} receiver - The receiver object.
	 */
	onReceiverPowerChanged(receiver) {
		PluginAction.visibleActions
			.filter((visibleAction) => visibleAction.host === receiver.host)
			.forEach((visibleAction) => {
				const action = streamDeck.actions.getActionById(visibleAction.id);
				if (action?.isKey()) {
					action.setState(receiver.power ? 0 : 1);
				}
			});
	}
}

export { PowerAction };