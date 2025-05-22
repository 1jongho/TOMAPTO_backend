// account/delete_account.js
require("dotenv").config();
const express = require("express");
const router = express.Router();
const db = require("../db.js");
const crypto = require("crypto"); // SHA-256 해시를 위한 내장 모듈
const { auth } = require("../routes/auth");

// SHA-256 해시 함수 (signup.js와 동일)
function sha256Hash(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// 회원탈퇴 처리 라우트
router.post("/", auth, async (req, res) => {
  try {
    const { password, reason } = req.body;
    const userId = req.user.user_id;

    console.log(`회원탈퇴 요청 - 사용자 ID: ${userId}`);

    if (!password) {
      return res.status(400).json({ message: "비밀번호를 입력해주세요." });
    }

    // 1. 사용자 정보 및 비밀번호 검증
    db.query(
      "SELECT * FROM users WHERE user_id = ?",
      [userId],
      async (err, results) => {
        if (err) {
          console.error("사용자 정보 조회 오류:", err);
          return res.status(500).json({ message: "서버 오류가 발생했습니다." });
        }

        if (results.length === 0) {
          console.error(`사용자를 찾을 수 없음 - ID: ${userId}`);
          return res.status(404).json({ message: "사용자를 찾을 수 없습니다." });
        }

        const user = results[0];
        
        // SHA-256으로 입력된 비밀번호 해시화
        const hashedInputPassword = sha256Hash(password);
        
        console.log(`=== 상세 비밀번호 검증 디버깅 ===`);
        console.log(`- 원본 입력 비밀번호: "${password}"`);
        console.log(`- 입력 비밀번호 길이: ${password.length}`);
        console.log(`- 입력 비밀번호 타입: ${typeof password}`);
        console.log(`- 입력된 비밀번호 해시: ${hashedInputPassword}`);
        console.log(`- 저장된 비밀번호 해시: ${user.user_password}`);
        console.log(`- 해시 길이 비교: 입력=${hashedInputPassword.length}, 저장=${user.user_password.length}`);
        console.log(`- 해시 일치 여부: ${hashedInputPassword === user.user_password}`);
        console.log(`- 문자열 비교 (===): ${hashedInputPassword === user.user_password}`);
        console.log(`- 문자열 비교 (==): ${hashedInputPassword == user.user_password}`);
        
        // 각 문자별로 비교해보기
        if (hashedInputPassword !== user.user_password) {
          console.log(`=== 문자별 비교 ===`);
          const minLength = Math.min(hashedInputPassword.length, user.user_password.length);
          for (let i = 0; i < minLength; i++) {
            if (hashedInputPassword[i] !== user.user_password[i]) {
              console.log(`첫 번째 차이점 - 위치 ${i}: 입력="${hashedInputPassword[i]}" vs 저장="${user.user_password[i]}"`);
              break;
            }
          }
          
          // 실제 데이터베이스의 사용자 정보도 확인
          console.log(`=== 사용자 정보 확인 ===`);
          console.log(`- 사용자 ID: ${user.user_id}`);
          console.log(`- 사용자 이메일: ${user.user_email}`);
          
          // 다시 한 번 해시 생성해서 확인
          const reHashedPassword = sha256Hash(password);
          console.log(`- 재생성된 해시: ${reHashedPassword}`);
          console.log(`- 재생성 해시 일치: ${reHashedPassword === hashedInputPassword}`);
          
          console.log(`비밀번호 불일치 - 사용자 ID: ${userId}`);
          return res.status(401).json({ message: "비밀번호가 일치하지 않습니다." });
        }

        console.log(`비밀번호 검증 성공 - 사용자 ID: ${userId}`);

        // 2. 트랜잭션 시작
        db.getConnection((err, connection) => {
          if (err) {
            console.error("DB 연결 오류:", err);
            return res.status(500).json({ message: "서버 오류가 발생했습니다." });
          }

          connection.beginTransaction(async (err) => {
            if (err) {
              console.error("트랜잭션 시작 오류:", err);
              connection.release();
              return res.status(500).json({ message: "서버 오류가 발생했습니다." });
            }

            try {
              // 3. 탈퇴 사유 로그 기록
              if (reason) {
                console.log(`탈퇴 사유 - 사용자 ID: ${userId}, 사유: ${reason}`);
              }

              // 4. 친구 요청 데이터 삭제
              await new Promise((resolve, reject) => {
                connection.query(
                  "DELETE FROM friendrequests WHERE sender_id = ? OR recipient_id = ?",
                  [userId, userId],
                  (err, result) => {
                    if (err) {
                      console.error("친구 요청 삭제 오류:", err);
                      reject(err);
                      return;
                    }
                    console.log(`친구 요청 삭제 완료 - 사용자 ID: ${userId}, 삭제된 행: ${result.affectedRows}`);
                    resolve();
                  }
                );
              });

              // 5. 친구 관계 데이터 삭제
              await new Promise((resolve, reject) => {
                connection.query(
                  "DELETE FROM friendships WHERE user_id_1 = ? OR user_id_2 = ?",
                  [userId, userId],
                  (err, result) => {
                    if (err) {
                      console.error("친구 관계 삭제 오류:", err);
                      reject(err);
                      return;
                    }
                    console.log(`친구 관계 삭제 완료 - 사용자 ID: ${userId}, 삭제된 행: ${result.affectedRows}`);
                    resolve();
                  }
                );
              });

              // 6. 현재 위치 데이터 삭제
              await new Promise((resolve, reject) => {
                connection.query(
                  "DELETE FROM location WHERE user_id = ?",
                  [userId],
                  (err, result) => {
                    if (err) {
                      console.error("위치 데이터 삭제 오류:", err);
                      reject(err);
                      return;
                    }
                    console.log(`위치 데이터 삭제 완료 - 사용자 ID: ${userId}, 삭제된 행: ${result.affectedRows}`);
                    resolve();
                  }
                );
              });

              // 7. 위치 기록 데이터 삭제
              await new Promise((resolve, reject) => {
                connection.query(
                  "DELETE FROM locationhistory WHERE user_id = ?",
                  [userId],
                  (err, result) => {
                    if (err) {
                      console.error("위치 기록 삭제 오류:", err);
                      reject(err);
                      return;
                    }
                    console.log(`위치 기록 삭제 완료 - 사용자 ID: ${userId}, 삭제된 행: ${result.affectedRows}`);
                    resolve();
                  }
                );
              });

              // 8. 위치 공유 데이터 삭제
              await new Promise((resolve, reject) => {
                connection.query(
                  "DELETE FROM locationsharing WHERE sharer_id = ? OR sharee_id = ?",
                  [userId, userId],
                  (err, result) => {
                    if (err) {
                      console.error("위치 공유 삭제 오류:", err);
                      reject(err);
                      return;
                    }
                    console.log(`위치 공유 삭제 완료 - 사용자 ID: ${userId}, 삭제된 행: ${result.affectedRows}`);
                    resolve();
                  }
                );
              });

              // 9. 위치 조회 로그 삭제
              await new Promise((resolve, reject) => {
                connection.query(
                  "DELETE FROM locationviewlogs WHERE viewer_id = ? OR viewed_user_id = ?",
                  [userId, userId],
                  (err, result) => {
                    if (err) {
                      console.error("위치 조회 로그 삭제 오류:", err);
                      reject(err);
                      return;
                    }
                    console.log(`위치 조회 로그 삭제 완료 - 사용자 ID: ${userId}, 삭제된 행: ${result.affectedRows}`);
                    resolve();
                  }
                );
              });

              // 10. 인증 코드 정보 삭제
              await new Promise((resolve, reject) => {
                connection.query(
                  "DELETE FROM verification_codes WHERE email = ?",
                  [user.user_email],
                  (err, result) => {
                    if (err) {
                      console.error("인증 코드 삭제 오류:", err);
                      reject(err);
                      return;
                    }
                    console.log(`인증 코드 삭제 완료 - 이메일: ${user.user_email}, 삭제된 행: ${result.affectedRows}`);
                    resolve();
                  }
                );
              });

              // 11. 리프레시 토큰 테이블이 있다면 삭제
              try {
                await new Promise((resolve, reject) => {
                  connection.query(
                    "DELETE FROM refresh_tokens WHERE user_id = ?",
                    [userId],
                    (err, result) => {
                      if (err) {
                        if (err.code === 'ER_NO_SUCH_TABLE') {
                          console.log("리프레시 토큰 테이블이 없습니다. 이 단계를 건너뜁니다.");
                          resolve();
                          return;
                        }
                        console.error("리프레시 토큰 삭제 오류:", err);
                        reject(err);
                        return;
                      }
                      console.log(`리프레시 토큰 삭제 완료 - 사용자 ID: ${userId}, 삭제된 행: ${result.affectedRows}`);
                      resolve();
                    }
                  );
                });
              } catch (tokenError) {
                console.log("리프레시 토큰 처리 중 오류 발생, 계속 진행합니다:", tokenError.message);
              }

              // 12. 최종 사용자 정보 삭제
              await new Promise((resolve, reject) => {
                connection.query(
                  "DELETE FROM users WHERE user_id = ?",
                  [userId],
                  (err, result) => {
                    if (err) {
                      console.error("사용자 삭제 오류:", err);
                      reject(err);
                      return;
                    }
                    
                    if (result.affectedRows === 0) {
                      const error = new Error("사용자를 삭제할 수 없습니다.");
                      console.error(error);
                      reject(error);
                      return;
                    }
                    
                    console.log(`사용자 삭제 완료 - 사용자 ID: ${userId}`);
                    resolve();
                  }
                );
              });

              // 트랜잭션 커밋
              connection.commit((err) => {
                if (err) {
                  console.error("트랜잭션 커밋 오류:", err);
                  return connection.rollback(() => {
                    connection.release();
                    res.status(500).json({ message: "서버 오류가 발생했습니다." });
                  });
                }

                console.log(`회원탈퇴 처리 완료 - 사용자 ID: ${userId}`);
                connection.release();
                res.status(200).json({ message: "회원탈퇴가 완료되었습니다." });
              });
            } catch (error) {
              console.error("회원탈퇴 처리 중 오류:", error);
              return connection.rollback(() => {
                connection.release();
                res.status(500).json({ message: "회원탈퇴 처리 중 오류가 발생했습니다." });
              });
            }
          });
        });
      }
    );
  } catch (error) {
    console.error("회원탈퇴 처리 중 예상치 못한 오류:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;