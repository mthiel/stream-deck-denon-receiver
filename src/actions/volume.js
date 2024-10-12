import streamDeck, { action, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { DenonAVR } from "../modules/denonavr";

let logger;

/**
 * The settings for the Volume action.
 * @typedef {Object} Settings
 * @property {string} host - The host of the Denon AVR receiver.
 * @property {number} port - The port of the Denon AVR receiver.
 * @property {string} statusMsg - A message to display in the PI's status area.
 */

/**
 * The Volume action class.
 * @extends {SingletonAction}
 */
@action({ UUID: "com.mthiel.denon-controller.volume" })
class VolumeAction extends SingletonAction {
	#status = "Disconnected.";
	get status() {
		return this.#status;
	}
	set status(newStatus) {
		this.#status = newStatus;
		this.#refreshPIStatus();
	}

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

	async onPropertyInspectorDidAppear(ev) {
		let settings = await ev.action.getSettings();
		// TODO: Update the PI with the current status

		this.#refreshPIStatus();
	}

	// onDidReceiveSettings(ev) {
	// 	this.#settings = ev.settings;
	// }

	/**
	 * Try to create a new receiver connection (if necessary) before the action will appear.
	 * @param {WillAppearEvent} ev - The event object.
	 */
	async onWillAppear(ev) {
		this.#createReceiverConnection(ev);
	}

	/**
	 * Adjust the volume when the dial is rotated.
	 * @param {Object} ev - The event object.
	 */
	// onDialRotate(ev) {
	// 	if (!this.#receiver) return;

	// 	let ticks = ev.payload.ticks;
	// 	this.#receiver.changeVolume(ticks);
	// }

	/**
	 * Toggle mute when the dial is pressed
	 * @param {Object} ev - The event object.
	 */
	// onDialDown(ev) {
	// 	if (!this.#receiver) return;

	// 	this.#receiver.toggleMute();
	// }

	onSendToPlugin(ev) {
		if (ev.payload && ev.payload.message === "connect") {
			this.#createReceiverConnection(ev);
		}
	}

	#refreshPIStatus() {
		if (!this.status) return;

		if (streamDeck.ui.current) {
			streamDeck.ui.current.sendToPropertyInspector({
				message: "status",
				details: this.status
			});
		}
	}

	/**
	 * Get the action instance for a given receiver instance.
	 * @param {DenonAVR} receiver - The receiver instance.
	 * @returns {VolumeAction | null} The action instance, or null if the receiver is not associated with an action.
	 */
	#getActionForReceiver(receiver) {
		return null;
		// let actions = streamDeck.actions;
		// return actions.find((action) => action.receiver === receiver);
	}

	/**
	 * Create a new receiver connection.
	 * @param {WillAppearEvent} ev - The event object.
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
			settings.statusMsg = "Invalid settings.";
			await action.setSettings(settings);
			return;
		}

		/** @type {DenonAVR} */
		let receiver = action.receiver;
		if (receiver) {
			logger.info("Disconnecting from existing receiver before creating a new connection.");
			settings.statusMsg = "Disconnecting...";
			await action.setSettings(settings);
			// this.#refreshPIStatus();

			await receiver.disconnect();
			action.receiver = null;
		}

		settings.statusMsg = "Connecting...";
		await action.setSettings(settings);
		// this.#refreshPIStatus();

		logger.info(`Creating new receiver connection: ${settings.host}:${settings.port}.`);
		receiver = new DenonAVR(settings.host, settings.port, logger);

		// Add event listeners for receiver events
		receiver.eventEmitter.on("connected", (ev) => this.#onReceiverConnected(ev));
		receiver.eventEmitter.on("closed", (ev) => this.#onReceiverDisconnected(ev));
		receiver.eventEmitter.on("error", (ev) => this.#onReceiverError(ev));

		action.receiver = receiver;
	}

	async #onReceiverConnected(ev) {
		logger.info("Receiver connected.");
		let receiver = ev.receiver;
		if (!receiver) return;

		let action = this.#getActionForReceiver(receiver);
		if (!action) return;

		let settings = await action.getSettings();
		settings.statusMsg = "Connected.";
		await action.setSettings(settings);
	}

	#onReceiverDisconnected(ev) {
		if (ev.msg) {
			logger.info("Receiver disconnected: ", ev.msg);
		} else {
			logger.info("Receiver disconnected.");
		}
		this.status = "Disconnected.";
		this.#refreshPIStatus();
	}

	#onReceiverError(ev) {
		logger.warn("Receiver error: ", msg);
		this.status = `Error: ${msg}`;
		this.#refreshPIStatus();
	}
}

export { VolumeAction };
