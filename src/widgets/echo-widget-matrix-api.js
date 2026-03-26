/**
 * Maubot Echo Plugin - Matrix Widget API Integration
 *
 * Uses official matrix-widget-api for proper Matrix integration
 * Follows MSC standards for widget capabilities
 */

class EchoBotWidget {
    constructor() {
        this.roomId = null;
        this.userId = null;
        this.widgetApi = null;
        this.isReady = false;
    }

    /**
     * Initialize widget with Matrix Widget API
     */
    async init() {
        // Load matrix-widget-api
        if (typeof mxwidgets === 'undefined') {
            throw new Error('Matrix Widget API not loaded');
        }

        this.widgetApi = new mxwidgets.WidgetApi();

        // Request required capabilities
        try {
            await this.widgetApi.requestCapabilities([
                mxwidgets.MatrixCapabilities.SendEvent,
                mxwidgets.MatrixCapabilities.ReadEvents,
            ]);
        } catch (e) {
            console.warn('Some widget capabilities not available:', e);
        }

        // Start the widget
        this.widgetApi.start();

        // Get room and user info
        const context = this.widgetApi.getContext();
        this.roomId = context.roomId;
        this.userId = context.userId;

        this.isReady = true;
        console.log(`Echo widget initialized: room=${this.roomId}, user=${this.userId}`);
    }

    /**
     * Send echo command to maubot
     */
    async echo(message, options = {}) {
        if (!this.isReady) {
            throw new Error('Widget not initialized. Call init() first.');
        }

        const data = {
            room_id: this.roomId,
            message: message,
            html: options.html || false,
            delay: options.delay || 0,
            formatted_body: options.formattedBody || null,
        };

        try {
            // Send event to room via Matrix Widget API
            await this.widgetApi.sendEvent('m.room.message', {
                msgtype: 'm.text',
                body: message,
                formatted_body: options.formattedBody || message,
                format: options.html ? 'org.matrix.custom.html' : null,
            });

            return { success: true, message };
        } catch (error) {
            console.error('Echo command error:', error);
            throw error;
        }
    }

    /**
     * Echo with HTML formatting
     */
    async echoHTML(plainText, htmlText) {
        return this.echo(plainText, {
            html: true,
            formattedBody: htmlText,
        });
    }

    /**
     * Echo with delay
     */
    async echoWithDelay(delayMs, message) {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(this.echo(message, { delay: delayMs }));
            }, delayMs);
        });
    }

    /**
     * Read recent messages from room (requires MSC2762 capability)
     */
    async getRecentMessages(limit = 10) {
        try {
            // Request timeline reading capability
            if (!this.widgetApi.hasCapability(mxwidgets.MatrixCapabilities.MSC2931Navigate)) {
                console.warn('Cannot read messages: timeline capability not available');
                return [];
            }

            // This would require MSC2762 timeline capability
            // For now, return empty array
            return [];
        } catch (error) {
            console.error('Error reading messages:', error);
            return [];
        }
    }

    /**
     * Navigate to a Matrix URI
     */
    async navigate(uri) {
        try {
            await this.widgetApi.navigateToRoom(uri);
        } catch (error) {
            console.error('Navigation error:', error);
            throw error;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = EchoBotWidget;
}
