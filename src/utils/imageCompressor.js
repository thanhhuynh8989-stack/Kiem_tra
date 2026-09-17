import { APP_CONFIG } from '../constants/appConfig.js';
import { logger } from './logger.js';

/**
 * Client-side image optimization utility before transmitting to Gemini/Storage.
 */
export class ImageCompressor {
  /**
   * Compresses a Base64 image string or Blob to an optimized JPEG Base64 string.
   */
  static async compressBase64Image(
    base64Data,
    maxWidth = (APP_CONFIG && APP_CONFIG.MAX_IMAGE_WIDTH) || 1024,
    maxHeight = (APP_CONFIG && APP_CONFIG.MAX_IMAGE_HEIGHT) || 1024,
    quality = (APP_CONFIG && APP_CONFIG.IMAGE_JPEG_QUALITY) || 0.75
  ) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = base64Data;

      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Tính toán tỷ lệ co giãn
        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF'; // Nền trắng cho ảnh JPG
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        logger.debug(`Nén ảnh thành công: từ ${Math.round(base64Data.length / 1024)}KB xuống ${Math.round(compressedBase64.length / 1024)}KB`);
        resolve(compressedBase64);
      };

      img.onerror = (error) => {
        logger.error('Lỗi khi tải ảnh để nén:', error);
        reject(error);
      };
    });
  }
}
