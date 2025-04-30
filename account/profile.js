// account/profile.js
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../db.js");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";

// 토큰 검증 미들웨어
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN 형식에서 TOKEN 부분 추출

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

// 사용자 프로필 정보 조회 API 엔드포인트
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.user_id;

    console.log("프로필 정보 요청 받음:", userId);

    // 데이터베이스에서 사용자 정보 조회
    const [results] = await db
      .promise()
      .query(
        "SELECT user_id, user_name, user_nickname, user_email, user_level, user_exp FROM users WHERE user_id = ?",
        [userId]
      );

    // 사용자가 존재하지 않는 경우
    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "사용자를 찾을 수 없습니다.",
      });
    }

    const user = results[0];

    // 성공 응답
    res.json({
      success: true,
      message: "프로필 정보 조회 성공",
      data: {
        user_id: user.user_id,
        user_name: user.user_name || user.user_id, // 이름이 없으면 아이디 사용
        user_nickname: user.user_nickname || "",
        user_email: user.user_email || "",
        user_level: user.user_level || 1,
        user_exp: user.user_exp,
      },
    });
  } catch (error) {
    console.error("프로필 조회 오류:", error);
    res.status(500).json({
      success: false,
      message: "서버 오류가 발생했습니다. 나중에 다시 시도해주세요.",
    });
  }
});

module.exports = router;
