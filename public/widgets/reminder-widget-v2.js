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
let matrixAdapterUrl = null;
let matrixAccessTokenEnvelope = null;
let matrixRefreshTokenEnvelope = null;

// Track pending requests by requestId
const pendingRequests = new Map();
let requestCounter = 0;
const MATRIX_ADAPTER_URL_STORAGE_KEY = 'matrixAdapterUrl';
const DEFAULT_MATRIX_ADAPTER_URL = '/api/matrix/command';
const MATRIX_ACCESS_TOKEN_STORAGE_KEY = 'mx_access_token';
const MATRIX_REFRESH_TOKEN_STORAGE_KEY = 'mx_refresh_token';
const MATRIX_SYNC_DB_CANDIDATES = [
    'matrix-js-sdk-riot-web-sync',
    'matrix-js-sdk'
];

function normalizeMatrixTokenEnvelope(rawValue) {
    if (!rawValue) return null;

    if (typeof rawValue === 'object') {
        return rawValue;
    }

    const text = String(rawValue).trim();
    if (!text) return null;

    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
    } catch (error) {
        // Ignore invalid JSON and require a structured token envelope.
    }

    return null;
}

function readMatrixTokenEnvelope(params, paramKey, storageKey, legacyStorageKey) {
    const rawValue = params.get(paramKey)
        || localStorage.getItem(storageKey)
        || (legacyStorageKey ? localStorage.getItem(legacyStorageKey) : null);

    return normalizeMatrixTokenEnvelope(rawValue);
}

function hasMatrixTokenEnvelopes() {
    return Boolean(matrixAccessTokenEnvelope || matrixRefreshTokenEnvelope);
}

function getFirstQueryParam(params, keys) {
    for (const key of keys) {
        const value = params.get(key);
        if (value) return value;
    }

    return null;
}

function getHomeserverFromRoomId(value) {
    if (!value || !/^![^:]+:[^:]+$/.test(value)) return null;

    const domain = value.slice(value.indexOf(':') + 1).trim();
    if (!domain) return null;

    return /^https?:\/\//.test(domain) ? domain : `https://${domain}`;
}

function getHomeserverFromUserId(value) {
    if (!value || !/^@[^:]+:[^:]+$/.test(value)) return null;

    const domain = value.slice(value.indexOf(':') + 1).trim();
    if (!domain) return null;

    return /^https?:\/\//.test(domain) ? domain : `https://${domain}`;
}

function openIndexedDb(databaseName) {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            resolve(null);
            return;
        }

        let request;
        try {
            request = window.indexedDB.open(databaseName);
        } catch (error) {
            reject(error);
            return;
        }

        request.onerror = () => reject(request.error || new Error(`Failed to open IndexedDB database: ${databaseName}`));
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = () => {
            try {
                request.result.close();
            } catch (error) {
                // Ignore upgrade cleanup errors.
            }
            resolve(null);
        };
    });
}

function readAllStoreEntries(db, storeName) {
    return new Promise((resolve) => {
        if (!db.objectStoreNames.contains(storeName)) {
            resolve([]);
            return;
        }

        const entries = [];
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.openCursor();

        request.onerror = () => resolve(entries);
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
                resolve(entries);
                return;
            }

            entries.push({ key: cursor.key, value: cursor.value });
            cursor.continue();
        };
    });
}

