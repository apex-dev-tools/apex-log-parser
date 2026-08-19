/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { parse } from '../index.js';

function logWithUserInfo(userInfoLine: string): string {
  return (
    '61.0 APEX_CODE,FINE;APEX_PROFILING,FINE\n' +
    userInfoLine +
    '\n' +
    '09:18:22.6 (100)|EXECUTION_STARTED\n' +
    '09:19:13.82 (2000)|EXECUTION_FINISHED\n'
  );
}

describe('userInfo', () => {
  it('reads the id, user name, label, IANA name and offset', () => {
    const apexLog = parse(
      logWithUserInfo(
        '00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|005J000000E9ctM|test@example.com|(GMT-08:00) Pacific Standard Time (America/Los_Angeles)|GMT-08:00',
      ),
    );

    expect(apexLog.userInfo).toEqual({
      id: '005J000000E9ctM',
      userName: 'test@example.com',
      timezone: {
        label: 'Pacific Standard Time',
        name: 'America/Los_Angeles',
        offsetMinutes: -480,
      },
    });
  });

  it('reports no IANA name when the header states a bare label', () => {
    const apexLog = parse(
      logWithUserInfo(
        "00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|0053r00000AUqiB|user@example.com|Heure d'Europe centrale|GMT+01:00",
      ),
    );

    expect(apexLog.userInfo?.timezone).toEqual({
      label: "Heure d'Europe centrale",
      name: null,
      offsetMinutes: 60,
    });
  });

  it('treats GMTZ as zero offset', () => {
    const apexLog = parse(
      logWithUserInfo(
        '00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|005J000000E9ctM|test@example.com|(GMT+00:00) Greenwich Mean Time (Europe/London)|GMTZ',
      ),
    );

    expect(apexLog.userInfo?.timezone.offsetMinutes).toBe(0);
  });

  it('keeps the slashes in a multi-part IANA name', () => {
    const apexLog = parse(
      logWithUserInfo(
        '00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|005J000000E9ctM|test@example.com|(GMT-04:00) Eastern Daylight Time (America/Indiana/Indianapolis)|GMT-04:00',
      ),
    );

    expect(apexLog.userInfo?.timezone.name).toBe('America/Indiana/Indianapolis');
  });

  it('is null when the log has no USER_INFO line', () => {
    const apexLog = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n09:19:13.82 (2000)|EXECUTION_FINISHED\n',
    );

    expect(apexLog.userInfo).toBeNull();
  });

  it('reads a CRLF log', () => {
    const apexLog = parse(
      logWithUserInfo(
        '00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|005J000000E9ctM|test@example.com|(GMT-08:00) Pacific Standard Time (America/Los_Angeles)|GMT-08:00\r',
      ).replaceAll('\n', '\r\n'),
    );

    expect(apexLog.userInfo?.timezone).toEqual({
      label: 'Pacific Standard Time',
      name: 'America/Los_Angeles',
      offsetMinutes: -480,
    });
  });

  it('reads a GMT-prefixed label that states no IANA name', () => {
    const apexLog = parse(
      logWithUserInfo(
        '00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|005J000000E9ctM|test@example.com|(GMT+05:30) India Standard Time|GMT+05:30',
      ),
    );

    expect(apexLog.userInfo?.timezone).toEqual({
      label: 'India Standard Time',
      name: null,
      offsetMinutes: 330,
    });
  });

  it('reports no offset when the header states none it can read', () => {
    const apexLog = parse(
      logWithUserInfo(
        '00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|005J000000E9ctM|test@example.com|Pacific Standard Time',
      ),
    );

    expect(apexLog.userInfo?.timezone.offsetMinutes).toBeNull();
  });

  it('reads the offset from the label when the header states no offset column', () => {
    const apexLog = parse(
      logWithUserInfo(
        '00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|005J000000E9ctM|test@example.com|(GMT+05:30) India Standard Time',
      ),
    );

    expect(apexLog.userInfo?.timezone.offsetMinutes).toBe(330);
  });

  it('ignores a timestamped USER_INFO line a USER_DEBUG message quotes', () => {
    const apexLog = parse(
      '61.0 APEX_CODE,FINE;APEX_PROFILING,FINE\n' +
        '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|USER_DEBUG|[9]|DEBUG|a nested log follows\n' +
        '00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|005OTHERUSER|other@example.com|(GMT+01:00) Central European Time|GMT+01:00\n' +
        '09:19:13.82 (2000)|EXECUTION_FINISHED\n',
    );

    expect(apexLog.userInfo).toBeNull();
  });

  it('ignores a USER_DEBUG message that quotes the USER_INFO marker', () => {
    const apexLog = parse(
      '61.0 APEX_CODE,FINE;APEX_PROFILING,FINE\n' +
        '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|USER_DEBUG|[9]|DEBUG|USER_INFO|[EXTERNAL]|x|y|z\n' +
        '09:19:13.82 (2000)|EXECUTION_FINISHED\n',
    );

    expect(apexLog.userInfo).toBeNull();
  });
});
