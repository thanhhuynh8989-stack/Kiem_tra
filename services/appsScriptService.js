import { API_ENDPOINTS } from '../constants/apiEndpoints.js';
import { fetchWithRetry, AppError } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';

/

Service managing secure communication with Google Apps Script Backend Gateway.
*/
export class AppsScriptService {
constructor(webAppUrl = null) {
this.webAppUrl = webAppUrl || localStorage.getItem(API_ENDPOINTS.APPS_SCRIPT.STORAGE_KEY) || '';
}

setWebAppUrl(url) {
this.webAppUrl = url;
localStorage.setItem(API_ENDPOINTS.APPS_SCRIPT.STORAGE_KEY, url);
}

/

Sends a request to Google Apps Script Web App Endpoint.
*/
async request(action, payload = {}) {
if (!this.webAppUrl) {
throw new AppError('Chưa cấu hình URL Google Apps Script Web App.', 'MISSING_APPS_SCRIPT_URL');
}

const requestData = {
  action,
  payload,
  timestamp: new Date().toISOString()
};

return fetchWithRetry(async () => {
  logger.info(`Đang gửi request đến Apps Script (Action: ${action})...`);

  const response = await fetch(this.webAppUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify(requestData)
  });

  if (!response.ok) {
    throw new Error(`Apps Script HTTP Error: ${response.status}`);
  }

  const result = await response.json();
  if (result.status === 'error') {
    throw new AppError(result.message || 'Lỗi xử lý từ Apps Script Backend', 'BACKEND_ERROR', result);
  }

  return result.data;
});


}

/

Submits student exam answers to Apps Script for server-side grading.
*/
async submitExam(examId, studentInfo, answers) {
return this.request('submitExam', {
examId,
studentInfo,
answers
});
}

/

Fetches exam results by exam ID.
*/
async getExamResults(examId) {
return this.request('getExamResults', { examId });
}

/

Authenticates lecturer credentials via Apps Script.
*/
async authenticateLecturer(username, password) {
return this.request('authLecturer', { username, password });
}

/

Saves exam key to Apps Script securely (protecting answers from frontend inspection).
*/
async saveExamKey(examId, keyData) {
return this.request('saveExamKey', { examId, keyData });
}
}

export const appsScriptService = new AppsScriptService();
