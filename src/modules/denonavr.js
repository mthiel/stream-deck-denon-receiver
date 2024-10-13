import net from "net";
import { TelnetSocket } from "telnet-stream";
import { EventEmitter } from "events";
import streamDeck, { LogLevel } from "@elgato/streamdeck";

let logger;

/**
 * @typedef {Object} ReceiverEvent
 * @property {DenonAVR} receiver - The receiver instance
 * @property {Action} action - The action instance to send the event to
 * @property {Object} [payload] - An optional payload object
 * @property {LogLevel} [payload.level] - The log level for the message
 * @property {string} [payload.message] - An optional message
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
	actionIds;

	/**
	 * The raw TCP socket supporting the telnet connection
	 * @type {net.Socket}
	 */
	#rawSocket;

	/**
	 * The telnet socket connection to the receiver
	 * @type {TelnetSocket}
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
	get id() {
		return this.#id;
	}

	#host;
	get host() {
		return this.#host;
	}

	#port;
	get port() {
		return this.#port;
	}

	/**
	 * Create a new DenonAVR instance
	 * @param {object} config - The configuration object
	 * @param {string} config.host - The host to connect to
	 * @param {number} config.port - The port to connect to
	 * @param {string} config.actionId - The action ID requesting this connection
	 * @param {Logger} [config.newLogger=null] - The logger to use for this instance.
	 */
	constructor(config = {}) {
		let { host, port, newLogger, actionId } = config;

		this.#host = host;
		this.#port = port;

		if (!logger) {
			if (newLogger) {
				logger = newLogger.createScope("DenonAVR");
			} else {
				logger = streamDeck.logger.createScope("DenonAVR");
			}
		}

		this.#id = `${host}:${port}`;

		// Check if the instance already exists and reuse it
		let instance = pool.find((instance) => instance.id == this.#id);
		if (instance) {
			logger.debug(`Reusing existing DenonAVR instance: ${this.#id}`);

			let existingActionInstance = DenonAVR.getInstanceByContext(actionId);
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
	static getInstanceByContext(actionId) {
		return pool.find((instance) => instance.actionIds.indexOf(actionId) !== -1);
	}

	/**
	 * Connect to a receiver
	 */
	async connect() {
		logger.debug(`Connecting to Denon receiver: ${this.#host}:${this.#port}`);

		let rawSocket = net.createConnection(this.#port, this.#host);
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

		// Assign the sockets to the instance
		this.#rawSocket = rawSocket;
		this.#telnet = telnet;
	}

	/**
	 * Disconnect from the receiver and remove it from the pool
	 */
	disconnect() {
		let telnet = this.#telnet;

		// Remove the instance from the pool
		pool = pool.filter((instance) => instance !== this);

		// Dispose of the sockets
		this.#telnet = null;
		this.#rawSocket = null;

		if (telnet && !telnet.destroyed) {
			telnet.destroy();

			// Set a timeout to clean up the socket
			setTimeout(() => {
				if (!telnet.destroyed) {
					telnet.unref();
				}
			}, 1000);
		}
	}

	async changeVolume(delta) {
		let telnet = this.#telnet;
		if (!telnet || !this.power || this.volume === undefined) return;

		let newVolumeStr = Math.max(0, Math.min(this.maxVolume, Math.round(this.volume + delta)))
			.toString()
			.padStart(2, "0");

		let command = `MV${newVolumeStr}`;

		telnet.write(command + "\r");
		logger.debug(`Sent volume command: ${command}`);
	}

	async toggleMute() {
		let telnet = this.#telnet;
		if (!telnet || !this.power || this.muted === undefined) return;

		let command = `MU${this.muted ? "OFF" : "ON"}`;

		telnet.write(command + "\r");
		logger.debug(`Sent mute command: ${command}`);
	}

	/**
	 * Send an event to all actions subscribed to this receiver
	 * Also performs subscriber maintenance tasks
	 * @param {string} eventName - The name of the event to send
	 * @param {ReceiverEvent} [ev] - The event object
	 */
	#broadcastEvent(eventName, ev) {
		let staleActionIds = [];

		if (!ev) {
			ev = {};
		}

		ev.receiver = this;

		// Broadcast the event to all actions and collect any stale action IDs
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
			this.actionIds = this.actionIds.filter((id) => id !== staleId);
		});

		// If there are no more actions subscribed to this receiver, disconnect
		if (this.actionIds.length === 0 && this.#telnet) {
			this.disconnect();
		}
	}

	/**
	 * Handle connection events
	 */
	#onConnect() {
		logger.info("Telnet connection established to Denon receiver.");

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
		const msg = `Telnet connection to Denon receiver closed${hadError ? " due to error" : ""}.`;

		let ev = {
			payload: {
				level: hadError ? LogLevel.WARN : LogLevel.INFO,
				message: msg,
			},
		};

		this.#broadcastEvent("closed", ev);

		// TODO: Test this out
		if (this.#telnet && this.#reconnectCount < 10) {
			this.#reconnectCount++;
			ev.payload.level = LogLevel.INFO;
			ev.payload.message = `Reconnecting to Denon receiver: ${this.#id}. Attempt ${this.#reconnectCount}`;

			setTimeout(() => {
				this.#broadcastEvent("status", ev);

				this.connect();
			}, 1000);
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
					this.power = parameter == "ON";
					logger.debug(`Updated receiver power status: ${this.power}`);

					this.#broadcastEvent("status");
					break;
				case "MV": // Volume or max volume
					if (parameter.startsWith("MAX")) {
						// The "MAX" extended command is not documented, but it is used by the receiver
						// Guessing this is the current maximum volume supported by the receiver
						// In testing, this value raises as the volume approaches the maximum
						// Ex: "MAX 855" (Last digit is tenths and not significant)
						let newMaxVolume = parseInt(parameter.substring(4, 6));
						this.maxVolume = newMaxVolume;
						logger.debug(`Updated receiver max volume: ${this.maxVolume}`);
					} else {
						this.volume = parseInt(parameter.substring(0, 2));
						logger.debug(`Updated receiver volume: ${this.volume}`);
					}
					break;
				case "MU": // Mute
					this.muted = parameter == "ON";
					logger.debug(`Updated receiver mute status: ${this.muted}`);
					break;
				default:
					logger.warn(`Unhandled message from receiver: ${line}`);
					break;
			}
		}
	}

	/**
	 * Handle socket errors
	 * @param {Error} error
	 */
	#onError(error) {
		if (error.code === "ENOTFOUND") {
			// If the host can't be looked up, give up.
			this.statusMsg = `Host not found: ${this.#host}`;
			this.disconnect();
		} else {
			this.statusMsg = `Connection error: ${error.message} (${error.code})`;
		}

		logger.warn(this.statusMsg);
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

/**
 * @typedef {import('./denonavr').ReceiverEvent} ReceiverEvent
 */

export { DenonAVR };

/** @typedef {ReceiverEvent} ReceiverEvent */
