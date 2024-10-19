import dgram, { Socket } from "dgram";
/** @typedef {import("dgram").RemoteInfo} RemoteInfo */
import { EventEmitter } from "events";

import streamDeck from "@elgato/streamdeck";

// TODO: Add HTTP retrieval of receiver description document and parsing for friendly name

// TODO: Add support for passively monitoring SSDP NOTIFY messages

// TODO: Add handler for system wake

/**
 * @typedef {Object} ReceiverInfo
 * @property {string} currentIP - The current IP address of the receiver
 * @property {number} lastSeen - The timestamp of the last time we saw a message
 * @property {string} [descriptionURL] - The URL to the description page of the receiver
 * @property {string} [name] - The name of the receiver (if known)
 */

/** @typedef {string} UUID */
/** @typedef {Record<UUID, ReceiverInfo>} ReceiverList */

const SSDP_BROADCAST_PORT = 1900;
const SSDP_BROADCAST_ADDRESS = "239.255.255.250";
const SSDP_SEARCH_TARGET = "urn:schemas-denon-com:device:ACT-Denon:1";
const SSDP_SEARCH_MX = 3; // 3 seconds
const SSDP_BROADCAST_INTERVAL = (SSDP_SEARCH_MX + 1) * 1000; // 4000 ms
const SSDP_BROADCAST_LIMIT = 3; // Number of broadcasts to send before stopping

const SSDP_SEARCH_MESSAGE =
	'M-SEARCH * HTTP/1.1\r\n' +
	`HOST: ${SSDP_BROADCAST_ADDRESS}:${SSDP_BROADCAST_PORT}\r\n` +
	'MAN: "ssdp:discover"\r\n' +
	`MX: ${SSDP_SEARCH_MX}\r\n` +
	`ST: ${SSDP_SEARCH_TARGET}\r\n` +
	'\r\n';

// Prep a udp socket for SSDP/UPnP discovery
/** @type {Socket} */
var udpSocket;

const emitter = new EventEmitter();

/** @type {NodeJS.Timeout | undefined} */
let broadcastTimer;

/** @type {number} */
let broadcastCounter = 0;

/** @type {ReceiverList} */
const receiverList = {};

function broadcastSearch() {
	udpSocket.send(SSDP_SEARCH_MESSAGE, SSDP_BROADCAST_PORT, SSDP_BROADCAST_ADDRESS);
	streamDeck.logger.debug(`AVRTracker broadcasted an SSDP search for ${SSDP_SEARCH_TARGET}`);

	broadcastCounter++;
	if (broadcastCounter >= SSDP_BROADCAST_LIMIT) {
		AVRTracker.stopBroadcasting();
	}
}

/**
 * Parse the headers from an SSDP response
 * @param {Buffer} message - The message from the response
 * @returns {Record<string, string>}
 */
function parseHeaders(message) {
	/** @type {Record<string, string>} */
	const headers = {};

	const lines = message.toString().split("\r\n");
	for (const line of lines) {
		const [key, value] = line.split(": ");
		headers[key] = value;
	}

	return headers;
}

/**
 * Handle a response from a receiver on the network
 * @param {Buffer} message - The message from the response
 * @param {RemoteInfo} rinfo - The remote info from the response
 */
function onResponse(message, rinfo) {
	const headers = parseHeaders(message);

	const usn = headers.USN;
	if (!usn) {
		streamDeck.logger.debug(`AVRTracker received a response without a USN from ${rinfo.address}`);
		return;
	}

	/** @type {UUID} */
	const uuid = usn.split("::")[0].split("uuid:")[1];
	if (!uuid) {
		streamDeck.logger.debug(`AVRTracker received a response with an invalid USN from ${rinfo.address}`);
		return;
	}

	streamDeck.logger.debug(`AVRTracker received an SSDP response from ${uuid}`);

	const isNew = !receiverList[uuid];

	// Update the list of receivers with details from the response
	/** @type {ReceiverInfo} */
	const receiver = {
		currentIP: rinfo.address,
		descriptionURL: headers.LOCATION || undefined,
		lastSeen: Date.now()
	};
	receiverList[uuid] = receiver;

	// Inform listeners if any new receivers were detected
	if (isNew) {
		setImmediate(() => emitter.emit("updated"));
	}
}

/**
 * Utility module for tracking HEOS-enabled AVR receivers on the network via SSDP/UPnP protocol
 */
export const AVRTracker = {
	/**
	 * Initialize the tracker
	 */
	listen: () => {
		streamDeck.logger.debug("AVRTracker initializing...");

		udpSocket = dgram
		.createSocket("udp4")
		.on("listening", () => { streamDeck.logger.debug("AVRTracker udp socket is ready."); })
		.on("message", (message, rinfo) => { onResponse(message, rinfo) })
		.on("error", (error) => { streamDeck.logger.error(`AVRTracker error: ${error}`) })
		.bind();
	},

	/**
	 * Perform an active search for HEOS-enabled AVR receivers on the network
	 * @returns {Promise<ReceiverList>}
	 */
	searchForReceivers: async () => {
		streamDeck.logger.info("AVRTracker broadcasting a SSDP search for HEOS receivers on the network...");

		const startTime = Date.now();

		function onUpdate() {
			const newCount = Object.values(receiverList).filter((r) => { r.lastSeen > startTime }).length;
			streamDeck.logger.info(`AVRTracker received ${newCount} new responses while actively searching.`);
		}

		AVRTracker.on("updated", onUpdate);

		for (let i = 1; i <= SSDP_BROADCAST_LIMIT; i++) {
			udpSocket.send(SSDP_SEARCH_MESSAGE, SSDP_BROADCAST_PORT, SSDP_BROADCAST_ADDRESS);

			streamDeck.logger.info(`AVRTracker sent request ${i} of ${SSDP_BROADCAST_LIMIT}. Waiting for replies...`);

			await new Promise((resolve) => setTimeout(resolve, SSDP_BROADCAST_INTERVAL));
		}

		AVRTracker.off("updated", onUpdate);

		return receiverList;
	},

	/**
	 * Start broadcasting for receivers on the network
	 */
	startBroadcasting: () => {
		streamDeck.logger.debug("AVRTracker started broadcasting for HEOS receivers on the network.");

		broadcastTimer = broadcastTimer || setInterval(broadcastSearch, SSDP_BROADCAST_INTERVAL);
		broadcastCounter = 0;
		broadcastSearch();
	},

	/**
	 * Stop broadcasting for receivers on the network
	 */
	stopBroadcasting: () => {
		if (!broadcastTimer) return;

		streamDeck.logger.debug("AVRTracker stopped broadcasting for HEOS receivers on the network.");
		clearInterval(broadcastTimer);
		broadcastTimer = undefined;
		broadcastCounter = 0;
	},

	/**
	 * Get the current list of detected receivers
	 * @returns {ReceiverList}
	 */
	getReceivers: () => receiverList,

	/**
	 * Event listener to be notified when the receiver list is updated
	 * @param {"updated"} event - The event to listen for
	 * @param {EventListener} callback - The callback to call when the event is emitted
	 */
	on(event, callback) {
		emitter.on(event, callback);
	},

	/**
	 * Remove an event listener from the receiver list
	 * @param {"updated"} event - The event to remove the listener from
	 * @param {EventListener} callback - The callback to remove
	 */
	off(event, callback) {
		emitter.off(event, callback);
	}
}