function getRecordTextValue(record, candidateKeys) {
    if (!record || typeof record !== 'object') return null;

    for (const key of candidateKeys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return null;
}

async function loadMatrixContextFromIndexedDb() {
    for (const databaseName of MATRIX_SYNC_DB_CANDIDATES) {
        const db = await openIndexedDb(databaseName).catch(() => null);
        if (!db) {
            continue;
        }

        try {
            const roomEntries = await readAllStoreEntries(db, 'room');
            const userEntries = await readAllStoreEntries(db, 'users');
            const accountDataEntries = await readAllStoreEntries(db, 'accountData');
            const clientOptionsEntries = await readAllStoreEntries(db, 'client_options');

            const indexedRoomId = roomEntries.find((entry) => typeof entry.key === 'string' && entry.key.startsWith('!'))?.key
                || getRecordTextValue(roomEntries.find((entry) => entry.value)?.value, ['roomId', 'room_id', 'id'])
                || getRecordTextValue(accountDataEntries.find((entry) => entry.value)?.value, ['roomId', 'room_id']);

            const indexedUserId = userEntries.find((entry) => typeof entry.key === 'string' && entry.key.startsWith('@'))?.key
                || getRecordTextValue(userEntries.find((entry) => entry.value)?.value, ['userId', 'user_id', 'id'])
                || getRecordTextValue(accountDataEntries.find((entry) => entry.value)?.value, ['userId', 'user_id', 'mx_user_id'])
                || getRecordTextValue(clientOptionsEntries.find((entry) => entry.value)?.value, ['userId', 'user_id', 'mx_user_id']);

            const indexedHomeserverUrl = getRecordTextValue(clientOptionsEntries.find((entry) => entry.value)?.value, ['homeserverUrl', 'homeserver_url', 'homeserver', 'baseUrl'])
                || getHomeserverFromRoomId(indexedRoomId)
                || getHomeserverFromUserId(indexedUserId);

            db.close();

            if (indexedRoomId || indexedUserId || indexedHomeserverUrl) {
                return {
                    roomId: indexedRoomId || null,
                    userId: indexedUserId || null,
                    homeserverUrl: indexedHomeserverUrl || null,
                    source: databaseName
                };
            }
        } catch (error) {
            try {
                db.close();
            } catch (closeError) {
                // Ignore close errors.
            }
        }
    }

    return null;
}

function getMatrixAdapterUrl() {
    if (matrixAdapterUrl) return matrixAdapterUrl;

    const params = new URLSearchParams(window.location.search);
    const configuredUrl = params.get('matrixAdapterUrl')
        || window.MATRIX_ADAPTER_URL
        || localStorage.getItem(MATRIX_ADAPTER_URL_STORAGE_KEY)
        || DEFAULT_MATRIX_ADAPTER_URL;

    matrixAdapterUrl = configuredUrl.trim();
    return matrixAdapterUrl;
}

function isMatrixAdapterMode() {
    return Boolean(getMatrixAdapterUrl());
}

async function sendMatrixCommandViaAdapter(command) {
    const adapterUrl = getMatrixAdapterUrl();
    if (!adapterUrl) {
        throw new Error('Matrix adapter URL is not configured');
    }

    const payload = {
        command,
        source: 'reminder-widget'
    };

    if (roomId) {
        payload.roomId = roomId;
    }

    if (userId) {
        payload.userId = userId;
    }

    if (homeserverUrl) {
        payload.homeserverUrl = homeserverUrl;
    }

    if (matrixAccessTokenEnvelope) {
        payload.mx_access_token = matrixAccessTokenEnvelope;
    }

    if (matrixRefreshTokenEnvelope) {
        payload.mx_refresh_token = matrixRefreshTokenEnvelope;
    }

    const response = await fetch(adapterUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(errorText || `Matrix adapter error: ${response.status}`);
    }

    return response.json().catch(() => ({}));
}

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

async function initStandaloneMatrixContext() {
    const params = new URLSearchParams(window.location.search);
    const storage = {
        roomId: localStorage.getItem("matrixRoomId"),
        userId: localStorage.getItem("matrixUserId"),
        homeserverUrl: localStorage.getItem("matrixHomeserverUrl"),
        accessToken: localStorage.getItem("matrixAccessToken"),
        mxAccessToken: localStorage.getItem(MATRIX_ACCESS_TOKEN_STORAGE_KEY),
        mxRefreshToken: localStorage.getItem(MATRIX_REFRESH_TOKEN_STORAGE_KEY)
    };

    roomId = getFirstQueryParam(params, ["roomId", "room", "room_id"]) || window.MATRIX_ROOM_ID || storage.roomId || roomId;
    userId = getFirstQueryParam(params, ["userId", "user", "user_id"]) || window.MATRIX_USER_ID || storage.userId || userId;
    homeserverUrl = getFirstQueryParam(params, ["homeserver", "homeserverUrl", "homeserver_url", "hs"]) || window.MATRIX_HOMESERVER_URL || storage.homeserverUrl || homeserverUrl;
    matrixAdapterUrl = getFirstQueryParam(params, ["matrixAdapterUrl", "adapterUrl", "adapter_url"]) || window.MATRIX_ADAPTER_URL || localStorage.getItem(MATRIX_ADAPTER_URL_STORAGE_KEY) || matrixAdapterUrl;
    matrixAccessTokenEnvelope = readMatrixTokenEnvelope(params, MATRIX_ACCESS_TOKEN_STORAGE_KEY, MATRIX_ACCESS_TOKEN_STORAGE_KEY, 'matrixAccessToken')
        || normalizeMatrixTokenEnvelope(storage.mxAccessToken)
        || normalizeMatrixTokenEnvelope(params.get('accessToken'));
    matrixRefreshTokenEnvelope = readMatrixTokenEnvelope(params, MATRIX_REFRESH_TOKEN_STORAGE_KEY, MATRIX_REFRESH_TOKEN_STORAGE_KEY, 'matrixRefreshToken')
        || normalizeMatrixTokenEnvelope(storage.mxRefreshToken)
        || normalizeMatrixTokenEnvelope(params.get('refreshToken'));
    openIdToken = isMatrixAdapterMode() ? null : (params.get("accessToken") || storage.accessToken || openIdToken);

    if ((!roomId || !homeserverUrl) && window.indexedDB) {
        const indexedDbContext = await loadMatrixContextFromIndexedDb();
        if (indexedDbContext) {
            roomId = roomId || indexedDbContext.roomId;
            userId = userId || indexedDbContext.userId;
            homeserverUrl = homeserverUrl || indexedDbContext.homeserverUrl;
            console.log('✓ Standalone Matrix context loaded from IndexedDB:', indexedDbContext.source);
        }
    }

    if (!homeserverUrl && roomId) {
        homeserverUrl = getHomeserverFromRoomId(roomId);
    }

    if (homeserverUrl && !/^https?:\/\//.test(homeserverUrl)) {
        homeserverUrl = `https://${homeserverUrl}`;
    }

    if (roomId) {
        localStorage.setItem("matrixRoomId", roomId);
    }

    if (homeserverUrl) {
        localStorage.setItem("matrixHomeserverUrl", homeserverUrl);
    }
    if (isMatrixAdapterMode()) {
        localStorage.setItem(MATRIX_ADAPTER_URL_STORAGE_KEY, matrixAdapterUrl);
        if (matrixAccessTokenEnvelope) {
            localStorage.setItem(MATRIX_ACCESS_TOKEN_STORAGE_KEY, JSON.stringify(matrixAccessTokenEnvelope));
        }
        if (matrixRefreshTokenEnvelope) {
            localStorage.setItem(MATRIX_REFRESH_TOKEN_STORAGE_KEY, JSON.stringify(matrixRefreshTokenEnvelope));
        }
    } else {
        localStorage.setItem("matrixAccessToken", openIdToken);
    }
    if (userId) {
        localStorage.setItem("matrixUserId", userId);
    }

    console.log("✓ Standalone Matrix context loaded:", { roomId, userId, homeserverUrl, hasMatrixTokenEnvelopes: hasMatrixTokenEnvelopes() });
    return true;
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
            isReady = await initStandaloneMatrixContext();
            if (isReady) {
                updateStatus("Standalone Matrix", "Using URL/localStorage Matrix config", true);
                console.log("✓ Widget ready in standalone Matrix mode");
            }
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

        if (isMatrixAdapterMode()) {
            console.log("[Init] Matrix adapter mode enabled; skipping OpenID token request.");
        } else {
            // Step 3: Request OpenID token
            console.log("[Init] Requesting OpenID token...");
            const tokenResponse = await widgetApi.sendRequest("org.matrix.msc2931.openid_credentials", {}, widgetId);

            if (tokenResponse && tokenResponse.data?.access_token) {
                openIdToken = tokenResponse.data.access_token;
                console.log("✓ Got OpenID token from Element!");
            } else {
                console.warn("⚠️  No token response from Element, will use guest auth");
            }
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
let isCalendarPopupDismissed = false;
let editingCalendarReminderId = null;
const CALENDAR_REMINDERS_STORAGE_KEY = 'matrixCalendarReminders';
const WIDGET_MODE_STORAGE_KEY = 'matrixReminderWidgetMode';

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function padCalendarNumber(value) {
    return String(value).padStart(2, '0');
}

function getCalendarOrdinalSuffix(day) {
    const mod100 = day % 100;
    if (mod100 >= 11 && mod100 <= 13) return 'th';

    switch (day % 10) {
        case 1:
            return 'st';
        case 2:
            return 'nd';
        case 3:
            return 'rd';
        default:
            return 'th';
    }
}

function parseCalendarDateValue(dateValue) {
    if (!dateValue) return null;

    const parts = String(dateValue).split('-').map((item) => parseInt(item, 10));
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
        return null;
    }

    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatCalendarFriendlyDate(dateValue) {
    const date = parseCalendarDateValue(dateValue);
    if (!date) return '';

    const weekday = date.toLocaleDateString([], { weekday: 'long' });
    const month = date.toLocaleDateString([], { month: 'long' });
    const day = date.getDate();
    return `${weekday}, ${month} ${day}${getCalendarOrdinalSuffix(day)}`;
}

function formatCalendarRelativeLabel(dateValue) {
    const date = parseCalendarDateValue(dateValue);
    if (!date) return 'Pick a future day to continue.';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);

    const diffDays = Math.round((date.getTime() - today.getTime()) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays > 1) return `In ${diffDays} days`;
    return `${Math.abs(diffDays)} days ago`;
}

function updateCalendarConfirmationLine(dateValue) {
    const calendarSelectedDateValue = document.getElementById('calendarSelectedDateValue');
    const calendarSelectedDateMeta = document.getElementById('calendarSelectedDateMeta');

    if (!calendarSelectedDateValue || !calendarSelectedDateMeta) return;

    if (!dateValue) {
        calendarSelectedDateValue.textContent = 'Select a date to get started.';
        calendarSelectedDateMeta.textContent = 'Pick a future day to continue.';
        return;
    }

    calendarSelectedDateValue.textContent = `Setting reminder for ${formatCalendarFriendlyDate(dateValue)}.`;
    calendarSelectedDateMeta.textContent = formatCalendarRelativeLabel(dateValue);
}

function populateCalendarTimeSelects() {
    const calendarHour = document.getElementById('calendarHour');
    const calendarMinute = document.getElementById('calendarMinute');
    const calendarPeriod = document.getElementById('calendarPeriod');

    if (calendarHour && calendarHour.options.length === 0) {
        for (let hour = 1; hour <= 12; hour++) {
            const option = document.createElement('option');
            option.value = String(hour);
            option.textContent = padCalendarNumber(hour);
            calendarHour.appendChild(option);
        }
    }

    if (calendarMinute && calendarMinute.options.length === 0) {
        for (let minute = 0; minute < 60; minute++) {
            const option = document.createElement('option');
            option.value = padCalendarNumber(minute);
            option.textContent = padCalendarNumber(minute);
            calendarMinute.appendChild(option);
        }
    }

    if (calendarPeriod && calendarPeriod.options.length === 0) {
        ['AM', 'PM'].forEach((period) => {
            const option = document.createElement('option');
            option.value = period;
            option.textContent = period;
            calendarPeriod.appendChild(option);
        });
    }
}

function getDefaultCalendarTimeParts() {
    const future = new Date();
    future.setMinutes(future.getMinutes() + 5);
    future.setMinutes(Math.ceil(future.getMinutes() / 5) * 5, 0, 0);

    const hour24 = future.getHours();
    let hour12 = hour24 % 12;
    if (hour12 === 0) hour12 = 12;

    return {
        hour: String(hour12),
        minute: padCalendarNumber(future.getMinutes()),
        period: hour24 >= 12 ? 'PM' : 'AM'
    };
}

function setCalendarTimeSelectValue(parts) {
    const calendarHour = document.getElementById('calendarHour');
    const calendarMinute = document.getElementById('calendarMinute');
    const calendarPeriod = document.getElementById('calendarPeriod');

    if (!calendarHour || !calendarMinute || !calendarPeriod || !parts) return;

    calendarHour.value = parts.hour;
    calendarMinute.value = parts.minute;
    calendarPeriod.value = parts.period;
}

function setCalendarTimeFromDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        setCalendarTimeSelectValue(getDefaultCalendarTimeParts());
        return;
    }

    const hour24 = date.getHours();
    let hour12 = hour24 % 12;
    if (hour12 === 0) hour12 = 12;

    setCalendarTimeSelectValue({
        hour: String(hour12),
        minute: padCalendarNumber(date.getMinutes()),
        period: hour24 >= 12 ? 'PM' : 'AM'
    });
}

