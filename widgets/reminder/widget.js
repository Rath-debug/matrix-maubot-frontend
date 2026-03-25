function renderWidget(container) {
    container.innerHTML = `
        <h2 class="widget-title">Reminder</h2>

        <div class="input-group">
            <input type="text" id="msg" placeholder="Reminder message" />
        </div>

        <div class="input-group">
            <input type="datetime-local" id="time" />
            <button class="btn" type="button" onclick="setReminder()">Set</button>
        </div>

        <button class="btn btn-secondary" type="button" onclick="listReminders()">View All</button>

        <div id="result" class="result-box" style="display:none;"></div>
    `;
}

async function setReminder() {
    const msg = document.getElementById('msg').value;
    const time = document.getElementById('time').value;
    const box = document.getElementById('result');

    box.style.display = 'block';
    box.innerHTML = 'Setting...';

    const res = await BotAPI.reminder.set(msg, time);

    box.innerHTML = res.success
        ? '<p class="success">Reminder set!</p>'
        : `<p class="error">${res.error}</p>`;
}

async function listReminders() {
    const box = document.getElementById('result');

    box.style.display = 'block';
    box.innerHTML = 'Loading...';

    const res = await BotAPI.reminder.list();

    if (!res.success) {
        box.innerHTML = `<p class="error">${res.error}</p>`;
        return;
    }

    if (!res.data.reminders || res.data.reminders.length === 0) {
        box.innerHTML = 'No reminders';
        return;
    }

    box.innerHTML = res.data.reminders
        .map((r) => `<p>${r.message} - ${r.time}</p>`)
        .join('');
}

window.renderWidget = renderWidget;
window.setReminder = setReminder;
window.listReminders = listReminders;
