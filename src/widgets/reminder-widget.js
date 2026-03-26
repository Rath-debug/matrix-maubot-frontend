/**
 * Maubot Reminder Plugin - Element Client Integration
 *
 * This widget provides Reminder bot commands directly in Element client
 * Usage: Add this as a widget in Element room
 */

class ReminderBotWidget {
    constructor(roomId, maubotUrl = "http://localhost:29316") {
        this.roomId = roomId
        this.maubotUrl = maubotUrl
        this.apiPath = "/_matrix/maubot/plugin/reminder"
    }

    /**
     * Create a new reminder
     * @param {string} message - Reminder message
     * @param {string} time - Time string (e.g., "5m", "2 hours", "2024-12-25 14:30")
     */
    async createReminder(message, time) {
        const data = {
            room_id: this.roomId,
            message: message,
            time: time,
            timestamp: Date.now(),
        }

        try {
            const response = await fetch(`${this.maubotUrl}${this.apiPath}/reminders`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${localStorage.getItem("access_token")}`,
                },
                body: JSON.stringify(data),
            })

            if (!response.ok) {
                throw new Error(`Reminder creation failed: ${response.statusText}`)
            }

            return await response.json()
        } catch (error) {
            console.error("Reminder creation error:", error)
            throw error
        }
    }

    /**
     * Get all reminders for this room
     */
    async listReminders() {
        try {
            const response = await fetch(
                `${this.maubotUrl}${this.apiPath}/reminders?room_id=${encodeURIComponent(this.roomId)}`,
                {
                    headers: {
                        "Authorization": `Bearer ${localStorage.getItem("access_token")}`,
                    },
                }
            )

            if (!response.ok) {
                throw new Error(`Failed to fetch reminders: ${response.statusText}`)
            }

            return await response.json()
        } catch (error) {
            console.error("Reminder list error:", error)
            throw error
        }
    }

    /**
     * Delete a reminder
     * @param {number|string} reminderId - Reminder ID to delete
     */
    async deleteReminder(reminderId) {
        try {
            const response = await fetch(
                `${this.maubotUrl}${this.apiPath}/reminders/${reminderId}`,
                {
                    method: "DELETE",
                    headers: {
                        "Authorization": `Bearer ${localStorage.getItem("access_token")}`,
                    },
                }
            )

            if (!response.ok) {
                throw new Error(`Failed to delete reminder: ${response.statusText}`)
            }

            return { success: true, id: reminderId }
        } catch (error) {
            console.error("Reminder deletion error:", error)
            throw error
        }
    }

    /**
     * Parse natural language time string
     * Examples: "5m", "2 hours", "tomorrow", "2024-12-25 14:30"
     * @param {string} timeStr - Time string to parse
     */
    parseTimeString(timeStr) {
        // Basic parsing logic
        const now = new Date()
        const units = {
            ms: 1,
            s: 1000,
            m: 60000,
            h: 3600000,
            d: 86400000,
        }

        const match = timeStr.match(/^(\d+)\s*([smhd])?$/)
        if (match) {
            const value = parseInt(match[1])
            const unit = match[2] || "m"
            const multiplier = units[unit] || 60000
            return new Date(now.getTime() + value * multiplier)
        }

        // Try to parse as absolute datetime
        const absoluteTime = new Date(timeStr)
        if (!isNaN(absoluteTime)) {
            return absoluteTime
        }

        throw new Error(`Could not parse time string: ${timeStr}`)
    }
}

// Export for use in Element
if (typeof module !== "undefined" && module.exports) {
    module.exports = ReminderBotWidget
}
