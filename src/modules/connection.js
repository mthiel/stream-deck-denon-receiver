import net from "net";
import { EventEmitter } from "events";
import { setTimeout } from "timers/promises";

import { TelnetSocket } from "telnet-stream";

/** @typedef {import("@elgato/streamdeck").Logger} Logger */
/** @typedef {import("@elgato/streamdeck").Action} Action */

/** @typedef {import("../plugin").PluginContext} PluginContext */
/** @typedef {import("./tracker").ReceiverInfo} ReceiverInfo */

/**
 * @typedef {Object} ReceiverEvent
 * @property { "connected" 
 * 			 | "closed"
 * 			 | "powerChanged"
 * 			 | "volumeChanged"
 * 			 | "muteChanged"
 * 			 | "status"
 * 			 | "sourceChanged"
 * 			 | "dynamicVolumeChanged"} type - The type of event.
 * @property {number} [zone] - The zone that the event occurred on.
 * @property {AVRConnection} connection - The receiver connection.
 * @property {Action[]} [actions] - The actions to inform of the event.
 */

/**
 * @typedef {"OFF" | "LIT" | "MED" | "HEV" | undefined} DynamicVolume
 */

/**
 * @typedef {Object} ReceiverZoneStatus
 * @property {boolean} power - Whether the zone is powered on.
 * @property {number} volume - The current volume of the zone.
 * @property {number} maxVolume - The (current) maximum volume of the receiver.
 * @property {DynamicVolume} [dynamicVolume] - Whether the volume is dynamic.
 * @property {boolean} muted - Whether the zone is muted.
 * @property {string} source - The current source of the zone.
 */

/**
 * @typedef {Object} ReceiverStatus
 * @property {ReceiverZoneStatus[]} zones - The status of each zone.
 * @property {string} statusMsg - The status message for this connection.
 */

const sources = {
	"PHONO": "Phono",
	"CD": "CD",
	"TUNER": "Tuner",
	"DVD": "DVD",
	"BD": "Blu-ray",
	"TV": "TV Audio",
	"SAT/CBL": "Cable / Satellite",
	"MPLAY": "Media Player",
	"GAME": "Game",
	"HDRADIO": "HD Radio",
	"NET": "Online Music",
	"PANDORA": "Pandora",
	"SIRIUSXM": "SiriusXM",
	"SPOTIFY": "Spotify",
	"LASTFM": "Last.fm",
	"FLICKR": "Flickr",
	"IRADIO": "iRadio",
	"SERVER": "Server",
	"FAVORITES": "Favorites",
	"AUX": "Aux",
	"AUX1": "Aux 1",
	"AUX2": "Aux 2",
	"AUX3": "Aux 3",
	"AUX4": "Aux 4",
	"AUX5": "Aux 5",
	"AUX6": "Aux 6",
	"AUX7": "Aux 7",
	"BT": "Bluetooth",
	"USB/IPOD": "USB/iPod",
	"USB": "USB",
	"IPD": "iPod",
	"IRP": "iRadio",
	"FVP": "",
	"ON": "Video Select: On",
	"OFF": "Video Select: Off"
};

/**
 * Represents a connection to a Denon AVR receiver
 */
export class AVRConnection {
	/** @type {Logger} */
	logger;

	/**
	 * The current status of the receiver
	 * @type {ReceiverStatus}
	 */
	status = {
		zones: [
			{
				power: false,
				volume: 0,
				maxVolume: 85,
				muted: false,
				dynamicVolume: "OFF",
				source: "",
			},
			{
				power: false,
				volume: 0,
				maxVolume: 85,
				muted: false,
				source: "",
			},
		],
		statusMsg: "Initializing...",
	};

	/**
	 * The event emitter for this instance
	 * @type {EventEmitter}
	 */
	#eventEmitter = new EventEmitter();

	/**
	 * The listeners for this instance
	 * @type {string[]}
	 */
	#listenerIds = [];

	/**
	 * The raw socket connection to the receiver
	 * @type {net.Socket | undefined}
	 */
	#rawSocket;

