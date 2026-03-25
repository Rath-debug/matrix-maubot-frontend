const API_BASE_URL = window.API_BASE_URL || '/api';

async function request(path, options = {}) {
    try {
        const response = await fetch(`${API_BASE_URL}${path}`, {
            headers: {
                'Content-Type': 'application/json',
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
