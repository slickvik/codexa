chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Handle auto-open setting
chrome.storage.sync.get({ autoOpen: false }, (result) => {
    if (result.autoOpen) {
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete') {
                chrome.sidePanel.open({ windowId: tab.windowId });
            }
        });
    }
});

// Keep track of tabs where content script is injected
const injectedTabs = new Set();

// Inject content script only on matching URL
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        try {
            // Skip if already injected in this tab
            if (injectedTabs.has(tabId)) {
                // If already injected, just send a message to refresh the highlights
                chrome.tabs.sendMessage(tabId, { action: 'refreshHighlights' }).catch(() => {
                    // If message fails, the content script might have been removed
                    injectedTabs.delete(tabId);
                });
                return;
            }

            const { targetUrl } = await chrome.storage.sync.get({ targetUrl: '' });
            if (targetUrl && tab.url.startsWith(targetUrl)) {
                await chrome.scripting.insertCSS({
                    target: { tabId: tabId },
                    files: ['content.css']
                });
                
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['content.js'],
                    world: 'ISOLATED'
                });

                // Mark this tab as injected
                injectedTabs.add(tabId);
            }
        } catch (error) {
            console.error('Error injecting content script:', error);
        }
    }
});

// Remove content script when navigating away from target URL
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && tab.url) {
        try {
            const { targetUrl } = await chrome.storage.sync.get({ targetUrl: '' });
            if (targetUrl && !tab.url.startsWith(targetUrl)) {
                // Send cleanup message to content script
                chrome.tabs.sendMessage(tabId, { action: 'cleanup' }).catch(() => {
                    // Ignore errors if content script is not present
                });
                // Remove tab from injected set
                injectedTabs.delete(tabId);
            }
        } catch (error) {
            console.error('Error cleaning up content script:', error);
        }
    }
});

// Clean up injectedTabs when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    injectedTabs.delete(tabId);
});

let aiSession = null;
let ports = new Set();

// Handle connections from sidepanel
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'sidepanel') {
        ports.add(port);
        port.onDisconnect.addListener(() => {
            ports.delete(port);
        });
    }
});

// Handle messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'CREATE_SESSION') {
        handleCreateSession(request.systemPrompt)
            .then(session => {
                aiSession = session;
                sendResponse({ success: true });
            })
            .catch(error => sendResponse({ error: error.message }));
        return true;
    }
    else if (request.type === 'SEND_MESSAGE') {
        const responseId = Date.now().toString();
        handleStreamingMessage(request.message, request.systemPrompt, responseId)
            .catch(error => console.error('Streaming Error:', error));
        sendResponse({ started: true, responseId });
        return true;
    }
    else if (request.type === 'CHECK_SESSION') {
        sendResponse({ hasSession: !!aiSession });
        return true;
    }
    else if (request.action === 'captureField') {
        // Handle field capture in a promise
        chrome.storage.sync.get({ capturedFields: [] })
            .then(settings => {
                const updatedFields = [...settings.capturedFields, request.fieldInfo];
                return chrome.storage.sync.set({ capturedFields: updatedFields });
            })
            .then(() => {
                // Notify sidepanel of the update
                chrome.runtime.sendMessage({ action: 'fieldCaptured' });
            })
            .catch(error => {
                console.error('Error storing captured field:', error);
            });
        return true;  // Indicate we'll send response asynchronously
    }
    else if (request.action === 'ignoreField') {
        // Handle field ignore in a promise
        chrome.storage.sync.get({ ignoredFields: [] })
            .then(settings => {
                const updatedFields = [...settings.ignoredFields, request.fieldInfo];
                return chrome.storage.sync.set({ ignoredFields: updatedFields });
            })
            .then(() => {
                // Notify sidepanel of the update
                chrome.runtime.sendMessage({ action: 'fieldIgnored' });
            })
            .catch(error => {
                console.error('Error storing ignored field:', error);
            });
        return true;
    }
});

async function handleCreateSession(systemPrompt) {
    try {
        if (aiSession) {
            return aiSession;
        }
        const session = await chrome.aiOriginTrial.languageModel.create({
            systemPrompt: systemPrompt
        });
        return session;
    } catch (error) {
        console.error('Create Session Error:', error);
        throw error;
    }
}

async function handleStreamingMessage(message, systemPrompt, responseId) {
    try {
        if (!aiSession) {
            aiSession = await handleCreateSession(systemPrompt);
            if (!aiSession) {
                throw new Error('Failed to initialize AI session');
            }
        }
        
        const stream = await aiSession.promptStreaming(message);
        
        for await (const chunk of stream) {
            for (const port of ports) {
                port.postMessage({
                    type: 'STREAM_CHUNK',
                    chunk: chunk,
                    responseId: responseId
                });
            }
        }
        
        for (const port of ports) {
            port.postMessage({
                type: 'STREAM_END',
                responseId: responseId
            });
        }
        
    } catch (error) {
        console.error('Stream Error:', error);
        if (error.message.includes('session')) {
            aiSession = null;
        }
        for (const port of ports) {
            port.postMessage({
                type: 'STREAM_ERROR',
                error: error.message,
                responseId: responseId
            });
        }
    }
} 