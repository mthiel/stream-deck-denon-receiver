import streamDeck from "@elgato/streamdeck";

import { VolumeAction } from "./actions/volume";
import { PowerAction } from "./actions/power";

// Register the volume control action.
streamDeck.actions.registerAction(new VolumeAction());
streamDeck.actions.registerAction(new PowerAction());

// Finally, connect to the Stream Deck.
streamDeck.connect();
