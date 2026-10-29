import { APP_CONFIG } from '../constants/appConfig.js';
import { appsScriptService } from './appsScriptService.js';
import { logger } from '../utils/logger.js';

/**
 * GITHUB SERVICE - QUẢN LÝ TẢI & CÔNG BỐ ĐỀ THI TRÊN GITHUB CDN
 */
export class GithubService {
  constructor() {
    this.owner = APP_CONFIG?.GITHUB?.OWNER || 'thanhhuynh8989-stack';
    this.repo = APP_CONFIG?.GITHUB?.REPO || 'Kiem_tra';
    this.branch = APP_CONFIG?.GITHUB?.BRANCH || 'main';
    this.rawBaseUrl = `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.branch}`;
  }

  /**
   * Tải nội dung file đề thi JSON từ GitHub CDN công khai
   * @param {string} filePath - Ví dụ: 'exams/exam_75ceb91a.json' hoặc 'exam_75ceb91a'
   * @returns {Promise<object>} Nội dung JSON đề thi
   */
  async fetchExamData(filePath) {
    if (!filePath) throw new Error('Thiếu đường dẫn tệp đề thi.');

    let cleanPath = String(filePath).trim().replace(/^exams\//i, '');
    if (cleanPath.includes('-')) cleanPath = cleanPath.split('-')[0];
    if (!cleanPath.endsWith('.json')) cleanPath = `${cleanPath}.json`;
    cleanPath = `exams/${cleanPath}`;

    const url = `${this.rawBaseUrl}/${cleanPath}?v=${Date.now()}`;
    logger.info(`Đang tải đề thi từ GitHub CDN: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Không tìm thấy file đề thi trên GitHub CDN (Mã lỗi: HTTP ${response.status}).`);
    }

    return await response.json();
  }

  /**
   * Công bố đề thi an toàn thông qua Google Apps Script Proxy
   * (Giúp giấu GitHub Token không bị lộ ở Client)
   * @param {string} examId 
   * @param {object} publicExamData 
   * @param {string} username 
   */
  async publishExamSecurely(examId, publicExamData, username = 'admin') {
    let cleanCode = String(examId).trim().toLowerCase().replace(/\.json$/i, '').replace(/^exams\//i, '');
    if (cleanCode.includes('-')) cleanCode = cleanCode.split('-')[0];
    
    const targetCode = `${cleanCode}.json`;
    const filePath = `exams/${targetCode}`;

    logger.info(`Đang gửi yêu cầu Backend công bố đề thi [${targetCode}] lên GitHub...`);

    const response = await appsScriptService.request('SAVE_AND_PUBLISH_EXAM', {
      examId: cleanCode,
      examCode: targetCode,
      publicExamData: publicExamData,
      filePath: filePath,
      username: username
    });

    return response;
  }
}

export const githubService = new GithubService();
window.githubService = githubService;
