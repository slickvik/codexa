document.addEventListener('DOMContentLoaded', () => {
    const targetUrlInput = document.getElementById('target-url');
    const captureUrlButton = document.getElementById('capture-url');
    const capturedFieldsList = document.getElementById('captured-fields');
    const saveButton = document.getElementById('save-settings');
    const resetButton = document.getElementById('reset-defaults');
    const captureFieldsButton = document.getElementById('capture-fields');

    const DEFAULT_SETTINGS = {
        targetUrl: '',
        capturedFields: [],
        ignoredFields: []
    };

    let isCaptureModeActive = false;

    // Load settings when panel opens
    async function loadSettings() {
        try {
            const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);
            targetUrlInput.value = result.targetUrl || '';
            updateCapturedFieldsList(result.capturedFields || []);
            updateIgnoredFieldsList(result.ignoredFields || []);
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    // Add helper function to expand a section
    function expandSection(targetId) {
        const header = document.querySelector(`.section-header[data-target="${targetId}"]`);
        const content = document.getElementById(targetId);
        
        if (header.classList.contains('collapsed')) {
            header.classList.remove('collapsed');
            content.classList.remove('collapsed');
            const button = header.querySelector('.collapse-button');
            button.innerHTML = '&minus;';
        }
    }

    function updateCapturedFieldsList(fields) {
        capturedFieldsList.innerHTML = '';
        
        if (fields.length === 0) {
            capturedFieldsList.innerHTML = '<div class="no-fields">No fields captured yet</div>';
            return;
        }

        if (fields.length > 0) {
            expandSection('captured-fields-container');
        }

        fields.forEach((field, index) => {
            const fieldElement = document.createElement('div');
            fieldElement.className = 'captured-field-item';
            fieldElement.innerHTML = `
                <div class="field-info">
                    ${field.label ? 
                        `<span class="field-label">${field.label}</span><br>` : 
                        ''}
                    ${field.identifier ? 
                        `<span class="field-id">${field.identifier}</span>` : 
                        '<span class="field-id">(No identifier)</span>'}
                </div>
                <button class="delete-field-button" data-index="${index}">Delete</button>
            `;

            // Add delete handler
            const deleteButton = fieldElement.querySelector('.delete-field-button');
            deleteButton.addEventListener('click', () => deleteField(index));

            capturedFieldsList.appendChild(fieldElement);
        });
    }

    async function deleteField(index) {
        try {
            const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
            const updatedFields = settings.capturedFields.filter((_, i) => i !== index);
            await chrome.storage.sync.set({
                ...settings,
                capturedFields: updatedFields
            });
            updateCapturedFieldsList(updatedFields);
            showSaveConfirmation();
        } catch (error) {
            console.error('Failed to delete field:', error);
            showError('Failed to delete field');
        }
    }

    // Capture current tab URL
    async function captureCurrentUrl() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.url) {
                targetUrlInput.value = new URL(tab.url).origin;
                // Note: Not saving automatically on capture anymore
            }
        } catch (error) {
            console.error('Failed to capture URL:', error);
            showError('Failed to capture URL');
        }
    }

    // Save settings
    async function saveSettings() {
        try {
            if (!targetUrlInput.value) {
                showError('Please capture a URL first');
                return;
            }

            const currentSettings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
            await chrome.storage.sync.set({
                targetUrl: targetUrlInput.value,
                capturedFields: currentSettings.capturedFields || [],
                ignoredFields: currentSettings.ignoredFields || []
            });
            showSaveConfirmation();
        } catch (error) {
            console.error('Failed to save settings:', error);
            showError('Failed to save settings');
        }
    }

    // Reset to defaults
    async function resetSettings() {
        try {
            await chrome.storage.sync.set(DEFAULT_SETTINGS);
            targetUrlInput.value = DEFAULT_SETTINGS.targetUrl;
            updateCapturedFieldsList([]);
            updateIgnoredFieldsList([]);
            showSaveConfirmation();
        } catch (error) {
            console.error('Failed to reset settings:', error);
            showError('Failed to reset settings');
        }
    }

    function showSaveConfirmation() {
        const message = document.createElement('div');
        message.className = 'save-confirmation';
        message.textContent = 'Settings saved successfully!';
        document.body.appendChild(message);
        setTimeout(() => message.remove(), 2000);
    }

    function showError(errorMessage) {
        const message = document.createElement('div');
        message.className = 'error-message';
        message.textContent = errorMessage;
        document.body.appendChild(message);
        setTimeout(() => message.remove(), 3000);
    }

    // Event listeners
    captureUrlButton.addEventListener('click', captureCurrentUrl);
    saveButton.addEventListener('click', saveSettings);
    resetButton.addEventListener('click', resetSettings);
    captureFieldsButton.addEventListener('click', async () => {
        try {
            // Get the active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                // Ensure content script is loaded
                const isReady = await ensureContentScript(tab);
                if (isReady) {
                    // Toggle capture mode
                    isCaptureModeActive = !isCaptureModeActive;
                    
                    // Update button text
                    captureFieldsButton.textContent = isCaptureModeActive ? 'Stop Capturing' : 'Capture Fields';
                    captureFieldsButton.classList.toggle('active', isCaptureModeActive);
                    
                    // Send message to content script to toggle field capture
                    chrome.tabs.sendMessage(tab.id, { action: 'startFieldCapture' });
                }
            }
        } catch (error) {
            console.error('Failed to toggle field capture:', error);
            showError('Failed to toggle field capture');
        }
    });

    // Listen for captured field updates
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'fieldCaptured') {
            // Only update captured fields list
            chrome.storage.sync.get(DEFAULT_SETTINGS).then(result => {
                updateCapturedFieldsList(result.capturedFields || []);
                expandSection('captured-fields-container');
            });
        } else if (request.action === 'fieldIgnored') {
            // Only update ignored fields list
            chrome.storage.sync.get(DEFAULT_SETTINGS).then(result => {
                updateIgnoredFieldsList(result.ignoredFields || []);
                expandSection('ignored-fields-container');
            });
        }
    });

    // Initial load
    loadSettings();

    // Add this function to check and inject content script if needed
    async function ensureContentScript(tab) {
        try {
            // First check if we have a target URL
            const { targetUrl } = await chrome.storage.sync.get({ targetUrl: '' });
            if (!targetUrl) {
                showError('Please capture and save a target URL first');
                return false;
            }

            // Check if we're on the target URL
            if (!tab.url.startsWith(targetUrl)) {
                showError('Please navigate to the target URL first');
                return false;
            }

            // Try to send a test message to check if content script is loaded
            try {
                await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
                return true;
            } catch (error) {
                // Content script not loaded, inject it
                await chrome.scripting.insertCSS({
                    target: { tabId: tab.id },
                    files: ['content.css']
                });
                
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js'],
                    world: 'ISOLATED'
                });
                
                return true;
            }
        } catch (error) {
            console.error('Error ensuring content script:', error);
            showError('Failed to initialize field capture');
            return false;
        }
    }

    // Add function to update ignored fields list
    function updateIgnoredFieldsList(fields) {
        const ignoredFieldsList = document.getElementById('ignored-fields');
        ignoredFieldsList.innerHTML = '';
        
        if (fields.length === 0) {
            ignoredFieldsList.innerHTML = '<div class="no-fields">No fields ignored</div>';
            return;
        }

        if (fields.length > 0) {
            expandSection('ignored-fields-container');
        }

        fields.forEach((field, index) => {
            const fieldElement = document.createElement('div');
            fieldElement.className = 'ignored-field-item';
            fieldElement.innerHTML = `
                <div class="field-info">
                    ${field.label ? 
                        `<span class="field-label">${field.label}</span><br>` : 
                        ''}
                    ${field.identifier ? 
                        `<span class="field-id">${field.identifier}</span>` : 
                        '<span class="field-id">(No identifier)</span>'}
                </div>
                <button class="delete-field-button" data-index="${index}">Delete</button>
            `;

            const deleteButton = fieldElement.querySelector('.delete-field-button');
            deleteButton.addEventListener('click', () => deleteIgnoredField(index));

            ignoredFieldsList.appendChild(fieldElement);
        });
    }

    // Add function to delete ignored field
    async function deleteIgnoredField(index) {
        try {
            const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
            const updatedFields = settings.ignoredFields.filter((_, i) => i !== index);
            await chrome.storage.sync.set({
                ...settings,
                ignoredFields: updatedFields
            });
            updateIgnoredFieldsList(updatedFields);
            showSaveConfirmation();
        } catch (error) {
            console.error('Failed to delete ignored field:', error);
            showError('Failed to delete ignored field');
        }
    }

    // Add collapsible functionality
    function initializeCollapsible() {
        document.querySelectorAll('.section-header.collapsible').forEach(header => {
            header.addEventListener('click', (e) => {
                // Don't collapse if clicking the capture fields button
                if (e.target.closest('#capture-fields')) {
                    return;
                }

                const targetId = header.dataset.target;
                const content = document.getElementById(targetId);
                
                header.classList.toggle('collapsed');
                content.classList.toggle('collapsed');
                
                // Update collapse button text with proper symbols
                const button = header.querySelector('.collapse-button');
                button.innerHTML = header.classList.contains('collapsed') ? '&plus;' : '&minus;';
            });
        });
    }

    // Initialize collapsible sections
    initializeCollapsible();

    // HCC Dialog functionality
    const getHccButton = document.getElementById('get-hcc-codes');

    getHccButton.addEventListener('click', () => {
        // Get the screen dimensions
        const screenWidth = window.screen.availWidth;
        const screenHeight = window.screen.availHeight;
        
        // Calculate the position to center the window
        const width = 600;
        const height = 700;
        const left = Math.round((screenWidth - width) / 2);
        const top = Math.round((screenHeight - height) / 2);
        
        chrome.windows.create({
            url: 'dialog.html',
            type: 'popup',
            width: width,
            height: height,
            left: left,
            top: top
        });
    });
}); 