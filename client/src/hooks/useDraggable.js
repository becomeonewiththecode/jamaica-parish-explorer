import { useState, useRef, useCallback } from 'react';

export function useDraggable() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const onMouseDown = useCallback((e) => {
    // Only drag from the header area, ignore buttons/links/inputs
    if (e.target.closest('button, a, input, textarea, select')) return;
    dragging.current = true;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };

    const onMouseMove = (e) => {
      if (!dragging.current) return;
      setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
    };

    const onMouseUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [pos]);

  const reset = useCallback(() => setPos({ x: 0, y: 0 }), []);

  return { pos, onMouseDown, reset };
}
