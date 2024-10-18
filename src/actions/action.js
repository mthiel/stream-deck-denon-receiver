import streamDeck, { SingletonAction } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").Action} Action */
/** @typedef {import("@elgato/streamdeck").ActionContext} ActionContext */
/** @typedef {import("@elgato/streamdeck").WillAppearEvent} WillAppearEvent */
/** @typedef {import("@elgato/streamdeck").WillDisappearEvent} WillDisappearEvent */
/** @typedef {import("@elgato/streamdeck").PropertyInspectorDidAppearEvent} PropertyInspectorDidAppearEvent */
/** @typedef {import("@elgato/streamdeck").PropertyInspectorDidDisappearEvent} PropertyInspectorDidDisappearEvent */
/** @typedef {import("@elgato/streamdeck").DidReceiveSettingsEvent} DidReceiveSettingsEvent */
/** @typedef {import("@elgato/streamdeck").SendToPluginEvent} SendToPluginEvent */

import { DenonAVR } from "../modules/denonavr";
import { AVRTracker } from "../modules/ssdp";

/**
 * @typedef {Object} VisibleAction
 * @property {string} id - The ID of the action.
 * @property {string} uuid - The UUID of the associated receiver
 */

/**
 * @typedef {Object} ConnectedReceiverInfo
 * @property {string} uuid - The UUID of the receiver
 * @property {DenonAVR} connection - The object representing the connected receiver
 */

/**
 * Generic action class for the StreamDeck plugin
 * @extends SingletonAction
 * @property {ConnectedReceiverInfo[]} connectedReceivers - The list of receivers that these actions are connected to.
 */

/** @type {ConnectedReceiverInfo[]} */
var connectedReceivers = [];

/** @type {VisibleAction[]} */
var visibleActions = [];

export class PluginAction extends SingletonAction {
	get connectedReceivers() {
		return connectedReceivers;
	}

	get visibleActions() {
		return visibleActions;
	}

