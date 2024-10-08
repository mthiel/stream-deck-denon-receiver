import net from 'net';
import { TelnetSocket } from 'telnet-stream';

class Denon {
    /** @type {TelnetSocket} */
    #telnet;

    connect(host = 'studio-receiver.faewoods.org', port = 23) {
        // Handle the case where the connection is already open
        if (this.#telnet && !this.#telnet.destroyed) {
            console.log('Connection already exists');
            return;
        }

        let socket = net.createConnection(port, host);
        let telnet = new TelnetSocket(socket);

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
        if (!this.#telnet) {
            return;
        }

        let telnet = this.#telnet;

        if (!telnet.destroyed) {
            telnet.destroy().on('close', () => {
                this.#telnet = null;
            });
        }
    }

    /**
     * Handle connection events
     */
    #onConnect() {
        console.log('Connected to Denon receiver');
    }

    /**
     * Handle connection closing event
     * @param {boolean} [hadError=false] - Whether the connection was closed due to an error.
     */
    #onClose(hadError = false) {
        this.#telnet = null;
    
        // TODO: Determine if we should reconnect
        console.log('Connection closed', hadError ? 'with error' : 'cleanly');
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
