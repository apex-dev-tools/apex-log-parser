import { bandOf, profile } from '../bench-profiles.js';

const log =
  '64.0 APEX_CODE,FINE\n' +
  '09:00:00.000 (100)|EXECUTION_STARTED\n' +
  '09:00:00.000 (200)|METHOD_ENTRY|[1]|01p000000000AAA|MyClass.run()\n' +
  '09:00:00.000 (300)|USER_DEBUG|[2]|DEBUG|first\n' +
  'wrapped text\n' +
  '09:00:00.000 (400)|NOT_A_REAL_EVENT|ns\n' +
  '09:00:00.000 (500)|METHOD_EXIT|[1]|01p000000000AAA|MyClass.run()\n' +
  '09:00:00.000 (600)|EXECUTION_FINISHED\n';

describe('bench-profiles', () => {
  it('puts a log in the band its size falls in', () => {
    expect([bandOf(0), bandOf(999_999), bandOf(1_000_000), bandOf(21_000_000)]).toEqual([
      'small',
      'small',
      'developer',
      'large',
    ]);
  });

  it('measures the events the parser builds, never an unregistered name or a text with none', () => {
    const { small } = profile([log, 'A text that is not a debug log.\n']);

    expect(small).toEqual({
      logs: 1,
      weights: {
        EXECUTION_STARTED: 200_000,
        METHOD_ENTRY: 200_000,
        USER_DEBUG: 200_000,
        METHOD_EXIT: 200_000,
        EXECUTION_FINISHED: 200_000,
      },
      wrappedLinesPerEvent: { USER_DEBUG: 1 },
      charsPerEvent: Math.round(log.length / 5),
      wrappedLinePercent: 16.7,
      meanDepth: 2,
    });
  });
});
