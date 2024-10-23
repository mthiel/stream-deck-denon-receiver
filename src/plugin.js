import streamDeck from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").Logger} Logger */

const logger = streamDeck.logger.createScope("Plugin");
// logger.setLevel(LogLevel.TRACE);

import { AVRTracker } from "./modules/tracker";

import { VolumeAction } from "./actions/volume";
import { PowerAction } from "./actions/power";

/** @typedef {import("./modules/connection").AVRConnection} AVRConnection */

/**
 * Plugin-level context for actions to access
 * @typedef {Object} PluginContext
 * @property {Record<ReceiverUUID, AVRConnection>} avrConnections - Maps receiver UUIDs to connections
 * @property {Logger} logger - Logger instance
 */

/** @typedef {string} ReceiverUUID */

/** @type {PluginContext} */
const plugin = {
    avrConnections: {},
    logger
};

streamDeck.actions.registerAction(new VolumeAction(plugin));
streamDeck.actions.registerAction(new PowerAction(plugin));

// Perform a quick initial scan, followed by a longer scan on startup so that existing actions can connect
// Between the two scans, that should cover fast (wired) connections as well as slower (wireless) connections
// TODO: Add a global settings cache of previous connections and only perform an initial scan if any actions need it.
AVRTracker.listen(() => { 
    AVRTracker.searchForReceivers(1, 1)
    .then(() => AVRTracker.searchForReceivers(3, 3));
});
streamDeck.connect();