// routes/account_routes.js
const express = require('express');
const router = express.Router();
const SignupController = require('../controllers/account/signup_controller');

// ===== 회원가입 관련 라우트 =====
// 중복 확인 라우트
router.get('/check-duplicate', SignupController.checkDuplicate);

// 회원가입 라우트
router.post('/signup', SignupController.signup);

// 이메일 인증 관련 라우트들 (회원가입용)
router.post(
  '/verification/send-verification',
  SignupController.sendVerificationEmail
);
router.post('/verification/verify-code', SignupController.verifyCode);
router.get(
  '/verification/check-verification',
  SignupController.checkEmailVerification
);

module.exports = router;
