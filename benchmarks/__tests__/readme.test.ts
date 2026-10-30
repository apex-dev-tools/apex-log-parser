import { nodeEngine } from '../../src/engine/node.js';
import { apexLog } from '../../src/views/log.js';
import { ROWS } from '../scripts/readme.js';

const log = apexLog(
  nodeEngine.build(
    new TextEncoder().encode(
      [
        '64.0 APEX_CODE,FINE',
        '09:00:00.001 (1000)|METHOD_ENTRY|[1]|01p000000000AAA|MyClass.run()',
        '09:00:00.001 (1500)|STATEMENT_EXECUTE|[2]',
        '09:00:00.001 (2000)|METHOD_ENTRY|[3]|01p000000000AAA|MyClass.work()',
        '09:00:00.001 (2500)|METHOD_EXIT|[3]|01p000000000AAA|MyClass.work()',
        '09:00:00.001 (4000)|METHOD_EXIT|[1]|01p000000000AAA|MyClass.run()',
      ].join('\n'),
    ),
  ),
);

// Numbers only: depth 1+2+2, self 2500+0+500, no SOQL.
// Flame chart: depth 1+2+2, labels 'MyClass.run()' (13) and 'MyClass.work()' (14).
// Call tree: two methods.
const EXPECTED = [5 + 3000, 5 + 13 + 14, 2];

describe('ROWS', () => {
  it.each(ROWS.map(([name, events, columns], i) => ({ name, events, columns, i })))(
    '$name: reads the same through event objects and through columns',
    ({ events, columns, i }) => {
      expect(events(log)).toBe(EXPECTED[i]);
      expect(columns(log)).toBe(EXPECTED[i]);
    },
  );
});
