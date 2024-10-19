import net from "net";
import { setTimeout } from "timers/promises";
import { TelnetSocket } from "telnet-stream";
import streamDeck from "@elgato/streamdeck";

const HEOS_PORT = 1255;

/**
 * Use the HEOS Telnet API to request the name of the receiver
 * @param {string} host - The host address of the receiver
 * @returns {Promise<string | undefined>} A promise that resolves to the name of the receiver, or undefined if not found
 */
export async function getNameFromHostByTelnet(host) {
    streamDeck.logger.debug(`Opening HEOS CLI connection to ${host} to request the receiver name.`);

    /** 
     * Structure of a HEOS command response
     * @typedef {Object} HEOSResponse
     * @property {Object} heos - The HEOS command response object
     * @property {string} heos.command - The command that was sent
     * @property {string} heos.result - The result of the command
     * @property {string} heos.message - The message from the command
     * @property {HEOSPlayer[]} payload - The payload from the command (an array of players for get_players)
     */

    /** 
     * @typedef {Object} HEOSPlayer
     * @property {string} name - The name of the player
     * @property {number} pid - The player ID
     * @property {string} model - The model of the player
     * @property {string} version - The version of the player
     * @property {string} ip - The IP address of the player
     * @property {string} network - The network type of the player
     * @property {number} lineout - The lineout number of the player
     * @property {string} serial - The serial number of the player
     */

    let name;
    const ac = new AbortController();

    // Set up a telnet connection to the receiver on port 1255
    const socket = net.createConnection(HEOS_PORT, host);
    const telnet = new TelnetSocket(socket);
    if (!telnet) return;

    // Ignore standard telnet negotiation
    telnet.on("do", (option) => telnet.writeWont(option));
    telnet.on("will", (option) => telnet.writeDont(option));

    telnet.on('connect', async () => {
        streamDeck.logger.debug(`Connected to HEOS receiver at ${host}, requesting the player list.`);
        // Send request for 'get_players'
        telnet.write("heos://player/get_players\r\n");
    });

    telnet.on('data', (data) => {
        streamDeck.logger.trace(`Received data from HEOS receiver at ${host}:\n${data}`);

        const lines = data.toString().split("\r\n").filter((line) => line.length > 0);

        // Try to parse the response(s) into JSON
        /** @type {HEOSResponse[]} */
        const responses = lines.map((line) => {
            try { return JSON.parse(line); }
            catch(e) {
                // Ignore malformed responses
                streamDeck.logger.warn(`Error parsing HEOS response from HEOS receiver at ${host}: ${line}`);
            }
        })
        .filter((response) => response !== undefined);

        // Filter parsed response(s) for matching 'get_players' command
        const validResponses = responses.filter((response) => {
            return response.heos?.command === "player/get_players"
                && response.heos?.result === "success"
                && response.payload?.length > 0;
        });

        // Flatten the 'payload' of each valid response into a single array
        const players = validResponses.map((response) => {
            return response.payload;
        }).flat();

        // Locate the player with a matching IP address
        const player = players.find((player) => {
            return player.ip == host;
        });

        name = player?.name;

        streamDeck.logger.debug(`Received player name from HEOS receiver at ${host}: ${name}`);

        // Stop waiting for a response if we found a match
        ac.abort();
    });

    telnet.on('error', (error) => {
        streamDeck.logger.error(`Error opening HEOS connection to ${host}: ${error}`);
    });

    telnet.on('close', () => {
        streamDeck.logger.debug(`HEOS connection to ${host} closed.`);
    });

    // Wait for a response until 'get_players' response is received, or timeout
    try {
        await setTimeout(1000, null, { signal: ac.signal });
        streamDeck.logger.warn(`Timeout waiting for HEOS response from ${host}.`);
    } catch(e) {
        // Aborted due to success, ironically.
    }

    streamDeck.logger.debug(`Closing HEOS connection to ${host}.`);

    telnet.end();

    return name;
}