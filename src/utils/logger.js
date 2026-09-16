import { APP_CONFIG, LOG_LEVELS } from '../constants/appConfig.js';

/

System-wide Logger Utility

Manages runtime logging, memory caching, and log export.
*/
class Logger {
constructor() {
this.logs = [];
this.currentLevel = LOG_LEVELS.DEBUG;
}

setLevel(level) {
if (LOG_LEVELS[level] !== undefined) {
this.currentLevel = LOG_LEVELS[level];
}
}

_log(levelName, levelValue, message, data = null) {
if (levelValue < this.currentLevel) return;

const timestamp = new Date().toISOString();
const entry = { timestamp, level: levelName, message, data };

this.logs.push(entry);
if (this.logs.length > APP_CONFIG.LOG_MAX_ENTRIES) {
  this.logs.shift(); // Giữ bộ nhớ không vượt quá giới hạn
}

const formattedMsg = `[${timestamp}] [${levelName}] ${message}`;

switch (levelName) {
  case 'DEBUG':
    console.debug(formattedMsg, data || '');
    break;
  case 'INFO':
    console.info(formattedMsg, data || '');
    break;
  case 'WARN':
    console.warn(formattedMsg, data || '');
    break;
  case 'ERROR':
    console.error(formattedMsg, data || '');
    break;
}


}

debug(message, data) {
this._log('DEBUG', LOG_LEVELS.DEBUG, message, data);
}

info(message, data) {
this._log('INFO', LOG_LEVELS.INFO, message, data);
}

warn(message, data) {
this._log('WARN', LOG_LEVELS.WARN, message, data);
}

error(message, data) {
this._log('ERROR', LOG_LEVELS.ERROR, message, data);
}

getLogs() {
return [...this.logs];
}

clear() {
this.logs = [];
}

exportLogsAsJSON() {
const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.logs, null, 2));
const downloadAnchor = document.createElement('a');
downloadAnchor.setAttribute("href", dataStr);
downloadAnchor.setAttribute("download", system_log_${new Date().toISOString().slice(0, 10)}.json);
document.body.appendChild(downloadAnchor);
downloadAnchor.click();
downloadAnchor.remove();
}
}

export const logger = new Logger();
