import { EventEmitter } from "events";
import streamDeck from "@elgato/streamdeck";
import { Client as SSDPClient } from "node-ssdp";
/** @typedef {import("node-ssdp").SsdpHeaders} SsdpHeaders */
/** @typedef {import("dgram").RemoteInfo} RemoteInfo */

/**
 * @typedef {Object} SSDPReply
 * @property {string} currentIP - The current IP address of the receiver
 * @property {NodeJS.Timeout} cacheTimer - The cache timer for the ssdp response
 * @property {string} [name] - The name of the receiver (if known)
 */

/** @typedef {Omit<SSDPReply, "cacheTimer">} ReceiverInfo */
/** @typedef {string} UUID */
/** @typedef {Record<UUID, SSDPReply>} SSDPReplyCache */
/** @typedef {Record<UUID, ReceiverInfo>} ReceiverList */

// The node-ssdp library doesn't pass the cache time in the headers, so we need to cache for a fixed time
const CACHE_TIME = 180 * 1000;
const SEARCH_TARGET = "urn:schemas-denon-com:device:ACT-DenonAVR:1";

/** @type {SSDPClient} Our SSDP client */
const client = new SSDPClient();

/** @type {SSDPReplyCache} PRIVATE: The cache of SSDP replies */
const cacheDict = {};

/** @type {EventEmitter} PRIVATE: Our event emitter */
const emitter = new EventEmitter();

/**
 * Handle a response from a receiver on the network
 * @param {SsdpHeaders} headers - The headers from the response
 * @param {number} statusCode - The status code from the response
 * @param {RemoteInfo} rinfo - The remote info from the response
 */
function onResponse(headers, statusCode, rinfo) {
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

	// Just update the cache timer for the receiver details if it exists
	if (uuid in cacheDict) {
		clearTimeout(cacheDict[uuid].cacheTimer);
		cacheDict[uuid].cacheTimer = setTimeout(() => expireFromCache(uuid), CACHE_TIME);
		return;
	}

	// Add the new receiver details to the cache
	/** @type {SSDPReply} */
	const reply = {
		currentIP: rinfo.address,
		cacheTimer: setTimeout(() => expireFromCache(uuid), CACHE_TIME)
	};
	cacheDict[uuid] = reply;

	// Inform listeners that the receiver list has been updated
	setImmediate(() => emitter.emit("updated", AVRTracker.receivers()));
}

/**
 * Expire a response from a receiver from the cache
 * @param {UUID} uuid - The UUID of the receiver
 */
function expireFromCache(uuid) {
	delete cacheDict[uuid];
	streamDeck.logger.debug(`AVRTracker: SSDP cache expired for ${uuid}`);
}

/**
 * Utility module for tracking HEOS-enabled AVR receivers on the network via SSDP
 */
export const AVRTracker = {
	/**
	 * Start searching for receivers on the network
	 */
	startSearching: () => {
		client.search(SEARCH_TARGET)
		streamDeck.logger.debug(`AVRTracker started searching for ${SEARCH_TARGET}`);
	},

	/**
	 * The list of detected receivers
	 * @returns {ReceiverList}
	 */
	receivers: () => {
		return Object.entries(cacheDict)
			.reduce(
				(receivers, [/** @type {UUID} */ uuid, reply]) => {
					const { cacheTimer, ...rest } = reply;
					receivers[uuid] = rest;
					return receivers;
				},
				/** @type {ReceiverList} */({})
			);
	},

	/**
	 * Add an event listener for the "updated" event
	 * @param {"updated"} event - The event to listen for
	 * @param {EventListener} callback - The callback to call when the event is emitted
	 */
	on(event, callback) {
		emitter.on(event, callback);
	}
}

function init() {
	client.on("response", (headers, statusCode, rinfo) => { 
		onResponse(headers, statusCode, rinfo);
		streamDeck.logger.debug(`AVRTracker response handler called`);
	});
}

init();