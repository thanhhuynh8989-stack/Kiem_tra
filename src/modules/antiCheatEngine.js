// =========================================================================
// FILE: src/modules/antiCheatEngine.js
// MODULE CHỐNG GIAN LẬN ĐỘC LẬP (PC FULLSCREEN + MOBILE VIEWPORT RESIZE)
// =========================================================================

import { escapeHtml } from './authAndCore.js';

export class AntiCheatEngine {
  constructor(options = {}) {
    this.maxViolations = options.maxViolations || 3;
    this.gracePeriodMs = options.gracePeriodMs || 3000;
    this.enableFullscreenPC = options.enableFullscreenPC !== false;

    // Callbacks giao tiếp với Exam Engine
    this.onWarning = options.onWarning || null;
    this.onViolation = options.onViolation || null;
    this.onMaxViolationsReached = options.onMaxViolationsReached || null;

    // Trạng thái nội bộ
    this.violationCount = 0;
    this.isActive = false;
    this.isDialogActive = false;
    this.isProcessing = false;
    this.initialViewportHeight = 0;

    // Timers & Event Handlers
    this.blurTimer = null;
    this.countdownInterval = null;
    this.focusCheckInterval = null;
    this.handlers = {};
  }

  isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  isZaloWebView() {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    return /Zalo/i.test(ua);
  }

