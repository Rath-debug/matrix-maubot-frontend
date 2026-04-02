/**
 * Reminder Widget - Matrix Widget for creating reminders in rooms
 * Uses proper postMessage protocol with requestId correlation
 */

let roomId;
let userId;
let homeserverUrl;
let isReady = false;

// Track pending requests by requestId
const pendingRequests = new Map();
let requestCounter = 0;

/**
 * PostMessage API using proper request/response correlation
 */
class MatrixWidgetAPI {
    constructor() {
        window.addEventListener("message", (e) => this.handleMessage(e));
    }

    handleMessage(event) {
        if (event.data?.api === "toWidget") {
            console.log("[API] Received:", event.data.action, "requestId:", event.data.requestId);

            // If this is a response to a pending request, resolve it
            if (event.data.requestId && pendingRequests.has(event.data.requestId)) {
                const { action, resolve } = pendingRequests.get(event.data.requestId);
                pendingRequests.delete(event.data.requestId);
                console.log("[API] ✓ Resolved request:", action);
                resolve(event.data);
            }

            // Also call any registered message handlers
            if (this.messageHandlers) {
                for (const handler of this.messageHandlers) {
                    handler(event.data);
                }
            }
        }
    }

    sendRequest(action, data = {}, widgetId = null) {
        const requestId = `widget-${++requestCounter}-${Date.now()}`;

        return new Promise((resolve) => {
            // Set a timeout for this request
            const timeout = setTimeout(() => {
                pendingRequests.delete(requestId);
                console.warn(`[API] Timeout waiting for response to ${action}`);
                resolve(null);
            }, 5000);

            // Store the pending request
            pendingRequests.set(requestId, { action, resolve, timeout });

            // Wrap the resolve to clear timeout
            const originalResolve = resolve;
            const wrappedResolve = (response) => {
                if (pendingRequests.has(requestId)) {
                    const { timeout } = pendingRequests.get(requestId);
                    clearTimeout(timeout);
                    pendingRequests.delete(requestId);
                }
                originalResolve(response);
            };

            // Update the stored resolve
            const entry = pendingRequests.get(requestId);
            entry.resolve = wrappedResolve;
            pendingRequests.set(requestId, entry);

            // Send the request
            const message = {
                api: "fromWidget",
                action,
                requestId,
                data
            };

            if (widgetId) {
                message.widgetId = widgetId;
            }

            console.log(`[API] Sending ${action} with requestId: ${requestId}`);
            window.parent.postMessage(message, "*");
        });
    }

    onMessage_subscribe(handler) {
        if (!this.messageHandlers) {
            this.messageHandlers = [];
        }
        this.messageHandlers.push(handler);
    }
}

let widgetApi = new MatrixWidgetAPI();
let openIdToken = null;


/**
 * Standalone Matrix context initialization
 */
function initStandaloneMatrixContext() {
    const params = new URLSearchParams(window.location.search);
    const storage = {
        roomId: localStorage.getItem("matrixRoomId"),
        userId: localStorage.getItem("matrixUserId"),
        homeserverUrl: localStorage.getItem("matrixHomeserverUrl"),
        accessToken: localStorage.getItem("matrixAccessToken")
    };

    roomId = params.get("roomId") || storage.roomId || roomId;
    userId = params.get("userId") || storage.userId || userId;
    homeserverUrl = params.get("homeserver") || params.get("homeserverUrl") || storage.homeserverUrl || homeserverUrl;
    openIdToken = params.get("accessToken") || window.MATRIX_ACCESS_TOKEN || storage.accessToken || openIdToken;

    if (!roomId) {
        roomId = window.prompt("Enter Matrix Room ID (example: !abc123:matrix.org):", "") || "";
    }
    if (!homeserverUrl) {
        homeserverUrl = window.prompt("Enter Matrix homeserver URL (example: https://matrix.org):", "") || "";
    }
    if (!openIdToken) {
        openIdToken = window.prompt("Enter Matrix access token:", "") || "";
    }
    if (!userId) {
        userId = window.prompt("Optional Matrix user ID (example: @alice:matrix.org):", "") || "";
    }

    if (homeserverUrl && !/^https?:\/\//.test(homeserverUrl)) {
        homeserverUrl = `https://${homeserverUrl}`;
    }

    if (!roomId || !homeserverUrl || !openIdToken) {
        throw new Error("Standalone mode requires roomId, homeserver, and accessToken");
    }

    localStorage.setItem("matrixRoomId", roomId);
    localStorage.setItem("matrixHomeserverUrl", homeserverUrl);
    localStorage.setItem("matrixAccessToken", openIdToken);
    if (userId) {
        localStorage.setItem("matrixUserId", userId);
    }

    console.log("✓ Standalone Matrix context loaded:", { roomId, userId, homeserverUrl });
}

