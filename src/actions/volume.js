import { action, SingletonAction } from "@elgato/streamdeck";
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
	#receiver;

	/**
	 * The settings for the Volume action.
	 * @type {Settings}
	 */
	#settings = {
		host: "",
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

	onDidReceiveSettings(ev) {
		this.#settings = ev.settings;
	}

	onSendToPlugin(ev) {
		// logger.debug("onSendToPlugin: ev = ", JSON.stringify(ev, null, 2));

		if (ev.payload && ev.payload.message === "connect" && this.#settings.host && this.#settings.port) {
			if (this.#receiver) {
				logger.info("Disconnecting from existing receiver");
				this.#receiver.disconnect();
			}

			logger.info(`Creating new receiver connection: ${this.#settings.host}:${this.#settings.port}`);
			this.#receiver = new DenonAVR(this.#settings.host, this.#settings.port, logger);
		}
	}

	onWillAppear(ev) {
		// logger.debug("onWillAppear: ev = ", JSON.stringify(ev, null, 2));

		if (ev.payload && ev.payload.settings) {
			this.#settings = ev.payload.settings;
		}

		this.#updateStatus(ev.action);
	}

	#updateStatus(action) {
		let receiver = this.#receiver;
		if (receiver) {
			action.setTitle(`Vol: ${receiver.volume}`);
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
}

export { VolumeAction };
