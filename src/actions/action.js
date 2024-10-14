import streamDeck, { SingletonAction } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").WillAppearEvent} WillAppearEvent */
/** @typedef {import("@elgato/streamdeck").PropertyInspectorDidAppearEvent} PropertyInspectorDidAppearEvent */
/** @typedef {import("@elgato/streamdeck").PropertyInspectorDidDisappearEvent} PropertyInspectorDidDisappearEvent */
/** @typedef {import("@elgato/streamdeck").SendToPluginEvent} SendToPluginEvent */

import { DenonAVR } from "../modules/denonavr";
/** @typedef {import("../modules/denonavr").ReceiverEvent} ReceiverEvent */

/**
 * Settings type for actions
 * @typedef {Object} ActionSettings
 * @property {string} host - The host of the Denon AVR receiver.
 * @property {number} port - The port of the Denon AVR receiver.
 * @property {boolean} [autoConnect=false] - Whether to automatically connect to the receiver when the action appears.
 * @property {string} statusMsg - A message to display in the PI's status area.
 */

/**
 * Generic action class for the StreamDeck plugin
 * @extends SingletonAction
 */
class PluginAction extends SingletonAction {
    constructor() {
        super();
    }

	/**
	 * Handle the PI appearing.
	 * @param {PropertyInspectorDidAppearEvent} ev - The event object.
	 */
	async onPropertyInspectorDidAppear(ev) {
		// Refresh the PI's status message with the receiver's current status

		let receiver = DenonAVR.getByContext(ev.action.id);
		if (receiver) {
			let settings = await ev.action.getSettings();
			await ev.action.setSettings({ ...settings, statusMsg: receiver.statusMsg });
		}
	}

	/**
	 * Handle the PI disappearing.
	 * @param {PropertyInspectorDidDisappearEvent} ev - The event object.
	 */
	async onPropertyInspectorDidDisappear(ev) {
		// Reset the PI/action's settings if they mismatch a connected receiver
		let receiver = DenonAVR.getByContext(ev.action.id);
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
			this.createReceiverConnection(ev);
		}
	}

   	/**
	 * Handle a message from the plugin.
	 * @param {SendToPluginEvent} ev - The event object.
	 */
	async onSendToPlugin(ev) {
		if (ev.payload && ev.payload.message === "connect") {
			await this.createReceiverConnection(ev);
		}
	}

    /**
	 * Create a new receiver connection.
	 * @param {WillAppearEvent | SendToPluginEvent} ev - The event object.
     * @returns {DenonAVR | undefined} The newly createdreceiver object.
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
		if (!settings.host || !settings.port) {
			settings.statusMsg = "Missing host or port number.";
			action.setSettings(settings);
			return;
		}

		let receiver = DenonAVR.getByContext(action.id);
		if (receiver) {
			streamDeck.logger.info("Disconnecting this action from existing receiver before creating a new connection.");
			receiver.actionIds = receiver.actionIds.filter((id) => id !== action.id);
			receiver.eventEmitter.removeAllListeners();
			receiver.disconnect();
		}

		streamDeck.logger.info(`Creating new receiver connection: ${settings.host}:${settings.port}.`);
		receiver = new DenonAVR({ host: settings.host, port: settings.port, actionId: action.id });

		settings.statusMsg = receiver.statusMsg;
		action.setSettings(settings);

		// Add event listeners for receiver events
		receiver.eventEmitter.on("status", (ev) => this.#onReceiverStatus(ev));
		receiver.eventEmitter.on("connected", (ev) => this.#onReceiverConnected(ev));
		receiver.eventEmitter.on("closed", (ev) => this.#onReceiverDisconnected(ev));

        return receiver;
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

/** 
 * @typedef {import('./action').ActionSettings} ActionSettings
 */

export { PluginAction };

/** @typedef {ActionSettings} ActionSettings */