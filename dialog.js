document.addEventListener('DOMContentLoaded', () => {
    const closeDialog = document.getElementById('close-dialog');
    const fetchAgain = document.getElementById('fetch-again');
    const copyButton = document.querySelector('.copy-button');
    const hccCodesTextarea = document.getElementById('hcc-codes');
    
    closeDialog.addEventListener('click', () => {
        window.close();
    });
    
    fetchAgain.addEventListener('click', () => {
        // TODO: Add logic to refresh HCC data
    });

    copyButton.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(hccCodesTextarea.value);
            
            // Visual feedback
            copyButton.classList.add('copied');
            
            // Reset the feedback after animation
            setTimeout(() => {
                copyButton.classList.remove('copied');
            }, 1000);
        } catch (err) {
            console.error('Failed to copy text:', err);
        }
    });
}); 