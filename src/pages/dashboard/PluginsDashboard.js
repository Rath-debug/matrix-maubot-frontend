// maubot - A plugin-based Matrix bot system.
// Copyright (C) 2022 Tulir Asokan
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
import React, { Component } from "react"
import api from "../../api"
import Spinner from "../../components/Spinner"
import EchoWidget from "./widgets/EchoWidget"
import ReminderWidget from "./widgets/ReminderWidget"

class PluginsDashboard extends Component {
    constructor(props) {
        super(props)
        this.state = {
            plugins: [],
            loading: true,
            error: "",
        }
    }

    async componentDidMount() {
        await this.loadPlugins()
    }

    loadPlugins = async () => {
        try {
            const plugins = await api.get("/plugins")
            this.setState({
                plugins: plugins,
                loading: false,
                error: "",
            })
        } catch (err) {
            this.setState({
                loading: false,
                error: err.message,
            })
        }
    }

    getPluginByID = (id) => this.state.plugins.find(plugin => plugin.id === id)

    render() {
        const { loading, error } = this.state

        if (loading) {
            return <Spinner/>
        }

        if (error) {
            return <div className="error">{error}</div>
        }

        const echoPlugin = this.getPluginByID("xyz.maubot.echo")
        const reminderPlugin = this.getPluginByID("xyz.maubot.reminder")

        return (
            <div className="plugins-dashboard">
                <h1>Plugin Dashboard</h1>
                <p className="subtitle">Manage your Echo and Reminder plugins</p>

                <div className="widgets-container">
                    {echoPlugin && (
                        <EchoWidget plugin={echoPlugin} onRefresh={this.loadPlugins}/>
                    )}
                    {reminderPlugin && (
                        <ReminderWidget plugin={reminderPlugin} onRefresh={this.loadPlugins}/>
                    )}
                </div>

                {!echoPlugin && !reminderPlugin && (
                    <div className="no-plugins">
                        <p>No plugins installed. Please install Echo and/or Reminder plugins.</p>
                    </div>
                )}
            </div>
        )
    }
}

export default PluginsDashboard
