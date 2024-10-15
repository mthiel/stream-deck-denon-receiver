import streamDeck, { action } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").KeyDownEvent} KeyDownEvent */
/** @typedef {import("@elgato/streamdeck").WillAppearEvent} WillAppearEvent */
/** @typedef {import("@elgato/streamdeck").SendToPluginEvent} SendToPluginEvent */

import { PluginAction } from "./action";
/** @typedef {import('./action').ActionSettings} ActionSettings */

import { DenonAVR } from "../modules/denonavr";
/** @typedef {import("../modules/denonavr").ReceiverEvent} ReceiverEvent */

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
		let receiver = DenonAVR.getByContext(ev.action.id);
		if (!receiver) return;
		receiver.togglePower() || ev.action.showAlert();		
	}

    /**
	 * Create a new receiver connection.
	 * @param {WillAppearEvent | SendToPluginEvent} ev - The event object.
     * @returns {Promise<DenonAVR | undefined>} The newly created receiver object.
	 */
	async createReceiverConnection(ev) {
		let receiver = await super.createReceiverConnection(ev);
		if (!receiver) return;

		receiver.eventEmitter.on("powerChanged", (ev) => this.#onReceiverPowerChanged(ev));
		return receiver;
	}

    /**
	 * Handle a receiver power changing.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	#onReceiverPowerChanged(ev) {
		if (ev.action.manifestId !== this.manifestId) {
			return;
		}

		ev.action.setState(ev.receiver.power ? 0 : 1);
	}
}

export { PowerAction };