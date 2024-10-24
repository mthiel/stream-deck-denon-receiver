import streamDeck, { SingletonAction } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").Action} Action */
/** @typedef {import("@elgato/streamdeck").Logger} Logger */
/** @typedef {import("@elgato/streamdeck").ActionContext} ActionContext */
/** @typedef {import("@elgato/streamdeck").WillAppearEvent} WillAppearEvent */
/** @typedef {import("@elgato/streamdeck").WillDisappearEvent} WillDisappearEvent */
/** @typedef {import("@elgato/streamdeck").PropertyInspectorDidAppearEvent} PropertyInspectorDidAppearEvent */
/** @typedef {import("@elgato/streamdeck").SendToPluginEvent} SendToPluginEvent */

/** @typedef {import("../plugin").PluginContext} PluginContext */
/** @typedef {import("../modules/connection").ReceiverEvent} ReceiverEvent */

import { AVRConnection } from "../modules/connection";
import { AVRTracker } from "../modules/tracker";

/** @typedef {string} ActionUUID */
/** @typedef {string} ReceiverUUID */
/** @typedef {Record<ActionUUID, ReceiverUUID>} ActionReceiverMap */

/**
 * Base action class for the plugin
 * @extends SingletonAction
 */
export class PluginAction extends SingletonAction {
	/** @type {PluginContext} - Plugin-level context */
	plugin;

	/** @type {Logger} */
	logger;

	get avrConnections() { return this.plugin.avrConnections; }

	/**
	 * Map of actions to their associated receiver UUIDs.
	 * Note: This is also used as a list of connections that this class instance is already listening to.
	 * @type {ActionReceiverMap}
	 */
	actionReceiverMap = {};

	/**
	 * @param {PluginContext} plugin - Plugin-level context to bind to this class
	 */
	constructor(plugin) {
		super();

		// Assign the plugin context to the class, if it wasn't already
		if (!this.plugin) {
			this.plugin = plugin;
			this.logger = plugin.logger.createScope(this.constructor.name);
		}
	}

	/**
	 * Handle the PI appearing
	 * @param {PropertyInspectorDidAppearEvent} ev - The event object.
	 */
	onPropertyInspectorDidAppear(ev) {
		// Clear the status message
		let statusMsg = "";
		if (ev.action.id in this.actionReceiverMap) {
			statusMsg = this.avrConnections[this.actionReceiverMap[ev.action.id]]?.statusMsg || "";
		}

		this.updateStatusMessage(statusMsg);
	}

	/**
	 * Handles checking if an appearing action has a receiver selected already and
	 * attempts to put it in the correct state.
	 * @param {WillAppearEvent} ev - The event object.
	 */
	async onWillAppear(ev) {
		// Check for a selected receiver for this action.
		const receiverId = ev.payload.settings.uuid?.toString();
		if (!receiverId) {
			// No receiver selected, ignore it until one is chosen
			return;
		}

		// If a connection doesn't exist yet, try to create one
		if (receiverId in this.avrConnections === false) {
			// Should we wait for the tracker to be updated first?
			if (AVRTracker.isScanning()) {
				// Wait for the scan to complete and try again in case the receiver was found
				AVRTracker.once("scanned", () => this.onWillAppear(ev));
				return;
			}

			// Try to open the new connection to this receiver
			if (await this.connectReceiver(receiverId) === undefined) {
				return;
			}
		}

		// Add listener for receiver events if we haven't already
		if (Object.values(this.actionReceiverMap).includes(receiverId) === false) {
			this.avrConnections[receiverId].on(this.routeReceiverEvent.bind(this));
		}

		// Update the map with the selected receiver ID for this action
		this.actionReceiverMap[ev.action.id] = receiverId;
	}

	/**
	 * Handle events from the Property Inspector.
	 * @param {SendToPluginEvent} ev - The event object.
	 */
	onSendToPlugin(ev) {
		const { event } = ev.payload;

		switch (event) {
			case "userChoseReceiver":
				this.onUserChoseReceiver(ev);
				break;
			case "refreshReceiverList":
				this.onRefreshReceiversForPI(ev);
				break;
			default:
				this.logger.warn(`Received unknown event: ${event}`);
		}
	}

	/**
	 * Handle a user choosing a receiver from the PI.
	 * @param {SendToPluginEvent} ev - The event object.
	 */
	async onUserChoseReceiver(ev) {
		const settings = await ev.action.getSettings();

		// Connect to the receiver if the user chose one
		this.actionReceiverMap[ev.action.id] = settings.uuid;
		this.connectReceiver(settings.uuid);
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
	 * @param {string} receiverId - The receiver UUID.
	 * @returns {Promise<AVRConnection | undefined>}
	 */
	async connectReceiver(receiverId) {
		// Check for an existing connection before creating a new one
		if (receiverId in this.avrConnections === false) {
			// Get the receiver info from the tracker
			const receiverInfo = AVRTracker.getReceivers()[receiverId];
			if (!receiverInfo) {
				this.updateStatusMessage(`Receiver with UUID ${receiverId} not found on the network.`);
				return;
			}

			this.logger.info(`Creating new receiver connection to ${receiverInfo.name || receiverInfo.currentIP}.`);
			const connection = new AVRConnection(this.plugin, receiverId, receiverInfo.currentIP);
			this.avrConnections[receiverId] = connection;
		}

		return this.avrConnections[receiverId];
	}

	/**
	 * Route a receiver event to the appropriate handler.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	routeReceiverEvent(ev) {
		// Get the list of actions to inform of the event and add them to the event object
		ev.actions = this.actions.filter((action) => this.actionReceiverMap[action.id] === ev.connection.uuid);

		switch (ev.type) {
			case "connected":
				this.onReceiverConnected(ev);
				break;
			case "closed":
				this.onReceiverDisconnected(ev);
				break;
			case "powerChanged":
				this.onReceiverPowerChanged(ev);
				break;
			case "volumeChanged":
				this.onReceiverVolumeChanged(ev);
				break;
			case "muteChanged":
				this.onReceiverMuteChanged(ev);
				break;
			case "status":
				this.onReceiverStatusChange(ev);
				break;
		}
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
	 * @param {ReceiverEvent} ev - The event object.
	 */
	onReceiverStatusChange(ev) {
		this.updateStatusMessage(ev.connection.statusMsg);
	}

	/**
	 * Fires when the receiver connects and updates the action's PI status message.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	onReceiverConnected(ev) {
		this.updateStatusMessage(ev.connection.statusMsg);
	}

	/**
	 * Fires when the receiver disconnects and updates the action's PI status message.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	onReceiverDisconnected(ev) {
		this.updateStatusMessage(ev.connection.statusMsg);
	}

	/**
	 * Fires when the receiver's power state changes.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	onReceiverPowerChanged(ev) {}

	/**
	 * Fires when the receiver's volume changes.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	onReceiverVolumeChanged(ev) {}

	/**
	 * Fires when the receiver's mute state changes.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	onReceiverMuteChanged(ev) {}
}
