import streamDeck, { action, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";
import { DenonAVR } from "../modules/denonavr";

export let logger = streamDeck.logger;

action({ UUID: "com.matthew-thiel.denon-receiver-network-control.avrvolume" })(AVRVolume);

/**
 * The AVRVolume action class.
 */
export class VolumeAction extends SingletonAction {

	/** @type {DenonAVR} */
	#receiver;

	constructor() {
		super();

		// Create a new DenonAVR instance.
		// TODO: Add host and port settings and use them here.
		this.#receiver = new DenonAVR();
	}

	#updateStatus() {
		this.setTitle(`Vol: ${this.#receiver.volume}`);
	}

	/**
	 * Called when the action is about to appear on the Stream Deck.
	 * @param {WillAppearEvent} ev - The event object.
	 */
	onWillAppear(ev) {
		this.#updateStatus();
	}
}
