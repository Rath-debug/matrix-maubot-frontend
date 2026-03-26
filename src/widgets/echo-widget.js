/**
 * Maubot Echo Plugin - Element Client Integration
 *
 * This widget provides Echo bot commands directly in Element client
 * Usage: Add this as a widget in Element room
 */

class EchoBotWidget {
    constructor(roomId, maubotUrl = "http://localhost:29316") {
        this.roomId = roomId
        this.maubotUrl = maubotUrl
        this.apiPath = "/_matrix/maubot/plugin/echo"
    }

    /**
     * Send echo command to maubot
     * @param {string} message - Message to echo
     * @param {object} options - Additional options
     */
    async echo(message, options = {}) {
        const data = {
            room_id: this.roomId,
            message: message,
            html: options.html || false,
            delay: options.delay || 0,
            formatted_body: options.formattedBody || null,
        }

        try {
            const response = await fetch(`${this.maubotUrl}${this.apiPath}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${localStorage.getItem("access_token")}`,
                },
                body: JSON.stringify(data),
            })

            if (!response.ok) {
                throw new Error(`Echo failed: ${response.statusText}`)
            }

            return await response.json()
        } catch (error) {
            console.error("Echo command error:", error)
            throw error
        }
    }

    /**
     * Echo with HTML formatting
     * @param {string} plainText - Plain text version
     * @param {string} htmlText - HTML formatted version
     */
    async echoHTML(plainText, htmlText) {
        return this.echo(plainText, {
            html: true,
            formattedBody: htmlText,
        })
    }

    /**
     * Echo with delay (milliseconds)
     * @param {number} delayMs - Delay in milliseconds
     * @param {string} message - Message to echo
     */
    async echoWithDelay(delayMs, message) {
        return this.echo(message, {
            delay: delayMs,
        })
    }
}

// Export for use in Element
if (typeof module !== "undefined" && module.exports) {
    module.exports = EchoBotWidget
}
