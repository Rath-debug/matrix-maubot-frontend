function renderWidget(container) {
    container.innerHTML = `
        <h2 class="widget-title">Echo</h2>
        <p class="muted">Send a message and receive the bot response.</p>

        <div class="input-group">
            <input type="text" id="echo-msg" placeholder="Type a message" />
            <button class="btn" type="button" onclick="sendEcho()">Send</button>
        </div>

        <div id="echo-result" class="result-box" style="display:none;"></div>
    `;
}

async function sendEcho() {
    const msgEl = document.getElementById('echo-msg');
    const box = document.getElementById('echo-result');
    const message = msgEl.value.trim();

    if (!message) {
        box.style.display = 'block';
        box.innerHTML = '<p class="error">Message is required.</p>';
        return;
    }

    box.style.display = 'block';
    box.textContent = 'Sending...';

    const res = await BotAPI.echo.send(message);

    if (!res.success) {
        box.innerHTML = `<p class="error">${res.error}</p>`;
        return;
    }

    const echoed = res.data.reply || res.data.message || message;
    box.innerHTML = `<p class="success">${echoed}</p>`;
}

window.renderWidget = renderWidget;
window.sendEcho = sendEcho;
