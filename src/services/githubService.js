import { utf8ToBase64 } from '../utils/encoding.js';
import { APP_CONFIG } from '../constants/appConfig.js';
import { logger } from '../utils/logger.js';

export const githubService = {
  /**
   * Tải file đề thi public từ GitHub CDN/Raw
   */
  async getExam(filename) {
    const url = `https://raw.githubusercontent.com/${APP_CONFIG.GITHUB.OWNER}/${APP_CONFIG.GITHUB.REPO}/${APP_CONFIG.GITHUB.BRANCH}/exams/${filename}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Không thể tải đề thi từ GitHub (${response.status})`);
    }
    return await response.json();
  },

  /**
   * Đẩy trực tiếp file đề thi lên GitHub (Dành cho Admin nếu cấu hình Client Token)
   */
  async uploadExamDirect(filename, examData, token) {
    const url = `https://api.github.com/repos/${APP_CONFIG.GITHUB.OWNER}/${APP_CONFIG.GITHUB.REPO}/contents/exams/${filename}`;
    const jsonString = JSON.stringify(examData, null, 2);
    const contentBase64 = utf8ToBase64(jsonString);

    let sha = null;
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        sha = data.sha;
      }
    } catch (e) {
      logger.warn('File chưa tồn tại trên Repo, sẽ tạo mới hoàn toàn');
    }

    const payload = {
      message: `Publish exam: ${filename}`,
      content: contentBase64
    };
    if (sha) payload.sha = sha;

    const uploadRes = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!uploadRes.ok) {
      throw new Error(`GitHub Upload Error: ${uploadRes.statusText}`);
    }
    return await uploadRes.json();
  }
};
