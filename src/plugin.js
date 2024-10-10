import streamDeck, { LogLevel } from "@elgato/streamdeck";
const logger = streamDeck.logger.createScope("Denon AVR Plugin");

import volumeModule, { VolumeAction } from "./actions/volume";
volumeModule.logger = logger.createScope("Volume Action");

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded.
logger.setLevel(LogLevel.TRACE);

// Register the volume control action.
streamDeck.actions.registerAction(new VolumeAction());

// Finally, connect to the Stream Deck.
streamDeck.connect();
