/** Last observed fix at this time; irregular intervals keep their real timing. */
export function sampleAtTime(points, seconds) {
    let low = 0;
    let high = points.length - 1;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (points[middle].elapsed_s <= seconds)
            low = middle;
        else
            high = middle - 1;
    }
    return low;
}
export function segmentFraction(points, index, seconds) {
    const next = points[index + 1];
    if (!next || next.break_before)
        return 0;
    const interval = next.elapsed_s - points[index].elapsed_s;
    return interval > 0 ? Math.max(0, Math.min(1, (seconds - points[index].elapsed_s) / interval)) : 0;
}
