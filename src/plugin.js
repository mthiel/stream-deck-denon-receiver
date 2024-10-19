import streamDeck from "@elgato/streamdeck";

// TODO: Add custom logger, extended from streamDeck.logger
// streamDeck.logger.setLevel(LogLevel.TRACE);
import { AVRTracker } from "./modules/tracker";

import { VolumeAction } from "./actions/volume";
import { PowerAction } from "./actions/power";

/** @typedef {import("./modules/denonavr").DenonAVR} DenonAVR */

/**
 * Plugin-level context for actions to access
 * @typedef {Object} PluginContext
 */

/** @type {PluginContext} */
const plugin = {
};

streamDeck.actions.registerAction(new VolumeAction(plugin));
streamDeck.actions.registerAction(new PowerAction(plugin));

AVRTracker.listen();
streamDeck.connect();