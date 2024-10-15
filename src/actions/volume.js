import streamDeck, { action } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").DialRotateEvent} DialRotateEvent */
/** @typedef {import("@elgato/streamdeck").DialDownEvent} DialDownEvent */

import { PluginAction } from "./action";
/** @typedef {import('./action').ActionSettings} ActionSettings */

import { DenonAVR } from "../modules/denonavr";
/** @typedef {import("../modules/denonavr").ReceiverEvent} ReceiverEvent */

const images = {
	unmuted: "imgs/actions/volume/volume2",
	muted: "imgs/actions/volume/volumeMute"
};

/**
 * The Volume action class.
 * @extends {PluginAction}
 */
@action({ UUID: "com.mthiel.denon-controller.volume" })
class VolumeAction extends PluginAction {
	/**
	 * Create a new VolumeAction instance.
	 */
	constructor() {
		super();
	}

	/**
	 * Adjust the volume when the dial is rotated.
	 * @param {DialRotateEvent} ev - The event object.
	 */
	onDialRotate(ev) {
		let receiver = DenonAVR.getByContext(ev.action.id);
		if (!receiver) return;
		receiver.changeVolume(ev.payload.ticks) || ev.action.showAlert();
	}

	/**
	 * Toggle mute when the dial is pressed
	 * @param {DialDownEvent} ev - The event object.
	 */
	onDialDown(ev) {
		let receiver = DenonAVR.getByContext(ev.action.id);
		if (!receiver) return;
		receiver.toggleMute() || ev.action.showAlert();
	}

	onKeyDown(ev) {
		let receiver = DenonAVR.getByContext(ev.action.id);
		if (!receiver) return;

		receiver.changeVolumeByValue(ev.payload.settings.volumeLevel) || ev.action.showAlert();
	}

    /**
	 * Create a new receiver connection.
	 * @param {WillAppearEvent | SendToPluginEvent} ev - The event object.
     * @returns {DenonAVR | undefined} The newly createdreceiver object.
	 */
	async createReceiverConnection(ev) {
		let receiver = await super.createReceiverConnection(ev);
		if (!receiver) return;

		receiver.eventEmitter.on("volumeChanged", (ev) => this.#onReceiverVolumeChanged(ev));
		receiver.eventEmitter.on("muteChanged", (ev) => this.#onReceiverMuteChanged(ev));
		return receiver;
	}

	/**
	 * Handle a receiver volume changing.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	#onReceiverVolumeChanged(ev) {
		if (ev.action.manifestId !== this.manifestId) {
			return;
		}

		if (ev.action.controllerType === "Encoder") {
			ev.action.setFeedback({
				indicator: {
					value: (ev.receiver.volume / ev.receiver.maxVolume) * 100
				},
				value: `Vol: ${ev.receiver.volume}`
			});
		}
	}

	/**
	 * Handle a receiver mute changing.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	#onReceiverMuteChanged(ev) {
		if (ev.action.manifestId !== this.manifestId) {
			return;
		}

		if (ev.action.controllerType === "Encoder") {
			if (ev.receiver.muted) {
				ev.action.setFeedback({
					value: "Muted",
					indicator: {
						value: 0
					}
				});
				ev.action.setFeedback({
					icon: images.muted
				});
			} else {
				ev.action.setFeedback({
					icon: images.unmuted
				});
				this.#onReceiverVolumeChanged(ev);
			}
		}
	}
}

export { VolumeAction };
