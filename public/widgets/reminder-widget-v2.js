// Provide a random motivational message if user leaves timer message blank
function getRandomMotivation() {
    const pool = [
        "",
        "Timer finished!"
    ];
    return pool[Math.floor(Math.random() * pool.length)];
}
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

    if (type === "success") {
        setTimeout(() => {
            el.classList.remove("show");
        }, 3000);
    }
}

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

let calendarReminders = [];
let activeTimer = null;
let timerWidgetInterval = null;
let calendarCountdownInterval = null;

function formatDateTime(dt) {
    const d = dt instanceof Date ? dt : new Date(String(dt).replace(' ', 'T'));
    return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

function formatDuration(totalSeconds) {
    const safeSeconds = Math.max(0, totalSeconds);
    const h = String(Math.floor(safeSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((safeSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(safeSeconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function renderCalendarReminderCountdowns() {
    const calendarReminderList = document.getElementById('calendarReminderList');
    if (!calendarReminderList) return;

    if (calendarReminders.length === 0) {
        calendarReminderList.innerHTML = '<li style="color:#888;">No active reminders</li>';
        return;
    }

    const now = Date.now();
    calendarReminderList.innerHTML = calendarReminders
        .sort((a, b) => a.targetMs - b.targetMs)
        .map((item) => {
            const remaining = Math.max(0, Math.ceil((item.targetMs - now) / 1000));
            return `<li style="list-style:none;margin-bottom:8px;padding:10px;border:1px solid #e6e6ef;border-radius:8px;background:#fafafe;">
                <div style="font-weight:600;color:#333;">${item.message}</div>
                <div style="font-size:0.85rem;color:#666;">${formatDateTime(new Date(item.targetMs))}</div>
                <div style="font-family:monospace;font-size:1rem;color:#f5576c;">${formatDuration(remaining)}</div>
            </li>`;
        })
        .join('');
}

function renderUnifiedUpcoming() {
    const unifiedUpcomingList = document.getElementById('unifiedUpcomingList');
    if (!unifiedUpcomingList) return;

    const now = Date.now();
    const items = [];

    if (activeTimer && activeTimer.targetMs > now) {
        items.push({
            kind: 'Timer',
            message: activeTimer.message || 'Timer',
            targetMs: activeTimer.targetMs
        });
    }

    calendarReminders.forEach((item) => {
        if (item.targetMs > now) {
            items.push({
                kind: 'Calendar',
                message: item.message,
                targetMs: item.targetMs
            });
        }
    });

    items.sort((a, b) => a.targetMs - b.targetMs);

    if (items.length === 0) {
        unifiedUpcomingList.innerHTML = '<li style="color:#888;">No active countdowns</li>';
        return;
    }

    unifiedUpcomingList.innerHTML = items
        .map((item) => {
            const remaining = Math.max(0, Math.ceil((item.targetMs - now) / 1000));
            return `<li style="list-style:none;margin-bottom:8px;padding:8px 10px;border:1px solid #ececf4;border-radius:8px;background:#fff;display:flex;justify-content:space-between;gap:10px;align-items:center;">
                <span style="color:#333;font-size:0.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.kind}: ${item.message}</span>
                <span style="font-family:monospace;color:#f5576c;font-size:0.95rem;">${formatDuration(remaining)}</span>
            </li>`;
        })
        .join('');
}

function refreshCountdownViews() {
    renderCalendarReminderCountdowns();
    renderUnifiedUpcoming();
}

function startCalendarCountdownTicker() {
    if (calendarCountdownInterval) return;

    calendarCountdownInterval = setInterval(() => {
        if (calendarReminders.length === 0) {
            refreshCountdownViews();
            return;
        }

        const now = Date.now();
        const dueItems = calendarReminders.filter((item) => item.targetMs <= now);
        calendarReminders = calendarReminders.filter((item) => item.targetMs > now);

        dueItems.forEach((item) => {
            if (isReady) {
                sendCommandToMatrix(`[Widget] Reminder: "${item.message}" at ${formatDateTime(new Date(item.targetMs))} triggered.`)
                    .catch(() => {});
            }
        });

        refreshCountdownViews();
    }, 1000);
}

// Send reminder using !remind <date> [message] format
async function sendReminderAtDateTime(dateTime, message) {
    // Convert datetime-local value (YYYY-MM-DDTHH:MM) to a format the bot understands (ISO or readable)
    // We'll use "YYYY-MM-DD HH:MM" (24h) for compatibility
    const formatted = dateTime.replace('T', ' ');
    const reminderCommand = `!remind ${formatted} ${message.trim()}`;
    debugLogReminderCommand(reminderCommand);
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
    startCalendarCountdownTicker();
    refreshCountdownViews();

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

    // Minimal timer flow: set -> running countdown -> reset
    const timerInputGroup = document.getElementById("timerInputGroup");
    const timerSetBtnGroup = document.getElementById("timerSetBtnGroup");
    const timerCountdownPanel = document.getElementById("timerCountdownPanel");
    const timerCountdownGroup = document.getElementById("timerCountdownGroup");
    const timerLiveCountdown = document.getElementById("timerLiveCountdown");
    const setTimerBtn = document.getElementById("setTimerBtn");
    const resetTimerBtn = document.getElementById("resetTimerBtn");
    const timerMessageInput = document.getElementById("timerMessage");
    const timerMessageGroup = timerMessageInput ? timerMessageInput.closest(".form-group") : null;

    const calendarForm = document.getElementById('calendarReminderForm');
    const calendarSetReminderBtn = document.getElementById('calendarSetReminderBtn');
    const calendarStatus = document.getElementById('calendarStatusMessage');

    function showTimerInputs() {
        if (timerInputGroup) timerInputGroup.style.display = '';
        if (timerSetBtnGroup) timerSetBtnGroup.style.display = '';
        if (timerMessageGroup) timerMessageGroup.style.display = '';
        if (timerCountdownPanel) timerCountdownPanel.style.display = 'none';
        if (timerCountdownGroup) timerCountdownGroup.style.display = 'none';
    }

    function showTimerCountdown() {
        if (timerInputGroup) timerInputGroup.style.display = 'none';
        if (timerSetBtnGroup) timerSetBtnGroup.style.display = 'none';
        if (timerMessageGroup) timerMessageGroup.style.display = 'none';
        if (timerCountdownPanel) timerCountdownPanel.style.display = '';
        if (timerCountdownGroup) timerCountdownGroup.style.display = '';
    }

    if (setTimerBtn && timerLiveCountdown && resetTimerBtn) {
        setTimerBtn.addEventListener('click', function() {
            const h = parseInt(document.getElementById("timerHours").value, 10) || 0;
            const m = parseInt(document.getElementById("timerMinutes").value, 10) || 0;
            const s = parseInt(document.getElementById("timerSeconds").value, 10) || 0;
            const userMsg = timerMessageInput ? timerMessageInput.value.trim() : "";
            const timerTotal = h * 3600 + m * 60 + s;

            if (timerTotal <= 0) {
                timerLiveCountdown.textContent = "00:00:00";
                return;
            }

            activeTimer = {
                targetMs: Date.now() + (timerTotal * 1000),
                message: userMsg
            };

            showTimerCountdown();
            timerLiveCountdown.textContent = formatDuration(timerTotal);
            refreshCountdownViews();

            if (timerWidgetInterval) clearInterval(timerWidgetInterval);

            timerWidgetInterval = setInterval(async function() {
                if (!activeTimer) {
                    clearInterval(timerWidgetInterval);
                    return;
                }

                const timerLeft = Math.max(0, Math.ceil((activeTimer.targetMs - Date.now()) / 1000));

                if (timerLeft <= 0) {
                    timerLiveCountdown.textContent = "00:00:00";
                    clearInterval(timerWidgetInterval);
                    const botMsg = activeTimer.message || getRandomMotivation();
                    activeTimer = null;
                    showTimerInputs();
                    refreshCountdownViews();
                    try {
                        if (botMsg && isReady) {
                            await sendCommandToMatrix(`!remind for 0s ${botMsg}`);
                        }
                    } catch (err) {
                        // ignore dispatch failures for local UI flow
                    }
                } else {
                    timerLiveCountdown.textContent = formatDuration(timerLeft);
                    renderUnifiedUpcoming();
                }
            }, 1000);
        });

        resetTimerBtn.addEventListener('click', function() {
            if (timerWidgetInterval) clearInterval(timerWidgetInterval);
            activeTimer = null;
            showTimerInputs();
            refreshCountdownViews();
        });

        showTimerInputs();
    }

    if (calendarForm) {
        calendarForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const selectedDate = document.getElementById('calendarSelectedDate').value;
            const calendarTime = document.getElementById('calendarTime').value;
            const calendarMessage = document.getElementById('calendarMessage').value.trim();

            if (!selectedDate) {
                calendarStatus.textContent = 'Select date';
                calendarStatus.className = 'status-message show error';
                return;
            }

            if (!calendarTime || !calendarMessage) {
                calendarStatus.textContent = 'Set time and message';
                calendarStatus.className = 'status-message show error';
                return;
            }

            const targetDate = new Date(`${selectedDate}T${calendarTime}`);
            if (Number.isNaN(targetDate.getTime()) || targetDate.getTime() <= Date.now()) {
                calendarStatus.textContent = 'Pick a future time';
                calendarStatus.className = 'status-message show error';
                return;
            }

            const dateTime = `${selectedDate} ${calendarTime}`;

            try {
                if (calendarSetReminderBtn) calendarSetReminderBtn.disabled = true;
                calendarStatus.textContent = 'Sending...';
                calendarStatus.className = 'status-message show info';

                await sendReminderAtDateTime(dateTime, calendarMessage);

                calendarReminders.push({
                    id: `cal-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    targetMs: targetDate.getTime(),
                    message: calendarMessage
                });

                calendarReminders.sort((a, b) => a.targetMs - b.targetMs);
                refreshCountdownViews();

                calendarStatus.textContent = 'Reminder set';
                calendarStatus.className = 'status-message show success';

                calendarForm.reset();
                document.getElementById('calendarSelectedDate').value = '';
            } catch (err) {
                calendarStatus.textContent = 'Error: ' + err.message;
                calendarStatus.className = 'status-message show error';
            } finally {
                if (calendarSetReminderBtn) calendarSetReminderBtn.disabled = false;
            }
        });
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

// Add this utility to log the exact command and room info being sent
function debugLogReminderCommand(command) {
    console.log('[DEBUG] Sending reminder command:', command);
    console.log('[DEBUG] roomId:', roomId, 'homeserverUrl:', homeserverUrl, 'userId:', userId);
}

// --- Listen for bot responses to reminders ---
document.addEventListener('DOMContentLoaded', function() {
    window.addEventListener('message', function(event) {
        // Only process Matrix API messages
        if (!event.data || !event.data.data || !event.data.data.body) return;
        const body = event.data.data.body;
        // Check if the message is a bot response to a reminder
        if (body.startsWith('Reminder set for') || body.startsWith('You have no upcoming reminders')) {
            // Show in a status message area if desired
            let calendarStatus = document.getElementById('calendarStatusMessage');
            if (calendarStatus) {
                calendarStatus.textContent = body;
                calendarStatus.className = 'status-message show info';
            }
        }
    });
});

// --- Calendar UI Rendering and Navigation Logic ---
document.addEventListener('DOMContentLoaded', function() {
    // Calendar state
    let currentMonth = new Date().getMonth();
    let currentYear = new Date().getFullYear();
    let selectedDate = null;

    const calendarTable = document.getElementById('calendarTable');
    const calendarMonthLabel = document.getElementById('calendarMonthLabel');
    const prevMonthBtn = document.getElementById('prevMonth');
    const nextMonthBtn = document.getElementById('nextMonth');
    const calendarSelectedDate = document.getElementById('calendarSelectedDate');

    function renderCalendar(month, year) {
        // Month label
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        calendarMonthLabel.textContent = `${monthNames[month]} ${year}`;

        // First day of the month
        const firstDay = new Date(year, month, 1).getDay();
        // Days in month
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // Build calendar grid
        let html = '<thead><tr>';
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        for (let d = 0; d < 7; d++) {
            html += `<th style="padding:6px 0;color:#f5576c;font-weight:600;">${dayNames[d]}</th>`;
        }
        html += '</tr></thead><tbody>';

        let date = 1;
        for (let i = 0; i < 6; i++) { // 6 weeks max
            html += '<tr>';
            for (let j = 0; j < 7; j++) {
                if (i === 0 && j < firstDay) {
                    html += '<td></td>';
                } else if (date > daysInMonth) {
                    html += '<td></td>';
                } else {
                    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(date).padStart(2,'0')}`;
                    let classes = 'cal-day';
                    if (selectedDate === dateStr) classes += ' selected';
                    html += `<td style="padding:0;position:relative;">
                        <button type="button" class="cal-day-btn ${classes}" data-date="${dateStr}" style="width:36px;height:36px;border:none;background:${selectedDate===dateStr?'#ff4d6d':'#f5f6fa'};color:${selectedDate===dateStr?'#fff':'#333'};border-radius:50%;font-weight:600;cursor:pointer;transition:background 0.2s;outline:none;position:relative;">
                            ${date}
                        </button>
                    </td>`;
                    date++;
                }
            }
            html += '</tr>';
        }
        html += '</tbody>';
        calendarTable.innerHTML = html;

        // Add click listeners to date buttons
        document.querySelectorAll('.cal-day-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                selectedDate = btn.getAttribute('data-date');
                calendarSelectedDate.value = selectedDate;
                renderCalendar(currentMonth, currentYear);
            });
        });
    }

    if (prevMonthBtn && nextMonthBtn) {
        prevMonthBtn.addEventListener('click', function() {
            currentMonth--;
            if (currentMonth < 0) {
                currentMonth = 11;
                currentYear--;
            }
            renderCalendar(currentMonth, currentYear);
        });
        nextMonthBtn.addEventListener('click', function() {
            currentMonth++;
            if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
            }
            renderCalendar(currentMonth, currentYear);
        });
    }

    // Initialize calendar
    renderCalendar(currentMonth, currentYear);
});
