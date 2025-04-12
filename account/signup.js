// account/signup.js
const express = require("express");
const crypto = require("crypto"); // SHA-256 해시를 위한 내장 모듈
const router = express.Router();
const db = require("../db.js");

// SHA-256 해시 함수
function sha256Hash(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// Check for duplicate fields (ID, nickname, email)
router.get("/check-duplicate", async (req, res) => {
  try {
    const { field, value } = req.query;
    // Validate input
    if (!field || !value) {
      return res
        .status(400)
        .json({ message: "필수 파라미터가 누락되었습니다." });
    }
    // Allow checking only specific fields
    const allowedFields = ["user_id", "user_nickname", "user_email"];
    if (!allowedFields.includes(field)) {
      return res.status(400).json({ message: "유효하지 않은 필드입니다." });
    }
    // Query to check for duplicates
    const query = `SELECT COUNT(*) as count FROM users WHERE ${field} = ?`;
    const [results] = await db.promise().query(query, [value]);
    const isDuplicate = results[0].count > 0;
    return res.json({ isDuplicate });
  } catch (error) {
    console.error("중복 확인 오류:", error);
    return res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

// Sign up new user
router.post("/signup", async (req, res) => {
  try {
    const { user_name, user_id, user_nickname, user_password, user_email } =
      req.body;

    // Validate required fields
    if (
      !user_name ||
      !user_id ||
      !user_nickname ||
      !user_password ||
      !user_email
    ) {
      return res.status(400).json({ message: "모든 필드를 입력해주세요." });
    }

    // Check for duplicate ID
    const [idResults] = await db
      .promise()
      .query("SELECT COUNT(*) as count FROM users WHERE user_id = ?", [
        user_id,
      ]);
    if (idResults[0].count > 0) {
      return res.status(400).json({ message: "이미 사용 중인 아이디입니다." });
    }

    // Check for duplicate nickname
    const [nicknameResults] = await db
      .promise()
      .query("SELECT COUNT(*) as count FROM users WHERE user_nickname = ?", [
        user_nickname,
      ]);
    if (nicknameResults[0].count > 0) {
      return res.status(400).json({ message: "이미 사용 중인 닉네임입니다." });
    }

    // Check for duplicate email
    const [emailResults] = await db
      .promise()
      .query("SELECT COUNT(*) as count FROM users WHERE user_email = ?", [
        user_email,
      ]);
    if (emailResults[0].count > 0) {
      return res.status(400).json({ message: "이미 사용 중인 이메일입니다." });
    }

    // 비밀번호를 SHA-256으로 해싱
    const hashedPassword = sha256Hash(user_password);
    console.log(
      "비밀번호 해시 처리 완료:",
      user_password.substring(0, 3) + "*** → SHA-256 해시됨"
    );

    // Insert new user with hashed password
    await db
      .promise()
      .query(
        "INSERT INTO users (user_name, user_id, user_nickname, user_password, user_email) VALUES (?, ?, ?, ?, ?)",
        [user_name, user_id, user_nickname, hashedPassword, user_email]
      );

    return res.status(201).json({ message: "회원가입이 완료되었습니다." });
  } catch (error) {
    console.error("회원가입 오류:", error);
    return res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
