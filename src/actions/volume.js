import streamDeck, { action } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").Action} Action */
/** @typedef {import("@elgato/streamdeck").WillAppearEvent} WillAppearEvent */
/** @typedef {import("@elgato/streamdeck").SendToPluginEvent} SendToPluginEvent */
/** @typedef {import("@elgato/streamdeck").DialRotateEvent} DialRotateEvent */
/** @typedef {import("@elgato/streamdeck").DialDownEvent} DialDownEvent */
/** @typedef {import("@elgato/streamdeck").KeyDownEvent} KeyDownEvent */
/** @typedef {import("@elgato/streamdeck").TouchTapEvent} TouchTapEvent */

import { PluginAction } from "./action";
/** @typedef {import("./action").ActionSettings} ActionSettings */

/** @typedef {import("../modules/connection").AVRConnection} AVRConnection */
/** @typedef {import("../modules/connection").ReceiverEvent} ReceiverEvent */

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
	 * Handle the will appear event.
	 * @param {WillAppearEvent} ev - The event object.
	 */
	async onWillAppear(ev) {
		await super.onWillAppear(ev);

		// If there's no connection yet, there's nothing to do
		const connection = this.avrConnections[this.actionReceiverMap[ev.action.id]?.uuid];
		if (!connection) return;

		// Set the initial state of the action based on the receiver's volume & mute status
		updateActionState(ev.action, connection);
	}

	/**
	 * Adjust the volume when the dial is rotated.
	 * @param {DialRotateEvent} ev - The event object.
	 */
	onDialRotate(ev) {
		/** @type {ActionSettings} */
		const settings = ev.payload.settings;

		this.avrConnections[this.actionReceiverMap[ev.action.id].uuid]?.changeVolume(ev.payload.ticks, settings.zone) || ev.action.showAlert();
	}

	/**
	 * Toggle mute when the dial is pressed.
	 * @param {DialDownEvent} ev - The event object.
	 */
	onDialDown(ev) {
		/** @type {ActionSettings} */
		const settings = ev.payload.settings;

		this.avrConnections[this.actionReceiverMap[ev.action.id].uuid]?.setMute(undefined, settings.zone) || ev.action.showAlert();
	}

	/**
	 * Toggle mute when the touch screen is tapped.
	 * @param {TouchTapEvent} ev - The event object.
	 */
	onTouchTap(ev) {
		/** @type {ActionSettings} */
		const settings = ev.payload.settings;

		this.avrConnections[this.actionReceiverMap[ev.action.id].uuid]?.setMute(undefined, settings.zone) || ev.action.showAlert();
	}

	/**
	 * Change the volume when the key is pressed.
	 * @param {KeyDownEvent} ev - The event object.
	 */
	onKeyDown(ev) {
		const connection = this.avrConnections[this.actionReceiverMap[ev.action.id].uuid];
		if (!connection) {
			ev.action.showAlert();
			return;
		}

		/** @type {ActionSettings} */
		const settings = ev.payload.settings;

		// Default to "toggleMute" if no volume action is set
		const volumeAction = settings.volumeAction || "toggleMute";

		switch (volumeAction) {
			case "set":
				if (settings.volumeLevel !== undefined && settings.volumeLevel > 0) {
					connection.changeVolumeAbsolute(settings.volumeLevel, settings.zone) || ev.action.showAlert();
				} else {
					ev.action.showAlert();
				}
				break;
			case "toggleMute":
				connection.setMute(undefined, settings.zone) || ev.action.showAlert();
				break;
			case "mute":
				connection.setMute(true, settings.zone) || ev.action.showAlert();
				break;
			case "unmute":
				connection.setMute(false, settings.zone) || ev.action.showAlert();
				break;
		}
	}

	/**
	 * Handle a user choosing a receiver from the PI.
	 * @param {SendToPluginEvent} ev - The event object.
	 */
	async onUserChoseReceiver(ev) {
		await super.onUserChoseReceiver(ev);

		// Update the action state for the new receiver
		updateActionState(ev.action, this.avrConnections[this.actionReceiverMap[ev.action.id].uuid]);
	}

	/**
	 * Handle a receiver volume changing.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	onReceiverVolumeChanged(ev) {
		Promise.all(ev.actions.map((action) => updateActionState(action, ev.connection, ev.zone)));
	}

	/**
	 * Handle a receiver mute status changing.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	onReceiverMuteChanged(ev) {
		Promise.all(ev.actions.map((action) => updateActionState(action, ev.connection, ev.zone)));
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
 * Update the state of an action based on the receiver's volume & mute status.
 * @param {Action} action - The action object.
 * @param {AVRConnection} connection - The receiver connection object.
 * @param {number} [zone] - The zone that the volume status changed for
 */
async function updateActionState(action, connection, zone) {
	const actionZone = (/** @type {ActionSettings} */ (await action.getSettings())).zone || 0;
	if (zone !== undefined && zone !== actionZone) { return; }

	const { muted, volume, maxVolume, power } = connection.status.zones[actionZone];

	if (action.isDial()) {
		action.setFeedback({
			indicator: {
				value: muted || !power ? 0 : (volume / maxVolume) * 100
			},
			value: !power ? "Off" :
				muted ? "Muted" : `Vol: ${volume}`
		});

		action.setFeedback({
			icon: muted || !power ? images.muted : images.unmuted
		});
	} else if (action.isKey()) {
		action.setState(muted || !power ? 1 : 0);
	}
}
