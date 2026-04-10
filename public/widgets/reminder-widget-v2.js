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
const TOKEN_MAP_STORAGE_KEY = "matrixAccessTokensByUser";

function normalizeMatrixUserId(value) {
    const v = typeof value === "string" ? value.trim() : "";
    return v || null;
}

function readTokenMap() {
    try {
        const raw = localStorage.getItem(TOKEN_MAP_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function writeTokenMap(map) {
    try {
        localStorage.setItem(TOKEN_MAP_STORAGE_KEY, JSON.stringify(map));
    } catch {
        // ignore storage write failures
    }
}

function storeUserToken(user, token) {
    const normalizedUser = normalizeMatrixUserId(user);
    const normalizedToken = typeof token === "string" ? token.trim() : "";
    if (!normalizedUser || !normalizedToken) return;

    const tokenMap = readTokenMap();
    tokenMap[normalizedUser] = normalizedToken;
    writeTokenMap(tokenMap);
}

function getStoredUserToken(user) {
    const normalizedUser = normalizeMatrixUserId(user);
    if (!normalizedUser) return null;
    const tokenMap = readTokenMap();
    const token = tokenMap[normalizedUser];
    return typeof token === "string" && token.trim() ? token.trim() : null;
}

function resolveMatrixAccessToken(options = {}) {
    const params = options.params || new URLSearchParams(window.location.search);
    const explicitUser = normalizeMatrixUserId(options.userId);
    const activeUser = explicitUser || normalizeMatrixUserId(userId);

    const urlToken = params.get("accessToken") || "";
    if (urlToken.trim()) {
        if (activeUser) {
            storeUserToken(activeUser, urlToken);
        }
        return urlToken.trim();
    }

    const userScopedToken = getStoredUserToken(activeUser);
    if (userScopedToken) return userScopedToken;

    if (typeof openIdToken === "string" && openIdToken.trim()) {
        if (activeUser) {
            storeUserToken(activeUser, openIdToken);
        }
        return openIdToken.trim();
    }

    const legacyStorageToken = typeof options.legacyStorageToken === "string"
        ? options.legacyStorageToken
        : (localStorage.getItem("matrixAccessToken") || "");
    if (legacyStorageToken.trim()) {
        if (activeUser) {
            storeUserToken(activeUser, legacyStorageToken);
        }
        return legacyStorageToken.trim();
    }

    // Last fallback only; global token can belong to another account.
    const globalToken = typeof window.MATRIX_ACCESS_TOKEN === "string" ? window.MATRIX_ACCESS_TOKEN : "";
    if (globalToken.trim()) {
        if (activeUser) {
            storeUserToken(activeUser, globalToken);
        }
        return globalToken.trim();
    }

    return null;
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
    const urlAccessToken = params.get("accessToken") || "";
    const normalizedStorageToken = typeof storage.accessToken === "string" ? storage.accessToken.trim() : "";
    if (urlAccessToken.trim()) {
        openIdToken = urlAccessToken.trim();
    } else if (normalizedStorageToken) {
        openIdToken = normalizedStorageToken;
    }

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

    const resolvedToken = resolveMatrixAccessToken({
        params,
        userId,
        legacyStorageToken: storage.accessToken || ""
    });
    openIdToken = resolvedToken || openIdToken;

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
        storeUserToken(userId, openIdToken);
    }

    console.log("✓ Standalone Matrix context loaded:", { roomId, userId, homeserverUrl });
}

function hydrateMatrixContextFromStorageAndUrl() {
    const params = new URLSearchParams(window.location.search);
    const storedRoomId = localStorage.getItem("matrixRoomId") || "";
    const storedUserId = localStorage.getItem("matrixUserId") || "";
    const storedHomeserver = localStorage.getItem("matrixHomeserverUrl") || "";

    roomId = params.get("roomId") || roomId || storedRoomId || null;
    userId = params.get("userId") || userId || storedUserId || null;
    homeserverUrl = params.get("homeserver")
        || params.get("homeserverUrl")
        || homeserverUrl
        || storedHomeserver
        || null;

    if (homeserverUrl && !/^https?:\/\//.test(homeserverUrl)) {
        homeserverUrl = `https://${homeserverUrl}`;
    }
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
            console.warn("[Init] Did not receive capabilities from Element, trying stored context fallback");
            hydrateMatrixContextFromStorageAndUrl();
            if (roomId && homeserverUrl) {
                isReady = true;
                updateStatus("Matrix Mode", "Connected using stored context", true);
                return;
            }
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
            storeUserToken(userId, openIdToken);
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
            console.warn(`[Init] Could not parse widgetId format: ${decodedWidgetId}`);
            hydrateMatrixContextFromStorageAndUrl();
        }

        if (!roomId || !homeserverUrl) {
            throw new Error("Missing room or homeserver context");
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
let isCalendarPopupDismissed = false;
const CALENDAR_REMINDERS_STORAGE_KEY = 'matrixCalendarReminders';

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

function saveCalendarReminders() {
    try {
        localStorage.setItem(CALENDAR_REMINDERS_STORAGE_KEY, JSON.stringify(calendarReminders));
    } catch (error) {
        console.warn('[Calendar] Failed to persist reminders:', error);
    }
}

function loadCalendarReminders() {
    try {
        const raw = localStorage.getItem(CALENDAR_REMINDERS_STORAGE_KEY);
        if (!raw) return;

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;

        calendarReminders = parsed
            .filter((item) => item && typeof item.targetMs === 'number' && item.message)
            .map((item) => ({
                id: item.id || `cal-${item.targetMs}`,
                targetMs: item.targetMs,
                message: item.message
            }))
            .filter((item) => item.targetMs > Date.now());

        saveCalendarReminders();
    } catch (error) {
        console.warn('[Calendar] Failed to load reminders:', error);
        calendarReminders = [];
    }
}

function showCalendarCountdownPopup() {
    const popup = document.getElementById('calendarCountdownPopup');
    if (popup) popup.style.display = 'block';
}

function hideCalendarCountdownPopup() {
    const popup = document.getElementById('calendarCountdownPopup');
    if (popup) popup.style.display = 'none';
}

function renderCalendarReminderCountdowns() {
    const calendarPopupList = document.getElementById('calendarPopupList');
    if (!calendarPopupList) return;

    if (calendarReminders.length === 0) {
        calendarPopupList.innerHTML = '';
        hideCalendarCountdownPopup();
        return;
    }

    const now = Date.now();
    calendarPopupList.innerHTML = calendarReminders
        .sort((a, b) => a.targetMs - b.targetMs)
        .map((item) => {
            const remaining = Math.max(0, Math.ceil((item.targetMs - now) / 1000));
            return `<li class="calendar-popup-item">
                <div class="calendar-popup-item-top">
                    <div class="calendar-popup-item-message">${item.message}</div>
                    <div class="calendar-popup-item-badge">Active</div>
                </div>
                <div class="calendar-popup-item-meta">
                    <span>${formatDateTime(new Date(item.targetMs))}</span>
                    <span class="calendar-popup-item-countdown">${formatDuration(remaining)}</span>
                </div>
            </li>`;
        })
        .join('');

    if (!isCalendarPopupDismissed) {
        showCalendarCountdownPopup();
    }
}

function refreshCalendarCountdownView() {
    renderCalendarReminderCountdowns();
}

function startCalendarCountdownTicker() {
    if (calendarCountdownInterval) return;

    calendarCountdownInterval = setInterval(() => {
        if (calendarReminders.length === 0) {
            refreshCalendarCountdownView();
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

        if (dueItems.length > 0) {
            saveCalendarReminders();
        }

        refreshCalendarCountdownView();
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

    let token = resolveMatrixAccessToken();
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
    loadCalendarReminders();
    startCalendarCountdownTicker();
    refreshCalendarCountdownView();

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
    const timerClockFace = document.getElementById("timerClockFace");
    const timerEndAt = document.getElementById("timerEndAt");
    const setTimerBtn = document.getElementById("setTimerBtn");
    const resetTimerBtn = document.getElementById("resetTimerBtn");
    const timerMessageInput = document.getElementById("timerMessage");
    const timerMessageGroup = timerMessageInput ? timerMessageInput.closest(".form-group") : null;

    const calendarForm = document.getElementById('calendarReminderForm');
    const calendarSetReminderBtn = document.getElementById('calendarSetReminderBtn');
    const calendarStatus = document.getElementById('calendarStatusMessage');
    const calendarPopupCloseBtn = document.getElementById('calendarPopupCloseBtn');
    const calendarHourSelect = document.getElementById('calendarHour');
    const calendarMinuteSelect = document.getElementById('calendarMinute');
    const calendarPeriodSelect = document.getElementById('calendarPeriod');

    const widgetModeSwitch = document.getElementById('widgetModeSwitch');
    const widgetModeButtons = Array.from(document.querySelectorAll('.widget-mode-button[data-mode]'));
    const widgetModePanels = Array.from(document.querySelectorAll('[data-mode-panel]'));

    function setWidgetMode(mode) {
        if (!mode || widgetModeButtons.length === 0 || widgetModePanels.length === 0) return;

        if (widgetModeSwitch) {
            widgetModeSwitch.setAttribute('data-active-mode', mode);
        }

        widgetModeButtons.forEach((btn) => {
            const isActive = btn.getAttribute('data-mode') === mode;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            btn.setAttribute('tabindex', isActive ? '0' : '-1');
        });

        widgetModePanels.forEach((panel) => {
            const panelMode = panel.getAttribute('data-mode-panel');
            const shouldShow = panelMode === mode;
            panel.classList.toggle('is-hidden-by-mode', !shouldShow);
        });
    }

    if (widgetModeButtons.length > 0 && widgetModePanels.length > 0) {
        widgetModeButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = btn.getAttribute('data-mode');
                setWidgetMode(mode);
            });
        });

        const initialMode = (widgetModeSwitch && widgetModeSwitch.getAttribute('data-active-mode')) || 'timer';
        setWidgetMode(initialMode);
    }

    function initializeCalendarTimeSelectors() {
        if (calendarHourSelect && calendarHourSelect.options.length === 0) {
            for (let h = 1; h <= 12; h++) {
                const option = document.createElement('option');
                option.value = String(h);
                option.textContent = String(h).padStart(2, '0');
                calendarHourSelect.appendChild(option);
            }
        }

        if (calendarMinuteSelect && calendarMinuteSelect.options.length === 0) {
            for (let m = 0; m < 60; m++) {
                const option = document.createElement('option');
                option.value = String(m);
                option.textContent = String(m).padStart(2, '0');
                calendarMinuteSelect.appendChild(option);
            }
        }

        if (calendarPeriodSelect && calendarPeriodSelect.options.length === 0) {
            ['AM', 'PM'].forEach((p) => {
                const option = document.createElement('option');
                option.value = p;
                option.textContent = p;
                calendarPeriodSelect.appendChild(option);
            });
        }

        const now = new Date();
        if (calendarHourSelect && !calendarHourSelect.value) {
            const hour12 = ((now.getHours() + 11) % 12) + 1;
            calendarHourSelect.value = String(hour12);
        }
        if (calendarMinuteSelect && !calendarMinuteSelect.value) {
            calendarMinuteSelect.value = String(now.getMinutes());
        }
        if (calendarPeriodSelect && !calendarPeriodSelect.value) {
            calendarPeriodSelect.value = now.getHours() >= 12 ? 'PM' : 'AM';
        }
    }

    initializeCalendarTimeSelectors();

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

    function setTimerProgress(percent) {
        if (!timerClockFace) return;
        const bounded = Math.max(0, Math.min(100, percent));
        timerClockFace.style.setProperty('--progress', String(bounded));
    }

    function setTimerEndLabel(targetMs) {
        if (!timerEndAt) return;
        if (!targetMs) {
            timerEndAt.textContent = 'Ends at --:--';
            return;
        }
        const endTime = new Date(targetMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        timerEndAt.textContent = `Ends at ${endTime}`;
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
                message: userMsg,
                totalSeconds: timerTotal
            };

            showTimerCountdown();
            timerLiveCountdown.textContent = formatDuration(timerTotal);
            setTimerProgress(100);
            setTimerEndLabel(activeTimer.targetMs);

            if (timerWidgetInterval) clearInterval(timerWidgetInterval);

            timerWidgetInterval = setInterval(async function() {
                if (!activeTimer) {
                    clearInterval(timerWidgetInterval);
                    return;
                }

                const timerLeft = Math.max(0, Math.ceil((activeTimer.targetMs - Date.now()) / 1000));

                if (timerLeft <= 0) {
                    timerLiveCountdown.textContent = "00:00:00";
                    setTimerProgress(0);
                    clearInterval(timerWidgetInterval);
                    const botMsg = activeTimer.message || getRandomMotivation();
                    activeTimer = null;
                    showTimerInputs();
                    setTimerEndLabel(null);
                    try {
                        if (botMsg && isReady) {
                            await sendCommandToMatrix(`!remind for 0s ${botMsg}`);
                        }
                    } catch (err) {
                        // ignore dispatch failures for local UI flow
                    }
                } else {
                    timerLiveCountdown.textContent = formatDuration(timerLeft);
                    const percent = (timerLeft / activeTimer.totalSeconds) * 100;
                    setTimerProgress(percent);
                }
            }, 1000);
        });

        resetTimerBtn.addEventListener('click', function() {
            if (timerWidgetInterval) clearInterval(timerWidgetInterval);
            activeTimer = null;
            showTimerInputs();
            setTimerProgress(0);
            setTimerEndLabel(null);
        });

        showTimerInputs();
        setTimerProgress(0);
        setTimerEndLabel(null);
    }

    if (calendarForm) {
        calendarForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const selectedDate = document.getElementById('calendarSelectedDate').value;
            const selectedHour = calendarHourSelect ? parseInt(calendarHourSelect.value, 10) : NaN;
            const selectedMinute = calendarMinuteSelect ? parseInt(calendarMinuteSelect.value, 10) : NaN;
            const selectedPeriod = calendarPeriodSelect ? calendarPeriodSelect.value : '';
            const calendarMessage = document.getElementById('calendarMessage').value.trim();

            const hasValidHour = Number.isInteger(selectedHour) && selectedHour >= 1 && selectedHour <= 12;
            const hasValidMinute = Number.isInteger(selectedMinute) && selectedMinute >= 0 && selectedMinute <= 59;
            const hasValidPeriod = selectedPeriod === 'AM' || selectedPeriod === 'PM';

            if (!hasValidHour || !hasValidMinute || !hasValidPeriod) {
                calendarStatus.textContent = 'Set a valid time';
                calendarStatus.className = 'status-message show error';
                return;
            }

            let hour24 = selectedHour % 12;
            if (selectedPeriod === 'PM') {
                hour24 += 12;
            }
            const calendarTime = `${String(hour24).padStart(2, '0')}:${String(selectedMinute).padStart(2, '0')}`;

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

                let matrixSendError = null;
                if (isReady) {
                    try {
                        await sendReminderAtDateTime(dateTime, calendarMessage);
                    } catch (sendErr) {
                        matrixSendError = sendErr;
                        console.warn('[Calendar] Matrix reminder send failed, keeping local reminder:', sendErr);
                    }
                }

                calendarReminders.push({
                    id: `cal-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    targetMs: targetDate.getTime(),
                    message: calendarMessage
                });

                calendarReminders.sort((a, b) => a.targetMs - b.targetMs);
                saveCalendarReminders();
                isCalendarPopupDismissed = false;
                refreshCalendarCountdownView();

                if (matrixSendError) {
                    calendarStatus.textContent = 'Reminder saved locally. Matrix send failed.';
                    calendarStatus.className = 'status-message show info';
                } else if (!isReady) {
                    calendarStatus.textContent = 'Reminder saved locally (Matrix not connected).';
                    calendarStatus.className = 'status-message show info';
                } else {
                    calendarStatus.textContent = 'Reminder set';
                    calendarStatus.className = 'status-message show success';
                }

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

    if (calendarPopupCloseBtn) {
        calendarPopupCloseBtn.addEventListener('click', function() {
            isCalendarPopupDismissed = true;
            hideCalendarCountdownPopup();
        });
    }
});

// Send arbitrary command to Matrix room
async function sendCommandToMatrix(command) {
    if (!roomId || !homeserverUrl) {
        throw new Error("Not connected to Matrix");
    }
    let token = resolveMatrixAccessToken();
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
    const calendarSelectedDateValue = document.getElementById('calendarSelectedDateValue');

    function syncSelectedDateLabel() {
        if (calendarSelectedDateValue) {
            calendarSelectedDateValue.textContent = selectedDate || 'None';
        }
    }

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
            html += `<th>${dayNames[d]}</th>`;
        }
        html += '</tr></thead><tbody>';

        let date = 1;
        for (let i = 0; i < 6; i++) { // 6 weeks max
            html += '<tr>';
            for (let j = 0; j < 7; j++) {
                if (i === 0 && j < firstDay) {
                    html += '<td class="calendar-day-cell"></td>';
                } else if (date > daysInMonth) {
                    html += '<td class="calendar-day-cell"></td>';
                } else {
                    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(date).padStart(2,'0')}`;
                    let classes = 'calendar-day-btn';
                    if (selectedDate === dateStr) classes += ' is-selected';
                    html += `<td class="calendar-day-cell">
                        <button type="button" class="${classes}" data-date="${dateStr}" aria-label="${dateStr}">
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
        document.querySelectorAll('.calendar-day-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                selectedDate = btn.getAttribute('data-date');
                calendarSelectedDate.value = selectedDate;
                syncSelectedDateLabel();
                renderCalendar(currentMonth, currentYear);
            });
        });

        syncSelectedDateLabel();
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
    syncSelectedDateLabel();
});
