// account/login.js
const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto"); // 기본 내장 모듈로 SHA-256 해시 사용
const jwt = require("jsonwebtoken");
const db = require("../db.js");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret"; // JWT 토큰 비밀키

// SHA-256 해시 함수
function sha256Hash(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// 로그인 API 엔드포인트
router.post("/", async (req, res) => {
  try {
    console.log("로그인 요청 받음:", req.body);

    const { user_id, user_password } = req.body;

    // 필수 필드 체크
    if (!user_id || !user_password) {
      return res.status(400).json({
        success: false,
        message: "아이디와 비밀번호를 모두 입력해주세요.",
      });
    }

    // 데이터베이스에서 사용자 조회
    const [results] = await db
      .promise()
      .query("SELECT * FROM users WHERE user_id = ?", [user_id]);

    console.log(
      "사용자 조회 결과:",
      results.length > 0 ? "사용자 찾음" : "사용자 없음"
    );

    // 사용자가 존재하지 않는 경우
    if (results.length === 0) {
      return res.status(401).json({
        success: false,
        message: "아이디 또는 비밀번호가 올바르지 않습니다.",
      });
    }

    const user = results[0];

    // 입력된 비밀번호 해시
    const inputPasswordHashed = sha256Hash(user_password);

    // 비밀번호 검증 로직
    let isPasswordValid = false;

    // 저장된 비밀번호 형식 확인
    if (user.user_password.startsWith("$2")) {
      // bcrypt 해시 비밀번호
      isPasswordValid = await bcrypt.compare(user_password, user.user_password);
      console.log("bcrypt 비밀번호 검증 수행");
    } else if (user.user_password.length === 64) {
      // SHA-256 해시 (64자 16진수 문자열)
      isPasswordValid = inputPasswordHashed === user.user_password;
      console.log("SHA-256 비밀번호 검증 수행");
    } else {
      // 평문 비밀번호 (이전 사용자)
      isPasswordValid = user_password === user.user_password;
      console.log("평문 비밀번호 검증 수행");
    }

    console.log("입력된 비밀번호:", user_password.substring(0, 3) + "***");
    console.log(
      "입력된 비밀번호 SHA-256 해시 (일부):",
      inputPasswordHashed.substring(0, 10) + "..."
    );
    console.log(
      "저장된 비밀번호 (일부):",
      user.user_password.substring(0, 10) + "..."
    );
    console.log("비밀번호 검증 결과:", isPasswordValid ? "성공" : "실패");

    // 비밀번호가 일치하지 않는 경우
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "아이디 또는 비밀번호가 올바르지 않습니다.",
      });
    }

    // JWT 토큰 생성
    const token = jwt.sign(
      {
        user_id: user.user_id,
        // 필요에 따라 추가 정보 포함 가능
      },
      JWT_SECRET,
      { expiresIn: "24h" } // 토큰 유효 기간 설정
    );

    // 로그인 성공 응답
    res.json({
      success: true,
      message: "로그인 성공",
      token,
      user: {
        user_id: user.user_id,
        // 필요한 사용자 정보만 선택적으로 전달
        // 비밀번호는 제외
      },
    });
  } catch (error) {
    console.error("로그인 오류:", error);
    res.status(500).json({
      success: false,
      message: "서버 오류가 발생했습니다. 나중에 다시 시도해주세요.",
    });
  }
});

// 토큰 검증 미들웨어 (보호된 라우트에 사용)
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

module.exports = router;