	constructor() {
		super();

		AVRTracker.on("updated", () => { PluginAction.#getDiscoveredReceivers() });
	}

	/**
	 * Set the PI's ID when it appears.
	 * @param {PropertyInspectorDidAppearEvent} ev - The event object.
	 */
	onPropertyInspectorDidAppear(ev) {
		AVRTracker.startSearching();

		this.getConnectionForAction(ev.action).then((connection) => {
			if (connection) {
				this.updateStatusMessage(connection.statusMsg);
			}
		});
	}

	/**
	 * Clean-up the action settings when it's PI disappears.
	 * @param {PropertyInspectorDidDisappearEvent} ev - The event object.
	 */
	onPropertyInspectorDidDisappear(ev) {
		ev.action.getSettings().then((settings) => {
			settings.statusMsg = "";
			ev.action.setSettings(settings);
		});
	}

	/**
	 * Try to create a new receiver connection (if necessary) before the action will appear.
	 * @param {WillAppearEvent} ev - The event object.
	 */
	onWillAppear(ev) {
		const uuid = ev.payload.settings.uuid;
		if (uuid) {
			let receiver = connectedReceivers.find((receiver) => receiver.uuid === uuid);
			if (receiver) {
				this.associateVisibleActionToReceiver(ev.action, receiver);
			} else {
				this.connectReceiver(ev).then((receiver) => {
					if (receiver) {
						this.associateVisibleActionToReceiver(ev.action, receiver);
					}
				});
			}
		}
	}

	/**
	 * Remove a visible action when it's disappearing.
	 * @param {WillDisappearEvent} ev - The event object.
	 */
	onWillDisappear(ev) {
		this.removeVisibleActionFromReceiver(ev.action);
	}

	/**
	 * Handle a events from the Property Inspector.
	 * @param {SendToPluginEvent} ev - The event object.
	 */
	onSendToPlugin(ev) {
		const { event } = ev.payload;

		switch (event) {
			case "userChoseReceiver":
				this.connectReceiver(ev).then((receiver) => {
					if (receiver) {
						this.associateVisibleActionToReceiver(ev.action, receiver);
					}
				});
				break;
			case "getDiscoveredReceivers":
				PluginAction.#getDiscoveredReceivers();
				break;
			default:
				streamDeck.logger.warn(`Received unknown event: ${event}`);
		}
	}

	/**
	 * Associate this action with a receiver, creating a new connection as necessary.
	 * @param {WillAppearEvent | SendToPluginEvent} ev - The event object.
	 * @returns {Promise<ConnectedReceiverInfo | undefined>} The receiver object or undefined in case of error.
	 */
	async connectReceiver(ev) {
		let settings = ev.payload?.settings;
		if (!settings) {
			settings = await ev.action.getSettings();
		}

		if (!settings.uuid) {
			this.updateStatusMessage("No receiver selected.");
			return;
		}

		let receiver = connectedReceivers.find((receiver) => receiver.uuid === settings.uuid);
		if (!receiver) {
			streamDeck.logger.info(`Creating new receiver connection to ${settings.name}.`);
			const connection = new DenonAVR(settings.host);
			receiver = { uuid: settings.uuid, connection };
			connectedReceivers.push(receiver);

			// Add event listeners for receiver events
			connection.on("status", (ev) => this.onReceiverStatusChange(ev));
			connection.on("connected", (ev) => this.onReceiverConnected(ev));
			connection.on("closed", (ev) => this.onReceiverDisconnected(ev));
			connection.on("powerChanged", (ev) => this.onReceiverPowerChanged(ev));
			connection.on("volumeChanged", (ev) => this.onReceiverVolumeChanged(ev));
			connection.on("muteChanged", (ev) => this.onReceiverMuteChanged(ev));
		}

		this.updateStatusMessage(receiver.connection.statusMsg);

		return receiver;
	}

	/**
	 * Get the receiver connection for an action.
	 * @param {Action} action - The action object.
	 * @returns {Promise<DenonAVR | undefined>} The receiver object or undefined if not found.
	 */
	async getConnectionForAction(action) {
		const settings = await action.getSettings();
		return connectedReceivers.find((receiver) => receiver.uuid === settings.uuid)?.connection;
	}

	/**
	 * Associate a visible action with a receiver connection.
	 * @param {Action} action - The action object.
	 * @param {ConnectedReceiverInfo} receiver - The receiver object.
	 */
	associateVisibleActionToReceiver(action, receiver) {
		// Remove any existing visible actions with the same ID
		visibleActions = visibleActions.filter((visibleAction) => visibleAction.id !== action.id);
		// Add this visible action
		visibleActions.push({ id: action.id, uuid: receiver.uuid });
	}

	/**
	 * Remove a visible action from the list of visible actions.
	 * @param {Action | ActionContext} action - The action object.
	 */
	removeVisibleActionFromReceiver(action) {
		visibleActions = visibleActions.filter((visibleAction) => visibleAction.id !== action.id);
	}

	/**
	 * Reformat and send a reply to the PI with a current list of receivers found on the network.
	 */
	static #getDiscoveredReceivers() {
		const PI = streamDeck.ui.current;
		if (!PI) { return; }

		const discoveredReceivers = AVRTracker.receivers();

		if (Object.keys(discoveredReceivers).length === 0) {
			return;
		}

		const receiverList = [
			{
				label: "Select a receiver",
				value: ""
			},
			...Object.entries(discoveredReceivers).map(([uuid, receiver]) => ({
				label: receiver.name || receiver.currentIP,
				value: uuid
			}))
		];

		PI.sendToPropertyInspector({
			event: "getDiscoveredReceivers",
			items: receiverList
		});
	}

	/**
	 * Update the status message for an action's PI.
	 * @param {string} newStatusMsg - The new status message.
	 */
	updateStatusMessage(newStatusMsg) {
		const action = streamDeck.ui.current?.action;
		if (action) {
			action.getSettings().then((settings) => {
				settings.statusMsg = newStatusMsg;
				action.setSettings(settings);
			});
		}
	}

	/**
	 * Fires when the receiver's status changes and updates the action's PI status message.
	 * @param {DenonAVR} receiver - The receiver object.
	 */
	onReceiverStatusChange(receiver) {
		this.updateStatusMessage(receiver.statusMsg);
	}

	/**
	 * Fires when the receiver connects and updates the action's PI status message.
	 * @param {DenonAVR} receiver - The receiver object.
	 */
	onReceiverConnected(receiver) {
		this.updateStatusMessage(receiver.statusMsg);
	}

	/**
	 * Fires when the receiver disconnects and updates the action's PI status message.
	 * @param {DenonAVR} receiver - The receiver object.
	 */
	onReceiverDisconnected(receiver) {
		this.updateStatusMessage(receiver.statusMsg);
	}

	/**
	 * Fires when the receiver's power state changes.
	 * @param {DenonAVR} receiver - The receiver object.
	 */
	onReceiverPowerChanged(receiver) {}

	/**
	 * Fires when the receiver's volume changes.
	 * @param {DenonAVR} receiver - The receiver object.
	 */
	onReceiverVolumeChanged(receiver) {}

	/**
	 * Fires when the receiver's mute state changes.
	 * @param {DenonAVR} receiver - The receiver object.
	 */
	onReceiverMuteChanged(receiver) {}
}