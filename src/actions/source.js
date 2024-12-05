import streamDeck, { action } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").Action} Action */
/** @typedef {import("@elgato/streamdeck").KeyDownEvent} KeyDownEvent */
/** @typedef {import("@elgato/streamdeck").SendToPluginEvent} SendToPluginEvent */

import { PluginAction } from "./action";
/** @typedef {import("./action").ActionSettings} ActionSettings */

import { AVRConnection } from "../modules/connection";

/** @typedef {import("../modules/connection").ReceiverEvent} ReceiverEvent */

/**
 * The Source action class.
 * @extends {PluginAction}
 */
@action({ UUID: "com.mthiel.denon-controller.source" })
export class SourceAction extends PluginAction {
	async onWillAppear(ev) {
		await super.onWillAppear(ev);

		// Set the initial state of the action
		// const connection = this.avrConnections[this.actionReceiverMap[ev.action.id]];
		// if (connection) {
		// 	updateActionState(ev.action, connection);
		// }
	}

	/**
	 * Change to the configured source when the key is pressed
	 * @param {KeyDownEvent} ev - The event object.
	 */
	onKeyDown(ev) {
		const connection = this.avrConnections[this.actionReceiverMap[ev.action.id].uuid];
		if (!connection) return;

		/** @type {ActionSettings} */
		const settings = ev.payload.settings;
		let { zone, sourceAction, source } = settings;

		// Default to "set" since PI sometimes sends undefined
		sourceAction = sourceAction || "set";

		switch (sourceAction) {
			case "set":
				connection.setSource(/** @type {string} */ (source), zone) || ev.action.showAlert();
				break;
		}
	}

	/**
	 * Handle events from the Property Inspector.
	 * @param {SendToPluginEvent} ev - The event object.
	 */
	onSendToPlugin(ev) {
		super.onSendToPlugin(ev);

		const { event } = ev.payload;

		switch (event) {
			case "refreshSourceList":
				this.onRefreshSourceListForPI(ev);
				break;
		}
	}

	/**
	 * Refresh the sources for the action.
	 * @param {SendToPluginEvent} ev - The event object.
	 */
	async onRefreshSourceListForPI(ev) {
		// const connection = this.avrConnections[this.actionReceiverMap[ev.action.id]];
		// if (!connection) return;

		/** @type {ActionSettings} */
		const settings = await ev.action.getSettings();
		const zone = /** @type {number} */ (settings.zone) || 0;

		// This is currently just a static list of sources, but in the future
		// I hope I can make this dynamic by asking the receiver each it supports
		const sources = AVRConnection.sources;

		/** @type {Array<{label: string, value: string}>} */
		let options = [
			{
				label: sources && Object.keys(sources).length > 0
					? "Select a source"
					: "Could not get sources",
				value: ""
			}
		];

		if (zone > 0) {
			options.push({
				label: "Same as Main Zone",
				value: "SOURCE"
			});
		}

		options.push(...Object.entries(sources).map(([id, desc]) => ({
			label: desc || id,
			value: id
		})));

		streamDeck.ui.current?.sendToPropertyInspector({
			event: "refreshSourceList",
			items: options
		});

	}
}

/**
 * Update the state of the action
 * @param {Action} action - The action object.
 * @param {AVRConnection} connection - The receiver connection object.
 * @param {number} [zone=0]
 */
async function updateActionState(action, connection, zone = 0) {
	const actionZone = parseInt("" + (await action.getSettings()).zone) || 0;
	if (action.isKey() && actionZone === zone) {
		// action.setState(connection.status.zones[zone].power ? 0 : 1);
	}
}
