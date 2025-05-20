// account/logout.js
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../db.js");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";

// 토큰 검증 미들웨어
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "인증 토큰이 필요합니다.",
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: "유효하지 않은 토큰입니다.",
      });
    }

    req.user = user;
    next();
  });
};

// 로그아웃 API 엔드포인트
router.post("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    console.log("로그아웃 요청 받음:", userId);

    // 위치 공유 비활성화 - 로그아웃 시 모든 공유 관계 종료 (추가된 부분)
    const deactivateSQL = `
      UPDATE LocationSharing
      SET status = 'inactive', end_time = NOW(), updated_at = NOW()
      WHERE sharer_id = ? AND status = 'active'
    `;

    try {
      await db.promise().query(deactivateSQL, [userId]);
      console.log(`사용자 ${userId}의 모든 위치 공유 비활성화 완료`);
    } catch (error) {
      console.error("위치 공유 비활성화 오류:", error);
      // 오류가 발생해도 로그아웃 진행
    }

    // 실제 서비스에서는 여기서 토큰 무효화 작업을 수행할 수 있음
    // 예: 블랙리스트에 토큰 추가, 세션 만료 처리 등

    // 성공 응답
    res.json({
      success: true,
      message: "로그아웃 성공",
    });
  } catch (error) {
    console.error("로그아웃 오류:", error);
    res.status(500).json({
      success: false,
      message: "서버 오류가 발생했습니다. 나중에 다시 시도해주세요.",
    });
  }
});

module.exports = router;