function getCalendarTimeValue() {
    const calendarHour = document.getElementById('calendarHour');
    const calendarMinute = document.getElementById('calendarMinute');
    const calendarPeriod = document.getElementById('calendarPeriod');

    if (!calendarHour || !calendarMinute || !calendarPeriod) return '';

    const hour12 = parseInt(calendarHour.value, 10);
    const minute = parseInt(calendarMinute.value, 10);
    const period = String(calendarPeriod.value || 'AM').toUpperCase();

    if (Number.isNaN(hour12) || Number.isNaN(minute)) {
        return '';
    }

    let hour24 = hour12 % 12;
    if (period === 'PM') {
        hour24 += 12;
    }

    return `${padCalendarNumber(hour24)}:${padCalendarNumber(minute)}`;
}

function clearCalendarReminderEditState() {
    editingCalendarReminderId = null;

    const calendarSetReminderBtn = document.getElementById('calendarSetReminderBtn');
    if (calendarSetReminderBtn) {
        calendarSetReminderBtn.textContent = 'Set Reminder';
    }
}

function setCalendarReminderFormValues(reminder) {
    const calendarSelectedDate = document.getElementById('calendarSelectedDate');
    const calendarMessage = document.getElementById('calendarMessage');
    const calendarSetReminderBtn = document.getElementById('calendarSetReminderBtn');
    const calendarStatus = document.getElementById('calendarStatusMessage');

    if (!reminder) return;

    const reminderDate = new Date(reminder.targetMs);
    const pad = (value) => String(value).padStart(2, '0');
    const selectedDate = `${reminderDate.getFullYear()}-${pad(reminderDate.getMonth() + 1)}-${pad(reminderDate.getDate())}`;

    if (calendarSelectedDate) calendarSelectedDate.value = selectedDate;
    updateCalendarConfirmationLine(selectedDate);
    setCalendarTimeFromDate(reminderDate);
    if (calendarMessage) calendarMessage.value = reminder.message;
    if (calendarSetReminderBtn) calendarSetReminderBtn.textContent = 'Update Reminder';

    if (typeof window.__setCalendarReminderDate === 'function') {
        window.__setCalendarReminderDate(selectedDate, false);
    }

    editingCalendarReminderId = reminder.id;

    if (calendarStatus) {
        calendarStatus.textContent = 'Editing reminder. Change the date or time, then submit to update the countdown.';
        calendarStatus.className = 'status-message show info';
    }
}

