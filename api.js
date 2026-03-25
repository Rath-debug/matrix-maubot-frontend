const API_BASE_URL = window.API_BASE_URL || '/api';

function getWidgetFromPath(path) {
    const parts = path.split('/').filter(Boolean);
    return parts.length ? parts[0] : 'unknown';
}

async function request(path, options = {}) {
    try {
        const widget = getWidgetFromPath(path);
        const response = await fetch(`${API_BASE_URL}${path}`, {
            headers: {
                'Content-Type': 'application/json',
                'X-Frontend-App': 'matrix-maubot-frontend',
                'X-Frontend-Widget': widget,
                ...(options.headers || {})
            },
            ...options
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            return {
                success: false,
                error: data.error || `Request failed (${response.status})`
            };
        }

        return { success: true, data };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Network error'
        };
    }
}

window.BotAPI = {
    info: {
        baseUrl() {
            return API_BASE_URL;
        }
    },
    echo: {
        send(message) {
            return request('/echo', {
                method: 'POST',
                body: JSON.stringify({ message })
            });
        }
    },
    reminder: {
        set(message, time) {
            return request('/reminder', {
                method: 'POST',
                body: JSON.stringify({ message, time })
            });
        },
        list() {
            return request('/reminder/list', { method: 'GET' });
        }
    },
    // weather: {
    //     get(city) {
    //         return request(`/weather?city=${encodeURIComponent(city)}`, { method: 'GET' });
    //     }
    // },
    // moderation: {
    //     mute(userId, roomId) {
    //         return request('/moderation/mute', {
    //             method: 'POST',
    //             body: JSON.stringify({ userId, roomId })
    //         });
    //     },
    //     unmute(userId, roomId) {
    //         return request('/moderation/unmute', {
    //             method: 'POST',
    //             body: JSON.stringify({ userId, roomId })
    //         });
    //     }
    // }
};
