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
        const reminderForm = document.getElementById("reminderForm");
        if (reminderForm) reminderForm.reset();
        const remindDateTime = document.getElementById("remindDateTime");
        if (remindDateTime) remindDateTime.focus();

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
    // For calendar widget reminders
    const calendarReminderList = document.getElementById("calendarReminderList");
    if (!calendarReminderList) return;
    if (reminders.length) {
        calendarReminderList.innerHTML = reminders.map(r =>
            `<li style='margin-bottom:6px;'><span style='color:#f5576c;font-weight:bold;'>${r.date ? r.date : formatDateTime(r.dateTime)} ${r.time ? r.time : ''}</span> — ${r.msg ? r.msg : r.message}</li>`
        ).join('');
    } else {
        calendarReminderList.innerHTML = '<li style="color:#aaa;font-style:italic;">No reminders yet.</li>';
    }
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
    const reminderForm = document.getElementById("reminderForm");
    if (reminderForm) {
        reminderForm.addEventListener("submit", sendReminder);
    }
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

    // ENHANCED TIMER WIDGET LOGIC (stepper controls, click-to-set, countdown, reset)
    let timerWidgetInterval = null;
    const timerInputGroup = document.getElementById("timerInputGroup");
    const timerSetBtnGroup = document.getElementById("timerSetBtnGroup");
    const timerCountdownGroup = document.getElementById("timerCountdownGroup");
    const timerLiveCountdown = document.getElementById("timerLiveCountdown");
    const setTimerBtn = document.getElementById("setTimerBtn");
    const resetTimerBtn = document.getElementById("resetTimerBtn");
    let timerTotal = 0;
    let timerLeft = 0;
    let timerRunning = false;

    function showTimerInputs() {
        if (timerInputGroup) timerInputGroup.style.display = '';
        if (timerSetBtnGroup) timerSetBtnGroup.style.display = '';
        if (timerCountdownGroup) timerCountdownGroup.style.display = 'none';
    }
    function showTimerCountdown() {
        if (timerInputGroup) timerInputGroup.style.display = 'none';
        if (timerSetBtnGroup) timerSetBtnGroup.style.display = 'none';
        if (timerCountdownGroup) timerCountdownGroup.style.display = '';
    }

    if (setTimerBtn && timerLiveCountdown && resetTimerBtn) {
        setTimerBtn.addEventListener('click', function() {
            const h = parseInt(document.getElementById("timerHours").value, 10) || 0;
            const m = parseInt(document.getElementById("timerMinutes").value, 10) || 0;
            const s = parseInt(document.getElementById("timerSeconds").value, 10) || 0;
            const msgInput = document.getElementById("timerMessage");
            const userMsg = msgInput ? msgInput.value.trim() : "";
            timerTotal = h * 3600 + m * 60 + s;
            timerLeft = timerTotal;
            if (timerTotal <= 0) {
                timerLiveCountdown.textContent = "00:00:00";
                return;
            }
            showTimerCountdown();
            timerRunning = true;
            timerLiveCountdown.textContent = formatTimer(timerLeft);
            if (timerWidgetInterval) clearInterval(timerWidgetInterval);
            timerWidgetInterval = setInterval(async function() {
                timerLeft--;
                if (timerLeft <= 0) {
                    timerLiveCountdown.textContent = "00:00:00";
                    clearInterval(timerWidgetInterval);
                    timerRunning = false;
                    // Send motivational message to Matrix room
                    let botMsg = userMsg || getRandomMotivation();
                    try {
                        await sendCommandToMatrix(`!remind for 0s ${botMsg}`);
                    } catch (err) {
                        // ignore
                    }
                } else {
                    timerLiveCountdown.textContent = formatTimer(timerLeft);
                }
            }, 1000);
        });
        resetTimerBtn.addEventListener('click', function() {
            if (timerWidgetInterval) clearInterval(timerWidgetInterval);
            timerRunning = false;
            showTimerInputs();
        });
        // On load, show inputs
        showTimerInputs();
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

// Add this utility to log the exact command and room info being sent
function debugLogReminderCommand(command) {
    console.log('[DEBUG] Sending reminder command:', command);
    console.log('[DEBUG] roomId:', roomId, 'homeserverUrl:', homeserverUrl, 'userId:', userId);
}

// --- Calendar Reminder Integration ---
document.addEventListener('DOMContentLoaded', function() {
    const calendarForm = document.getElementById('calendarReminderForm');
    if (!calendarForm) return;
    calendarForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const selectedDate = document.getElementById('calendarSelectedDate').value;
        const calendarTime = document.getElementById('calendarTime').value;
        const calendarMessage = document.getElementById('calendarMessage').value.trim();
        const calendarStatus = document.getElementById('calendarStatusMessage');
        if (!selectedDate) {
            calendarStatus.textContent = 'Please select a date.';
            calendarStatus.className = 'status-message show error';
            return;
        }
        if (!calendarTime || !calendarMessage) {
            calendarStatus.textContent = 'Please enter time and message.';
            calendarStatus.className = 'status-message show error';
            return;
        }
        // Format: YYYY-MM-DD HH:MM
        const dateTime = `${selectedDate} ${calendarTime}`;
        try {
            calendarStatus.textContent = 'Sending reminder...';
            calendarStatus.className = 'status-message show info';
            await sendReminderAtDateTime(dateTime, calendarMessage);
            calendarStatus.textContent = 'Reminder set!';
            calendarStatus.className = 'status-message show success';
        } catch (err) {
            calendarStatus.textContent = 'Error: ' + err.message;
            calendarStatus.className = 'status-message show error';
        }
        calendarForm.reset();
        document.getElementById('calendarSelectedDate').value = '';
    });
});

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
