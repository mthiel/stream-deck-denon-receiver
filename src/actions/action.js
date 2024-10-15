import streamDeck, { SingletonAction } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").WillAppearEvent} WillAppearEvent */
/** @typedef {import("@elgato/streamdeck").PropertyInspectorDidAppearEvent} PropertyInspectorDidAppearEvent */
/** @typedef {import("@elgato/streamdeck").PropertyInspectorDidDisappearEvent} PropertyInspectorDidDisappearEvent */
/** @typedef {import("@elgato/streamdeck").DidReceiveSettingsEvent} DidReceiveSettingsEvent */
/** @typedef {import("@elgato/streamdeck").SendToPluginEvent} SendToPluginEvent */

import { DenonAVR } from "../modules/denonavr";
/** @typedef {import("../modules/denonavr").ReceiverEvent} ReceiverEvent */

/**
 * Settings type for actions
 * @typedef {Object} ActionSettings
 * @property {string} host - The host of the Denon AVR receiver.
 * @property {boolean} [autoConnect=false] - Whether to automatically connect to the receiver when the action appears.
 * @property {string} statusMsg - A message to display in the PI's status area.
 */

/**
 * Generic action class for the StreamDeck plugin
 * @extends SingletonAction
 */
class PluginAction extends SingletonAction {
	/* 
	 * TODO: Rework this base class to manage the receiver connections
	 * instead of having the DenonAVR class manage the action instances.
	 */

	/**
	 * Refresh the PI's status message with the receiver's current status when it appears.
	 * @param {PropertyInspectorDidAppearEvent} ev - The event object.
	 */
	async onPropertyInspectorDidAppear(ev) {
		let receiver = DenonAVR.getByContext(ev.action.id);
		if (receiver) {
			let settings = await ev.action.getSettings();
			await ev.action.setSettings({ ...settings, statusMsg: receiver.statusMsg });
		}
	}

	/**
	 * Clean-up the PI settings when it's disappearing.
	 * @param {PropertyInspectorDidDisappearEvent} ev - The event object.
	 */
	async onPropertyInspectorDidDisappear(ev) {
		let receiver = DenonAVR.getByContext(ev.action.id);
		if (receiver) {
			let settings = await ev.action.getSettings();
			if (settings.host !== receiver.host) {
				settings.host = receiver.host;
				await ev.action.setSettings(settings);
			}
		}
	}

	/**
	 * Sync up the settings fields on behalf of the PI when the settings change.
	 * @param {DidReceiveSettingsEvent} ev - The event object.
	 */
	onDidReceiveSettings(ev) {
		let settings = ev.payload.settings;
		if (!settings) return;

		if (settings.detectedReceiver) {
			settings.host = settings.detectedReceiver;
		}
		ev.action.setSettings(settings);
	}

	/**
	 * Try to create a new receiver connection (if necessary) before the action will appear.
	 * @param {WillAppearEvent} ev - The event object.
	 */
	onWillAppear(ev) {
		streamDeck.logger.debug(`onWillAppear for action id: ${ev.action.id}`);
		if (ev.payload.settings.autoConnect) {
			this.createReceiverConnection(ev);
		}
	}

	/**
	 * Handle a message from the plugin.
	 * @param {SendToPluginEvent} ev - The event object.
	 */
	async onSendToPlugin(ev) {
		const { event } = ev.payload;

		switch (event) {
			case "connect":
				await this.createReceiverConnection(ev);
				break;
			case "getDetectedReceivers":
				this.getDetectedReceivers(ev);
				break;
			default:
				streamDeck.logger.warn(`Received unknown event: ${event}`);
		}
	}

	/**
	 * Create a new receiver connection.
	 * @param {WillAppearEvent | SendToPluginEvent} ev - The event object.
	 * @returns {Promise<DenonAVR | undefined>} The newly created receiver object.
	 */
	async createReceiverConnection(ev) {
		let action = ev.action;
		if (!action) return;

		let settings;
		if (ev.payload && ev.payload.settings) {
			settings = ev.payload.settings;
		} else {
			settings = await action.getSettings();
		}
		if (!settings.host) {
			settings.statusMsg = "Missing host address.";
			action.setSettings(settings);
			return;
		}

		let receiver = DenonAVR.getByContext(action.id);
		if (receiver) {
			streamDeck.logger.info("Disconnecting this action from existing receiver before creating a new connection.");
			receiver.actionIds = receiver.actionIds.filter((id) => id !== action.id);
			receiver.eventEmitter.removeAllListeners(); // TODO: This is not a good idea.
			receiver.disconnect();
		}

		streamDeck.logger.info(`Creating new receiver connection: ${settings.host}.`);
		receiver = new DenonAVR({ host: settings.host, actionId: action.id });

		if (receiver.isConnected()) {
			// If this receiver connection was already established, tag this action to auto-connect onWillAppear
			settings.autoConnect = true;
		}

		settings.statusMsg = receiver.statusMsg;
		action.setSettings(settings);

		// Add event listeners for receiver events
		// TODO: How do I avoid binding these listeners multiple times?
		receiver.eventEmitter.on("status", (ev) => this.#onReceiverStatus(ev));
		receiver.eventEmitter.on("connected", (ev) => this.#onReceiverConnected(ev));
		receiver.eventEmitter.on("closed", (ev) => this.#onReceiverDisconnected(ev));

		return receiver;
	}

	/**
	 * Get a list of detected receivers on the network.
	 * @param {SendToPluginEvent} ev - The event object.
	 */
	async getDetectedReceivers(ev) {
		const receiverAddresses = await DenonAVR.getDetectedReceiverAddresses();
		if (receiverAddresses.length === 0) {
			return;
		}

		let addressList = [
			{ label: "Select a detected receiver", value: "" },
			...receiverAddresses.map((address) => ({ label: address, value: address }))
		];

		if (streamDeck.ui.current) {
			streamDeck.ui.current.sendToPropertyInspector({
				event: "getDetectedReceivers",
				items: addressList
			});
		}
	}

	/**
	 * Handle a receiver general status update.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	async #onReceiverStatus(ev) {
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
}

export { PluginAction };