export type LogLevel = 'error' | 'info' | 'warn';

type LogFields = Record<string, unknown>;

function writeLog(level: LogLevel, event: string, fields: LogFields = {}) {
  const payload = {
    event,
    level,
    timestamp: new Date().toISOString(),
    ...fields,
  };

  const serializedPayload = JSON.stringify(payload);

  if (level === 'error') {
    console.error(serializedPayload);
    return;
  }

  if (level === 'warn') {
    console.warn(serializedPayload);
    return;
  }

  console.log(serializedPayload);
}

export function logError(event: string, fields?: LogFields) {
  writeLog('error', event, fields);
}

export function logInfo(event: string, fields?: LogFields) {
  writeLog('info', event, fields);
}

export function logWarn(event: string, fields?: LogFields) {
  writeLog('warn', event, fields);
}
