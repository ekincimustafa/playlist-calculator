// Shared by the website and the packaged extension.
async function fetchCalculationData(url, controller) {
    const { signal } = controller;
    signal.throwIfAborted();
    let rejectOnAbort;
    const cancelled = new Promise((resolve, reject) => {
        rejectOnAbort = () => reject(signal.reason);
        signal.addEventListener('abort', rejectOnAbort, { once: true });
    });
    const timeout = setTimeout(() => {
        controller.abort(new DOMException('The request timed out. Please try again.', 'TimeoutError'));
    }, 150000);

    try {
        const request = (async () => {
            let response;
            try {
                response = await fetch(url, { signal });
            } catch (error) {
                if (signal.aborted) throw signal.reason;
                throw new Error('Could not connect. Check your connection and try again.');
            }
            let data;
            try {
                data = await response.json();
            } catch (error) {
                throw new Error('The server returned an unreadable response. Please try again.');
            }
            if (!response.ok) {
                const message = typeof data?.detail === 'string' && data.detail
                    ? data.detail : 'The server could not complete the calculation. Please try again.';
                throw new Error(message);
            }
            if (!Array.isArray(data?.videos) || data.videos.some(video =>
                !video || typeof video.id !== 'string' || typeof video.title !== 'string' || typeof video.duration !== 'string'
            )) {
                throw new Error('The server returned incomplete video data. Please try again.');
            }
            return data;
        })();
        const data = await Promise.race([request, cancelled]);
        signal.throwIfAborted();
        return data;
    } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', rejectOnAbort);
    }
}