  preventSelectEvents(e) {
    if (!this.isActive) return;
    const tag = e.target.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
      e.preventDefault();
      return false;
    }
  }

  /**
   * KÍCH HOẠT GIÁM SÁT
   */
  start(initialCount = 0) {
    if (this.isZaloWebView()) {
      this.renderZaloBlockerScreen();
      return;
    }

    this.stop(); // Clean-up trước khi bắt đầu phiên mới
    this.violationCount = Number(initialCount) || 0;
    window.violationCount = this.violationCount;
    this.isActive = true;
    this.isDialogActive = false;

    // 1. Khóa bôi đen, copy, cut, paste, chuột phải, kéo thả
    this.handlers.preventSelect = this.preventSelectEvents.bind(this);
    ['contextmenu', 'selectstart', 'copy', 'cut', 'paste', 'dragstart'].forEach(evt => {
      document.addEventListener(evt, this.handlers.preventSelect);
    });
    document.body.classList.add('exam-prevent-select');

    // 2. Chế độ Fullscreen (PC) hoặc Viewport Resize (Mobile)
    if (!this.isMobileDevice() && this.enableFullscreenPC) {
      this.requestPCFullscreen();
      this.handlers.fullscreen = () => {
        if (!this.isActive || this.isDialogActive) return;
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
          this.triggerViolation('Thoát chế độ Toàn màn hình (Fullscreen) trên PC!');
        }
      };
      document.addEventListener('fullscreenchange', this.handlers.fullscreen);
      document.addEventListener('webkitfullscreenchange', this.handlers.fullscreen);
    } else if (this.isMobileDevice()) {
      this.initialViewportHeight = window.innerHeight;
      this.handlers.resize = () => {
        if (!this.isActive || this.isDialogActive) return;
        // Bài thi 100% trắc nghiệm không có bàn phím ảo, nếu chiều cao giảm >25% -> Chia đôi màn hình
        if (window.innerHeight < this.initialViewportHeight * 0.75) {
          this.triggerViolation('Phát hiện chia đôi màn hình (Split-Screen) trên thiết bị di động!');
        }
      };
      window.addEventListener('resize', this.handlers.resize);
    }

    // 3. Giám sát Chuyển Tab / Thu nhỏ Trình duyệt
    this.handlers.visibility = () => {
      if (!this.isActive || this.isDialogActive) return;
      if (document.hidden) {
        this.clearTimers();
        this.hideGraceBanner();
        this.triggerViolation('Chuyển sang Tab khác hoặc thu nhỏ trình duyệt!');
      }
    };

    this.handlers.blur = () => {
      if (!this.isActive || this.isDialogActive || document.hidden) return;
      this.startGraceCountdown('Mất tiêu điểm cửa sổ làm bài quá 3 giây!');
    };

    this.handlers.focus = () => {
      this.clearTimers();
      this.hideGraceBanner();
    };

    this.handlers.pagehide = () => {
      if (!this.isActive || this.isDialogActive) return;
      this.clearTimers();
      this.hideGraceBanner();
      this.triggerViolation('Đóng ứng dụng hoặc điều hướng rời khỏi trang làm bài!');
    };

    document.addEventListener('visibilitychange', this.handlers.visibility);
    window.addEventListener('blur', this.handlers.blur);
    window.addEventListener('focus', this.handlers.focus);
    window.addEventListener('pagehide', this.handlers.pagehide);

    // 4. Polling check tiệm cận tiêu điểm
    this.focusCheckInterval = setInterval(() => {
      if (!this.isActive || this.isDialogActive || document.hidden) return;
      if (!document.hasFocus()) {
        this.startGraceCountdown('Thao tác ngoài vùng màn hình bài thi quá 3 giây!');
      } else if (this.blurTimer) {
        this.clearTimers();
        this.hideGraceBanner();
      }
    }, 1000);
  }

  startGraceCountdown(reason) {
    if (this.blurTimer || !this.isActive || this.isDialogActive || document.hidden) return;

    let secondsLeft = Math.ceil(this.gracePeriodMs / 1000);
    this.showGraceBanner(secondsLeft);

    this.countdownInterval = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft > 0) {
        this.showGraceBanner(secondsLeft);
      } else {
        clearInterval(this.countdownInterval);
      }
    }, 1000);

    this.blurTimer = setTimeout(() => {
      this.clearTimers();
      this.hideGraceBanner();
      if (this.isActive && !this.isDialogActive) {
        this.triggerViolation(reason);
      }
    }, this.gracePeriodMs);
  }

  triggerViolation(reason) {
    if (this.isProcessing) return;
    this.isProcessing = true;

    this.violationCount += 1;
    window.violationCount = this.violationCount;
    const count = this.violationCount;

    if (typeof this.onViolation === 'function') {
      this.onViolation(count, reason);
    }

    this.isDialogActive = true;
    window.isInternalDialogActive = true;

    this.showViolationModal(count, reason, () => {
      this.isDialogActive = false;
      window.isInternalDialogActive = false;
      this.isProcessing = false;

      if (count >= this.maxViolations) {
        this.stop();
        if (typeof this.onMaxViolationsReached === 'function') {
          this.onMaxViolationsReached(count, reason);
        }
      } else if (!this.isMobileDevice() && this.enableFullscreenPC) {
        this.requestPCFullscreen();
      }
    });
  }

  /**
   * TẮT GIÁM SÁT & DỌN DẸP SUYÊN SUỐT
   */
  stop() {
    this.isActive = false;
    this.isDialogActive = false;
    window.isInternalDialogActive = false;
    this.isProcessing = false;

    this.clearTimers();
    this.hideGraceBanner();

    if (this.handlers.preventSelect) {
      ['contextmenu', 'selectstart', 'copy', 'cut', 'paste', 'dragstart'].forEach(evt => {
        document.removeEventListener(evt, this.handlers.preventSelect);
      });
    }
    document.body.classList.remove('exam-prevent-select');

    if (this.focusCheckInterval) clearInterval(this.focusCheckInterval);
    if (this.handlers.resize) window.removeEventListener('resize', this.handlers.resize);
    if (this.handlers.fullscreen) {
      document.removeEventListener('fullscreenchange', this.handlers.fullscreen);
      document.removeEventListener('webkitfullscreenchange', this.handlers.fullscreen);
    }
    if (this.handlers.visibility) document.removeEventListener('visibilitychange', this.handlers.visibility);
    if (this.handlers.blur) window.removeEventListener('blur', this.handlers.blur);
    if (this.handlers.focus) window.removeEventListener('focus', this.handlers.focus);
    if (this.handlers.pagehide) window.removeEventListener('pagehide', this.handlers.pagehide);

    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }

  clearTimers() {
    if (this.blurTimer) clearTimeout(this.blurTimer);
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    this.blurTimer = null;
    this.countdownInterval = null;
  }

  requestPCFullscreen() {
    if (this.isMobileDevice()) return;
    const docEl = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (docEl.requestFullscreen) {
        docEl.requestFullscreen().catch(() => {});
      } else if (docEl.webkitRequestFullscreen) {
        docEl.webkitRequestFullscreen();
      }
    }
  }

  showGraceBanner(sec) {
    let banner = document.getElementById('gracePeriodWarningBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'gracePeriodWarningBanner';
      banner.style.cssText = `
        position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
        z-index: 999999; background: #fef08a; border: 2px solid #eab308; color: #854d0e;
        padding: 10px 18px; border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        font-size: 13px; font-weight: 600; text-align: center; max-width: 90%; width: 480px; box-sizing: border-box;
      `;
      document.body.appendChild(banner);
    }
    banner.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:center; gap:10px;">
        <span style="font-size:18px;">⚠️</span>
        <div style="text-align:left;">
          <div style="color:#a16207; font-weight:700;">MẤT TIÊU ĐIỂM MÀN HÌNH BÀI THI!</div>
          <div style="font-size:12px; font-weight:500;">Bấm/chạm lại vào bài thi để giữ trạng thái hợp lệ.</div>
        </div>
        <div style="background:#eab308; color:#fff; font-size:15px; font-weight:800; padding:4px 10px; border-radius:50px; min-width:32px; text-align:center; margin-left:auto;">${sec}s</div>
      </div>
    `;
    banner.style.display = 'block';
  }

  hideGraceBanner() {
    const banner = document.getElementById('gracePeriodWarningBanner');
    if (banner) banner.style.display = 'none';
  }

  showViolationModal(count, reason, onConfirm) {
    let modal = document.getElementById('violationModalOverlay');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'violationModalOverlay';
      modal.style.cssText = `
        position: fixed; inset: 0; width: 100%; height: 100%;
        background: rgba(15, 23, 42, 0.88); display: flex; justify-content: center;
        align-items: center; z-index: 999999; font-family: system-ui, -apple-system, sans-serif;
        backdrop-filter: blur(4px); padding: 16px; box-sizing: border-box;
      `;
      document.body.appendChild(modal);
    }

    const isFinal = count >= this.maxViolations;
    modal.innerHTML = `
      <div style="background: #fff; border-radius: 12px; max-width: 420px; width: 100%; padding: 24px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3); border-top: 6px solid ${isFinal ? '#dc2626' : '#f59e0b'};">
        <div style="font-size: 48px; margin-bottom: 12px;">${isFinal ? '❌' : '⚠️'}</div>
        <h3 style="margin: 0 0 8px 0; color: ${isFinal ? '#dc2626' : '#d97706'}; font-size: 18px; font-weight: 700;">
          ${isFinal ? 'VI PHẠM QUY CHẾ BÀI THI!' : `CẢNH BÁO VI PHẠM (Lần ${count}/${this.maxViolations})`}
        </h3>
        <p style="margin: 0 0 12px 0; color: #475569; font-size: 14px; line-height: 1.5;">
          ${isFinal 
            ? 'Bạn đã rời màn hình làm bài quá 3 lần. Hệ thống <strong>tự động nộp bài thi</strong> ngay bây giờ!' 
            : 'Hệ thống ghi nhận thao tác rời khỏi màn hình bài thi.<br><strong style="color:#dc2626;">Lưu ý: Vi phạm quá 3 lần bài thi sẽ tự động nộp!</strong>'}
        </p>
        ${reason ? `<div style="font-size: 12px; color: #64748b; background: #f1f5f9; padding: 6px 10px; border-radius: 6px; margin-bottom: 16px;">Chi tiết: ${escapeHtml(reason)}</div>` : ''}
        <button id="violationModalBtn" type="button" style="background: ${isFinal ? '#dc2626' : '#2563eb'}; color: #fff; border: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer; width: 100%; -webkit-tap-highlight-color: transparent;">
          ${isFinal ? 'Tự Động Nộp Bài' : 'Tôi Đã Hiểu & Tiếp Tục Làm Bài'}
        </button>
      </div>
    `;
    modal.style.display = 'flex';

    document.getElementById('violationModalBtn').onclick = () => {
      modal.style.display = 'none';
      if (typeof onConfirm === 'function') onConfirm();
    };
  }

  renderZaloBlockerScreen() {
    const mainContent = document.getElementById('mainContentArea');
    if (!mainContent) return;
    mainContent.innerHTML = `
      <div style="max-width:480px; margin:40px auto; padding:24px; background:#fff; border-radius:12px; border:2px solid #ef4444; text-align:center; box-shadow:0 10px 25px rgba(0,0,0,0.1);">
        <div style="font-size:48px; margin-bottom:12px;">⚠️</div>
        <h3 style="color:#991b1b; margin-bottom:12px; font-size:18px;">Yêu Cầu Mở Bằng Trình Duyệt</h3>
        <p style="font-size:14px; color:#334155; line-height:1.6; margin-bottom:16px;">
          Để đảm bảo tính minh bạch và tính năng chống gian lận hoạt động chính xác, bài thi <strong>không thể làm trực tiếp bên trong ứng dụng Zalo</strong>.
        </p>
        <div style="background:#f8fafc; padding:14px; border-radius:8px; border:1px dashed #cbd5e1; text-align:left; font-size:13px; color:#475569; margin-bottom:20px;">
          <strong>📌 Hướng dẫn mở bằng trình duyệt:</strong>
          <ol style="margin-left:18px; margin-top:8px; line-height:1.6;">
            <li>Bấm vào biểu tượng <strong>3 dấu chấm (⋮)</strong> hoặc <strong>(•••)</strong> ở góc trên bên phải màn hình.</li>
            <li>Chọn <strong>"Mở bằng trình duyệt"</strong> (Chrome trên Android hoặc Safari trên iPhone).</li>
          </ol>
        </div>
        <button type="button" onclick="location.reload()" style="background:#2563eb; color:#fff; border:none; padding:10px 20px; border-radius:6px; font-weight:600; cursor:pointer; font-size:14px;">
          🔄 Thử Tải Lại Trang
        </button>
      </div>
    `;
  }
}