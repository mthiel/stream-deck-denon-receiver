import streamDeck, { action } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").WillAppearEvent} WillAppearEvent */
/** @typedef {import("@elgato/streamdeck").SendToPluginEvent} SendToPluginEvent */
/** @typedef {import("@elgato/streamdeck").DialRotateEvent} DialRotateEvent */
/** @typedef {import("@elgato/streamdeck").DialDownEvent} DialDownEvent */

import { PluginAction } from "./action";

import { DenonAVR } from "../modules/denonavr";

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
	 * Adjust the volume when the dial is rotated.
	 * @param {DialRotateEvent} ev - The event object.
	 */
	onDialRotate(ev) {
		this.getReceiverForAction(ev.action)
		.then((receiver) => {
			if (!(receiver && receiver.changeVolume(ev.payload.ticks))) {
				ev.action.showAlert();
			}
		});
	}

	/**
	 * Toggle mute when the dial is pressed
	 * @param {DialDownEvent} ev - The event object.
	 */
	onDialDown(ev) {
		this.getReceiverForAction(ev.action)
		.then((receiver) => {
			if (!(receiver && receiver.toggleMute())) {
				ev.action.showAlert();
			}
		});
	}

	onKeyDown(ev) {
		this.getReceiverForAction(ev.action)
		.then((receiver) => {
			if (!(receiver && receiver.changeVolumeAbsolute(ev.payload.settings.volumeLevel))) {
				ev.action.showAlert();
			}
		});
	}

	/**
	 * Handle a receiver volume changing.
	 * @param {DenonAVR} receiver - The receiver object.
	 */
	onReceiverVolumeChanged(receiver) {
		PluginAction.visibleActions
			.filter((visibleAction) => visibleAction.host === receiver.host)
			.forEach((visibleAction) => {
				const action = streamDeck.actions.getActionById(visibleAction.id);
				if (action?.isDial()) {
					action.setFeedback({
						indicator: {
							value: (receiver.volume / receiver.maxVolume) * 100
						},
						value: `Vol: ${receiver.volume}`
					});
				}
			});

	}

	/**
	 * Handle a receiver mute changing.
	 * @param {DenonAVR} receiver - The receiver object.
	 */
	onReceiverMuteChanged(receiver) {
		PluginAction.visibleActions
			.filter((visibleAction) => visibleAction.host === receiver.host)
			.forEach((visibleAction) => {
				const action = streamDeck.actions.getActionById(visibleAction.id);
				if (action?.isDial()) {
					if (receiver.muted) {
						action.setFeedback({
							value: "Muted",
							indicator: {
								value: 0
							}
						});
						action.setFeedback({
							icon: images.muted
						});
					} else {
						action.setFeedback({
							indicator: {
								value: (receiver.volume / receiver.maxVolume) * 100
							},
							value: `Vol: ${receiver.volume}`
						});
						action.setFeedback({
							icon: images.unmuted
						});
					}
				}
			});
	}
}

export { VolumeAction };
