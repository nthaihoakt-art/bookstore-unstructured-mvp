'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// src/otp-service.js
// Quản lý mã OTP đăng nhập khách hàng bằng Redis STRING
// Key: otp:{email}  TTL: 300s (5 phút)
// ─────────────────────────────────────────────────────────────────────────────
const { getClient, isRedisActive } = require('./redis-client');

const OTP_TTL = 300;        // 5 phút (giây)
const OTP_COOLDOWN = 60;    // 1 phút chờ trước khi gửi lại
const KEY_PREFIX = 'otp:';
const COOLDOWN_PREFIX = 'otp_cd:';

function otpKey(email) {
  return `${KEY_PREFIX}${email.toLowerCase()}`;
}
function cooldownKey(email) {
  return `${COOLDOWN_PREFIX}${email.toLowerCase()}`;
}

/**
 * Tạo mã OTP 6 chữ số ngẫu nhiên
 */
function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Lưu OTP vào Redis và trả về mã (để gửi email/sms)
 * @returns {{ otp: string, expiresIn: number, alreadySent: boolean }}
 */
async function createOTP(email) {
  if (!isRedisActive()) throw new Error('Redis không khả dụng, không thể tạo OTP');

  const client = getClient();

  // Kiểm tra cooldown
  const cooldown = await client.ttl(cooldownKey(email));
  if (cooldown > 0) {
    return { alreadySent: true, retryAfter: cooldown };
  }

  const otp = generateOTP();
  const pipeline = client.pipeline();
  pipeline.set(otpKey(email), otp, 'EX', OTP_TTL);
  pipeline.set(cooldownKey(email), '1', 'EX', OTP_COOLDOWN);
  await pipeline.exec();

  // Trong thực tế: gửi email/sms ở đây
  // Hiện tại log ra console (demo)
  console.log(`[OTP] 📧 Gửi OTP đến ${email}: ${otp} (hết hạn sau ${OTP_TTL}s)`);

  return { alreadySent: false, expiresIn: OTP_TTL, cooldown: OTP_COOLDOWN };
}

/**
 * Xác minh mã OTP do khách hàng nhập
 * @returns {{ valid: boolean, reason?: string }}
 */
async function verifyOTP(email, inputOtp) {
  if (!isRedisActive()) throw new Error('Redis không khả dụng');

  const client = getClient();
  const stored = await client.get(otpKey(email));

  if (!stored) {
    return { valid: false, reason: 'OTP đã hết hạn hoặc chưa được gửi' };
  }
  if (stored !== String(inputOtp).trim()) {
    return { valid: false, reason: 'Mã OTP không đúng' };
  }

  // OTP hợp lệ → xóa để tránh dùng lại
  await client.del(otpKey(email));
  return { valid: true };
}

/**
 * Kiểm tra TTL còn lại của OTP
 */
async function getOTPStatus(email) {
  if (!isRedisActive()) return { exists: false };
  const client = getClient();
  const ttl = await client.ttl(otpKey(email));
  return { exists: ttl > 0, ttl: ttl > 0 ? ttl : 0 };
}

module.exports = { createOTP, verifyOTP, getOTPStatus };
