import { appsScriptService } from '../services/appsScriptService.js';
import { renderExamCard } from './examManagement.js';
import { showAppLoading, hideAppLoading, escapeHtml } from './authAndCore.js';

/**
 * 1. TẢI VÀ RENDER DASHBOARD GIẢNG VIÊN
 */
export async function handleLoadLecturerDashboard() {
  const mainContentArea = document.getElementById('mainContentArea');
  if (!mainContentArea) return;

  showAppLoading('⏳ Đang tải danh sách đề thi...');

  try {
    const res = await appsScriptService.request('GET_EXAM_LIST', {});
    hideAppLoading();

    const exams = (res && res.exams) ? res.exams : [];
    renderLecturerDashboard(exams, mainContentArea);

  } catch (err) {
    hideAppLoading();
    mainContentArea.innerHTML = `<div style="padding:20px; color:#ef4444;">⚠️ Lỗi tải danh sách đề thi: ${escapeHtml(err.message)}</div>`;
  }
}

/**
 * 2. RENDER KHUNG DANH SÁCH ĐỀ THI (SỬ DỤNG CARD CHUẨN TỪ EXAMMANAGEMENT)
 */
export function renderLecturerDashboard(exams = [], container) {
  let html = `
    <div style="background:#fff; border-radius:10px; padding:20px; border:1px solid #e2e8f0; margin-top:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid #f1f5f9; padding-bottom:12px;">
        <h3 style="margin:0; font-size:18px; color:#0f172a;">📊 Danh Sách Đề Thi Đã Tạo (${exams.length})</h3>
        <button type="button" onclick="handleLoadLecturerDashboard()" style="background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:13px;">
          🔄 Tải lại
        </button>
      </div>

      <div style="display:flex; flex-wrap:wrap; gap:16px;">
        ${exams.length === 0 
          ? '<p style="color:#64748b; padding:10px;">Chưa có đề thi nào được tạo.</p>' 
          : exams.map(exam => renderExamCard(exam)).join('')
        }
      </div>
    </div>
    <div id="examScoresContainer" style="margin-top:20px;"></div>
  `;

  container.innerHTML = html;
}

window.handleLoadLecturerDashboard = handleLoadLecturerDashboard;
