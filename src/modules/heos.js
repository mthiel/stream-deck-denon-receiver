import net from "net";
import dgram, { Socket } from "dgram";
import { setTimeout } from "timers/promises";
import { TelnetSocket } from "telnet-stream";
import { EventEmitter } from "events";
import streamDeck from "@elgato/streamdeck";

const HEOS_PORT = 1255;
const SSDP_BROADCAST_PORT = 1900;
const SSDP_BROADCAST_ADDRESS = "239.255.255.250";
const SSDP_BROADCAST_INTERVAL = 60000; // 1 minute

/**
 * Utility class to search for HEOS receivers on the network
 */
export class HEOSSearch {
    /** @type {Socket} */
    #socket;

    /** @type {EventEmitter} */
    #emitter;

    /** @type {NodeJS.Timeout | undefined} */
    #broadcastInterval;

    /** @type {boolean} */
    #isReady = false;
    get isReady() { return this.#isReady; }

    /** @type {boolean} */
    #destroyed = false;
    get destroyed() { return this.#destroyed; }

    /**
     * Create a new HEOS search instance
     */
    constructor() {
        this.#socket = dgram.createSocket("udp4");
        this.#emitter = new EventEmitter();

		this.#socket.once("listening", () => { this.#isReady = true; });
		this.#socket.on("message", (message, rinfo) => { this.#onMessage(message, rinfo) });
        this.#socket.on("error", (error) => { this.#onError(error) });

        this.#socket.bind();
    }

   	/** @typedef {(...args: any[]) => void} EventListener */

    /**
     * Subscribe to an event
     * @param {"response"} eventName - The name of the event to subscribe to
     * @param {EventListener} listener - The listener function to call when the event is emitted
     */
    on(eventName, listener) {
        this.#emitter.on(eventName, listener);
    }

    /**
     * Start searching for HEOS receivers on the network
     */
    startSearching() {
        streamDeck.logger.debug("Started search for HEOS receivers on the network.");
        this.#broadcastInterval = setInterval(() => { this.#broadcastSearch() }, SSDP_BROADCAST_INTERVAL);
        this.#broadcastSearch();
    }

    /**
     * Stop searching for HEOS receivers on the network
     */
    stopSearching() {
        if (!this.#broadcastInterval) return;

        streamDeck.logger.debug("Stopped search for HEOS receivers on the network.");
        clearInterval(this.#broadcastInterval);
        this.#broadcastInterval = undefined;
    }

    /**
     * Close the HEOS search and clean-up resources
     */
    close() {
        this.stopSearching();
        this.#isReady = false;
        this.#socket.close();
        this.#emitter.removeAllListeners();
        this.#destroyed = true;
    }

    /**
     * Broadcast an SSDP M-SEARCH message for HEOS receivers on the LAN
     */
    #broadcastSearch() {
        if (!this.isReady) return;

        streamDeck.logger.debug(`Broadcasting an SSDP M-SEARCH message for HEOS receivers on the LAN`);

        const message = Buffer.from(
            'M-SEARCH * HTTP/1.1\r\n' +
            'HOST: ' + SSDP_BROADCAST_ADDRESS + ':' + SSDP_BROADCAST_PORT + '\r\n' +
            'MAN: "ssdp:discover"\r\n' +
            'ST: urn:schemas-denon-com:device:ACT-Denon:1\r\n' +
            'MX: 1\r\n' +
            '\r\n'
        );

        streamDeck.logger.trace(`SSDP M-SEARCH Request:\n${message}`);
        this.#socket.send(message, 0, message.length, SSDP_BROADCAST_PORT, SSDP_BROADCAST_ADDRESS);
    }

    #onMessage(message, rinfo) {
        streamDeck.logger.debug(`SSDP M-SEARCH Reply from ${rinfo.address}:\n${message}`);

        this.#emitter.emit("response", rinfo.address);
    }

    #onError(error) {
        streamDeck.logger.error(`Error performing HEOS search: ${error}`);
        this.close();
    }
}

/**
 * Request the name of the receiver from it's HEOS API
 * @param {string} host - The host address of the receiver
 * @param {"telnet" | "http"} [method="telnet"] - The method to use to request the receiver name
 * @returns {Promise<string | undefined>} A promise that resolves to the name of the receiver, or undefined if not found
 */
export async function getReceiverNameFromHost(host, method = "telnet") {
    // This is a proxy function in case I want to add an HTTP request method in the future

    switch(method) {
        case "telnet":
            return getReceiverNameFromHostByTelnet(host);
        default:
            throw new Error(`Unsupported method: ${method}`);
    }
}

/**
 * Use the HEOS Telnet API to request the name of the receiver
 * @param {string} host - The host address of the receiver
 * @returns {Promise<string | undefined>} A promise that resolves to the name of the receiver, or undefined if not found
 */
async function getReceiverNameFromHostByTelnet(host) {
    streamDeck.logger.debug(`Opening HEOS connection to ${host} to request the receiver name.`);

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