	/**
	 * The telnet socket connection to the receiver
	 * @type {TelnetSocket | undefined}
	 */
	#telnet;

	/**
	 * The number of times in a row that we've retried connecting
	 * @type {number}
	 */
	#reconnectCount = 0;

	/**
	 * The host address of the receiver
	 * @type {string}
	 */
	#host;
	get host() { return this.#host; }

	/**
	 * The UUID of the receiver
	 * @type {string}
	 */
	#uuid;
	get uuid() { return this.#uuid; }

	static get sources() { return sources; }

	/**
	 * Create a new DenonAVR instance and attempt to connect to the receiver
	 * @param {PluginContext} plugin - The plugin context to use
	 * @param {string} uuid - The UUID of the receiver on the network
	 * @param {string} host - The IP address of the receiver to connect to
	 */
	constructor(plugin, uuid, host) {
		this.logger = plugin.logger.createScope(this.constructor.name);

		this.#host = host;
		this.#uuid = uuid;
		this.connect();
	}

	/**
	 * Connect to a receiver
	 */
	async connect() {
		this.logger.debug(`Connecting to Denon receiver: ${this.#host}`);

		let rawSocket = net.createConnection(23, this.#host);
		let telnet = new TelnetSocket(rawSocket);

		// Connection lifecycle events
		telnet.on("connect", () => this.#onConnect());
		telnet.on("close", (hadError) => this.#onClose(hadError));
		telnet.on("error", (error) => this.#onError(error));

		// Ignore standard telnet negotiation
		telnet.on("do", (option) => telnet.writeWont(option));
		telnet.on("will", (option) => telnet.writeDont(option));

		// Data events
		telnet.on("data", (data) => this.#onData(data));

		// Assign the telnet socket to the instance
		this.#rawSocket = rawSocket;
		this.#telnet = telnet;
	}

	/**
	 * Disconnect from the receiver and clean up resources
	 */
	disconnect() {
		let rawSocket = this.#rawSocket;
		let telnet = this.#telnet;

		// Clear the listeners for this instance
		this.#listenerIds = [];

		// Dispose of this instance's sockets
		this.#rawSocket = undefined;
		this.#telnet = undefined;

		if (telnet && rawSocket?.destroyed !== true) {
			telnet.destroy();

			// Set a timeout to clean up the sockets
			setTimeout(1000).then(() => {
				if (telnet && rawSocket?.destroyed !== true) {
					telnet.unref();
					rawSocket?.unref();
				}
			});
		}
	}

	/**
	 * Change the volume by the given delta
	 * @param {number} delta - The amount to change the volume by
	 * @param {number} [zone=0] - The zone to change the volume for
	 * @returns {boolean} Whether the command was sent successfully
	 */
	changeVolume(delta, zone = 0) {
		const telnet = this.#telnet;
		const status = this.status.zones[zone];

		if (!telnet || !status.power || status.volume === undefined) return false;

		try {
			let command = ["MV", "Z2"][zone];

			if (delta === 1) {
				command += "UP";
			} else if (delta === -1) {
				command += "DOWN";
			} else {
				let newVolumeStr = Math.max(0, Math.min(status.maxVolume, Math.round(status.volume + delta)))
					.toString()
					.padStart(2, "0");
				command += newVolumeStr;
			}

			telnet.write(command + "\r");
			this.logger.debug(`Sent volume command: ${command}`);
		} catch (error) {
			this.logger.error(`Error sending volume command: ${error.message}`);
			return false;
		}

		return true;
	}

	/**
	 * Change the volume to the given value
	 * @param {number} value - The new volume value to set
	 * @param {number} [zone=0] - The zone to change the volume for
	 * @returns {boolean} Whether the command was sent successfully
	 */
	changeVolumeAbsolute(value, zone = 0) {
		const telnet = this.#telnet;
		const status = this.status.zones[zone];

		if (!telnet || !status.power) return false;

		try {
			let command = ["MV", "Z2"][zone];
			command += value.toString().padStart(2, "0");

			telnet.write(command + "\r");
			this.logger.debug(`Sent volume command: ${command}`);
		} catch (error) {
			this.logger.error(`Error sending volume command: ${error.message}`);
			return false;
		}

		return true;
	}

	/**
	 * Set the mute state
	 * @param {boolean} [value] - The new mute state to set
	 * @param {number} [zone=0] - The zone to set the mute state for
	 * @returns {boolean} Whether the command was sent successfully
	 */
	setMute(value, zone = 0) {
		const telnet = this.#telnet;
		const status = this.status.zones[zone];

		if (!telnet || !status.power) return false;

		if (value === undefined) value = !status.muted;

		let command = ["MU", "Z2MU"][zone];
		command += value ? "ON" : "OFF";

		telnet.write(command + "\r");
		this.logger.debug(`Sent mute command: ${command}`);

		return true;
	}

	/**
	 * Set the power state
	 * @param {boolean} [value] - The new power state to set. If not provided, toggle the current state.
	 * @param {number} [zone=0] - The zone to set the power state for
	 * @returns {boolean} Whether the command was sent successfully
	 */
	setPower(value, zone = 0) {
		const telnet = this.#telnet;
		const status = this.status.zones[zone];

		if (!telnet) return false;

		if (value === undefined) value = !status.power;

		let command = ["PW", "Z2"][zone];
		command += value ? "ON" : ["STANDBY", "OFF"][zone];

		telnet.write(command + "\r");
		this.logger.debug(`Sent power command: ${command}`);

		return true;
	}

	/**
	 * Set the source of the given zone
	 * @param {string} value - The source to set
	 * @param {number} [zone=0] - The zone to set the source for
	 * @returns {boolean} Whether the command was sent successfully
	 */
	setSource(value, zone = 0) {
		const telnet = this.#telnet;
		if (!telnet || !value) return false;

		let command = ["SI", "Z2"][zone];
		command += value;

		telnet.write(command + "\r");
		this.logger.debug(`Sent source command: ${command}`);

		return true;
	}

	/**
	 * Set the video select source of the given zone
	 * @param {string} value - The source to set
	 * @returns {boolean} Whether the command was sent successfully
	 */
	setVideoSelectSource(value) {
		const telnet = this.#telnet;
		if (!telnet || !value) return false;

		let command = "SV";
		command += value;

		telnet.write(command + "\r");
		this.logger.debug(`Sent video select source command: ${command}`);

		return true;
	}

	/**
	 * Set the dynamic volume state
	 * @param {DynamicVolume} value - The new dynamic volume state to set
	 * @returns {boolean} Whether the command was sent successfully
	 */
	setDynamicVolume(value) {
		const telnet = this.#telnet;
		if (!telnet) return false;

		let command = "PSDYNVOL ";
		command += value;

		telnet.write(command + "\r");
		this.logger.debug(`Sent dynamic volume command: ${command}`);

		return true;
	}

	/** @typedef {(...args: any[]) => void} EventListener */

	/**
	 * Subscribe to events from this receiver
	 * @param {EventListener} listener - The listener function to call when the event is emitted
	 * @param {string} id - The binding ID for this listener, should be the manifest ID of the action that is listening
	 */
	on(listener, id) {
		const listenerId = `${id}-${listener.name}`;

		// Don't add the same listener twice
		if (this.#listenerIds.includes(listenerId)) {
			return;
		}

		this.#listenerIds.push(listenerId);

		this.#eventEmitter.on("event", listener);
	}

	/**
	 * Emit an event from this receiver
	 * @param {ReceiverEvent["type"]} type - The type of event to emit
	 * @param {ReceiverEvent["zone"]} [zone] - The zone that the event occurred on
	 */
	emit(type, zone = 0) {
		/** @type {ReceiverEvent} */
		const payload = { type, zone, connection: this };
		this.#eventEmitter.emit("event", payload);
	}

	/**
	 * Handle connection events
	 */
	#onConnect() {
		this.logger.debug(`Telnet connection established to Denon receiver at ${this.#host}`);

		this.#reconnectCount = 0;
		this.status.statusMsg = "Connected.";

		this.emit("connected");

		this.#requestFullReceiverStatus();
	}

	/**
	 * Handle connection closing event
	 * @param {boolean} [hadError=false] - Whether the connection was closed due to an error.
	 */
	#onClose(hadError = false) {
		(hadError ? this.logger.warn : this.logger.debug)(`Telnet connection to Denon receiver at ${this.#host} closed${hadError ? " due to error" : ""}.`);

		this.emit("closed");

		// Attempt to reconnect if we haven't given up yet
		if (this.#telnet && this.#reconnectCount < 10) {
			this.#reconnectCount++;

			setTimeout(1000).then(() => {
				this.logger.debug(`Trying to reconnect to Denon receiver at ${this.#host}. Attempt ${this.#reconnectCount}`);
				this.connect();
			});
		}
	}

	/**
	 * Incoming data from the receiver
	 * @param {Buffer | string} data
	 */
	#onData(data) {
		let lines = data.toString().split("\r");
		for (let line of lines) {
			if (line.length === 0) continue;

			let command = "";
			let parameter = "";
			let zone = 0;

			if (line.startsWith("Z2")) {
				// Zone 2 status messages start with "Z2"
				zone = 1;
				line = line.substring(2); // Remove the "Z2" prefix

				// Special parsing for zone 2 due to a lack of "command" portion
				if (parseInt(line.substring(0, 2)) > 0) {
					// Volume
					command = "MV";
					parameter = line.substring(2);
				} else if (line.startsWith("ON") || line.startsWith("OFF")) {
					// Power
					command = "PW";
					parameter = line;
				} else if (line in sources) {
					// Source
					command = "SI";
					parameter = line;
				} else {
					// Resume default parsing
					command = line.substring(0, 2);
					parameter = line.substring(2);
				}
			} else if (line.startsWith("PS")) {
				// Unclear what this meta-command stands for
				line = line.substring(2);  // Remove the "PS" prefix

				// These commands are all space-delimited from their values
				[command, parameter] = line.split(" ");
			} else {
				// Default parsing
				command = line.substring(0, 2);
				parameter = line.substring(2);
			}

			switch (command) {
				case "PW": // Power
					this.#onPowerChanged(parameter, zone);
					break;
				case "MV": // Volume or max volume
					this.#onVolumeChanged(parameter, zone);
					break;
				case "MU": // Mute
					this.#onMuteChanged(parameter, zone);
					break;
				case "SI": // Source
					this.#onSourceChanged(parameter, zone);
					break;
				case "DYNVOL": // Dynamic volume
					this.#onDynamicVolumeChanged(parameter);
					break;
				default:
					this.logger.warn(`Unhandled message from receiver at ${this.#host} Z${zone === 0 ? "M" : "2"}: ${line}`);
					break;
			}
		}
	}

	/**
	 * Handle a power changed message from the receiver
	 * @param {string} parameter - The parameter from the receiver
	 * @param {number} [zone=0] - The zone that the power status changed for
	 */
	#onPowerChanged(parameter, zone = 0) {
		const status = this.status.zones[zone];

		// The receiver will send "ON" or "STANDBY" in zone 1, and "ON" or "OFF" in zone 2
		// It also repeats the power status at a regular interval, so we don't need to emit an event for every message
		const newStatus = parameter === "ON";
		if (newStatus === status.power) return;

		status.power = newStatus;
		this.logger.debug(`Updated receiver power status for ${this.#host} Z${zone === 0 ? "M" : "2"}: ${status.power}`);

		this.emit("powerChanged", zone);

		// Request the full status of the receiver if it is powered on
		// if (status.power) {
		// 	this.#requestFullReceiverStatus();
		// }
	}

	/**
	 * Handle a volume changed message from the receiver
	 * @param {string} parameter - The parameter from the receiver
	 * @param {number} [zone=0] - The zone that the volume status changed for
	 */
	#onVolumeChanged(parameter, zone = 0) {
		const status = this.status.zones[zone];

		if (parameter.startsWith("MAX")) {
			// The "MAX" extended command is not documented, but it is used by the receiver
			// Guessing this is the current maximum volume supported by the receiver
			// In testing, this value raises as the volume approaches the maximum
			// Ex: "MAX 855"
			let valueStr = parameter.substring(4);
			let newMaxVolume = parseInt(valueStr);
			if (valueStr.length === 3) {
				newMaxVolume = newMaxVolume / 10;
			}

			status.maxVolume = newMaxVolume;
			this.logger.debug(`Updated receiver max volume for ${this.#host} Z${zone === 0 ? "M" : "2"}: ${status.maxVolume}`);

			// this.emit("maxVolumeChanged");
		} else {
			let newVolume = parseInt(parameter);
			if (parameter.length === 3) {
				newVolume = newVolume / 10;
			}

			status.volume = newVolume;
			status.muted = false; // Implied by the volume changing
			this.logger.debug(`Updated receiver volume for ${this.#host} Z${zone === 0 ? "M" : "2"}: ${status.volume}`);

			this.emit("volumeChanged", zone);
		}
	}

	/**
	 * Handle a mute changed message from the receiver
	 * @param {string} parameter - The parameter from the receiver
	 * @param {number} [zone=0] - The zone that the mute status changed for
	 */
	#onMuteChanged(parameter, zone = 0) {
		const status = this.status.zones[zone];

		status.muted = parameter == "ON";
		this.logger.debug(`Updated receiver mute status for ${this.#host} Z${zone === 0 ? "M" : "2"}: ${status.muted}`);

		this.emit("muteChanged", zone);
	}

	/**
	 * Handle a source changed message from the receiver
	 * @param {string} parameter - The parameter from the receiver
	 * @param {number} [zone=0] - The zone that the source status changed for
	 */
	#onSourceChanged(parameter, zone = 0) {
		const status = this.status.zones[zone];

		status.source = parameter;
		this.logger.debug(`Updated receiver source for ${this.#host} Z${zone === 0 ? "M" : "2"}: ${status.source}`);

		this.emit("sourceChanged", zone);
	}

