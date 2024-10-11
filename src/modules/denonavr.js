import net from "net";
import { TelnetSocket } from "telnet-stream";

let logger;

/**
 * Pool of active DenonAVR instances
 * @type {DenonAVR[]}
 */
let pool = [];

/**
 * Represents a connection to a Denon AVR receiver
 * @property {string} id - The unique identifier for the receiver
 * @property {number} volume - The current volume of the receiver
 * @property {boolean} muted - Whether the receiver is muted
 */
class DenonAVR {
	volume;
	muted;

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
	get id() { return this.#id; }

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
	connect(host, port) {
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
	disconnect() {
		let telnet = this.#telnet;

		// Dispose of the telnet socket
		this.#telnet = null;
		if (telnet && !telnet.destroyed) {
			telnet.destroy();

			// Set a timeout to clean up the socket
			/** @type {TelnetSocket} */
			setTimeout(() => {
				if (!telnet.destroyed) {
					telnet.unref();
				}
			}, 1000);
		}

		// Remove the instance from the pool
		pool = pool.filter((instance) => instance !== this);
	}

	/**
	 * Handle connection events
	 */
	#onConnect() {
		logger.info("Connected to Denon receiver.");

		this.#reconnectCount = 0;

		this.#requestStatus();
	}

	/**
	 * Handle connection closing event
	 * @param {boolean} [hadError=false] - Whether the connection was closed due to an error.
	 */
	#onClose(hadError = false) {
		(hadError ? logger.error : logger.warn)("Disconnected from Denon receiver.");

		if (this.#telnet && this.#reconnectCount < 10) {
			this.#reconnectCount++;

			setTimeout(() => {
				this.connect(this.#telnet.remoteAddress, this.#telnet.remotePort);
			}, 1000);
		}
	}

	/**
	 * Incoming data from the receiver
	 * @param {Buffer | string} data
	 */
	#onData(data) {
		logger.debug("Received data:", data.toString());

		let lines = data.toString().split('\r');
		for (let line of lines) {
			let command = line.substring(0, 2);
			let parameter = line.substring(2);

			switch (command) {
				case "MV":
					this.volume = parseInt(parameter.substring(0, 2));
					break;
				case "MU":
					this.muted = parameter == "ON";
					break;
			}
		}
	}

	/**
	 * Handle socket errors
	 * @param {Error} error
	 */
	#onError(error) {
		// TODO: Determine if we should reconnect
		logger.error("Error:", error);
	}

	#requestStatus() {
		let telnet = this.#telnet;

		telnet.write("MV?\r"); // Request the volume
		telnet.write("MU?\r"); // Request the mute status
	}
}

export { DenonAVR };
