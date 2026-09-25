import { useEffect, useRef, useState } from "react";


export function usePlayback(duration, initialTime = 0) {
    const start = Number.isFinite(initialTime) ? Math.min(duration, Math.max(0, initialTime)) : 0;
    const [elapsed, setElapsed] = useState(start);
    const [playing, setPlaying] = useState(false);
    const [rate, setRate] = useState(1);
    const position = useRef(start);


    useEffect(() => {
        if (!playing || duration <= 0)
            return;
        let previous = performance.now();
        let frame = 0;
        const tick = (now) => {
            position.current = Math.min(duration, position.current + (now - previous) / 1000 * rate);
            previous = now;
            setElapsed(position.current);
            if (position.current >= duration)
                setPlaying(false);
            else
                frame = requestAnimationFrame(tick);
        };


        frame = requestAnimationFrame(tick);
        const pauseWhenHidden = () => { if (document.hidden)
            setPlaying(false); };
        document.addEventListener("visibilitychange", pauseWhenHidden);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener("visibilitychange", pauseWhenHidden);
        };
    }, [playing, rate, duration]);


    function seek(seconds) {
        setPlaying(false);
        position.current = Math.max(0, Math.min(duration, seconds));
        setElapsed(position.current);
    }


    function toggle() {
        if (duration <= 0)
            return;
        if (!playing && position.current >= duration) {
            position.current = 0;
            setElapsed(0);
        }
        setPlaying((previous) => !previous);
    }
    
    return { elapsed, playing, rate, setRate, seek, toggle, restart: () => seek(0) };
}
