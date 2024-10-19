import streamDeck, { SingletonAction } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").Action} Action */
/** @typedef {import("@elgato/streamdeck").ActionContext} ActionContext */
/** @typedef {import("@elgato/streamdeck").WillAppearEvent} WillAppearEvent */
/** @typedef {import("@elgato/streamdeck").WillDisappearEvent} WillDisappearEvent */
/** @typedef {import("@elgato/streamdeck").PropertyInspectorDidAppearEvent} PropertyInspectorDidAppearEvent */
/** @typedef {import("@elgato/streamdeck").DidReceiveSettingsEvent} DidReceiveSettingsEvent */
/** @typedef {import("@elgato/streamdeck").SendToPluginEvent} SendToPluginEvent */

import { DenonAVR } from "../modules/denonavr";
import { AVRTracker } from "../modules/tracker";

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
	// Plugin-level context
	/** @type {import("../plugin").PluginContext} */
	plugin;

	get connectedReceivers() {
		return connectedReceivers;
	}

	get visibleActions() {
		return visibleActions;
	}

	/**
	 * @param {import("../plugin").PluginContext} plugin 
	 */
	constructor(plugin) {
		super();

		this.plugin = plugin;
	}

	/**
	 * Handle the PI appearing by refreshing data
	 * @param {PropertyInspectorDidAppearEvent} ev - The event object.
	 */
	onPropertyInspectorDidAppear(ev) {
		// Refresh the connection status message for the action
		this.getConnectionForAction(ev.action).then((connection) => {
			let statusMsg = "";
			if (connection) {
				statusMsg = connection.statusMsg;
			}
			this.updateStatusMessage(statusMsg);
		});
	}

	/**
	 * Handles checking if an appearing action has a receiver selected already and
	 * tries to re-associate or re-connect to it.
	 * @param {WillAppearEvent} ev - The event object.
	 */
	onWillAppear(ev) {
		// Check for a UUID of a selected receiver
		const uuid = ev.payload.settings.uuid;
		if (uuid) {
			// Should we wait for the receiver list to be updated?
			if (Object.keys(AVRTracker.getReceivers()).length === 0 && AVRTracker.isScanning()) {
				// Wait for the scan to complete and try again
				AVRTracker.once("scanned", () => this.onWillAppear(ev));
				return;
			}

			// Check for an existing connection to associate with
			let receiver = connectedReceivers.find((receiver) => receiver.uuid === uuid);
			if (receiver) {
				// (Re)associate this action with the existing connection
				this.associateActionWithReceiver(ev.action, receiver);
			} else {
				// Start a connection process and associate it if it completes successfully
				this.connectReceiver(ev)
				.then((receiver) => {
					if (receiver) this.associateActionWithReceiver(ev.action, receiver);
				});
			}
		}
	}

	/**
	 * Handles updating states when an action will no longer be visible
	 * @param {WillDisappearEvent} ev - The event object.
	 */
	onWillDisappear(ev) {
		this.disassociateActionFromReceiver(ev.action);
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
						this.associateActionWithReceiver(ev.action, receiver);
					}
				});
				break;
			case "refreshReceiverList":
				this.onRefreshReceiversForPI(ev);
				break;
			default:
				streamDeck.logger.warn(`Received unknown event: ${event}`);
		}
	}

	/**
	 * Handle a request from the PI to refresh the receiver list
	 * @param {SendToPluginEvent} ev 
	 */
	async onRefreshReceiversForPI(ev) {
		let options;

		// If this action isn't configured yet, or the user has manally
		// refreshed, actively attempt to scan for receivers now.
		const settings = await ev.action.getSettings();
		if (!settings?.uuid || ev.payload.isRefresh === true) {
			// Perform a short scan for receivers
			const receivers = await AVRTracker.searchForReceivers(1, 2);

			// Convert the dict stricture into options
			options = [
				{
					label: Object.keys(receivers).length > 0
						? "Select a receiver"
						: "No receivers detected",
					value: ""
				},
				...Object.entries(receivers).map(([uuid, receiver]) => ({
					label: receiver.name || receiver.currentIP,
					value: uuid
				}))
			];
		} else {
			// Just send back the current selection to avoid unnecessary
			// scanning every time the user opens the PI
			options = [{ label: settings.name, value: settings.uuid }];
		}

		streamDeck.ui.current?.sendToPropertyInspector({
			event: "refreshReceiverList",
			items: options
		});
	}

	/**
	 * Create a new receiver connection (if necessary) and return it.
	 * @param {WillAppearEvent | SendToPluginEvent} ev - The event object.
	 * @returns {Promise<ConnectedReceiverInfo | undefined>} The receiver object or undefined in case of error.
	 */
	async connectReceiver(ev) {
		let settings = ev.payload?.settings;
		if (!settings) {
			settings = await ev.action.getSettings();
		}

		// If no receiver is selected, don't try to connect
		if (!settings.uuid) {
			this.updateStatusMessage("No receiver selected.");
			return;
		}

		// Check for an existing connection
		let receiver = connectedReceivers.find((receiver) => receiver.uuid === settings.uuid);
		if (!receiver) {
			// Get the receiver info from the tracker
			const receiverInfo = AVRTracker.getReceivers()[settings.uuid];
			if (!receiverInfo) {
				this.updateStatusMessage(`Receiver ${settings.name} not found.`);
				return;
			}

			streamDeck.logger.info(`Creating new receiver connection to ${receiverInfo.name}.`);
			const connection = new DenonAVR(receiverInfo.currentIP);
			receiver = { uuid: settings.uuid, connection };
			connectedReceivers.push(receiver);

			// Add event listeners for receiver events
			connection.on("status", (ev) => { this.onReceiverStatusChange(ev); });
			connection.on("connected", (ev) => { this.onReceiverConnected(ev); });
			connection.on("closed", (ev) => { this.onReceiverDisconnected(ev); });
			connection.on("powerChanged", (ev) => { this.onReceiverPowerChanged(ev); });
			connection.on("volumeChanged", (ev) => { this.onReceiverVolumeChanged(ev); });
			connection.on("muteChanged", (ev) => { this.onReceiverMuteChanged(ev); });
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
	 * Associate an action with a receiver connection.
	 * @param {Action} action - The action object.
	 * @param {ConnectedReceiverInfo} receiver - The receiver object.
	 */
	associateActionWithReceiver(action, receiver) {
		// Remove any existing visible actions with the same ID
		visibleActions = visibleActions.filter((visibleAction) => visibleAction.id !== action.id);
		// Add this visible action
		visibleActions.push({ id: action.id, uuid: receiver.uuid });
	}

	/**
	 * Remove a visible action from the list of visible actions.
	 * @param {Action | ActionContext} action - The action object.
	 */
	disassociateActionFromReceiver(action) {
		visibleActions = visibleActions.filter((visibleAction) => visibleAction.id !== action.id);
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