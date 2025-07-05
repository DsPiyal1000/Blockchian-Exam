// Validate oracle response
function validateOracleResponse(response) {
    if (!response || !response.data) {
        return false;
    }
    if (response.errors || response.exceptions) {
        return false;
    }
    if (typeof response.data !== 'object') {
        return false;
    }
    return true;
}

// Handle stale data on the frontend
function handleStaleData(data) {
    if (data.isStale) {
        // Display a loading indicator
        document.getElementById('loading-indicator').style.display = 'block';
        // Fetch fresh data
        fetchFreshData();
    } else {
        // Update the UI with fresh data
        updateUI(data);
    }
}