/**
 * Update the status indicator and text
 */
function updateStatus(text, title, connected) {
    const indicator = document.getElementById("statusIndicator");
    const statusText = document.getElementById("statusText");

    if (indicator && statusText) {
        indicator.className = `status-indicator ${connected ? "connected" : "disconnected"}`;
        statusText.textContent = text;
        statusText.title = title;
    }
}

/**
 * Show a message to the user
 */
function showMessage(text, type) {
    const el = document.getElementById("statusMessage");
    if (!el) return;

    el.textContent = text;
    el.className = `status-message show ${type}`;

/**
 * Initialize widget by handshaking with Element
 */
async function initWidget() {
    try {
        console.log("🔄 Widget initializing...");
        updateStatus("Connecting...", "Connecting", false);

        // If opened directly in browser, use explicit standalone Matrix config.
        if (window.parent === window) {
            initStandaloneMatrixContext();
            isReady = true;
            updateStatus("Standalone Matrix", "Using URL/manual Matrix config", true);
            console.log("✓ Widget ready in standalone Matrix mode");
            return;
        }

        // Step 1: Wait for capabilities from Element
        console.log("[Init] Waiting for capabilities from Element...");
        let capabilitiesRequestId = null;
        let widgetId = null;
        const capabilitiesReceived = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.warn("⚠️ Timeout waiting for capabilities");
                resolve(false);
            }, 3000);

            const capListener = (msg) => {
                if (msg.action === "capabilities") {
                    capabilitiesRequestId = msg.requestId;
                    widgetId = msg.widgetId;
                    clearTimeout(timeout);
                    console.log("✓ Received capabilities from Element");
                    console.log("  requestId:", capabilitiesRequestId);
                    console.log("  widgetId:", widgetId);
                    resolve(true);
                }
            };

            widgetApi.onMessage_subscribe(capListener);
        });

        if (!capabilitiesReceived) {
            throw new Error("Did not receive capabilities from Element");
        }

        // Step 2: Acknowledge capabilities with the SAME requestId and widgetId
        console.log("[Init] Acknowledging capabilities...");
        window.parent.postMessage({
            api: "fromWidget",
            widgetId: widgetId,
            action: "capabilities",
            requestId: capabilitiesRequestId,
            response: {
                capabilities: ["org.matrix.msc2762.send.event"]
            }
        }, "*");

        // Step 3: Request OpenID token
        console.log("[Init] Requesting OpenID token...");
        const tokenResponse = await widgetApi.sendRequest("org.matrix.msc2931.openid_credentials", {}, widgetId);

        if (tokenResponse && tokenResponse.data?.access_token) {
            openIdToken = tokenResponse.data.access_token;
            console.log("✓ Got OpenID token from Element!");
        } else {
            console.warn("⚠️  No token response from Element, will use guest auth");
        }

        // Step 4: Extract context from widgetId (from Element's capabilities message)
        console.log("[Init] Extracting context from Element's widgetId...");

        // Decode the widgetId first
        const decodedWidgetId = decodeURIComponent(widgetId);
        console.log("[Init] Decoded widgetId:", decodedWidgetId);

        const match = decodedWidgetId.match(/!([\w.-]+):([^_]+)_@([\w.-]+):([^_]+)/);
        if (match) {
            roomId = `!${match[1]}:${match[2]}`;
            userId = `@${match[3]}:${match[4]}`;
            homeserverUrl = `https://${match[2]}`;

            console.log("✓ Extracted context from widgetId:", { roomId, userId, homeserverUrl });
        } else {
            throw new Error(`Could not parse widgetId format: ${decodedWidgetId}`);
        }

        if (!roomId || !userId) {
            throw new Error("Missing room or user context");
        }

        isReady = true;
        updateStatus("Matrix Mode", "Connected to Matrix", true);
        console.log("✓ Widget ready. Room:", roomId, "User:", userId);

    } catch (error) {
        console.error("❌ Widget initialization error:", error);
        updateStatus("Error", `Failed to connect: ${error.message}`, false);
    }
}

/**
 * Send a reminder message to the Matrix room
 */
// Store reminders in memory (in a real app, persist to backend)
let reminders = [];

