import streamDeck, { LogLevel } from '@elgato/streamdeck';
import { DenonAVR } from './modules/denonavr';
import { AVRVolume } from './actions/avrvolume';

class AvrPlugin {
    logger;

    #connections = [];

    constructor() {
        let logger = streamDeck.logger.createScope('DenonAVR');

        // We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
        logger.setLevel(LogLevel.TRACE);

        this.logger = logger;

        // TODO: Retrieve global settings from Stream Deck
    }
}

// Instantiate the plugin.
const plugin = new AvrPlugin();

// Register the volume control action.
streamDeck.actions.registerAction(new AVRVolume(plugin));

// Finally, connect to the Stream Deck.
streamDeck.connect();