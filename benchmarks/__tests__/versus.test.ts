import { fromRatio, parts, versus } from '../scripts/versus.js';

describe('versus', () => {
  it('states times smaller or larger, and the change', () => {
    expect(versus(1130, 254, 'time')).toBe('4.4× faster (-77.5%)');
    expect(versus(100, 120, 'time')).toBe('1.2× slower (+20.0%)');
    expect(versus(808, 39, 'memory')).toBe('20.7× less (-95.2%)');
    expect(fromRatio(2, 'memory')).toBe('2.0× more (+100.0%)');
  });

  it('gives a dash, or no parts, when a figure is not positive', () => {
    expect(versus(0, 10, 'time')).toBe('—');
    expect(fromRatio(Number.NaN, 'time')).toBe('—');
    expect(parts(0, 'time')).toBeNull();
  });
});
