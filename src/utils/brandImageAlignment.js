const MAX_SAMPLE_EDGE = 128;
const MAX_OFFSET_PERCENT = 12.5;

export function getBrandImageCenterOffset(image) {
    const { naturalWidth, naturalHeight } = image;
    if (!naturalWidth || !naturalHeight) return 0;

    const scale = Math.min(1, MAX_SAMPLE_EDGE / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return 0;

    try {
        context.drawImage(image, 0, 0, width, height);
        const { data } = context.getImageData(0, 0, width, height);
        let totalOpacity = 0;
        let weightedRows = 0;
        for (let y = 0; y < height; y++) {
            let rowOpacity = 0;
            for (let x = 0; x < width; x++) {
                rowOpacity += data[(y * width + x) * 4 + 3];
            }
            totalOpacity += rowOpacity;
            weightedRows += (y + 0.5) * rowOpacity;
        }
        if (!totalOpacity) return 0;

        // Align the visual weight of the artwork within the existing image box.
        const offset = (0.5 - weightedRows / totalOpacity / height) * 100;
        return Math.min(MAX_OFFSET_PERCENT, Math.max(-MAX_OFFSET_PERCENT, offset));
    } catch {
        // A decoded image may still be unreadable, for example after a redirect.
        return 0;
    }
}
