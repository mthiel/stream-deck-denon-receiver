import streamDeck, { LogLevel } from '@elgato/streamdeck';
import { DenonAVR } from './modules/denonavr';
import { AVRVolume } from './actions/avrvolume';

const logger = streamDeck.logger.createLogger('DenonAVR');

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
logger.setLevel(LogLevel.TRACE);

// Register the increment action.
streamDeck.actions.registerAction(new AVRVolume());

// Finally, connect to the Stream Deck.
streamDeck.connect();
