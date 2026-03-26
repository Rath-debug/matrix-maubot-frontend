/**
 * Maubot Reminder Plugin - Matrix Widget API Integration
 *
 * Uses official matrix-widget-api for proper Matrix integration
 * Follows MSC standards for widget capabilities
 */

class ReminderBotWidget {
    constructor() {
        this.roomId = null;
        this.userId = null;
        this.widgetApi = null;
        this.isReady = false;
        this.maubotUrl = null;
    }

    /**
     * Initialize widget with Matrix Widget API
     */
    async init(maubotUrl = null) {
        // Load matrix-widget-api
        if (typeof mxwidgets === 'undefined') {
            throw new Error('Matrix Widget API not loaded');
        }

        // Get maubot URL from widget data or parameter
        this.maubotUrl = maubotUrl || this.getMaubotUrlFromEnv();

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
        console.log(`Reminder widget initialized: room=${this.roomId}, user=${this.userId}`);
    }

    /**
     * Get maubot URL from environment or config
     */
    getMaubotUrlFromEnv() {
        // Try to get from window
        if (window.MAUBOT_URL) {
            return window.MAUBOT_URL;
        }

        // Try to get from localStorage
        const stored = localStorage.getItem('maubot_url');
        if (stored) {
            return stored;
        }

        // Default
        return 'http://localhost:29316';
    }

    /**
     * Create a new reminder via messaging
     */
    async createReminder(message, time) {
        if (!this.isReady) {
            throw new Error('Widget not initialized. Call init() first.');
        }

        try {
            // Send reminder command to room
            const commandMessage = `!remind ${message} in ${time}`;

            await this.widgetApi.sendEvent('m.room.message', {
                msgtype: 'm.text',
                body: commandMessage,
            });

            return {
                success: true,
                message: message,
                time: time,
                sent_at: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Reminder creation error:', error);
            throw error;
        }
    }

    /**
     * Send list reminders command
     */
    async listReminders() {
        if (!this.isReady) {
            throw new Error('Widget not initialized. Call init() first.');
        }

        try {
            await this.widgetApi.sendEvent('m.room.message', {
                msgtype: 'm.text',
                body: '!remind list',
            });

            return { success: true };
        } catch (error) {
            console.error('List reminders error:', error);
            throw error;
        }
    }

    /**
     * Cancel a reminder by ID
     */
    async deleteReminder(reminderId) {
        if (!this.isReady) {
            throw new Error('Widget not initialized. Call init() first.');
        }

        try {
            await this.widgetApi.sendEvent('m.room.message', {
                msgtype: 'm.text',
                body: `!remind cancel ${reminderId}`,
            });

            return { success: true, id: reminderId };
        } catch (error) {
            console.error('Reminder deletion error:', error);
            throw error;
        }
    }

    /**
     * Read messages from room (requires MSC2762 capability)
     */
    async getMessages(limit = 50) {
        try {
            // This requires MSC2762 timeline capability
            if (!this.widgetApi || !this.widgetApi.hasCapability) {
                return [];
            }

            // Timeline capability not commonly available yet
            return [];
        } catch (error) {
            console.error('Error reading messages:', error);
            return [];
        }
    }

    /**
     * Parse natural language time string
     */
    parseTimeString(timeStr) {
        const now = new Date();
        const units = {
            ms: 1,
            s: 1000,
            m: 60000,
            h: 3600000,
            d: 86400000,
        };

        const match = timeStr.match(/^(\d+)\s*([smhd])?$/);
        if (match) {
            const value = parseInt(match[1]);
            const unit = match[2] || 'm';
            const multiplier = units[unit] || 60000;
            return new Date(now.getTime() + value * multiplier);
        }

        // Try to parse as absolute datetime
        const absoluteTime = new Date(timeStr);
        if (!isNaN(absoluteTime)) {
            return absoluteTime;
        }

        throw new Error(`Could not parse time string: ${timeStr}`);
    }

    /**
     * Get widget context information
     */
    getContext() {
        if (!this.widgetApi) {
            return null;
        }

        try {
            return this.widgetApi.getContext();
        } catch (error) {
            console.error('Error getting context:', error);
            return null;
        }
    }

    /**
     * Get available capabilities
     */
    getCapabilities() {
        if (!this.widgetApi) {
            return [];
        }

        return [
            { name: 'SendEvent', available: this.widgetApi.hasCapability ? true : false },
            { name: 'ReadEvents', available: this.widgetApi.hasCapability ? true : false },
            { name: 'MSC2931Navigate', available: false },
            { name: 'MSC2762Timeline', available: false },
        ];
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ReminderBotWidget;
}
