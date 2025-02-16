import dgram from "dgram";
import os from "os";
import { EventEmitter } from "events";
import { DOMParser } from "@xmldom/xmldom";
/** @typedef {import("dgram").Socket} Socket */
/** @typedef {import("dgram").RemoteInfo} RemoteInfo */

import streamDeck from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").Logger} Logger */

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
const SSDP_BROADCAST_INTERVAL = (SSDP_SEARCH_MX) * 1000; // 3000 ms
const SSDP_BROADCAST_LIMIT = 3; // Number of broadcasts to send before stopping

/** @type {Logger} */
let logger = streamDeck.logger;

// Prep a udp socket for SSDP/UPnP discovery
/** @type {Socket} */
var udpSocket;

const emitter = new EventEmitter();

/** @type {ReceiverList} */
let receiverList = {};

/**
 * The delay timer for writing the receiver list to the settings cache
 * @type {NodeJS.Timeout | undefined}
 */
let cacheWriteTimer;

/**
 * Whether the tracker is currently scanning for receivers, used to prevent duplicate scans.
 * Defaults to true to ensure initialization completes before any actions attempt to connect.
 * @type {boolean}
 */
let isScanning = true;

/**
 * Create an SSDP search message
 * @param {number} [mx] - The maximum wait time for a response
 * @returns {string}
 */
function createSSDPMessage(mx = SSDP_SEARCH_MX) {
	return 'M-SEARCH * HTTP/1.1\r\n' +
		`HOST: ${SSDP_BROADCAST_ADDRESS}:${SSDP_BROADCAST_PORT}\r\n` +
		'MAN: "ssdp:discover"\r\n' +
		`MX: ${mx}\r\n` +
		`ST: ${SSDP_SEARCH_TARGET}\r\n` +
		'\r\n';
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
		logger.debug(`AVRTracker received a response without a USN from ${rinfo.address}`);
		return;
	}

	/** @type {UUID} */
	const uuid = usn.split("::")[0].split("uuid:")[1];
	if (!uuid) {
		logger.debug(`AVRTracker received a response with an invalid USN from ${rinfo.address}`);
		return;
	}

	logger.debug(`AVRTracker received an SSDP response from ${uuid}`);

	const isNew = !receiverList[uuid];

	// Update the list of receivers with details from the response
	/** @type {ReceiverInfo} */
	const receiver = {
		currentIP: rinfo.address,
		descriptionURL: headers.LOCATION || undefined,
		lastSeen: Date.now()
	};
	receiverList[uuid] = receiver;

	// If we have a description URL, try to get the name from it
	if (receiver.descriptionURL && !receiver.name) {
		updateNameFromDescriptionURL(uuid)
			.then(() => {
				if (isNew) {
					emitter.emit("updated");
				}
				updatePersistentCache();
			});
		return;
	}

	// Inform listeners if any new receivers were detected
	if (isNew) {
		setImmediate(() => emitter.emit("updated"));
	}

	updatePersistentCache();
}

async function updateNameFromDescriptionURL(receiverID) {
	const receiver = receiverList[receiverID];
	if (!receiver || !receiver.descriptionURL) {
		return;
	}

	// Get the name of the receiver from the description URL
	const response = await fetch(receiver.descriptionURL);
	if (!response.ok) {
		// If we couldn't get the description, just clear the URL and move on
		delete receiver.descriptionURL;
		logger.debug(`Failed to fetch device description for ${receiverID}: ${response.statusText}`);
		return;
	}

	const xmlText = await response.text();
	const parser = new DOMParser();
	const xmlDoc = parser.parseFromString(xmlText, "text/xml");
	const friendlyName = xmlDoc.getElementsByTagName("friendlyName")[0]?.textContent;
	if (friendlyName) {
		receiver.name = friendlyName;
	} else {
		delete receiver.descriptionURL;
		logger.debug(`Couldn't find friendlyName in the device description for ${receiverID}`);
	}
}

/**
 * Update the global settings cache with the new receiver details.
 * This is scheduled to delay a bit to prevent an active scan from making excessive changes to the settings.
 */
function updatePersistentCache() {
	if (cacheWriteTimer) {
		// If there's already a timer running, clear it so we just delay longer instead of running multiple times.
		clearTimeout(cacheWriteTimer);
	}

	// Set the timer to eventually update the global settings cache with the new receiver details.
	cacheWriteTimer = setTimeout(() => {
		streamDeck.settings.getGlobalSettings().then((settings) => {
			settings.receiverList = receiverList;
			streamDeck.settings.setGlobalSettings(settings)
			.then(() => {
				logger.debug("AVRTracker updated the global settings cache with the new receiver details.");
			})
			.catch((error) => {
				logger.error(`AVRTracker failed to update the global settings cache: ${error}`);
			});
		});
	}, 10000); // 10 second delay
}

async function readFromPersistentCache() {
	const settings = (await streamDeck.settings.getGlobalSettings());

	if (settings.receiverList) {
		receiverList = /** @type {ReceiverList} */ (settings.receiverList);
	}
}

/**
 * Utility module for tracking HEOS-enabled AVR receivers on the network via SSDP/UPnP protocol
 */