async function sendReminder(event) {
    event.preventDefault();

    if (!isReady) {
        showMessage("Widget not ready. Please reload.", "error");
        return;
    }

    const dateTime = document.getElementById("remindDateTime").value;
    const message = document.getElementById("message").value;
    const btn = document.getElementById("submitBtn");

    if (!dateTime || !message.trim()) {
        showMessage("Please fill in all fields", "error");
        return;
    }

    btn.disabled = true;
    btn.textContent = "⏳ Sending...";
    showMessage("Sending reminder...", "info");

    // Step 1: Notify chat that timer is starting
    await sendCommandToMatrix(`[Widget] Timer countdown started.`);

    try {
        await sendReminderAtDateTime(dateTime, message);
        showMessage(`✓ Reminder set for ${dateTime}!`, "success");

        // Step 2: Notify chat that reminder is scheduled
        await sendCommandToMatrix(`[Widget] Reminder scheduled for ${dateTime}.`);

        // Add to reminders list
        reminders.push({ dateTime, message });
        reminders.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
        renderReminders();

        // Start or update the countdown timer
        startCountdownTimer();

        // Clear form (but keep timer running)
        document.getElementById("reminderForm").reset();
        document.getElementById("remindDateTime").focus();

    } catch (error) {
        console.error("❌ Error:", error.message);
        showMessage(`Error: ${error.message}`, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "📤 Set Reminder";
    }
}

// Render the list of upcoming reminders
function renderReminders() {
    const list = document.getElementById("reminderList");
    list.innerHTML = "";
    reminders.forEach((rem, idx) => {
        const li = document.createElement("li");
        li.style.display = "flex";
        li.style.alignItems = "center";
        li.style.justifyContent = "space-between";
        li.style.padding = "6px 0";
        li.innerHTML = `<span><b>${formatDateTime(rem.dateTime)}</b>: ${rem.message}</span> <button data-idx="${idx}" style="background:#eee;color:#f5576c;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;">✕</button>`;
        li.querySelector("button").onclick = function() {
            reminders.splice(idx, 1);
            renderReminders();
            startCountdownTimer();
        };
        list.appendChild(li);
    });
}

function formatDateTime(dt) {
    const d = new Date(dt.replace('T', ' '));
    return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

// Mac-style circular countdown timer logic
let timerInterval = null;
function startCountdownTimer() {
    const timerContainer = document.getElementById("timerContainer");
    const timerArc = document.getElementById("timerArc");
    const timerText = document.getElementById("timerText");
    if (!timerContainer || !timerArc || !timerText) return;

    // Always show timer
    timerContainer.style.display = "flex";

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(async () => {
        if (reminders.length === 0) {
            timerText.textContent = "00:00:00";
            timerArc.setAttribute('stroke-dashoffset', 0);
            return;
        }
        // Next upcoming reminder
        reminders.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
        const next = reminders[0];
        const target = new Date(next.dateTime.replace('T', ' '));
        const now = new Date();
        const total = (target - now) / 1000;
        let remaining = total;
        if (remaining < 0) remaining = 0;

        // Format as HH:MM:SS
        const h = String(Math.floor(remaining / 3600)).padStart(2, '0');
        const m = String(Math.floor((remaining % 3600) / 60)).padStart(2, '0');
        const s = String(Math.floor(remaining % 60)).padStart(2, '0');
        timerText.textContent = `${h}:${m}:${s}`;

        // Animate arc
        const CIRCUM = 2 * Math.PI * 54;
        let percent = 1;
        if (reminders.length > 0) {
            // Find how much time has passed since scheduled
            const firstScheduled = new Date();
            percent = remaining / ((target - firstScheduled) / 1000 + remaining);
        }
        timerArc.setAttribute('stroke-dasharray', CIRCUM);
        timerArc.setAttribute('stroke-dashoffset', CIRCUM * (1 - percent));

        if (remaining <= 0) {
            // Remove the reminder and notify chat
            const finished = reminders.shift();
            renderReminders();
            await sendCommandToMatrix(`[Widget] Reminder: "${finished.message}" at ${formatDateTime(finished.dateTime)} triggered.`);
        }
    }, 1000);
}

// Send reminder using !remind <date> [message] format
async function sendReminderAtDateTime(dateTime, message) {
    // Convert datetime-local value (YYYY-MM-DDTHH:MM) to a format the bot understands (ISO or readable)
    // We'll use "YYYY-MM-DD HH:MM" (24h) for compatibility
    const formatted = dateTime.replace('T', ' ');
    const reminderCommand = `!remind ${formatted} ${message.trim()}`;
    await sendCommandToMatrix(reminderCommand);
}

async function sendReminderViaMatrix(duration, unit, message) {
    const reminderCommand = `!remind ${duration}${unit} ${message.trim()}`;

    if (!roomId || !homeserverUrl) {
        throw new Error("Not connected to Matrix");
    }

    let token = window.MATRIX_ACCESS_TOKEN || openIdToken;
    if (!token) {
        throw new Error("No access token available");
    }

    const txnId = `${Date.now()}_${Math.random()}`;
    const url = `${homeserverUrl}/_matrix/client/v3/rooms/${roomId}/send/m.room.message/${txnId}`;


    const response = await fetch(url, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
            msgtype: "m.text",
            body: reminderCommand
        })
    });

    if (!response.ok) {
        throw new Error(`Matrix API error: ${response.status}`);
    }

    const result = await response.json();
    console.log("✓ Reminder sent:", result.event_id);
}
// locales, locale, timezone
async function sendListReminder(name, time, list) {
    const reminderCommand = `!remind ${list}`;

    const response = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                msgtype: "m.text",
                body: reminderCommand
            }),
        }
    );
    const returnlist = await response.json();
}

