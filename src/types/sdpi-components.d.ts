/// <reference path="./stream-deck.d.ts" />

declare namespace SDPIComponents {
    interface StreamDeckClient {
        /**
         * Gets the connection information used to connect to the Stream Deck.
         * @returns The connection information as a promise.
         */
        getConnectionInfo: () => Promise<import("stream-deck").ConnectionInfo>;

        /**
         * Request the global persistent data.
         * @returns The global settings as a promise.
         */
        getGlobalSettings: () => Promise<Record<string, unknown>>;

        /**
         * Save data securely and globally for the plugin.
         * @param value The global settings.
         * @returns The promise of sending the message that will set the global settings.
         */
        setGlobalSettings: (value: unknown) => Promise<void>;

        /**
         * Gets the settings.
         * @returns The settings as a promise.
         */
        getSettings: () => Promise<import("stream-deck").DidReceiveSettingsEvent["payload"]>;

        /**
         * Save data persistently for the action's instance.
         * {@link https://developer.elgato.com/documentation/stream-deck/sdk/events-sent/#setsettings}
         * @param value The settings.
         * @returns The promise of sending the message that will set the action settings.
         */
        setSettings: (value: unknown) => Promise<void>;

        /**
         * Sends a message to the Stream Deck.
         * @param {string} event The event name.
         * @param {unknown} payload The optional payload.
         */
        send: (event: string, data: unknown) => Promise<void>;
    }

    const streamDeckClient: StreamDeckClient;
}
