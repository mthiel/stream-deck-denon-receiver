import net from "net";
import { TelnetSocket } from "telnet-stream";
import { EventEmitter } from "events";

let logger;

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
 */
class DenonAVR {
	power;
	maxVolume = 85;
	volume;
	muted;
	eventEmitter = new EventEmitter();

	/**
	 * The telnet socket connection to the receiver
	 * @type {TelnetSocket}
	 */
	#telnet;

	/**
	 * The number of times the receiver has reconnected
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

	/**
	 * Create a new DenonAVR instance
	 * @param {string} host - The host to connect to
	 * @param {number} port - The port to connect to
	 * @param {Logger} [newLogger=null] - The logger to use for this instance.
	 */
	constructor(host, port, newLogger = null) {
		if (!logger && newLogger) {
			logger = newLogger.createScope("DenonAVR");
		}

		this.#id = `${host}:${port}`;

		// Check if the instance already exists and reuse it
		let instance = pool.find((instance) => instance.id == this.#id);
		if (instance) {
			logger.debug(`Reusing existing DenonAVR instance: ${this.#id}`);
			return instance;
		}

		this.connect(host, port);

		// Add the instance to the pool
		pool.push(this);
	}

	/**
	 * Connect to a receiver
	 * @param {string} host - The host to connect to
	 * @param {number} port - The port to connect to
	 */
	async connect(host, port) {
		logger.debug(`Connecting to Denon receiver: ${host}:${port}`);

		let telnet = new TelnetSocket(net.createConnection(port, host));

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
		this.#telnet = telnet;
	}

	/**
	 * Disconnect from the receiver and remove it from the pool
	 */
	async disconnect() {
		let telnet = this.#telnet;

		// Dispose of the telnet socket
		this.#telnet = null;
		if (telnet && !telnet.destroyed) {
			telnet.destroy();

			// Set a timeout to clean up the socket
			setTimeout(() => {
				if (!telnet.destroyed) {
					telnet.unref();
				}
			}, 1000);
		}

		// Remove the instance from the pool
		pool = pool.filter((instance) => instance !== this);
	}

	async changeVolume(delta) {
		let telnet = this.#telnet;
		if (!telnet || !this.power || this.volume === undefined) return;

		let newVolumeStr = Math.max(0, Math.min(this.maxVolume, Math.round(this.volume + delta)))
			.toString()
			.padStart(2, "0");

		let command = `MV${newVolumeStr}`;

		logger.debug(`Sending volume command: ${command}`);
		telnet.write(command + "\r");
	}

	async toggleMute() {
		let telnet = this.#telnet;
		if (!telnet || !this.power || this.muted === undefined) return;

		let command = `MU${this.muted ? "OFF" : "ON"}`;

		logger.debug(`Sending mute command: ${command}`);
		telnet.write(command + "\r");
	}

	/**
	 * Handle connection events
	 */
	#onConnect() {
		logger.info("Telnet connection established to Denon receiver.");

		this.#reconnectCount = 0;

		this.#requestStatus();

		this.eventEmitter.emit("connected");
	}

	/**
	 * Handle connection closing event
	 * @param {boolean} [hadError=false] - Whether the connection was closed due to an error.
	 */
	#onClose(hadError = false) {
		const msg = `Telnet connection to Denon receiver closed${hadError ? " due to error" : ""}.`;

		this.eventEmitter.emit("closed", msg);

		// TODO: Test this out
		if (this.#telnet && this.#reconnectCount < 10) {
			this.#reconnectCount++;

			setTimeout(() => {
				this.eventEmitter.emit("status", `Reconnecting to Denon receiver: ${this.#id}. Attempt ${this.#reconnectCount}`);

				this.connect(this.#telnet.remoteAddress, this.#telnet.remotePort);
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
					logger.debug(`Received power status: ${this.power}`);
					break;
				case "MV": // Volume or max volume
					if (parameter.startsWith("MAX")) {
						// The "MAX" extended command is not documented, but it is used by the receiver
						// Guessing this is the current maximum volume supported by the receiver
						// In testing, this value raises as the volume approaches the maximum
						// Ex: "MAX 855" (Last digit is tenths and not significant)
						let newMaxVolume = parseInt(parameter.substring(4, 6));
						this.maxVolume = newMaxVolume;
						logger.debug(`Received (probably) max volume: ${this.maxVolume}`);
					} else {
						this.volume = parseInt(parameter.substring(0, 2));
						logger.debug(`Received current volume: ${this.volume}`);
					}
					break;
				case "MU": // Mute
					this.muted = parameter == "ON";
					logger.debug(`Received mute status: ${this.muted}`);
					break;
				default:
					logger.debug(`Unknown message from receiver: ${line}`);
					break;
			}
		}
	}

	/**
	 * Handle socket errors
	 * @param {Error} error
	 */
	#onError(error) {
		this.eventEmitter.emit("error", `${error.message} (${error.code})`);

		// TODO: Determine if we should reconnect
		logger.error("Error:", error);
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
