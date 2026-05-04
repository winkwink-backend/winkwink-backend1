import dotenv from 'dotenv';
dotenv.config();

export const otpStore = new Map();

export function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