async function reminderReschedule(params) {
}

async function reminderTimezone(params) {

}
async function reminderTimer(params) {

}
/**
 * Initialize on DOM ready
 */
document.addEventListener("DOMContentLoaded", () => {
    initWidget();
    document.getElementById("reminderForm").addEventListener("submit", sendReminder);
    renderReminders();
    startCountdownTimer();

    // Add event listeners for command buttons
    const cmdBtns = document.querySelectorAll(".cmd-btn");
    cmdBtns.forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            const command = btn.getAttribute("data-cmd");
            if (!isReady) {
                showMessage("Widget not ready. Please reload.", "error");
                return;
            }
            try {
                await sendCommandToMatrix(command);
                showMessage(`✓ Sent: ${command}`, "success");
            } catch (error) {
                showMessage(`Error: ${error.message}`, "error");
            }
        });
    });

    // TIMER WIDGET LOGIC (moved from HTML)
    let timerWidgetInterval = null;
    const timerForm = document.getElementById("timerForm");
    const timerDisplay = document.getElementById("timerCountdownDisplay");
    let timerTotal = 0;
    let timerLeft = 0;
    let timerRunning = false;

    if (timerForm && timerDisplay) {
        timerForm.addEventListener("submit", async function(e) {
            e.preventDefault();
            const h = parseInt(document.getElementById("timerHours").value, 10) || 0;
            const m = parseInt(document.getElementById("timerMinutes").value, 10) || 0;
            const s = parseInt(document.getElementById("timerSeconds").value, 10) || 0;
            const msgInput = document.getElementById("timerMessage");
            const userMsg = msgInput ? msgInput.value.trim() : "";
            timerTotal = h * 3600 + m * 60 + s;
            timerLeft = timerTotal;
            if (timerTotal <= 0) {
                timerDisplay.textContent = "00:00:00";
                return;
            }
            timerRunning = true;
            timerDisplay.textContent = formatTimer(timerLeft);
            if (timerWidgetInterval) clearInterval(timerWidgetInterval);
            timerWidgetInterval = setInterval(async function() {
                timerLeft--;
                if (timerLeft <= 0) {
                    timerDisplay.textContent = "00:00:00";
                    clearInterval(timerWidgetInterval);
                    timerRunning = false;
                    // Send motivational message to Matrix room2
                    try {
                        await sendCommandToMatrix(`!remind for 0s ${botMsg}`);
                    } catch (err) {
                        // ignore
                    }
                } else {
                    timerDisplay.textContent = formatTimer(timerLeft);
                }
            }, 1000);
        });
    }

    function formatTimer(sec) {
        const h = String(Math.floor(sec / 3600)).padStart(2, '0');
        const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }
});

// Send arbitrary command to Matrix room
async function sendCommandToMatrix(command) {
    if (!roomId || !homeserverUrl) {
        throw new Error("Not connected to Matrix");
    }
    let token = window.MATRIX_ACCESS_TOKEN || openIdToken;
    if (!token) {
        throw new Error("No access token available");
    }
    const txnId = `${Date.now()}_${Math.random()}`;
    const url = `${homeserverUrl}/_matrix/client/v3/rooms/${roomId}/send/m.room.message/${txnId}`;
    const response = await fetch(url, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
            msgtype: "m.text",
            body: command
        })
    });
    if (!response.ok) {
        throw new Error(`Matrix API error: ${response.status}`);
    }
    const result = await response.json();
    console.log("✓ Command sent:", result.event_id);
}
}
