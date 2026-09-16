import { API_ENDPOINTS } from '../constants/apiEndpoints.js';
import { fetchWithRetry, AppError } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';

/

Service managing read/write/delete operations with GitHub REST API repository.
*/
export class GitHubService {
constructor(owner = null, repo = null, token = null) {
this.owner = owner || localStorage.getItem('github_owner') || '';
this.repo = repo || localStorage.getItem('github_repo') || '';
this.token = token || localStorage.getItem('github_token') || '';
}

setCredentials(owner, repo, token) {
this.owner = owner;
this.repo = repo;
this.token = token;
localStorage.setItem('github_owner', owner);
localStorage.setItem('github_repo', repo);
localStorage.setItem('github_token', token);
}

_getHeaders() {
if (!this.token) {
throw new AppError('GitHub Access Token chưa được cấu hình.', 'MISSING_GITHUB_TOKEN');
}
return {
'Authorization': Bearer ${this.token},
'Accept': 'application/vnd.github.v3+json',
'Content-Type': 'application/json'
};
}

/

Fetches content of a file or directory from repository.
*/
async getFileContent(filePath) {
if (!this.owner || !this.repo) {
throw new AppError('Chưa cấu hình thông tin Repository (owner/repo).', 'MISSING_REPO_INFO');
}

const url = `${API_ENDPOINTS.GITHUB.BASE_URL}/repos/${this.owner}/${this.repo}/contents/${filePath}`;

return fetchWithRetry(async () => {
  logger.info(`Đang tải file từ GitHub: ${filePath}`);
  const response = await fetch(url, { headers: this._getHeaders() });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Lỗi GitHub API: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (Array.isArray(data)) {
    return data;
  }

  const contentUtf8 = decodeURIComponent(
    escape(atob(data.content.replace(/\n/g, '')))
  );
  return {
    sha: data.sha,
    content: JSON.parse(contentUtf8)
  };
});


}

/

Creates or updates a JSON file in the repository.
*/
async saveJsonFile(filePath, jsonObject, commitMessage = 'Update exam file') {
const url = ${API_ENDPOINTS.GITHUB.BASE_URL}/repos/${this.owner}/${this.repo}/contents/${filePath};

const existingFile = await this.getFileContent(filePath);
const sha = existingFile ? existingFile.sha : undefined;

const jsonString = JSON.stringify(jsonObject, null, 2);
const encodedContent = btoa(unescape(encodeURIComponent(jsonString)));

const body = {
  message: commitMessage,
  content: encodedContent,
  sha: sha
};

return fetchWithRetry(async () => {
  logger.info(`Đang lưu file lên GitHub: ${filePath}`);
  const response = await fetch(url, {
    method: 'PUT',
    headers: this._getHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`Lỗi khi lưu file GitHub: ${errData.message || response.statusText}`);
  }

  return await response.json();
});


}

/

Deletes a file from the repository.
*/
async deleteFile(filePath, commitMessage = 'Delete file') {
const existingFile = await this.getFileContent(filePath);
if (!existingFile) {
logger.warn(Không tìm thấy file để xóa: ${filePath});
return false;
}

const url = `${API_ENDPOINTS.GITHUB.BASE_URL}/repos/${this.owner}/${this.repo}/contents/${filePath}`;
const body = {
  message: commitMessage,
  sha: existingFile.sha
};

return fetchWithRetry(async () => {
  logger.info(`Đang xóa file trên GitHub: ${filePath}`);
  const response = await fetch(url, {
    method: 'DELETE',
    headers: this._getHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Lỗi khi xóa file GitHub: ${response.statusText}`);
  }

  return true;
});


}
}

export const githubService = new GitHubService();
