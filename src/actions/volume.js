import streamDeck, { action, SingletonAction } from "@elgato/streamdeck";
import { DenonAVR } from "../modules/denonavr";

let logger;

/**
 * The settings for the Volume action.
 * @typedef {Object} Settings
 * @property {string} host - The host of the Denon AVR receiver.
 * @property {number} port - The port of the Denon AVR receiver.
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

	#receiver;

	/**
	 * The settings for the Volume action.
	 * @type {Settings}
	 */
	#settings = {
		host: "receiver.local",
		port: 23
	};

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

	onPropertyInspectorDidAppear() {
		this.#refreshPIStatus();
	}

	onDidReceiveSettings(ev) {
		this.#settings = ev.settings;
	}

	onWillAppear(ev) {
		if (ev.payload && ev.payload.settings) {
			this.#settings = ev.payload.settings;
		}

		if (!this.#receiver) {
			this.#connectToReceiver();
		}
	}

	/**
	 * Adjust the volume when the dial is rotated.
	 * @param {Object} ev - The event object.
	 */
	onDialRotate(ev) {
		if (!this.#receiver) return;

		let ticks = ev.payload.ticks;
		this.#receiver.changeVolume(ticks);
	}

	/**
	 * Toggle mute when the dial is pressed
	 * @param {Object} ev - The event object.
	 */
	onDialDown(ev) {
		if (!this.#receiver) return;

		this.#receiver.toggleMute();
	}

	onSendToPlugin(ev) {
		// logger.debug("onSendToPlugin: ev = ", JSON.stringify(ev, null, 2));

		if (ev.payload && ev.payload.message === "connect") {
			this.#connectToReceiver();
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

	async #connectToReceiver() {
		if (!this.#settings.host || !this.#settings.port) return;

		this.status = "Connecting...";

		if (this.#receiver) {
			logger.info("Disconnecting from existing receiver before creating a new connection.");
			await this.#receiver.disconnect();
			this.#receiver = null;
		}

		logger.info(`Creating new receiver connection: ${this.#settings.host}:${this.#settings.port}.`);
		let receiver = new DenonAVR(this.#settings.host, this.#settings.port, logger);

		// Add event listeners for receiver events
		receiver.eventEmitter.on("connected", () => this.#onReceiverConnected());
		receiver.eventEmitter.on("closed", (msg) => this.#onReceiverDisconnected(msg));
		receiver.eventEmitter.on("error", (msg) => this.#onReceiverError(msg));

		this.#receiver = receiver;
	}

	#onReceiverConnected() {
		logger.info("Receiver connected.");
		this.status = "Connected.";
		this.#refreshPIStatus();
	}

	#onReceiverDisconnected(msg) {
		logger.info("Receiver disconnected: ", msg);
		this.status = "Disconnected.";
		this.#refreshPIStatus();
	}

	#onReceiverError(msg) {
		logger.warn("Receiver error: ", msg);
		this.status = `Error: ${msg}`;
		this.#refreshPIStatus();
	}
}

export { VolumeAction };
