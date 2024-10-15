import net from "net";
import dgram from "dgram";
import { TelnetSocket } from "telnet-stream";
import { EventEmitter } from "events";
import { setTimeout } from "timers/promises";
import streamDeck from "@elgato/streamdeck";

/**
 * @typedef {Object} ReceiverEvent
 * @property {DenonAVR} receiver - The receiver instance
 * @property {Object} action - The action instance to send the event to
 */

/**
 * Pool of active DenonAVR instances
 * @type {DenonAVR[]}
 */
let pool = [];

/**
 * Represents a connection to a Denon AVR receiver
 * @property {string} id - The unique identifier for the receiver
 * @property {boolean} power - Whether the receiver is powered on
 * @property {number} maxVolume - The maximum volume of the receiver
 * @property {number} volume - The current volume of the receiver
 * @property {boolean} muted - Whether the receiver is muted
 * @property {EventEmitter} eventEmitter - The event emitter for this instance
 * @property {string[]} actionIds - The action IDs associated with this receiver connection
 */
class DenonAVR {
	power;
	maxVolume = 85;
	volume;
	muted;

	eventEmitter = new EventEmitter();
	statusMsg = "Initializing...";
	actionIds = [];

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
	 * The unique identifier for the receiver
	 * @type {string}
	 */
	#id;
	get id() { return this.#id; }

	#host;
	get host() { return this.#host; }

	/**
	 * Create a new DenonAVR instance
	 * @param {object} config - The configuration object
	 * @param {string} config.host - The host to connect to
	 * @param {string} config.actionId - The action ID requesting this connection
	 */
	constructor(config) {
		let { host, actionId } = config;

		this.#host = host;
		this.#id = `${host}`;

		// Check if the instance already exists and reuse it
		let instance = pool.find((instance) => instance.id == this.#id);
		if (instance) {
			streamDeck.logger.debug(`Reusing existing DenonAVR instance: ${this.#id}`);

			let existingActionInstance = DenonAVR.getByContext(actionId);
			if (existingActionInstance && existingActionInstance !== instance) {
				// Remove the action context from the old instance
				existingActionInstance.actionIds = existingActionInstance.actionIds.filter((id) => id !== actionId);
			}

			// Add the action context to the new instance
			if (instance.actionIds.indexOf(actionId) === -1) {
				instance.actionIds.push(actionId);
			}

			return instance;
		}

		// Initialize this instance with a first action context
		this.actionIds = [actionId];

		this.connect();

		// Add the instance to the pool
		pool.push(this);
	}

	/**
	 * Get an instance by an action ID
	 * @param {string} actionId - The action ID
	 * @returns {DenonAVR | undefined} The instance or undefined if not found
	 */
	static getByContext(actionId) {
		return pool.find((instance) => instance.actionIds.indexOf(actionId) !== -1);
	}

	/**
	 * Get a list of detected receivers on the network
	 * @returns {Promise<string[]>} A promise that resolves to an array of detected receiver addresses
	 */
	static async getDetectedReceiverAddresses() {
		let addresses = [];

		const socket = dgram.createSocket("udp4");
		socket.on("listening", () => {
			const broadcastAddress = "239.255.255.250";
			const broadcastPort = 1900;
			const message = Buffer.from(
				'M-SEARCH * HTTP/1.1\r\n' +
				'HOST: ' + broadcastAddress + ':' + broadcastPort + '\r\n' +
				'MAN: "ssdp:discover"\r\n' +
				'ST: urn:schemas-denon-com:device:ACT-Denon:1\r\n' +
				'MX: 1\r\n' +
				'\r\n'
			);
			socket.send(message, 0, message.length, broadcastPort, broadcastAddress);
			streamDeck.logger.debug(`Sent SSDP M-SEARCH message for Denon receivers`);
		});
		socket.on("message", (message, rinfo) => {
			addresses.push(rinfo.address);
		});
		socket.bind();

		await setTimeout(1000);
		socket.close();

		return addresses;
	}

	/**
	 * Connect to a receiver
	 */
	async connect() {
		streamDeck.logger.debug(`Connecting to Denon receiver: ${this.#host}`);

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
	 * Disconnect from the receiver and remove it from the pool
	 */
	disconnect() {
		let rawSocket = this.#rawSocket;
		let telnet = this.#telnet;

		// Remove the instance from the pool
		pool = pool.filter((instance) => instance !== this);

		// Dispose of this instance's sockets
		this.#rawSocket = undefined;
		this.#telnet = undefined;

		if (telnet && !rawSocket?.destroyed) {
			telnet.destroy();

			// Set a timeout to clean up the sockets
			(async () => {
				await setTimeout(1000);
				if (!rawSocket?.destroyed && telnet) {
					telnet.unref();
				}
			})();
		}
	}

	/**
	 * Utility method to check if this receiver instance is currently connected
	 * @returns {boolean} Whether the receiver is connected
	 */
	isConnected() {
		return !!this.#telnet && !this.#rawSocket?.destroyed;
	}

	/**
	 * Change the volume by the given delta
	 * @param {number} delta - The amount to change the volume by
	 * @returns {Promise<boolean>} Whether the command was sent successfully
	 */
	async changeVolume(delta) {
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
			streamDeck.logger.debug(`Sent volume command: ${command}`);
		} catch (error) {
			return false;
		}

		return true;
	}

	/**
	 * Change the volume to the given value
	 * @param {number} value - The new volume value to set
	 * @returns {Promise<boolean>} Whether the command was sent successfully
	 */
	async changeVolumeByValue(value) {
		let telnet = this.#telnet;
		if (!telnet || !this.power) return false;

		try {
			let command = `MV${value.toString().padStart(2, "0")}`;
			telnet.write(command + "\r");
			streamDeck.logger.debug(`Sent volume command: ${command}`);
		} catch (error) {
			return false;
		}

		return true;
	}

	/**
	 * Toggle the mute state
	 * @returns {Promise<boolean>} Whether the command was sent successfully
	 */
	async toggleMute() {
		let telnet = this.#telnet;
		if (!telnet || !this.power || this.muted === undefined) return false;

		try {
			let command = `MU${this.muted ? "OFF" : "ON"}`;

			telnet.write(command + "\r");
			streamDeck.logger.debug(`Sent mute command: ${command}`);
		} catch (error) {
			return false;
		}

		return true;
	}

	/**
	 * Toggle the power state
	 * @returns {Promise<boolean>} Whether the command was sent successfully
	 */
	async togglePower() {
		let telnet = this.#telnet;
		if (!telnet) return false;

		try {
			let command = `PW${this.power ? "STANDBY" : "ON"}`;
			telnet.write(command + "\r");
			streamDeck.logger.debug(`Sent power command: ${command}`);
		} catch (error) {
			return false;
		}
		return true;
	}

	/**
	 * Send an event to all actions subscribed to this receiver
	 * Also performs subscriber maintenance tasks
	 * @param {string} eventName - The name of the event to send
	 */
	#broadcastEvent(eventName) {
		let staleActionIds = [];

		/** @type {ReceiverEvent} */
		let ev = { 
			receiver: this,
			action: undefined
		};
	
		// Broadcast the event to all actions and collect any stale action IDs
		// TODO: Rework this to avoid event storms
		this.actionIds.forEach((id) => {
			delete ev.action;

			let action = streamDeck.actions.getActionById(id);
			if (action) {
				ev.action = action;
				this.eventEmitter.emit(eventName, ev);
			} else {
				staleActionIds.push(id);
			}
		});

		// Remove any stale action subscriptions
		staleActionIds.forEach((staleId) => {
			streamDeck.logger.debug(`Removing stale action subscription: ${staleId}`);
			this.actionIds = this.actionIds.filter((id) => id !== staleId);
		});

		// If there are no more actions subscribed to this receiver, disconnect
		if (this.actionIds.length === 0 && this.#telnet) {
			streamDeck.logger.debug(`No actions subscribed to receiver ${this.#id}, disconnecting`);
			this.disconnect();
		}
	}

	/**
	 * Handle connection events
	 */
	#onConnect() {
		streamDeck.logger.info("Telnet connection established to Denon receiver.");

		this.#reconnectCount = 0;
		this.statusMsg = "Connected.";

		this.#broadcastEvent("connected");

		this.#requestStatus();
	}

	/**
	 * Handle connection closing event
	 * Note: Logging in this state causes errors, so we hand it off to the actions to handle.
	 * @param {boolean} [hadError=false] - Whether the connection was closed due to an error.
	 */
	#onClose(hadError = false) {
		streamDeck.logger.warn(`Telnet connection to Denon receiver closed${hadError ? " due to error" : ""}.`);

		this.#broadcastEvent("closed");

		// Attempt to reconnect if we haven't given up yet
		if (this.#telnet && this.#reconnectCount < 10) {
			this.#reconnectCount++;

			(async () => {
				await setTimeout(1000);
				streamDeck.logger.info(`Trying to reconnect to Denon receiver: ${this.#id}. Attempt ${this.#reconnectCount}`);

				this.connect();
			})();
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
					streamDeck.logger.warn(`Unhandled message from receiver: ${line}`);
					break;
			}
		}
	}

	#onPowerChanged(parameter) {
		this.power = parameter == "ON";
		streamDeck.logger.debug(`Updated receiver power status: ${this.power}`);

		this.#broadcastEvent("powerChanged");
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
			streamDeck.logger.debug(`Updated receiver max volume: ${this.maxVolume}`);

			this.#broadcastEvent("maxVolumeChanged");
		} else {
			let newVolume = parseInt(parameter);
			if (parameter.length === 3) {
				newVolume = newVolume / 10;
			}

			this.volume = newVolume;
			streamDeck.logger.debug(`Updated receiver volume to: ${this.volume}`);

			this.#broadcastEvent("volumeChanged");
		}
	}

	#onMuteChanged(parameter) {
		this.muted = parameter == "ON";
		streamDeck.logger.debug(`Updated receiver mute status: ${this.muted}`);

		this.#broadcastEvent("muteChanged");
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

		streamDeck.logger.warn(this.statusMsg);
		this.#broadcastEvent("status");
	}

	#requestStatus() {
		let telnet = this.#telnet;
		if (!telnet) return;

		telnet.write("PW?\r"); // Request the power status
		telnet.write("MV?\r"); // Request the volume
		telnet.write("MU?\r"); // Request the mute status
	}
}

export { DenonAVR };