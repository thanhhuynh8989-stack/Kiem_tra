import { appsScriptService } from '../services/appsScriptService.js';
import { loadExamForEditing } from './aiExamParser.js';
import { showAppLoading, hideAppLoading, getLoggedInUsername, escapeHtml } from './authAndCore.js';

let cachedStudentsList = null; // Cache lưu danh sách sinh viên

/**
 * 1. TẢI DANH SÁCH ĐỀ THI TỪ APPS SCRIPT / GOOGLE SHEET
 */
export async function loadExamList() {
  const container = document.getElementById('examListContainer') || document.getElementById('mainContentArea');
  if (!container) return;

  container.innerHTML = `<div style="padding:20px; text-align:center; color:#64748b;">⏳ Đang tải danh sách đề thi...</div>`;

  try {
    const res = await appsScriptService.request('GET_EXAM_LIST', {});
    
    if (!res || !res.exams || res.exams.length === 0) {
      container.innerHTML = `
        <div style="background:#fff; border-radius:8px; padding:30px; text-align:center; border:1px solid #e2e8f0; margin-top:16px;">
          <p style="color:#64748b; margin-bottom:12px;">📭 Chưa có đề thi nào được tạo.</p>
          <button onclick="document.querySelector('[data-tab=\\'tab-parser\\']')?.click()" style="background:#2563eb; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:600; cursor:pointer;">
            ➕ Bóc Tách / Tạo Đề Thi Mới
          </button>
        </div>
      `;
      return;
    }

    renderExamList(res.exams, container);

  } catch (err) {
    container.innerHTML = `<div style="padding:20px; color:#ef4444;">⚠️ Lỗi tải danh sách đề thi: ${escapeHtml(err.message)}</div>`;
  }
}

/**
 * 2. RENDER DANH SÁCH THẺ ĐỀ THI
 */
