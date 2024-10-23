import net from "net";
import { EventEmitter } from "events";
import { setTimeout } from "timers/promises";

import { TelnetSocket } from "telnet-stream";

/** @typedef {import("@elgato/streamdeck").Logger} Logger */

/** @typedef {import("../plugin").PluginContext} PluginContext */
/** @typedef {import("./tracker").ReceiverInfo} ReceiverInfo */

/**
 * @typedef {Object} ReceiverEvent
 * @property {"connected" | "closed" | "powerChanged" | "volumeChanged" | "muteChanged" | "status"} type - The type of event.
 * @property {AVRConnection} connection - The receiver connection.
 * @property {Object} [actions] - The actions to inform of the event.
 */

/**
 * Represents a connection to a Denon AVR receiver
 */
export class AVRConnection {
	/** @type {Logger} */
	logger;

	/**
	 * Whether the receiver is powered on
	 * @type {boolean}
	 */
	power;

	/**
	 * The maximum volume of the receiver
	 * @type {number}
	 */
	maxVolume = 85;

	/**
	 * The current volume of the receiver
	 * @type {number}
	 */
	volume;

	/**
	 * Whether the receiver is muted
	 * @type {boolean}
	 */
	muted;

	/**
	 * The status message for this instance
	 * @type {string}
	 */
	statusMsg = "Initializing...";

	/**
	 * The event emitter for this instance
	 * @type {EventEmitter}
	 */
	#eventEmitter = new EventEmitter();

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
	 * @returns {boolean} Whether the command was sent successfully
	 */
	changeVolume(delta) {
		let telnet = this.#telnet;
		if (!telnet || !this.power || this.volume === undefined) return false;

		try {
			let command = "MV";

			if (delta === 1) {
				command += "UP";
			} else if (delta === -1) {
				command += "DOWN";
			} else {
				let newVolumeStr = Math.max(0, Math.min(this.maxVolume, Math.round(this.volume + delta)))
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
	 * @returns {boolean} Whether the command was sent successfully
	 */
	changeVolumeAbsolute(value) {
		let telnet = this.#telnet;
		if (!telnet || !this.power) return false;

		try {
			let command = `MV${value.toString().padStart(2, "0")}`;
			telnet.write(command + "\r");
			this.logger.debug(`Sent volume command: ${command}`);
		} catch (error) {
			this.logger.error(`Error sending volume command: ${error.message}`);
			return false;
		}

		return true;
	}

	/**
	 * Toggle the mute state
	 * @returns {boolean} Whether the command was sent successfully
	 */
	toggleMute() {
		let telnet = this.#telnet;
		if (!telnet || !this.power || this.muted === undefined) return false;

		try {
			let command = `MU${this.muted ? "OFF" : "ON"}`;

			telnet.write(command + "\r");
			this.logger.debug(`Sent mute command: ${command}`);
		} catch (error) {
			this.logger.error(`Error sending mute command: ${error.message}`);
			return false;
		}

		return true;
	}

	/**
	 * Set the power state
	 * @param {boolean} [value] - The new power state to set. If not provided, toggle the current state.
	 * @returns {boolean} Whether the command was sent successfully
	 */
	setPower(value) {
		let telnet = this.#telnet;
		if (!telnet) return false;

		if (value === undefined) value = !this.power;

		let command = `PW${value ? "ON" : "STANDBY"}`;
		telnet.write(command + "\r");
		this.logger.debug(`Sent power command: ${command}`);

		return true;
	}

	/** @typedef {(...args: any[]) => void} EventListener */

	/**
	 * Subscribe to events from this receiver
	 * @param {EventListener} listener - The listener function to call when the event is emitted
	 */
	on(listener) {
		if (this.#eventEmitter.listeners("event").includes(listener)) {
			return;
		}

		this.#eventEmitter.on("event", listener);
	}

	/**
	 * Emit an event from this receiver
	 * @param {ReceiverEvent["type"]} type - The type of event to emit
	 */
	emit(type) {
		/** @type {ReceiverEvent} */
		const payload = { type, connection: this };
		this.#eventEmitter.emit("event", payload);
	}

	/**
	 * Handle connection events
	 */
	#onConnect() {
		this.logger.debug(`Telnet connection established to Denon receiver at ${this.#host}`);

		this.#reconnectCount = 0;
		this.statusMsg = "Connected.";

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

			let command = line.substring(0, 2);
			let parameter = line.substring(2);

			switch (command) {
				case "PW": // Power
					this.#onPowerChanged(parameter);
					break;
				case "MV": // Volume or max volume
					this.#onVolumeChanged(parameter);
					break;
				case "MU": // Mute
					this.#onMuteChanged(parameter);
					break;
				default:
					this.logger.warn(`Unhandled message from receiver at ${this.#host}: ${line}`);
					break;
			}
		}
	}

	/**
	 * Handle a power changed message from the receiver
	 * @param {string} parameter - The parameter from the receiver
	 */
	#onPowerChanged(parameter) {
		// The receiver will send "ON" or "STANDBY"
		// It also repeats the power status at a regular interval, so we don't need to emit an event for every message
		const newStatus = parameter === "ON";
		if (newStatus === this.power) return;

		this.power = newStatus;
		this.logger.debug(`Updated receiver power status for ${this.#host}: ${this.power}`);

		this.emit("powerChanged");
	}

	#onVolumeChanged(parameter) {
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

			this.maxVolume = newMaxVolume;
			this.logger.debug(`Updated receiver max volume for ${this.#host}: ${this.maxVolume}`);

			// this.emit("maxVolumeChanged");
		} else {
			let newVolume = parseInt(parameter);
			if (parameter.length === 3) {
				newVolume = newVolume / 10;
			}

			this.volume = newVolume;
			this.logger.debug(`Updated receiver volume for ${this.#host}: ${this.volume}`);

			this.emit("volumeChanged");
		}
	}

	#onMuteChanged(parameter) {
		this.muted = parameter == "ON";
		this.logger.debug(`Updated receiver mute status for ${this.#host}: ${this.muted}`);

		this.emit("muteChanged");
	}

	/**
	 * Handle socket errors
	 * @param {Object} error
	 */
	#onError(error) {
		if (error.code === "ENOTFOUND") {
			// If the host can't be looked up, give up.
			this.statusMsg = `Host not found: ${this.#host}`;
			this.disconnect();
		} else {
			this.statusMsg = `Connection error: ${error.message} (${error.code})`;
		}

		this.logger.warn(this.statusMsg);
		this.emit("status");
	}

	/**
	 * Request the full status of the receiver
	 * Usually only needed when the connection is first established
	 */
	#requestFullReceiverStatus() {
		const telnet = this.#telnet;
		if (!telnet) return;

		telnet.write("PW?\r"); // Request the power status
		telnet.write("MV?\r"); // Request the volume
		telnet.write("MU?\r"); // Request the mute status
	}
}