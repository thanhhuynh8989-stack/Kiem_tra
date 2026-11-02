import { escapeHtml, showAppLoading, hideAppLoading } from './authAndCore.js';
import { appsScriptService } from '../services/appsScriptService.js';

let rawLecturerList = [];

/**
 * 1. NẠP DANH SÁCH GIẢNG VIÊN TỪ SERVER
 */
export async function handleLoadLecturerManagement() {
  const container = document.getElementById('lecturerManagementContainer');
  if (!container) return;

  container.innerHTML = '<p style="color:#2563eb; font-size:13px; padding:12px;">🔄 Đang nạp danh sách Giảng viên...</p>';

  try {
    const res = await appsScriptService.request('GET_LECTURERS', {});
    rawLecturerList = res.lecturers || res.data || [];
    renderLecturerManagementUI(rawLecturerList);
  } catch (err) {
    container.innerHTML = `<p style="color:#ef4444; font-size:13px; padding:12px;">⚠️ Lỗi nạp danh sách Giảng viên: ${escapeHtml(err.message)}</p>`;
  }
}

/**
 * 2. RENDER GIAO DIỆN QUẢN LÝ GIẢNG VIÊN
 */
export function renderLecturerManagementUI(lecturers = []) {
  const container = document.getElementById('lecturerManagementContainer');
  if (!container) return;

  let html = `
    <div style="background:#fff; border-radius:10px; padding:16px; border:1px solid var(--border, #cbd5e1);">
      
      <!-- THANH CÔNG CỤ & NÚT THÊM GIẢNG VIÊN -->
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px; background:#f8fafc; padding:12px 16px; border-radius:8px; border:1px solid #e2e8f0;">
        <div style="display:flex; align-items:center; gap:10px;">
          <h3 style="margin:0; font-size:16px; color:#0f172a;">👨‍🏫 Quản Lý Giảng Viên (${lecturers.length})</h3>
          <input type="text" id="searchLecturerInput" oninput="window.handleSearchLecturer(this.value)" placeholder="🔍 Tìm tên, email, username..." style="padding:6px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; width:220px;">
        </div>

        <button type="button" onclick="window.openAddLecturerModal()" style="background:#2563eb; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:600; font-size:13px; cursor:pointer;">
          ➕ Thêm Giảng Viên Mới
        </button>
      </div>

      <!-- BẢNG DANH SÁCH GIẢNG VIÊN -->
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">
          <thead>
            <tr style="background:#f1f5f9; border-bottom:2px solid #cbd5e1; color:#475569;">
              <th style="padding:10px 12px;">Tên đăng nhập</th>
              <th style="padding:10px 12px;">Họ và Tên</th>
              <th style="padding:10px 12px;">Email</th>
              <th style="padding:10px 12px;">Khoa / Bộ môn</th>
              <th style="padding:10px 12px; text-align:center;">Vai trò</th>
              <th style="padding:10px 12px; text-align:center;">Thao tác</th>
            </tr>
          </thead>
          <tbody id="lecturerTableBody">
            ${renderLecturerRows(lecturers)}
          </tbody>
        </table>
      </div>

    </div>

    <!-- MODAL THÊM GIẢNG VIÊN MỚI -->
    <div id="addLecturerModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9999; justify-content:center; align-items:center; padding:16px;">
      <div style="background:#fff; border-radius:10px; max-width:450px; width:100%; padding:20px; box-shadow:0 10px 25px rgba(0,0,0,0.2);">
        <h3 style="margin-top:0; color:#0f172a; font-size:16px;">➕ Thêm Giảng Viên Mới</h3>
        
        <div style="display:flex; flex-direction:column; gap:12px; margin-top:14px;">
          <div>
            <label style="font-size:12px; font-weight:600; color:#475569;">Tên đăng nhập (Username) *</label>
            <input type="text" id="addLecturerUser" placeholder="gv_nguyenvana" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; margin-top:4px;">
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; color:#475569;">Họ và Tên *</label>
            <input type="text" id="addLecturerName" placeholder="TS. Nguyễn Văn A" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; margin-top:4px;">
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; color:#475569;">Email liên hệ *</label>
            <input type="email" id="addLecturerEmail" placeholder="nguyenvana@truong.edu.vn" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; margin-top:4px;">
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; color:#475569;">Mật khẩu ban đầu *</label>
            <input type="password" id="addLecturerPass" placeholder="••••••••" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; margin-top:4px;">
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; color:#475569;">Khoa / Bộ môn</label>
            <input type="text" id="addLecturerDept" placeholder="Khoa CNTT" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; margin-top:4px;">
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
          <button type="button" onclick="window.closeAddLecturerModal()" style="background:#64748b; color:#fff; border:none; padding:8px 14px; border-radius:6px; font-size:13px; cursor:pointer;">Hủy</button>
          <button type="button" onclick="window.handleCreateLecturerSubmit()" style="background:#2563eb; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:600; font-size:13px; cursor:pointer;">Lưu Giảng Viên</button>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

function renderLecturerRows(lecturers) {
  if (lecturers.length === 0) {
    return `<tr><td colspan="6" style="text-align:center; padding:20px; color:#64748b;">Chưa có tài khoản Giảng viên nào.</td></tr>`;
  }

  return lecturers.map(lec => {
    const username = escapeHtml(lec.username || lec.user || '');
    return `
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:10px 12px; font-weight:600; color:#0f172a;">${username}</td>
        <td style="padding:10px 12px; color:#334155;">${escapeHtml(lec.fullName || lec.name || username)}</td>
        <td style="padding:10px 12px; color:#64748b;">${escapeHtml(lec.email || '--')}</td>
        <td style="padding:10px 12px; color:#64748b;">${escapeHtml(lec.department || lec.className || '--')}</td>
        <td style="padding:10px 12px; text-align:center;">
          <span style="background:#dbeafe; color:#1e40af; font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px;">
            ${escapeHtml(lec.role || 'LECTURER')}
          </span>
        </td>
        <td style="padding:10px 12px; text-align:center;">
          <button type="button" onclick="window.handleResetLecturerPass('${username}')" style="background:#f59e0b; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:12px; cursor:pointer; margin-right:4px;">🔑 Đổi pass</button>
          <button type="button" onclick="window.handleDeleteLecturer('${username}')" style="background:#dc2626; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:12px; cursor:pointer;">🗑️ Xóa</button>
        </td>
      </tr>
    `;
  }).join('');
}

// =========================================================================
// 3. EVENT HANDLERS & MODAL CONTROL
// =========================================================================
window.handleSearchLecturer = function(keyword) {
  const kw = String(keyword || '').toLowerCase().trim();
  const filtered = rawLecturerList.filter(l => 
    String(l.username || '').toLowerCase().includes(kw) ||
    String(l.fullName || l.name || '').toLowerCase().includes(kw) ||
    String(l.email || '').toLowerCase().includes(kw)
  );
  const tbody = document.getElementById('lecturerTableBody');
  if (tbody) tbody.innerHTML = renderLecturerRows(filtered);
};

window.openAddLecturerModal = function() {
  const modal = document.getElementById('addLecturerModal');
  if (modal) modal.style.display = 'flex';
};

window.closeAddLecturerModal = function() {
  const modal = document.getElementById('addLecturerModal');
  if (modal) modal.style.display = 'none';
};

window.handleCreateLecturerSubmit = async function() {
  const username = document.getElementById('addLecturerUser')?.value.trim();
  const fullName = document.getElementById('addLecturerName')?.value.trim();
  const email = document.getElementById('addLecturerEmail')?.value.trim();
  const password = document.getElementById('addLecturerPass')?.value.trim();
  const department = document.getElementById('addLecturerDept')?.value.trim();

  if (!username || !fullName || !password) {
    alert('⚠️ Vui lòng nhập đầy đủ Username, Họ tên và Mật khẩu!');
    return;
  }

  showAppLoading('⏳ Đang tạo tài khoản Giảng viên...');
  try {
    const res = await appsScriptService.request('CREATE_LECTURER', {
      username, fullName, email, password, department, role: 'LECTURER'
    });
    hideAppLoading();

    if (res.status === 'error') {
      alert(`❌ ${res.message}`);
      return;
    }

    alert(res.message || '✅ Tạo tài khoản Giảng viên thành công!');
    window.closeAddLecturerModal();
    handleLoadLecturerManagement();
  } catch (err) {
    hideAppLoading();
    alert(`❌ Lỗi: ${err.message}`);
  }
};

window.handleResetLecturerPass = async function(username) {
  const newPass = prompt(`Nhập mật khẩu mới cho Giảng viên (${username}):`);
  if (!newPass || !newPass.trim()) return;

  showAppLoading('⏳ Đang cập nhật mật khẩu...');
  try {
    const res = await appsScriptService.request('RESET_USER_PASSWORD', {
      username: username,
      newPassword: newPass.trim()
    });
    hideAppLoading();
    alert(res.message || '✅ Đổi mật khẩu thành công!');
  } catch (err) {
    hideAppLoading();
    alert(`❌ Lỗi: ${err.message}`);
  }
};

window.handleDeleteLecturer = async function(username) {
  if (confirm(`⚠️ Bạn có chắc muốn XÓA tài khoản Giảng viên (${username}) không?`)) {
    showAppLoading('⏳ Đang xóa tài khoản...');
    try {
      const res = await appsScriptService.request('DELETE_LECTURER', { username });
      hideAppLoading();
      alert(res.message || '✅ Đã xóa tài khoản Giảng viên thành công!');
      handleLoadLecturerManagement();
    } catch (err) {
      hideAppLoading();
      alert(`❌ Lỗi xóa: ${err.message}`);
    }
  }
};
