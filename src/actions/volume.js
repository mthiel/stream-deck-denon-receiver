import streamDeck, { action, SingletonAction, LogLevel } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").Logger} Logger */
/** @typedef {import("@elgato/streamdeck").WillAppearEvent} WillAppearEvent */
/** @typedef {import("@elgato/streamdeck").PropertyInspectorDidAppearEvent} PropertyInspectorDidAppearEvent */
/** @typedef {import("@elgato/streamdeck").PropertyInspectorDidDisappearEvent} PropertyInspectorDidDisappearEvent */
/** @typedef {import("@elgato/streamdeck").DialRotateEvent} DialRotateEvent */
/** @typedef {import("@elgato/streamdeck").DialDownEvent} DialDownEvent */
/** @typedef {import("@elgato/streamdeck").SendToPluginEvent} SendToPluginEvent */

import { DenonAVR } from "../modules/denonavr";
/** @typedef {import("../modules/denonavr").ReceiverEvent} ReceiverEvent */

const images = {
	unmuted: "imgs/actions/volume/volume2",
	muted: "imgs/actions/volume/volumeMute"
};

/**
 * The (potentially scoped)logger for this action
 * @type {Logger}
 */
let logger;

/**
 * The settings for the Volume action.
 * @typedef {Object} Settings
 * @property {string} host - The host of the Denon AVR receiver.
 * @property {number} port - The port of the Denon AVR receiver.
 * @property {boolean} [autoConnect=false] - Whether to automatically connect to the receiver when the action appears.
 * @property {string} statusMsg - A message to display in the PI's status area.
 */

/**
 * The Volume action class.
 * @extends {SingletonAction}
 */
@action({ UUID: "com.mthiel.denon-controller.volume" })
class VolumeAction extends SingletonAction {
	/**
	 * Create a new VolumeAction instance.
	 * @param {Logger} [newLogger=null] - The logger to use for this action.
	 */
	constructor(newLogger = null) {
		super();

		if (!logger && newLogger) {
			logger = newLogger.createScope("Volume Action");
		}
	}

	/**
	 * Handle the PI appearing.
	 * @param {PropertyInspectorDidAppearEvent} ev - The event object.
	 */
	async onPropertyInspectorDidAppear(ev) {
		// Refresh the PI's status message with the receiver's current status
		if (ev.action.receiver) {
			let settings = await ev.action.getSettings();
			await ev.action.setSettings({ ...settings, statusMsg: ev.action.receiver.statusMsg });
		}
	}

	/**
	 * Handle the PI disappearing.
	 * @param {PropertyInspectorDidDisappearEvent} ev - The event object.
	 */
	async onPropertyInspectorDidDisappear(ev) {
		// Reset the PI/action's settings if they mismatch a connected receiver
		let receiver = DenonAVR.getInstanceByContext(ev.action.id);
		if (receiver) {
			let settings = await ev.action.getSettings();
			settings.host = receiver.host || settings.host;
			settings.port = receiver.port || settings.port;
			await ev.action.setSettings(settings);
		}
	}

	/**
	 * Try to create a new receiver connection (if necessary) before the action will appear.
	 * @param {WillAppearEvent} ev - The event object.
	 */
	onWillAppear(ev) {
		if (ev.payload.settings.autoConnect) {
			this.#createReceiverConnection(ev);
		}
	}

	/**
	 * Adjust the volume when the dial is rotated.
	 * @param {DialRotateEvent} ev - The event object.
	 */
	onDialRotate(ev) {
		let receiver = DenonAVR.getInstanceByContext(ev.action.id);
		if (!receiver) return;
		receiver.changeVolume(ev.payload.ticks);
	}

	/**
	 * Toggle mute when the dial is pressed
	 * @param {DialDownEvent} ev - The event object.
	 */
	onDialDown(ev) {
		let receiver = DenonAVR.getInstanceByContext(ev.action.id);
		if (!receiver) return;
		receiver.toggleMute();
	}

	/**
	 * Handle a message from the plugin.
	 * @param {SendToPluginEvent} ev - The event object.
	 */
	async onSendToPlugin(ev) {
		if (ev.payload && ev.payload.message === "connect") {
			await this.#createReceiverConnection(ev);
		}
	}

	/**
	 * Create a new receiver connection.
	 * @param {WillAppearEvent | SendToPluginEvent} ev - The event object.
	 */
	async #createReceiverConnection(ev) {
		let action = ev.action;
		if (!action) return;

		let settings;
		if (ev.payload && ev.payload.settings) {
			settings = ev.payload.settings;
		} else {
			settings = await action.getSettings();
		}
		if (!settings.host || !settings.port) {
			settings.statusMsg = "Missing host or port number.";
			action.setSettings(settings);
			return;
		}

		/** @type {DenonAVR} */
		let receiver = DenonAVR.getInstanceByContext(action.id);
		if (receiver) {
			logger.info("Disconnecting from existing receiver before creating a new connection.");
			receiver.actionIds = receiver.actionIds.filter((id) => id !== action.id);
			receiver.eventEmitter.removeAllListeners();
			receiver.disconnect();
		}

		logger.info(`Creating new receiver connection: ${settings.host}:${settings.port}.`);
		receiver = new DenonAVR({ host: settings.host, port: settings.port, actionId: action.id, newLogger: logger });

		settings.statusMsg = receiver.statusMsg;
		action.setSettings(settings);

		// Add event listeners for receiver events
		receiver.eventEmitter.on("status", (ev) => this.#onReceiverStatus(ev));
		receiver.eventEmitter.on("connected", (ev) => this.#onReceiverConnected(ev));
		receiver.eventEmitter.on("closed", (ev) => this.#onReceiverDisconnected(ev));
		receiver.eventEmitter.on("volumeChanged", (ev) => this.#onReceiverVolumeChanged(ev));
		receiver.eventEmitter.on("muteChanged", (ev) => this.#onReceiverMuteChanged(ev));
	}

	/**
	 * Handle a receiver general status update.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	async #onReceiverStatus(ev) {
		// Log a message on behalf of the receiver
		if (ev.payload && ev.payload.message) {
			logger.debug(ev.payload.message);
		}

		// Update the action's status message
		let settings = await ev.action.getSettings();
		settings.statusMsg = ev.receiver.statusMsg;
		await ev.action.setSettings(settings);
	}

	/**
	 * Handle a receiver connecting.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	async #onReceiverConnected(ev) {
		// On a successful connection, allow auto-connections in the future
		let settings = await ev.action.getSettings();
		settings.autoConnect = true;
		await ev.action.setSettings(settings);

		// TODO: Handle action button UI updates

		this.#onReceiverStatus(ev);
	}

	/**
	 * Handle the receiver disconnecting.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	async #onReceiverDisconnected(ev) {
		// TODO: Handle action button UI updates

		this.#onReceiverStatus(ev);
	}

	/**
	 * Handle a receiver volume changing.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	#onReceiverVolumeChanged(ev) {
		ev.action.setFeedback({
			indicator: {
				value: (ev.receiver.volume / ev.receiver.maxVolume) * 100
			},
			value: `Vol: ${ev.receiver.volume}`
		});
	}

	/**
	 * Handle a receiver mute changing.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	#onReceiverMuteChanged(ev) {
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

export { VolumeAction };