	/**
	 * Handle a dynamic volume changed message from the receiver
	 * @param {string} parameter - The parameter from the receiver
	 */
	#onDynamicVolumeChanged(parameter) {
		if (!["HEV", "MED", "LIT", "OFF"].includes(parameter)) {
			this.logger.warn(`Invalid dynamic volume value received from receiver at ${this.#host}: ${parameter}`);
			return;
		}

		const status = this.status;

		status.zones[0].dynamicVolume = /** @type {DynamicVolume} */ (parameter);
		this.logger.debug(`Updated receiver dynamic volume status for ${this.#host}: ${status.zones[0].dynamicVolume}`);

		this.emit("dynamicVolumeChanged");
	}

	/**
	 * Handle socket errors
	 * @param {Object} error
	 */
	#onError(error) {
		const status = this.status;

		if (error.code === "ENOTFOUND") {
			// If the host can't be looked up, give up.
			status.statusMsg = `Host not found: ${this.#host}`;
			this.disconnect();
		} else {
			status.statusMsg = `Connection error: ${error.message} (${error.code})`;
		}

		this.logger.warn(status.statusMsg);
		this.emit("status");
	}

	/**
	 * Request the full status of the receiver
	 * Usually only needed when the connection is first established
	 */
	#requestFullReceiverStatus() {
		const telnet = this.#telnet;
		if (!telnet) return;

		// Main zone
		telnet.write("PW?\r"); // Request the power status
		telnet.write("MV?\r"); // Request the volume
		telnet.write("MU?\r"); // Request the mute status
		telnet.write("PSDYNVOL ?\r"); // Request the dynamic volume status

		// Zone 2
		telnet.write("Z2PW?\r"); // Request the power status
		telnet.write("Z2MV?\r"); // Request the volume
		telnet.write("Z2MU?\r"); // Request the mute status
	}
}