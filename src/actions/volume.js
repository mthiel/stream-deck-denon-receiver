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
 * @property {DenonAVR} #receiver - The bound DenonAVR instance.
 */
@action({ UUID: "com.mthiel.denon-controller.volume" })
class VolumeAction extends SingletonAction {
	#receiver;

	/**
	 * Create a new VolumeAction instance.
	 * @param {Logger} [newLogger=null] - The logger to use for this action.
	 */
	constructor(newLogger = null) {
		super();

		if (!logger && newLogger) {
			logger = newLogger.createScope("Volume Action");
		}

		// Create a new DenonAVR instance.
		// TODO: Add host and port settings and use them here.
		// this.#receiver = new DenonAVR("studio-receiver.faewoods.org", 23, logger);
	}

	#updateStatus(action) {
		let receiver = this.#receiver;
		if (receiver) {
			action.setTitle(`Vol: ${receiver.volume}`);
		}
	}

	onWillAppear(ev) {
		logger.debug("onWillAppear: ev = ", JSON.stringify(ev, null, 2));
		this.#updateStatus(ev.action);
	}
}

export { VolumeAction };
