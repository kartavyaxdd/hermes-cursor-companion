export function fractionToDisplayPoint(bounds: { x: number; y: number; width: number; height: number }, x: number, y: number): { x: number; y: number } {
  if (![x, y].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1) throw new Error('Invalid screen coordinates.');
  return {
    x: Math.round(bounds.x + x * (bounds.width - 1)),
    y: Math.round(bounds.y + y * (bounds.height - 1)),
  };
}
