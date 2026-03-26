// Reminder Plugin Widget Component
import React, { Component } from "react"
import api from "../../../api"

class ReminderWidget extends Component {
    constructor(props) {
        super(props)
        this.state = {
            instances: [],
            reminders: [],
            loading: true,
            error: "",
            message: "",
        }
    }

    async componentDidMount() {
        await this.loadData()
    }

    loadData = async () => {
        console.log("hello: Loading data...")
        try {
            const instances = await api.get("/instances")
            const reminderInstances = instances.filter(inst => inst.type === "reminder")
            this.setState({
                instances: reminderInstances,
                loading: false,
            })
        } catch (err) {
            this.setState({
                error: err.message,
                loading: false,
            })
        }
    }

    addReminder = async (instanceID) => {
        const reminderText = prompt("Enter reminder message:")
        if (!reminderText) return

        const timeStr = prompt("When? (e.g., '5m', '1h', '2024-12-25 14:30')")
        if (!timeStr) return

        try {
            await api.post(`/instances/${instanceID}/reminders`, {
                message: reminderText,
                time: timeStr,
            })
            this.setState({ message: "Reminder added successfully" })
            setTimeout(() => this.setState({ message: "" }), 3000)
            await this.loadData()
        } catch (err) {
            this.setState({ error: `Failed to add reminder: ${err.message}` })
        }
    }

    deleteReminder = async (instanceID, reminderID) => {
        if (!window.confirm("Delete this reminder?")) return

        try {
            await api.delete(`/instances/${instanceID}/reminders/${reminderID}`)
            this.setState({ message: "Reminder deleted" })
            setTimeout(() => this.setState({ message: "" }), 3000)
            await this.loadData()
        } catch (err) {
            this.setState({ error: `Failed to delete reminder: ${err.message}` })
        }
    }

    render() {
        const { instances, loading, error, message } = this.state

        return (
            <div className="widget reminder-widget">
                <div className="widget-header">
                    <h2>⏰ Reminder Plugin</h2>
                    <p className="description">Schedule reminders and notifications</p>
                </div>

                {error && <div className="error-message">{error}</div>}
                {message && <div className="success-message">{message}</div>}

                <div className="widget-content">
                    {loading ? (
                        <p>Loading...</p>
                    ) : instances.length > 0 ? (
                        <div className="instances-list">
                            <h3>Active Instances</h3>
                            {instances.map(instance => (
                                <div key={instance.id} className="instance-item">
                                    <div className="instance-info">
                                        <span className="instance-name">{instance.id}</span>
                                        <span
                                            className={`status ${
                                                instance.started ? "active" : "inactive"
                                            }`}
                                        >
                                            {instance.started ? "✓ Active" : "✗ Inactive"}
                                        </span>
                                    </div>
                                    <button
                                        className="
                                            action-button
                                        "
                                        onClick={() => this.addReminder(instance.id)}
                                    >
                                        + Add Reminder
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="no-instances">No reminder instances configured</p>
                    )}
                </div>

                <div className="widget-footer">
                    <button
                        className="action-button primary"
                        onClick={() => window.location.hash = "/plugin/xyz.maubot.reminder"}
                    >
                        Configure Reminder
                    </button>
                </div>
            </div>
        )
    }
}

export default ReminderWidget