export function renderExamList(exams = [], container) {
  let html = `
    <div style="background:#fff; border-radius:10px; padding:20px; border:1px solid #e2e8f0; margin-top:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid #f1f5f9; padding-bottom:12px;">
        <h3 style="margin:0; font-size:18px; color:#0f172a;">📊 Danh Sách Đề Thi Đã Tạo (${exams.length})</h3>
        <button type="button" onclick="loadExamList()" style="background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:13px;">
          🔄 Tải lại
        </button>
      </div>

      <div style="display:flex; flex-wrap:wrap; gap:16px;">
        ${exams.map(exam => renderExamCard(exam)).join('')}
      </div>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * 3. RENDER TỪNG THẺ ĐỀ THI (CÓ ĐẦY ĐỦ CÁC NÚT THAO TÁC)
 */
export function renderExamCard(exam) {
  const examId = escapeHtml(exam.examId || '');
  const title = escapeHtml(exam.title || 'Chưa có tiêu đề');

  return `
    <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:16px; width:290px; box-shadow:0 1px 3px rgba(0,0,0,0.05); display:flex; flex-direction:column; justify-content:space-between;">
      <div>
        <h4 style="margin:0 0 8px 0; color:#0f172a; font-size:15px; font-weight:700;">${title}</h4>
        <p style="margin:0 0 12px 0; font-size:12px; color:#64748b; line-height:1.5;">
          Mã đề: <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-weight:600; color:#2563eb;">${examId}</code><br>
          ⏱️ ${exam.durationMinutes || 45} phút | 👤 ${escapeHtml(exam.createdBy || 'Giảng viên')}
        </p>
      </div>

      <div style="display:flex; gap:4px; margin-top:8px; flex-wrap:wrap;">
        <button type="button" onclick="handleOpenAssignExamModal('${examId}', '${title}')" style="background:#8b5cf6; color:#fff; border:none; padding:6px 8px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">
          📌 Giao đề
        </button>

        <button type="button" onclick="viewExamScores('${examId}')" style="background:#2563eb; color:#fff; border:none; padding:6px 8px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">
          📊 Điểm
        </button>

        <button type="button" onclick="handleEditExam('${examId}')" style="background:#f59e0b; color:#fff; border:none; padding:6px 8px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">
          ✏️ Sửa
        </button>

        <button type="button" onclick="deleteExam('${examId}')" style="background:#ef4444; color:#fff; border:none; padding:6px 8px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">
          🗑️ Xóa
        </button>
      </div>
    </div>
  `;
}

/**
 * 4. MỞ MODAL GIAO ĐỀ THI
 */
export async function handleOpenAssignExamModal(examId, examTitle) {
  showAppLoading('⏳ Đang lấy danh sách sinh viên...');

  try {
    if (!cachedStudentsList) {
      const res = await appsScriptService.request('GET_STUDENTS', {});
      cachedStudentsList = (res && res.students) ? res.students : [];
    }
    hideAppLoading();

    const uniqueClasses = [...new Set(cachedStudentsList.map(s => s.className || s.class || 'Mặc định').filter(Boolean))];

    renderAssignModalHTML(examId, examTitle, uniqueClasses, cachedStudentsList);

  } catch (err) {
    hideAppLoading();
    alert(`Không thể lấy danh sách sinh viên: ${err.message}`);
  }
}

/**
 * 5. RENDER CHÍNH XÁC HTML POPUP MODAL GIAO ĐỀ
 */
function renderAssignModalHTML(examId, examTitle, classesList = [], studentsList = []) {
  const oldModal = document.getElementById('assignExamModal');
  if (oldModal) oldModal.remove();

  const modalHtml = `
    <div id="assignExamModal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.6); display:flex; align-items:center; justify-content:center; z-index:9999; backdrop-filter:blur(2px);">
      <div style="background:#fff; border-radius:12px; width:90%; max-width:500px; padding:24px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.1); border:1px solid #e2e8f0;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding-bottom:12px; margin-bottom:16px;">
          <h3 style="margin:0; font-size:18px; color:#0f172a;">📌 Giao Đề Thi Cho Sinh Viên</h3>
          <button type="button" onclick="document.getElementById('assignExamModal').remove()" style="background:none; border:none; font-size:20px; cursor:pointer; color:#64748b;">✕</button>
        </div>

        <p style="margin:0 0 16px 0; font-size:13px; color:#475569;">
          Đề thi: <strong style="color:#2563eb;">${escapeHtml(examTitle)}</strong> (Mã: <code>${escapeHtml(examId)}</code>)
        </p>

        <div style="margin-bottom:14px;">
          <label style="display:block; font-size:13px; font-weight:600; color:#334155; margin-bottom:6px;">Hình thức giao đề:</label>
          <select id="assignTargetType" onchange="toggleAssignTargetDropdown()" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; outline:none;">
            <option value="CLASS">🏫 Giao theo Lớp học</option>
            <option value="STUDENT">👤 Giao cho Sinh viên cụ thể</option>
          </select>
        </div>

        <!-- DROPDOWN LỚP HỌC -->
        <div id="assignClassGroup" style="margin-bottom:14px;">
          <label style="display:block; font-size:13px; font-weight:600; color:#334155; margin-bottom:6px;">Chọn Lớp học:</label>
          <select id="assignClassSelect" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; outline:none;">
            <option value="ALL">ALL - Tất cả sinh viên toàn trường</option>
            ${classesList.map(c => `<option value="${escapeHtml(c)}">Lớp: ${escapeHtml(c)}</option>`).join('')}
          </select>
        </div>

        <!-- DROPDOWN SINH VIÊN -->
        <div id="assignStudentGroup" style="margin-bottom:14px; display:none;">
          <label style="display:block; font-size:13px; font-weight:600; color:#334155; margin-bottom:6px;">Chọn Sinh viên:</label>
          <select id="assignStudentSelect" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; outline:none;">
            ${studentsList.map(s => `
              <option value="${escapeHtml(s.studentId || s.username)}">
                [${escapeHtml(s.studentId || s.username)}] ${escapeHtml(s.fullName || s.name)} - Lớp: ${escapeHtml(s.className || s.class || 'N/A')}
              </option>
            `).join('')}
          </select>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:20px;">
          <div>
            <label style="display:block; font-size:12px; font-weight:600; color:#334155; margin-bottom:4px;">Thời gian mở đề:</label>
            <input type="datetime-local" id="assignStartTime" style="width:100%; padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;">
          </div>
          <div>
            <label style="display:block; font-size:12px; font-weight:600; color:#334155; margin-bottom:4px;">Hạn chót nộp bài:</label>
            <input type="datetime-local" id="assignEndTime" style="width:100%; padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;">
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" onclick="document.getElementById('assignExamModal').remove()" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; padding:8px 16px; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer;">Hủy</button>
          <button type="button" onclick="submitAssignExam('${escapeHtml(examId)}')" style="background:#8b5cf6; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer;">🚀 Xác Nhận Giao Đề</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

/**
 * 6. TOGGLE ẨN/HIỆN CÁC DROPDOWN PHÂN CÔNG
 */
export function toggleAssignTargetDropdown() {
  const type = document.getElementById('assignTargetType').value;
  document.getElementById('assignClassGroup').style.display = type === 'CLASS' ? 'block' : 'none';
  document.getElementById('assignStudentGroup').style.display = type === 'STUDENT' ? 'block' : 'none';
}

/**
 * 7. XỬ LÝ GỬI THÔNG TIN GIAO ĐỀ LÊN SERVER
 */
export async function submitAssignExam(examId) {
  const targetType = document.getElementById('assignTargetType').value;
  const targetValue = targetType === 'CLASS' 
    ? document.getElementById('assignClassSelect').value 
    : document.getElementById('assignStudentSelect').value;

  const startTime = document.getElementById('assignStartTime').value;
  const endTime = document.getElementById('assignEndTime').value;

  showAppLoading(`⏳ Đang lưu giao đề thi [${examId}]...`);

  try {
    const res = await appsScriptService.request('ASSIGN_EXAM', {
      examId: examId,
      targetType: targetType,
      targetValue: targetValue,
      startTime: startTime,
      endTime: endTime,
      createdBy: getLoggedInUsername()
    });

    hideAppLoading();

    if (res && (res.status === 'success' || res.success)) {
      alert(`🎉 Đã giao đề thi [${examId}] cho ${targetType === 'CLASS' ? 'Lớp ' + targetValue : 'SV ' + targetValue} thành công!`);
      const modal = document.getElementById('assignExamModal');
      if (modal) modal.remove();
    } else {
      alert(`⚠️ Lỗi giao đề: ${res?.message || 'Không thể lưu phân công đề thi'}`);
    }

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi giao đề: ${err.message}`);
  }
}

/**
 * 8. XỬ LÝ KHI BẤM NÚT "✏️ SỬA" ĐỀ THI
 */
export async function handleEditExam(examId) {
  if (!examId) return;

  if (typeof window.switchTab === 'function') {
    window.switchTab('tab-parser');
  } else {
    window.currentActiveTab = 'tab-parser';
  }

  showAppLoading(`⏳ Đang tải nội dung đề thi [${examId}]...`);

  try {
    let examData = null;
    let cleanCode = String(examId).trim();
    if (!cleanCode.endsWith('.json')) cleanCode = `${cleanCode}.json`;

    const cdnUrl = `https://cdn.jsdelivr.net/gh/thanhhuynh8989-stack/Kiem_tra@main/exams/${cleanCode}?t=${Date.now()}`;
    const rawUrl = `https://raw.githubusercontent.com/thanhhuynh8989-stack/Kiem_tra/main/exams/${cleanCode}?t=${Date.now()}`;

    try {
      let res = await fetch(cdnUrl);
      if (!res.ok) res = await fetch(rawUrl);
      if (res.ok) examData = await res.json();
    } catch (e) {}

    if (!examData) {
      const res = await appsScriptService.request('GET_EXAM_DETAIL', { examId });
      if (res && res.examData) examData = res.examData;
    }

    hideAppLoading();

    if (window.currentActiveTab !== 'tab-parser') return;

    if (!examData) {
      alert('Không thể nạp chi tiết câu hỏi của đề thi này!');
      return;
    }

    const formattedExam = {
      examId: examData.examId || examId,
      title: examData.title || `Đề thi ${examId}`,
      durationMinutes: examData.durationMinutes || 45,
      questions: examData.questions || (Array.isArray(examData) ? examData : [])
    };

    loadExamForEditing(formattedExam);

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi khi tải đề thi: ${err.message}`);
  }
}

/**
 * 9. XỬ LÝ XÓA ĐỀ THI
 */
export async function deleteExam(examId) {
  if (!confirm(`Bạn có chắc chắn muốn xóa đề thi [${examId}] không? Thao tác này không thể hoàn tác!`)) {
    return;
  }

  showAppLoading(`⏳ Đang xóa đề thi [${examId}]...`);

  try {
    const res = await appsScriptService.request('DELETE_EXAM', { examId });
    hideAppLoading();

    if (res && res.status === 'success') {
      alert('🗑️ Xóa đề thi thành công!');
      loadExamList();
    } else {
      alert(`Không thể xóa đề thi: ${res?.message || 'Lỗi không xác định'}`);
    }

  } catch (err) {
    hideAppLoading();
    alert(`Lỗi khi xóa đề thi: ${err.message}`);
  }
}

// Bắt buộc gán vào scope global window
window.loadExamList = loadExamList;
window.handleEditExam = handleEditExam;
window.deleteExam = deleteExam;
window.handleOpenAssignExamModal = handleOpenAssignExamModal;
window.toggleAssignTargetDropdown = toggleAssignTargetDropdown;
window.submitAssignExam = submitAssignExam;
