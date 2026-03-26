// Echo Plugin Widget Component
import React, { Component } from "react"
import api from "../../../api"

class EchoWidget extends Component {
    constructor(props) {
        super(props)
        this.state = {
            instances: [],
            loading: true,
            error: "",
            message: "",
        }
    }

    async componentDidMount() {
        await this.loadInstances()
    }

    loadInstances = async () => {
        try {
            const instances = await api.get("/instances")
            const echoInstances = instances.filter(inst => inst.type === "echo")
            this.setState({
                instances: echoInstances,
                loading: false,
            })
        } catch (err) {
            this.setState({
                error: err.message,
                loading: false,
            })
        }
    }

    testEcho = async (instanceID) => {
        try {
            const response = await api.post(`/instances/${instanceID}/test`, {
                message: "Test echo message",
            })
            this.setState({ message: `Echo test successful: ${response.message}` })
            setTimeout(() => this.setState({ message: "" }), 3000)
        } catch (err) {
            this.setState({ error: `Echo test failed: ${err.message}` })
        }
    }

    render() {
        const { instances, loading, error, message } = this.state

        return (
            <div className="widget echo-widget">
                <div className="widget-header">
                    <h2>🔊 Echo Plugin</h2>
                    <p className="description">Echo messages in configured rooms</p>
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
                                        className="action-button"
                                        onClick={() => this.testEcho(instance.id)}
                                    >
                                        Test Echo
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="no-instances">No echo instances configured</p>
                    )}
                </div>

                <div className="widget-footer">
                    <button
                        className="action-button primary"
                        onClick={() => window.location.hash = "/plugin/xyz.maubot.echo"}
                    >
                        Configure Echo
                    </button>
                </div>
            </div>
        )
    }
}

export default EchoWidget
