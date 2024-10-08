import net from 'net';
import { TelnetSocket } from 'telnet-stream';
import { Logger } from '@elgato/streamdeck';

class Denon {
    /** @type {TelnetSocket} */
    #telnet;

    /**
     * Initialize the Denon receiver module
     */
    constructor() {
        // this.#logger = logger;
    }
    
    /**
     * Connect to the receiver
     * @param {string} [host='studio-receiver.faewoods.org'] - The host to connect to (default is for testing)
     * @param {number} [port=23] - The port to connect to
     */
    connect(host = 'studio-receiver.faewoods.org', port = 23) {
        // Handle the case where the connection is already open
        if (this.#telnet && !this.#telnet.destroyed) {
            console.warn('Connection already exists.');
            return;
        }

        let telnet = new TelnetSocket(net.createConnection(port, host));

        // Connection lifecycle events
        telnet.on('connect', this.#onConnect);
        telnet.on('close', this.#onClose);
        telnet.on('error', this.#onError);

        // Ignore standard telnet negotiation
        telnet.on('do', (option) => telnet.writeWont(option));
        telnet.on('will', (option) => telnet.writeDont(option));

        // Data events
        telnet.on('data', this.#onData);

        // Assign the telnet socket to the instance
        this.#telnet = telnet;
    }

    /**
     * Disconnect from the receiver
     */
    disconnect() {
        if (this.#telnet && !this.#telnet.destroyed) {
            this.#telnet.destroy();

            // Set a timeout to clean up the instance
            /** @type {TelnetSocket} */
            let staleTelnet = this.#telnet;
            setTimeout(() => {
                if (!staleTelnet.destroyed) {
                    staleTelnet.unref();
                }
            }, 1000);
        }
    }

    /**
     * Handle connection events
     */
    #onConnect() {
        console.info('Connected to Denon receiver.');
    }

    /**
     * Handle connection closing event
     * @param {boolean} [hadError=false] - Whether the connection was closed due to an error.
     */
    #onClose(hadError = false) {
        this.#telnet = null;
    
        // TODO: Determine if we should reconnect
        if (!hadError) {
            console.log('Connection to receiver closed cleanly.');
        } else {
            console.log('Connection to receiver closed with error.');
        }
    }

    /**
     * Incoming data from the receiver
     * @param {Buffer | string} data
     */
    #onData(data) {
        // TODO: Build a parser and dispatch events for the data
        console.log('Received data:', data.toString());
    }

    /**
     * Handle socket errors
     * @param {Error} error
     */
    #onError(error) {
        // TODO: Determine if we should reconnect
        console.error('Error:', error);
    }
};

export { Denon };