function removeCalendarReminder(reminderId) {
    const index = calendarReminders.findIndex((item) => item.id === reminderId);
    if (index === -1) return false;

    calendarReminders.splice(index, 1);
    saveCalendarReminders();
    refreshCalendarCountdownView();

    if (editingCalendarReminderId === reminderId) {
        clearCalendarReminderEditState();
    }

    return true;
}

function clearAllCalendarReminders() {
    if (calendarReminders.length === 0) return false;

    calendarReminders = [];
    saveCalendarReminders();
    clearCalendarReminderEditState();
    refreshCalendarCountdownView();
    return true;
}

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

function showCalendarConfirmDialog(message, confirmLabel) {
    return new Promise((resolve) => {
        const dialog = document.getElementById('calendarConfirmDialog');
        const title = document.getElementById('calendarConfirmTitle');
        const messageEl = document.getElementById('calendarConfirmMessage');
        const cancelBtn = document.getElementById('calendarConfirmCancel');
        const okBtn = document.getElementById('calendarConfirmOk');

        if (!dialog || !title || !messageEl || !cancelBtn || !okBtn) {
            resolve(true);
            return;
        }

        const close = (result) => {
            dialog.classList.remove('is-open');
            dialog.setAttribute('aria-hidden', 'true');
            document.removeEventListener('keydown', onKeyDown);
            cancelBtn.onclick = null;
            okBtn.onclick = null;
            dialog.onclick = null;
            resolve(result);
        };

        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                close(false);
            }
        };

        title.textContent = 'Are you sure?';
        messageEl.textContent = message;
        okBtn.textContent = confirmLabel || 'Confirm';

        cancelBtn.onclick = () => close(false);
        okBtn.onclick = () => close(true);
        dialog.onclick = (event) => {
            if (event.target && event.target.getAttribute('data-close-confirm') === 'true') {
                close(false);
            }
        };

        document.addEventListener('keydown', onKeyDown);
        dialog.setAttribute('aria-hidden', 'false');
        dialog.classList.add('is-open');
        okBtn.focus();
    });
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
                <div class="calendar-popup-item-actions">
                    <button type="button" class="calendar-popup-action" data-action="reschedule" data-reminder-id="${escapeHtml(item.id)}">Reschedule</button>
                    <button type="button" class="calendar-popup-action secondary" data-action="delete" data-reminder-id="${escapeHtml(item.id)}">Delete</button>
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

    return sendMatrixCommandViaAdapter(reminderCommand);
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
    const calendarPopupClearBtn = document.getElementById('calendarPopupClearBtn');
    const calendarPopupCloseBtn = document.getElementById('calendarPopupCloseBtn');
    const calendarPopupList = document.getElementById('calendarPopupList');
    const widgetModeSwitch = document.getElementById('widgetModeSwitch');
    const widgetModeButtons = Array.from(document.querySelectorAll('.widget-mode-button'));
    const widgetModePanels = Array.from(document.querySelectorAll('[data-mode-panel]'));

    function setWidgetMode(mode) {
        const normalizedMode = mode === 'calendar' ? 'calendar' : 'timer';

        if (widgetModeSwitch) {
            widgetModeSwitch.setAttribute('data-active-mode', normalizedMode);
        }

        widgetModeButtons.forEach((button) => {
            const isActive = button.getAttribute('data-mode') === normalizedMode;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        widgetModePanels.forEach((panel) => {
            const panelMode = panel.getAttribute('data-mode-panel');
            panel.classList.toggle('is-hidden-by-mode', panelMode !== normalizedMode);
        });

        try {
            localStorage.setItem(WIDGET_MODE_STORAGE_KEY, normalizedMode);
        } catch (error) {
            console.warn('[Widget] Failed to persist widget mode:', error);
        }
    }

    widgetModeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            setWidgetMode(button.getAttribute('data-mode'));
        });
    });

    const initialMode = (() => {
        try {
            return localStorage.getItem(WIDGET_MODE_STORAGE_KEY) || 'timer';
        } catch (error) {
            return 'timer';
        }
    })();

    setWidgetMode(initialMode);

    populateCalendarTimeSelects();
    setCalendarTimeSelectValue(getDefaultCalendarTimeParts());

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
            const selectedCalendarDate = document.getElementById('calendarSelectedDate').value;
            const calendarTime = getCalendarTimeValue();
            const calendarMessage = document.getElementById('calendarMessage').value.trim();

            if (!selectedCalendarDate) {
                calendarStatus.textContent = 'Select date';
                calendarStatus.className = 'status-message show error';
                return;
            }

            if (!calendarTime || !calendarMessage) {
                calendarStatus.textContent = 'Set time and message';
                calendarStatus.className = 'status-message show error';
                return;
            }

            const targetDate = new Date(`${selectedCalendarDate}T${calendarTime}`);
            if (Number.isNaN(targetDate.getTime()) || targetDate.getTime() <= Date.now()) {
                calendarStatus.textContent = 'Pick a future time';
                calendarStatus.className = 'status-message show error';
                return;
            }

            const dateTime = `${selectedCalendarDate} ${calendarTime}`;
            const isEditingReminder = editingCalendarReminderId !== null;

            try {
                if (calendarSetReminderBtn) calendarSetReminderBtn.disabled = true;
                calendarStatus.textContent = isEditingReminder ? 'Updating...' : 'Sending...';
                calendarStatus.className = 'status-message show info';

                if (isEditingReminder) {
                    const reminderIndex = calendarReminders.findIndex((item) => item.id === editingCalendarReminderId);
                    if (reminderIndex === -1) {
                        throw new Error('Reminder no longer exists');
                    }

                    await sendReminderAtDateTime(dateTime, calendarMessage);

                    calendarReminders[reminderIndex] = {
                        id: editingCalendarReminderId,
                        targetMs: targetDate.getTime(),
                        message: calendarMessage
                    };
                } else {
                    await sendReminderAtDateTime(dateTime, calendarMessage);

                    calendarReminders.push({
                        id: `cal-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                        targetMs: targetDate.getTime(),
                        message: calendarMessage
                    });
                }

                calendarReminders.sort((a, b) => a.targetMs - b.targetMs);
                saveCalendarReminders();
                isCalendarPopupDismissed = false;
                refreshCalendarCountdownView();

                if (isEditingReminder) {
                    clearCalendarReminderEditState();
                }

                calendarStatus.textContent = isEditingReminder ? 'Reminder updated' : 'Reminder set';
                calendarStatus.className = 'status-message show success';

                calendarForm.reset();
                setSelectedCalendarDate(null);
                setCalendarTimeSelectValue(getDefaultCalendarTimeParts());
                clearCalendarReminderEditState();
            } catch (err) {
                calendarStatus.textContent = 'Error: ' + err.message;
                calendarStatus.className = 'status-message show error';
            } finally {
                if (calendarSetReminderBtn) calendarSetReminderBtn.disabled = false;
            }
        });
    }

    if (calendarPopupList) {
        calendarPopupList.addEventListener('click', async function(event) {
            const button = event.target.closest('button[data-action][data-reminder-id]');
            if (!button) return;

            const action = button.getAttribute('data-action');
            const reminderId = button.getAttribute('data-reminder-id');
            const reminder = calendarReminders.find((item) => item.id === reminderId);
            if (!reminder) return;

            if (action === 'delete') {
                const confirmed = await showCalendarConfirmDialog(
                    `Delete reminder "${reminder.message}"?`,
                    'Delete'
                );
                if (!confirmed) return;

                removeCalendarReminder(reminderId);
                if (calendarStatus) {
                    calendarStatus.textContent = 'Reminder deleted';
                    calendarStatus.className = 'status-message show success';
                }
                return;
            }

            if (action === 'reschedule') {
                setCalendarReminderFormValues(reminder);
            }
        });
    }

    if (calendarPopupClearBtn) {
        calendarPopupClearBtn.addEventListener('click', async function() {
            if (calendarReminders.length === 0) return;

            const confirmed = await showCalendarConfirmDialog(
                'Clear all upcoming reminders in this room?',
                'Clear All'
            );
            if (!confirmed) return;

            clearAllCalendarReminders();
            if (calendarStatus) {
                calendarStatus.textContent = 'All reminders cleared';
                calendarStatus.className = 'status-message show success';
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

    return sendMatrixCommandViaAdapter(command);
}

// Add this utility to log the exact command and room info being sent
function debugLogReminderCommand(command) {
    console.log('[DEBUG] Sending reminder command:', command);
    console.log('[DEBUG] roomId:', roomId, 'homeserverUrl:', homeserverUrl, 'userId:', userId);
    if (hasMatrixTokenEnvelopes()) {
        console.log('[DEBUG] Matrix token envelopes available:', {
            hasAccessToken: Boolean(matrixAccessTokenEnvelope),
            hasRefreshToken: Boolean(matrixRefreshTokenEnvelope)
        });
    }
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

    function syncSelectedDateLabel() {
        updateCalendarConfirmationLine(selectedDate);
    }

    function setSelectedCalendarDate(dateValue, shouldSyncInput = true) {
        selectedDate = dateValue || null;
        if (shouldSyncInput && calendarSelectedDate) {
            calendarSelectedDate.value = dateValue || '';
        }
        syncSelectedDateLabel();
        renderCalendar(currentMonth, currentYear);
    }

    window.__setCalendarReminderDate = setSelectedCalendarDate;

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
        const today = new Date();
        today.setHours(0, 0, 0, 0);

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
                    const currentDate = new Date(year, month, date);
                    currentDate.setHours(0, 0, 0, 0);
                    const isToday = currentDate.getTime() === today.getTime();
                    const isPast = currentDate.getTime() < today.getTime();
                    let classes = 'calendar-day-btn';
                    if (isToday) classes += ' is-today';
                    if (isPast) classes += ' is-past';
                    if (selectedDate === dateStr) classes += ' is-selected';
                    const ariaLabel = `${formatCalendarFriendlyDate(dateStr)}${isToday ? ', today' : ''}${isPast ? ', unavailable' : ''}`;
                    html += `<td class="calendar-day-cell">
                        <button type="button" class="${classes}" data-date="${dateStr}" aria-label="${ariaLabel}"${isPast ? ' disabled aria-disabled="true" tabindex="-1"' : ''}>
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
                setSelectedCalendarDate(btn.getAttribute('data-date'));
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
