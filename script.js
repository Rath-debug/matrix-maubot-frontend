const WIDGET_REGISTRY = {
    echo: 'widgets/echo/widget.js',
    reminder: 'widgets/reminder/widget.js'
};

let currentScript = null;

function bindSelectorEvents() {
    const targetEl = document.getElementById('backend-target');
    if (targetEl && window.BotAPI && window.BotAPI.info) {
        targetEl.textContent = `Backend API: ${window.BotAPI.info.baseUrl()}`;
    }

    const cards = document.querySelectorAll('[data-widget]');
    cards.forEach((card) => {
        card.addEventListener('click', () => {
            const widgetName = card.getAttribute('data-widget');
            if (widgetName) {
                loadWidget(widgetName);
            }
        });
    });

    const backButton = document.getElementById('back-btn');
    backButton.addEventListener('click', backToSelector);
}

function backToSelector() {
    const selector = document.getElementById('widget-selector');
    const container = document.getElementById('widget-container');
    const content = document.getElementById('widget-content');

    if (currentScript) {
        currentScript.remove();
        currentScript = null;
    }

    window.renderWidget = undefined;

    content.innerHTML = '';
    container.style.display = 'none';
    selector.style.display = 'grid';
}

function loadWidget(name) {
    const scriptPath = WIDGET_REGISTRY[name];

    if (!scriptPath) {
        alert('Widget not found!');
        return;
    }

    document.getElementById('widget-selector').style.display = 'none';
    document.getElementById('widget-container').style.display = 'block';

    const container = document.getElementById('widget-content');
    container.innerHTML = '<p>Loading...</p>';

    if (currentScript) {
        currentScript.remove();
    }

    window.renderWidget = undefined;

    const script = document.createElement('script');
    script.src = scriptPath;

    script.onload = () => {
        if (typeof window.renderWidget === 'function') {
            window.renderWidget(container);
        } else {
            container.innerHTML = '<p class="error">Error: renderWidget not found</p>';
        }
    };

    script.onerror = () => {
        container.innerHTML = '<p class="error">Error loading widget script</p>';
    };

    document.body.appendChild(script);
    currentScript = script;
}

window.addEventListener('DOMContentLoaded', bindSelectorEvents);
