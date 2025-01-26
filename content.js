(function() {
    // Create a single observer instance
    let formFieldObserver = null;
    let isCaptureModeActive = false;

    function createControlButtons(element) {
        const controls = document.createElement('div');
        controls.className = 'codexa-form-controls';

        const captureButton = document.createElement('button');
        captureButton.className = 'codexa-form-button codexa-capture-button';
        captureButton.textContent = 'Capture';
        
        // Add hover effects for capture button
        captureButton.addEventListener('mouseenter', () => {
            element.classList.add('capture-hover');
        });
        captureButton.addEventListener('mouseleave', () => {
            element.classList.remove('capture-hover');
        });
        
        captureButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            element.classList.remove('capture-hover');
            element.classList.add('captured');
            controls.remove();

            // Get field information
            const fieldInfo = getFieldName(element);

            // Send message to background script to store the captured field
            chrome.runtime.sendMessage({
                action: 'captureField',
                fieldInfo: fieldInfo
            });
        });

        const ignoreButton = document.createElement('button');
        ignoreButton.className = 'codexa-form-button codexa-ignore-button';
        ignoreButton.textContent = 'Ignore';
        
        // Add hover effects for ignore button
        ignoreButton.addEventListener('mouseenter', () => {
            element.classList.add('ignore-hover');
        });
        ignoreButton.addEventListener('mouseleave', () => {
            element.classList.remove('ignore-hover');
        });
        
        ignoreButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            element.classList.remove('codexa-form-highlight', 'captured', 'ignore-hover');
            element.classList.add('codexa-form-ignored');
            controls.remove();

            // Get field information
            const fieldInfo = getFieldName(element);

            // Send message to background script to store the ignored field
            chrome.runtime.sendMessage({
                action: 'ignoreField',
                fieldInfo: fieldInfo
            });
        });

        controls.appendChild(captureButton);
        controls.appendChild(ignoreButton);
        return controls;
    }

    // Helper function to generate a unique field identifier
    function generateFieldId(element) {
        const path = [];
        let current = element;
        
        while (current) {
            let selector = current.tagName.toLowerCase();
            if (current.id) {
                selector += `#${current.id}`;
            } else if (current.className) {
                selector += `.${current.className.split(' ').join('.')}`;
            }
            path.unshift(selector);
            current = current.parentElement;
        }
        
        return path.join(' > ');
    }

    // Load and highlight previously captured fields
    async function highlightCapturedFields() {
        try {
            const { capturedFields = [] } = await chrome.storage.sync.get({ capturedFields: [] });
            
            capturedFields.forEach(field => {
                // Try multiple ways to find the field
                let element = null;
                
                if (field.identifier) {
                    // Try by ID first
                    element = document.getElementById(field.identifier);
                    
                    // If not found, try by name
                    if (!element) {
                        element = document.querySelector(`[name="${field.identifier}"]`);
                    }
                    
                    // Try by label text
                    if (!element && field.label) {
                        // Look for label with exact text
                        const labels = Array.from(document.getElementsByTagName('label'));
                        const matchingLabel = labels.find(label => 
                            label.textContent.trim() === field.label
                        );
                        
                        if (matchingLabel) {
                            // Try to find the field through the label's 'for' attribute
                            if (matchingLabel.htmlFor) {
                                element = document.getElementById(matchingLabel.htmlFor);
                            }
                            // If no 'for' attribute, look for input within the label
                            if (!element) {
                                element = matchingLabel.querySelector('input, select, textarea');
                            }
                        }
                    }

                    // If still not found, try aria-label
                    if (!element && field.label) {
                        element = document.querySelector(`[aria-label="${field.label}"]`);
                    }
                }

                // If we found the element, highlight it
                if (element) {
                    element.classList.add('codexa-form-highlight', 'captured');
                }
            });
        } catch (error) {
            console.error('Error highlighting captured fields:', error);
        }
    }

    // Helper function to get a meaningful field name
    function getFieldName(element) {
        // First try to find an associated label
        let labelText = '';
        let fieldIdentifier = '';
        
        // Check for label element pointing to this field
        if (element.id) {
            const label = document.querySelector(`label[for="${element.id}"]`);
            if (label) {
                labelText = label.textContent.trim();
            }
            fieldIdentifier = element.id;
        }
        
        // Check for parent label element if no label found
        if (!labelText) {
            const parentLabel = element.closest('label');
            if (parentLabel) {
                // Get text content excluding the input field's content
                const clone = parentLabel.cloneNode(true);
                const input = clone.querySelector('input, select, textarea');
                if (input) input.remove();
                labelText = clone.textContent.trim();
            }
        }

        // Check for aria-label or aria-labelledby if still no label
        if (!labelText) {
            labelText = element.getAttribute('aria-label') || '';
            if (!labelText && element.getAttribute('aria-labelledby')) {
                const labelledBy = document.getElementById(element.getAttribute('aria-labelledby'));
                if (labelledBy) {
                    labelText = labelledBy.textContent.trim();
                }
            }
        }

        // If no identifier yet, try name attribute
        if (!fieldIdentifier) {
            fieldIdentifier = element.name || '';
        }

        // If still no identifier, generate one from the element's path
        if (!fieldIdentifier) {
            fieldIdentifier = generateFieldId(element);
        }

        return {
            label: labelText,
            identifier: fieldIdentifier,
            type: element.tagName.toLowerCase() + (element.type ? `-${element.type}` : '')
        };
    }

    function highlightFormFields() {
        // Find all input fields, textareas, contenteditable elements, and select dropdowns
        const formElements = document.querySelectorAll(`
            input[type="text"],
            input[type="number"],
            input[type="email"],
            input[type="tel"],
            input[type="search"],
            input[type="url"],
            textarea,
            select,
            [contenteditable="true"]
        `);

        // Add highlight class and controls to each element
        formElements.forEach(element => {
            // Skip if already processed or ignored
            if (element.classList.contains('codexa-form-highlight') || 
                element.classList.contains('codexa-form-ignored')) {
                return;
            }

            // Check if this is a previously captured field
            const fieldInfo = getFieldName(element);
            const shouldHighlight = !element.classList.contains('captured');

            element.classList.add('codexa-form-highlight');
            
            // Only add controls if not already captured
            if (shouldHighlight) {
                const controls = createControlButtons(element);
                
                // Position the controls relative to the element
                const rect = element.getBoundingClientRect();
                if (rect.top > 30) { // Only add controls if there's enough space above
                    element.parentElement.insertBefore(controls, element);
                }
            }
        });
    }

    function initializeObserver() {
        // Cleanup existing observer if it exists
        if (formFieldObserver) {
            formFieldObserver.disconnect();
        }

        // Create new observer
        formFieldObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length) {
                    highlightFormFields();
                }
            });
        });

        // Start observing
        formFieldObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Listen for messages from the extension
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'cleanup') {
            cleanup();
            isCaptureModeActive = false;
        } else if (request.action === 'refreshHighlights') {
            (async () => {
                await highlightCapturedFields();
                if (isCaptureModeActive) {
                    highlightFormFields();
                }
            })();
        } else if (request.action === 'startFieldCapture') {
            if (isCaptureModeActive) {
                // If already active, clean up and deactivate
                cleanup();
                isCaptureModeActive = false;
            } else {
                // If not active, start capture mode
                isCaptureModeActive = true;
                highlightFormFields();
                initializeObserver();
            }
        } else if (request.action === 'ping') {
            // Respond to ping to confirm content script is loaded
            sendResponse(true);
        }
        // Return true if we're going to send a response asynchronously
        return request.action === 'ping';
    });

    // Initial setup - only highlight previously captured fields
    (async () => {
        await highlightCapturedFields();
        await highlightIgnoredFields();
    })();

    // Cleanup function
    function cleanup() {
        const highlightedElements = document.querySelectorAll('.codexa-form-highlight:not(.captured)');
        highlightedElements.forEach(element => {
            element.classList.remove(
                'codexa-form-highlight',
                'capture-hover',
                'ignore-hover'
            );
        });

        const controls = document.querySelectorAll('.codexa-form-controls');
        controls.forEach(control => control.remove());

        if (formFieldObserver) {
            formFieldObserver.disconnect();
            formFieldObserver = null;
        }
    }

    // Add function to highlight ignored fields
    async function highlightIgnoredFields() {
        try {
            const { ignoredFields = [] } = await chrome.storage.sync.get({ ignoredFields: [] });
            
            ignoredFields.forEach(field => {
                // Try multiple ways to find the field (same as highlightCapturedFields)
                let element = null;
                
                if (field.identifier) {
                    element = document.getElementById(field.identifier);
                    if (!element) {
                        element = document.querySelector(`[name="${field.identifier}"]`);
                    }
                    // ... rest of field finding logic ...
                }

                // If we found the element, mark it as ignored
                if (element) {
                    element.classList.add('codexa-form-ignored');
                }
            });
        } catch (error) {
            console.error('Error highlighting ignored fields:', error);
        }
    }
})(); 