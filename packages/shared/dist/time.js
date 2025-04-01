export const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
};
export const formatDuration = (seconds) => {
    if (!seconds)
        return 'N/A';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    if (seconds < 60) {
        return `${remainingSeconds}s`;
    }
    else if (seconds < 3600) {
        return `${minutes}m ${remainingSeconds}s`;
    }
    else {
        return `${hours}h ${minutes}m ${remainingSeconds}s`;
    }
};
export const formatDateTime = (dateString) => {
    if (!dateString)
        return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
};