export const AVRTracker = {
	/**
	 * Set the logger instance to use
	 * @param {Logger} newLogger - The new logger instance
	 */
	setLogger(newLogger) {
		logger = newLogger.createScope("AVRTracker");
	},

	/**
	 * Initialize the tracker
	 * @returns {Promise<void>}
	 */
	listen: async () => {
		logger.debug("AVRTracker listener initializing...");

		// First bind to all interfaces, then configure multicast
		udpSocket = dgram.createSocket({ 
			type: "udp4",
			reuseAddr: true,
			ipv6Only: false
		})
		.on("listening", () => { 
			try {
				// Essential Windows multicast setup
				udpSocket.setBroadcast(true);
				udpSocket.setMulticastTTL(4); // Reduced TTL, some Windows systems have issues with higher values
				udpSocket.setMulticastLoopback(true);

				// Get all network interfaces
				const interfaces = os.networkInterfaces();
				Object.values(interfaces).forEach((iface) => {
					if (!iface) return;

					iface.forEach((address) => {
						// Only handle IPv4 interfaces that aren't internal
						if (address.family === 'IPv4' && !address.internal) {
							try {
								// First try to add membership with specific interface
								udpSocket.addMembership(SSDP_BROADCAST_ADDRESS, address.address);
								logger.debug(`Added multicast membership for interface ${address.address}`);

								// On Windows, explicitly set the multicast interface
								udpSocket.setMulticastInterface(address.address);
								logger.debug(`Set multicast interface to ${address.address}`);
							} catch (err) {
								logger.debug(`Failed to configure interface ${address.address}: ${err.message}`);
							}
						}
					});
				});

				logger.debug(`AVRTracker udp socket listening on ${udpSocket.address().address}:${udpSocket.address().port}`);
			} catch (err) {
				logger.error(`Error configuring multicast: ${err.message}`);
			}
		})
		.on("message", (message, rinfo) => { onResponse(message, rinfo) })
		.on("error", (error) => { logger.error(`AVRTracker error: ${error}`) });

		// Bind to all interfaces
		await new Promise((resolve) => {
			udpSocket.bind({
				port: 0,
				address: '0.0.0.0',
				exclusive: false
			}, () => {
				resolve(undefined);
			});
		});

		// Read the receiver list from the global settings cache
		await readFromPersistentCache();

		// We've retrieved the receiver list from the cache, so we're no longer "scanning"
		isScanning = false;
		emitter.emit("scanned");
	},

	/**
	 * Perform an active search for HEOS-enabled AVR receivers on the network
	 * @param {number} [count] - The number of SSDP messages to send
	 * @param {number} [maxWait] - The maximum wait time for a response
	 * @returns {Promise<ReceiverList>}
	 */
	searchForReceivers: async (count = SSDP_BROADCAST_LIMIT, maxWait = SSDP_BROADCAST_INTERVAL) => {
		if (isScanning) {
			// If we're already scanning, just wait for the current scan to complete and return the results
			await new Promise((resolve) => AVRTracker.once("scanned", resolve));
			return receiverList;
		}

		logger.info("AVRTracker broadcasting SSDP search for HEOS receivers on the network...");
		isScanning = true;
		const startTime = Date.now();

		function onUpdate() {
			const newCount = Object.values(receiverList).filter((r) => r.lastSeen > startTime).length;
			logger.info(`AVRTracker received ${newCount} new responses while actively searching.`);
		}

		AVRTracker.on("updated", onUpdate);

		// Get all network interfaces
		const interfaces = os.networkInterfaces();
		const message = createSSDPMessage(maxWait);

		// The broadcast and wait loop
		for (let i = 1; i <= count; i++) {
			// Send on each interface
			Object.values(interfaces).forEach((iface) => {
				if (!iface) return;

				iface.forEach((address) => {
					if (address.family === 'IPv4' && !address.internal) {
						try {
							udpSocket.setMulticastInterface(address.address);
							udpSocket.send(message, SSDP_BROADCAST_PORT, SSDP_BROADCAST_ADDRESS);
							logger.debug(`Sent request ${i} on interface ${address.address}`);
						} catch (err) {
							logger.debug(`Failed to send on interface ${address.address}: ${err.message}`);
						}
					}
				});
			});

			logger.info(`AVRTracker sent request ${i} of ${count}. Waiting for replies...`);
			await new Promise((resolve) => setTimeout(resolve, maxWait * 1000));
		}

		AVRTracker.off("updated", onUpdate);

		isScanning = false;

		emitter.emit("scanned");

		return receiverList;
	},

	/**
	 * Get the current list of detected receivers
	 * @returns {ReceiverList}
	 */
	getReceivers: () => receiverList,

	/**
	 * Check if the tracker is currently scanning for receivers
	 * @returns {boolean}
	 */
	isScanning: () => isScanning,

	/**
	 * Subscribe to be notified of scanning events
	 * @param {"updated" | "scanned"} event - The event to listen for
	 * @param {EventListener} callback - The callback to call when the event is emitted
	 */
	on(event, callback) {
		emitter.on(event, callback);
	},

	/**
	 * Subscribe to be notified (once) of a scanning event
	 * @param {"updated" | "scanned"} event - The event to listen for
	 * @param {EventListener} callback - The callback to call when the event is emitted
	 */
	once(event, callback) {
		emitter.once(event, callback);
	},

	/**
	 * Unsubscribe from scanning events
	 * @param {"updated" | "scanned"} event - The event to remove the listener from
	 * @param {EventListener} callback - The callback to remove
	 */
	off(event, callback) {
		emitter.off(event, callback);
	}
}
