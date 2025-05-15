// account/password_reset.js
require("dotenv").config();
const express = require("express");
const router = express.Router();
const db = require("../db.js");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");

// 기존 email_verification.js와 동일한 nodemailer 설정
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

// 인증 코드 생성 함수 (기존과 동일)
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 비밀번호 유효성 검사 함수 (추가됨)
function validatePassword(password) {
  // 비밀번호 규칙: 8자 이상, 문자 포함, 숫자 포함
  const hasMinLength = password.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  
  return {
    isValid: hasMinLength && hasLetter && hasNumber,
    hasMinLength,
    hasLetter,
    hasNumber
  };
}

// 비밀번호 재설정용 인증 코드 발송
router.post("/send-reset-code", async (req, res) => {
  try {
    const { user_id, email } = req.body;

    if (!user_id || !email) {
      return res.status(400).json({ 
        message: "아이디와 이메일 주소가 필요합니다." 
      });
    }

    // 아이디와 이메일이 일치하는 사용자 확인
    db.query(
      "SELECT * FROM users WHERE user_id = ? AND user_email = ?",
      [user_id, email],
      async (err, results) => {
        if (err) {
          console.error("데이터베이스 오류:", err);
          return res.status(500).json({ 
            message: "서버 오류가 발생했습니다." 
          });
        }

        if (results.length === 0) {
          return res.status(400).json({ 
            message: "일치하는 회원 정보를 찾을 수 없습니다." 
          });
        }

        // 인증 코드 생성
        const verificationCode = generateVerificationCode();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5분 후 만료

        console.log(`비밀번호 재설정 코드 생성: ${email} - 코드: ${verificationCode}`);

        // 기존 인증 코드가 있는지 확인 및 업데이트 또는 생성
        db.query(
          "SELECT * FROM verification_codes WHERE email = ?",
          [email],
          async (err, codeResults) => {
            if (err) {
              console.error("데이터베이스 오류:", err);
              return res.status(500).json({ message: "서버 오류가 발생했습니다." });
            }

            try {
              if (codeResults.length > 0) {
                // 기존 코드 업데이트
                console.log(`기존 인증 코드 업데이트: ${email}`);
                await new Promise((resolve, reject) => {
                  db.query(
                    "UPDATE verification_codes SET code = ?, expires_at = ?, verified = 0 WHERE email = ?",
                    [verificationCode, expiresAt, email],
                    (err) => {
                      if (err) {
                        console.error("인증 코드 업데이트 오류:", err);
                        reject(err);
                        return;
                      }
                      resolve();
                    }
                  );
                });
              } else {
                // 새 코드 생성
                console.log(`새 인증 코드 생성: ${email}`);
                await new Promise((resolve, reject) => {
                  db.query(
                    "INSERT INTO verification_codes (email, code, expires_at) VALUES (?, ?, ?)",
                    [email, verificationCode, expiresAt],
                    (err) => {
                      if (err) {
                        console.error("인증 코드 저장 오류:", err);
                        reject(err);
                        return;
                      }
                      resolve();
                    }
                  );
                });
              }

              // 이메일 발송
              const mailOptions = {
                from: `"비밀번호 재설정" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: "비밀번호 재설정 인증 코드",
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2>비밀번호 재설정 인증 코드</h2>
                    <p>안녕하세요! 비밀번호 재설정을 위한 인증 코드입니다:</p>
                    <div style="background-color: #f0f0f0; padding: 15px; font-size: 24px; text-align: center; letter-spacing: 5px; font-weight: bold; border-radius: 4px; margin: 20px 0;">
                      ${verificationCode}
                    </div>
                    <p>아이디: <strong>${user_id}</strong></p>
                    <p>이 코드는 5분 후에 만료됩니다.</p>
                    <p>이 이메일을 요청하지 않았다면 무시하셔도 됩니다.</p>
                  </div>
                `,
              };

              // Promise로 이메일 전송 래핑
              await new Promise((resolve, reject) => {
                transporter.sendMail(mailOptions, (err, info) => {
                  if (err) {
                    console.error("이메일 발송 오류:", err);
                    reject(err);
                    return;
                  }
                  console.log("비밀번호 재설정 메일 발송 성공:", info.messageId);
                  resolve(info);
                });
              });

              res.status(200).json({
                message: "비밀번호 재설정 인증 코드가 이메일로 발송되었습니다.",
                emailSent: true,
              });

            } catch (error) {
              console.error("비밀번호 재설정 처리 중 오류:", error);
              res.status(500).json({
                message: "이메일 발송에 실패했습니다.",
                error: error.message,
              });
            }
          }
        );
      }
    );
  } catch (error) {
    console.error("비밀번호 재설정 요청 중 오류:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

// 비밀번호 재설정 인증 코드 확인 (기존 verify-code와 동일하지만 사용자 확인 추가)
router.post("/verify-reset-code", async (req, res) => {
  try {
    const { user_id, email, code } = req.body;

    if (!user_id || !email || !code) {
      return res.status(400).json({ 
        message: "아이디, 이메일, 인증 코드가 필요합니다." 
      });
    }

    console.log(`비밀번호 재설정 인증 시도: 아이디 = ${user_id}, 이메일 = ${email}, 코드 = ${code}`);

    // 아이디와 이메일이 일치하는지 다시 확인
    db.query(
      "SELECT * FROM users WHERE user_id = ? AND user_email = ?",
      [user_id, email],
      (err, userResults) => {
        if (err) {
          console.error("데이터베이스 오류:", err);
          return res.status(500).json({ message: "서버 오류가 발생했습니다." });
        }

        if (userResults.length === 0) {
          return res.status(400).json({
            message: "일치하는 회원 정보를 찾을 수 없습니다.",
            verified: false,
          });
        }

        // 데이터베이스에서 인증 코드 확인 (기존 verify-code 로직과 동일)
        db.query(
          "SELECT * FROM verification_codes WHERE email = ? AND code = ? AND expires_at > NOW()",
          [email, code],
          (err, codeResults) => {
            if (err) {
              console.error("인증 코드 확인 오류:", err);
              return res.status(500).json({ message: "서버 오류가 발생했습니다." });
            }

            console.log(`비밀번호 재설정 인증 조회 결과: ${codeResults.length}개 항목 찾음`);

            if (codeResults.length === 0) {
              return res.status(400).json({
                message: "유효하지 않거나 만료된 인증 코드입니다.",
                verified: false,
              });
            }

            // 인증 상태 업데이트
            db.query(
              "UPDATE verification_codes SET verified = 1, verified_at = NOW() WHERE email = ?",
              [email],
              (err) => {
                if (err) {
                  console.error("인증 상태 업데이트 오류:", err);
                  return res.status(500).json({ message: "서버 오류가 발생했습니다." });
                }

                console.log(`비밀번호 재설정 인증 완료: ${email}`);
                
                res.status(200).json({
                  message: "인증이 완료되었습니다.",
                  verified: true,
                  user_id: user_id
                });
              }
            );
          }
        );
      }
    );
  } catch (error) {
    console.error("비밀번호 재설정 인증 중 오류:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

// 새 비밀번호 설정
router.post("/reset-password", async (req, res) => {
  try {
    const { user_id, email, newPassword } = req.body;

    if (!user_id || !email || !newPassword) {
      return res.status(400).json({ 
        message: "필수 정보가 누락되었습니다." 
      });
    }

    // 비밀번호 유효성 검사 (강화됨)
    const validation = validatePassword(newPassword);
    
    if (!validation.isValid) {
      let errorMessage = "비밀번호가 요구사항을 충족하지 않습니다. ";
      
      if (!validation.hasMinLength) {
        errorMessage += "비밀번호는 8자리 이상이어야 합니다. ";
      }
      
      if (!validation.hasLetter) {
        errorMessage += "최소 하나의 문자를 포함해야 합니다. ";
      }
      
      if (!validation.hasNumber) {
        errorMessage += "최소 하나의 숫자를 포함해야 합니다.";
      }
      
      return res.status(400).json({
        message: errorMessage.trim()
      });
    }

    // 인증이 완료되었는지 확인
    db.query(
      "SELECT * FROM verification_codes WHERE email = ? AND verified = 1",
      [email],
      async (err, results) => {
        if (err) {
          console.error("인증 상태 확인 오류:", err);
          return res.status(500).json({ message: "서버 오류가 발생했습니다." });
        }

        if (results.length === 0) {
          return res.status(400).json({
            message: "이메일 인증이 완료되지 않았습니다.",
          });
        }

        // 사용자 확인
        db.query(
          "SELECT * FROM users WHERE user_id = ? AND user_email = ?",
          [user_id, email],
          async (err, userResults) => {
            if (err) {
              console.error("사용자 확인 오류:", err);
              return res.status(500).json({ message: "서버 오류가 발생했습니다." });
            }

            if (userResults.length === 0) {
              return res.status(400).json({
                message: "일치하는 회원 정보를 찾을 수 없습니다.",
              });
            }

            try {
              // 새 비밀번호 해시화
              const saltRounds = 10;
              const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

              // 사용자 비밀번호 업데이트
              await new Promise((resolve, reject) => {
                db.query(
                  "UPDATE users SET user_password = ? WHERE user_id = ?",
                  [hashedPassword, user_id],
                  (err, result) => {
                    if (err) {
                      console.error("비밀번호 업데이트 오류:", err);
                      reject(err);
                      return;
                    }
                    console.log("비밀번호 업데이트 결과:", result);
                    resolve();
                  }
                );
              });

              // 사용된 인증 코드 삭제
              await new Promise((resolve, reject) => {
                db.query(
                  "DELETE FROM verification_codes WHERE email = ?",
                  [email],
                  (err) => {
                    if (err) {
                      console.error("인증 코드 삭제 오류:", err);
                      reject(err);
                      return;
                    }
                    resolve();
                  }
                );
              });

              console.log(`비밀번호 재설정 완료: ${user_id}`);
              
              // 성공 이메일 발송 (선택사항)
              const mailOptions = {
                from: `"보안 알림" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: "비밀번호가 성공적으로 변경되었습니다",
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2>비밀번호 변경 완료</h2>
                    <p>안녕하세요! 회원님의 비밀번호가 성공적으로 변경되었습니다.</p>
                    <p>아이디: <strong>${user_id}</strong></p>
                    <p>변경 시각: ${new Date().toLocaleString('ko-KR')}</p>
                    <p>본인이 변경하지 않았다면 고객센터로 즉시 연락해주세요.</p>
                  </div>
                `,
              };

              transporter.sendMail(mailOptions, (err, info) => {
                if (err) {
                  console.error("비밀번호 변경 알림 메일 발송 오류:", err);
                } else {
                  console.log("비밀번호 변경 알림 메일 발송 성공:", info.messageId);
                }
              });

              res.status(200).json({
                message: "비밀번호가 성공적으로 변경되었습니다.",
                success: true,
              });

            } catch (error) {
              console.error("비밀번호 재설정 처리 중 오류:", error);
              res.status(500).json({
                message: "비밀번호 변경에 실패했습니다.",
                error: error.message,
              });
            }
          }
        );
      }
    );
  } catch (error) {
    console.error("비밀번호 재설정 중 오류:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;