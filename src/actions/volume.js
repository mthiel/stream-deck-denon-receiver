import streamDeck, { action } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").WillAppearEvent} WillAppearEvent */
/** @typedef {import("@elgato/streamdeck").SendToPluginEvent} SendToPluginEvent */
/** @typedef {import("@elgato/streamdeck").DialRotateEvent} DialRotateEvent */
/** @typedef {import("@elgato/streamdeck").DialDownEvent} DialDownEvent */

import { PluginAction } from "./action";

import { AVRConnection } from "../modules/connection";

const images = {
	unmuted: "imgs/actions/volume/volume2",
	muted: "imgs/actions/volume/volumeMute"
};

/**
 * The Volume action class.
 * @extends {PluginAction}
 */
@action({ UUID: "com.mthiel.denon-controller.volume" })
export class VolumeAction extends PluginAction {
	/**
	 * Adjust the volume when the dial is rotated.
	 * @param {DialRotateEvent} ev - The event object.
	 */
	onDialRotate(ev) {
		this.getConnectionForAction(ev.action)
		.then((connection) => {
			connection?.changeVolume(ev.payload.ticks) || ev.action.showAlert();
		});
	}

	/**
	 * Toggle mute when the dial is pressed
	 * @param {DialDownEvent} ev - The event object.
	 */
	onDialDown(ev) {
		this.getConnectionForAction(ev.action)
		.then((connection) => {
			connection?.toggleMute() || ev.action.showAlert();
		});
	}

	onKeyDown(ev) {
		this.getConnectionForAction(ev.action)
		.then((connection) => {
			connection?.changeVolumeAbsolute(ev.payload.settings.volumeLevel) || ev.action.showAlert();
		});
	}

	/**
	 * Handle a receiver volume changing.
	 * @param {AVRConnection} connection - The receiver connection.
	 */
	onReceiverVolumeChanged(connection) {
		this.connectedReceivers
		.filter((receiver) => receiver.connection === connection)
		.forEach((receiver) => {
			this.visibleActions
			.filter((visibleAction) => visibleAction.uuid === receiver.uuid)
			.forEach((visibleAction) => {
				const action = streamDeck.actions.getActionById(visibleAction.id);
				action?.isDial() && action.setFeedback({
					indicator: {
						value: (connection.volume / connection.maxVolume) * 100
					},
					value: `Vol: ${connection.volume}`
				});
			});
		});
	}

	/**
	 * Handle a receiver mute changing.
	 * @param {AVRConnection} connection - The receiver connection.
	 */
	onReceiverMuteChanged(connection) {
		this.connectedReceivers
		.filter((receiver) => receiver.connection === connection)
		.forEach((receiver) => {
			this.visibleActions
			.filter((visibleAction) => visibleAction.uuid === receiver.uuid)
			.forEach((visibleAction) => {
				const action = streamDeck.actions.getActionById(visibleAction.id);
				const { muted, volume, maxVolume } = connection;
				action?.isDial()
				&& action.setFeedback({
					value: muted ? "Muted" : `Vol: ${volume}`,
					indicator: {
						value: muted ? 0 : (volume / maxVolume) * 100
					}
				})
				.then(() => {
					action.setFeedback({
						icon: muted ? images.muted : images.unmuted
					});
				});
			});
		});
	}
}