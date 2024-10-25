import streamDeck, { action } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").Action} Action */
/** @typedef {import("@elgato/streamdeck").WillAppearEvent} WillAppearEvent */
/** @typedef {import("@elgato/streamdeck").SendToPluginEvent} SendToPluginEvent */
/** @typedef {import("@elgato/streamdeck").DialRotateEvent} DialRotateEvent */
/** @typedef {import("@elgato/streamdeck").DialDownEvent} DialDownEvent */
/** @typedef {import("@elgato/streamdeck").KeyDownEvent} KeyDownEvent */

import { PluginAction } from "./action";

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

		// Set the initial state of the action based on the receiver's volume & mute status
		const connection = this.avrConnections[this.actionReceiverMap[ev.action.id]];
		const zone = parseInt("" + ev.payload.settings.zone) || 0;
		if (connection) {
			updateActionState(ev.action, connection, zone);
		}
	}

	/**
	 * Adjust the volume when the dial is rotated.
	 * @param {DialRotateEvent} ev - The event object.
	 */
	onDialRotate(ev) {
		const zone = parseInt("" + ev.payload.settings.zone) || 0;
		this.avrConnections[this.actionReceiverMap[ev.action.id]]?.changeVolume(ev.payload.ticks, zone) || ev.action.showAlert();
	}

	/**
	 * Toggle mute when the dial is pressed
	 * @param {DialDownEvent} ev - The event object.
	 */
	onDialDown(ev) {
		const zone = parseInt("" + ev.payload.settings.zone) || 0;
		this.avrConnections[this.actionReceiverMap[ev.action.id]]?.toggleMute(zone) || ev.action.showAlert();
	}

	/**
	 * Change the volume when the key is pressed.
	 * @param {KeyDownEvent} ev - The event object.
	 */
	onKeyDown(ev) {
		const volumeLevel = parseInt("" + ev.payload.settings.volumeLevel);
		if (isNaN(volumeLevel)) {
			ev.action.showAlert();
			return;
		}

		const zone = parseInt("" + ev.payload.settings.zone) || 0;
		this.avrConnections[this.actionReceiverMap[ev.action.id]]?.changeVolumeAbsolute(volumeLevel, zone) || ev.action.showAlert();
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
 * @param {number} [zone=0] - The zone that the volume status changed for
 */
async function updateActionState(action, connection, zone = 0) {
	const actionZone = parseInt("" + (await action.getSettings()).zone) || 0;
	if (actionZone !== zone) { return; }

	const { muted, volume, maxVolume, power } = connection.status.zones[zone];

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
