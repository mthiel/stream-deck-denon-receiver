import streamDeck, { action, SingletonAction } from "@elgato/streamdeck";
import { DenonAVR } from "../modules/denonavr";

let logger;

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
		this.#receiver = new DenonAVR("studio-receiver.faewoods.org", 23, logger);
	}

	#updateStatus() {
		let receiver = this.#receiver;
		if (receiver) {
			this.setTitle(`Vol: ${receiver.volume}`);
		}
	}

	/**
	 * Called when the action is about to appear on the Stream Deck.
	 * @param {WillAppearEvent} ev - The event object.
	 */
	onWillAppear(ev) {
		this.#updateStatus();
	}
}

export { VolumeAction };
