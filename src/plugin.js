import streamDeck, { LogLevel } from "@elgato/streamdeck";

// TODO: Add custom logger, extended from streamDeck.logger
// streamDeck.logger.setLevel(LogLevel.TRACE);
import { AVRTracker } from "./modules/tracker";

import { VolumeAction } from "./actions/volume";
import { PowerAction } from "./actions/power";

/** @typedef {import("./modules/denonavr").DenonAVR} DenonAVR */

/**
 * Plugin-level context for actions to access
 * @typedef {Object} PluginContext
 * @property {AVRTracker} AVRTracker - The module for discovering and tracking HEOS-enabled AVR receivers on the network
 */

/** @type {PluginContext} */
const plugin = {
    AVRTracker
};

streamDeck.actions.registerAction(new VolumeAction(plugin));
streamDeck.actions.registerAction(new PowerAction(plugin));

AVRTracker.listen();
streamDeck.connect();