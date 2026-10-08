import { idOfType } from '../../src/next/catalog/catalog.js';
import { nodeEngine } from '../../src/next/node.js';
import { apexLog } from '../../src/next/views/log.js';
import { readColumns, readEvents } from '../scripts/views.js';

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

describe('readColumns', () => {
  it('reads every column of every event, and not the log', () => {
    const types = 2 * idOfType('METHOD_ENTRY') + idOfType('STATEMENT_EXECUTE');
    // parent 0+1+1, depth 1+2+2, subtreeEnd 4+3+4, timestamp 1000+1500+2000,
    // exitStamp 4000+2500 (the leaf has none), self 2500+0+500, total 3000+0+500.
    expect(readColumns(log)).toBe(types + 2 + 5 + 11 + 4500 + 6500 + 3000 + 3500);
  });
});

describe('readEvents', () => {
  it('reads every event', () => {
    expect(readEvents(log)).toBe(1 + 2 + 2);
  });
});
