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
        text: '(GMT-08:00) Pacific Standard Time (America/Los_Angeles)',
        label: 'Pacific Standard Time',
        name: 'America/Los_Angeles',
        offsetMinutes: -480,
        offsetText: 'GMT-08:00',
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
      text: "Heure d'Europe centrale",
      label: "Heure d'Europe centrale",
      name: null,
      offsetMinutes: 60,
      offsetText: 'GMT+01:00',
    });
  });

  it('treats GMTZ as zero offset', () => {
    const apexLog = parse(
      logWithUserInfo(
        '00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|005J000000E9ctM|test@example.com|(GMT+00:00) Greenwich Mean Time (Europe/London)|GMTZ',
      ),
    );

    expect(apexLog.userInfo?.timezone).toMatchObject({ offsetMinutes: 0, offsetText: 'GMTZ' });
  });

  it('keeps the slashes in a multi-part IANA name', () => {
    const apexLog = parse(
      logWithUserInfo(
        '00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|005J000000E9ctM|test@example.com|(GMT-04:00) Eastern Daylight Time (America/Indiana/Indianapolis)|GMT-04:00',
      ),
    );

    expect(apexLog.userInfo?.timezone?.name).toBe('America/Indiana/Indianapolis');
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
      text: '(GMT-08:00) Pacific Standard Time (America/Los_Angeles)',
      label: 'Pacific Standard Time',
      name: 'America/Los_Angeles',
      offsetMinutes: -480,
      offsetText: 'GMT-08:00',
    });
  });

  it('reads a GMT-prefixed label that states no IANA name', () => {
    const apexLog = parse(
      logWithUserInfo(
        '00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|005J000000E9ctM|test@example.com|(GMT+05:30) India Standard Time|GMT+05:30',
      ),
    );

    expect(apexLog.userInfo?.timezone).toEqual({
      text: '(GMT+05:30) India Standard Time',
      label: 'India Standard Time',
      name: null,
      offsetMinutes: 330,
      offsetText: 'GMT+05:30',
    });
  });

  it('reports no offset when the header states none it can read', () => {
    const apexLog = parse(
      logWithUserInfo(
        '00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|005J000000E9ctM|test@example.com|Pacific Standard Time',
      ),
    );

    expect(apexLog.userInfo?.timezone).toMatchObject({ offsetMinutes: null, offsetText: null });
  });

  it('reads the offset from the label when the header states no offset column', () => {
    const apexLog = parse(
      logWithUserInfo(
        '00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|005J000000E9ctM|test@example.com|(GMT+05:30) India Standard Time',
      ),
    );

    expect(apexLog.userInfo?.timezone).toMatchObject({
      offsetMinutes: 330,
      offsetText: 'GMT+05:30',
    });
  });

  it('reports null for fields the header does not state', () => {
    const apexLog = parse(
      logWithUserInfo('00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|005000000000AAA'),
    );

    expect(apexLog.userInfo).toEqual({ id: '005000000000AAA', userName: null, timezone: null });
  });

  it('reports null for empty fields', () => {
    const apexLog = parse(
      logWithUserInfo('00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|005000000000AAA||'),
    );

    expect(apexLog.userInfo).toEqual({ id: '005000000000AAA', userName: null, timezone: null });
  });

  it('reports a null label when the timezone field states only an offset', () => {
    const apexLog = parse(
      logWithUserInfo(
        '00:53:58.0 (525718)|USER_INFO|[EXTERNAL]|005000000000AAA|user@example.com|(GMT+01:00)|GMT+01:00',
      ),
    );

    expect(apexLog.userInfo?.timezone).toMatchObject({ text: '(GMT+01:00)', label: null });
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

  it('reads the header after an anonymous echo that quotes EXECUTION_STARTED', () => {
    const apexLog = parse(
      '64.0 APEX_CODE,FINE;APEX_PROFILING,FINE\n' +
        "Execute Anonymous: String s = '|EXECUTION_STARTED';\n" +
        '09:18:22.6 (50)|USER_INFO|[EXTERNAL]|005000000000AAA|user@example.com|Pacific Standard Time|GMT-08:00\n' +
        '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:19:13.82 (2000)|EXECUTION_FINISHED\n',
    );

    expect(apexLog.userInfo?.userName).toBe('user@example.com');
  });

  it('ignores a payload USER_INFO line in a log with no EXECUTION_STARTED', () => {
    const apexLog = parse(
      '64.0 APEX_CODE,FINE;APEX_PROFILING,FINE\n' +
        '09:18:22.6 (1)|CODE_UNIT_STARTED|[EXTERNAL]|MyTrigger on Account trigger event BeforeInsert\n' +
        '09:18:22.6 (2)|USER_DEBUG|[7]|DEBUG|pasted log follows:\n' +
        '09:18:22.6 (2)|USER_INFO|[EXTERNAL]|005000000000AAA|other@example.com|Pacific Standard Time|GMT-08:00\n' +
        '09:18:22.6 (3)|CODE_UNIT_FINISHED|MyTrigger on Account trigger event BeforeInsert\n',
    );

    expect(apexLog.userInfo).toBeNull();
  });

  it('reads the first header when every execution states one', () => {
    const apexLog = parse(
      logWithUserInfo(
        '09:18:22.6 (50)|USER_INFO|[EXTERNAL]|005000000000AAA|user@example.com|Pacific Standard Time|GMT-08:00',
      ) +
        '09:19:13.90 (3000)|USER_INFO|[EXTERNAL]|005000000000AAB|later@example.com|Pacific Standard Time|GMT-08:00\n' +
        '09:19:13.90 (3100)|EXECUTION_STARTED\n' +
        '09:19:13.95 (4000)|EXECUTION_FINISHED\n',
    );

    expect(apexLog.userInfo?.userName).toBe('user@example.com');
  });
});
