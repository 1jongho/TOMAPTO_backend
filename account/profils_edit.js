// account/profils_edit.js
require("dotenv").config();
const express = require("express");
const router = express.Router();
const db = require("../db.js");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { isValidToken } = require("../routes/auth.js");

// 다양한 해시 방식으로 비밀번호 비교하는 함수
async function comparePasswordMultipleFormats(inputPassword, storedHash) {
  try {
    console.log(`비밀번호 비교 시작 - 입력: ${inputPassword?.length}자, 저장된 해시: ${storedHash?.substring(0, 20)}...`);
    
    // 1. bcrypt 형식 확인 및 비교
    if (storedHash && (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$'))) {
      console.log('bcrypt 형식 해시 감지, bcrypt.compare 사용');
      const bcryptResult = await bcrypt.compare(inputPassword, storedHash);
      console.log(`bcrypt 비교 결과: ${bcryptResult}`);
      return bcryptResult;
    }
    
    // 2. 평문 비교
    if (inputPassword === storedHash) {
      console.log('평문 비교 성공');
      return true;
    }
    
    // 3. 다양한 해시 방식으로 비교
    const hashMethods = [
      { name: 'SHA256', hash: crypto.createHash('sha256').update(inputPassword).digest('hex') },
      { name: 'MD5', hash: crypto.createHash('md5').update(inputPassword).digest('hex') },
      { name: 'SHA1', hash: crypto.createHash('sha1').update(inputPassword).digest('hex') },
      { name: 'SHA256+Salt', hash: crypto.createHash('sha256').update(inputPassword + 'salt').digest('hex') },
      { name: 'MD5+Salt', hash: crypto.createHash('md5').update(inputPassword + 'salt').digest('hex') }
    ];
    
    for (const method of hashMethods) {
      if (method.hash === storedHash) {
        console.log(`${method.name} 해시 방식으로 비교 성공`);
        return true;
      }
    }
    
    console.log('모든 해시 방식으로 비교 실패');
    return false;
    
  } catch (error) {
    console.error('비밀번호 비교 중 오류:', error);
    return false;
  }
}

// 새로운 비밀번호를 bcrypt로 해시화
async function hashPasswordWithBcrypt(password) {
  try {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    console.log(`새 비밀번호 bcrypt 해시 생성 완료: ${hashedPassword.substring(0, 20)}...`);
    return hashedPassword;
  } catch (error) {
    console.error('bcrypt 해시 생성 오류:', error);
    throw error;
  }
}

// 현재 프로필 정보 조회 (실제 DB 컬럼명 사용)
router.get("/current", isValidToken, (req, res) => {
  try {
    const userId = req.user.user_id;
    
    console.log(`프로필 정보 조회 요청 - 사용자 ID: ${userId}`);
    
    const sql = `
      SELECT 
        user_id, 
        user_nickname, 
        user_email, 
        user_level, 
        user_exp, 
        user_created_at,
        user_status 
      FROM users 
      WHERE user_id = ? AND user_status = 'active'
    `;
    
    db.query(sql, [userId], (err, results) => {
      if (err) {
        console.error('프로필 조회 중 데이터베이스 오류:', err);
        return res.status(500).json({
          success: false,
          message: '서버 오류가 발생했습니다.'
        });
      }
      
      if (results.length === 0) {
        console.error(`사용자 정보를 찾을 수 없음: ${userId}`);
        return res.status(404).json({
          success: false,
          message: '사용자 정보를 찾을 수 없습니다.'
        });
      }
      
      const user = results[0];
      console.log(`프로필 조회 성공 - 사용자: ${user.user_id}`);
      
      res.status(200).json({
        success: true,
        data: {
          user_id: user.user_id,
          user_nickname: user.user_nickname,
          user_email: user.user_email,
          user_level: user.user_level || 1,
          user_exp: user.user_exp || 0
        }
      });
    });
  } catch (error) {
    console.error('프로필 조회 중 오류:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.'
    });
  }
});

// 아이디 중복 확인 (실제 DB 컬럼명 사용)
router.post("/check-userid", isValidToken, (req, res) => {
  try {
    const { new_user_id } = req.body;
    const currentUserId = req.user.user_id;
    
    console.log(`아이디 중복 확인 요청 - 현재 사용자: ${currentUserId}, 새 아이디: ${new_user_id}`);
    
    if (!new_user_id || new_user_id.trim() === '') {
      return res.status(200).json({
        available: false,
        message: '새 아이디를 입력해주세요.'
      });
    }
    
    const trimmedUserId = new_user_id.trim();
    
    // 현재 사용자의 아이디와 같다면 사용 가능
    if (trimmedUserId === currentUserId) {
      return res.status(200).json({
        available: true,
        message: '현재 사용 중인 아이디입니다.'
      });
    }
    
    // 아이디 유효성 검사
    const userIdRegex = /^[a-zA-Z0-9_]{4,20}$/;
    if (!userIdRegex.test(trimmedUserId)) {
      return res.status(200).json({
        available: false,
        message: '아이디는 4-20자의 영문, 숫자, 언더스코어만 사용 가능합니다.'
      });
    }
    
    // 데이터베이스에서 중복 확인
    const sql = "SELECT user_id FROM users WHERE user_id = ? AND user_status = 'active'";
    
    db.query(sql, [trimmedUserId], (err, results) => {
      if (err) {
        console.error('아이디 중복 확인 오류:', err);
        return res.status(200).json({
          available: false,
          message: '중복 확인 중 오류가 발생했습니다.'
        });
      }
      
      const isAvailable = results.length === 0;
      console.log(`아이디 중복 확인 결과 - ${trimmedUserId}: ${isAvailable ? '사용 가능' : '중복'}`);
      
      res.status(200).json({
        available: isAvailable,
        message: isAvailable ? '사용 가능한 아이디입니다.' : '이미 사용 중인 아이디입니다.'
      });
    });
  } catch (error) {
    console.error('아이디 중복 확인 중 오류:', error);
    res.status(200).json({
      available: false,
      message: '중복 확인 중 오류가 발생했습니다.'
    });
  }
});

// 닉네임 중복 확인 (실제 DB 컬럼명 사용)
router.post("/check-nickname", isValidToken, (req, res) => {
  try {
    const { new_nickname } = req.body;
    const currentUserId = req.user.user_id;
    
    console.log(`닉네임 중복 확인 요청 - 현재 사용자: ${currentUserId}, 새 닉네임: ${new_nickname}`);
    
    if (!new_nickname || new_nickname.trim() === '') {
      return res.status(200).json({
        available: false,
        message: '새 닉네임을 입력해주세요.'
      });
    }
    
    const trimmedNickname = new_nickname.trim();
    
    // 현재 사용자의 닉네임 조회
    const getCurrentNicknameSql = "SELECT user_nickname FROM users WHERE user_id = ? AND user_status = 'active'";
    
    db.query(getCurrentNicknameSql, [currentUserId], (err, currentResults) => {
      if (err) {
        console.error('현재 닉네임 조회 오류:', err);
        return res.status(200).json({
          available: false,
          message: '중복 확인 중 오류가 발생했습니다.'
        });
      }
      
      // 현재 사용자의 닉네임과 같다면 사용 가능
      if (currentResults.length > 0 && currentResults[0].user_nickname === trimmedNickname) {
        return res.status(200).json({
          available: true,
          message: '현재 사용 중인 닉네임입니다.'
        });
      }
      
      // 닉네임 유효성 검사
      if (trimmedNickname.length < 2 || trimmedNickname.length > 20) {
        return res.status(200).json({
          available: false,
          message: '닉네임은 2-20자 사이여야 합니다.'
        });
      }
      
      // 데이터베이스에서 중복 확인
      const checkDuplicateSql = "SELECT user_nickname FROM users WHERE user_nickname = ? AND user_status = 'active'";
      
      db.query(checkDuplicateSql, [trimmedNickname], (err, results) => {
        if (err) {
          console.error('닉네임 중복 확인 오류:', err);
          return res.status(200).json({
            available: false,
            message: '중복 확인 중 오류가 발생했습니다.'
          });
        }
        
        const isAvailable = results.length === 0;
        console.log(`닉네임 중복 확인 결과 - ${trimmedNickname}: ${isAvailable ? '사용 가능' : '중복'}`);
        
        res.status(200).json({
          available: isAvailable,
          message: isAvailable ? '사용 가능한 닉네임입니다.' : '이미 사용 중인 닉네임입니다.'
        });
      });
    });
  } catch (error) {
    console.error('닉네임 중복 확인 중 오류:', error);
    res.status(200).json({
      available: false,
      message: '중복 확인 중 오류가 발생했습니다.'
    });
  }
});

// 프로필 정보 업데이트 (실제 DB 컬럼명 및 구조 반영)
router.put("/update", isValidToken, (req, res) => {
  try {
    const { new_user_id, new_nickname } = req.body;
    const currentUserId = req.user.user_id;
    
    console.log(`프로필 업데이트 요청 - 사용자: ${currentUserId}`, {
      new_user_id: new_user_id?.trim(),
      new_nickname: new_nickname?.trim()
    });
    
    // 입력값 트림 처리
    const trimmedUserId = new_user_id?.trim();
    const trimmedNickname = new_nickname?.trim();
    
    if (!trimmedUserId && !trimmedNickname) {
      return res.status(400).json({
        success: false,
        message: '변경할 정보가 없습니다.'
      });
    }
    
    // 먼저 현재 사용자 정보 조회
    const getCurrentUserSql = `
      SELECT user_id, user_nickname 
      FROM users 
      WHERE user_id = ? AND user_status = 'active'
    `;
    
    db.query(getCurrentUserSql, [currentUserId], (err, currentUserResults) => {
      if (err) {
        console.error('현재 사용자 정보 조회 오류:', err);
        return res.status(500).json({
          success: false,
          message: '사용자 정보 조회 중 오류가 발생했습니다.'
        });
      }
      
      if (currentUserResults.length === 0) {
        return res.status(404).json({
          success: false,
          message: '사용자 정보를 찾을 수 없습니다.'
        });
      }
      
      const currentUserData = currentUserResults[0];
      console.log('현재 사용자 데이터:', currentUserData);
      
      // 실제로 변경되는 항목만 필터링
      let updateFields = [];
      let updateValues = [];
      let updatedFields = {};
      
      if (trimmedUserId && trimmedUserId !== currentUserData.user_id) {
        updateFields.push('user_id = ?');
        updateValues.push(trimmedUserId);
        updatedFields.user_id_changed = true;
      }
      
      if (trimmedNickname && trimmedNickname !== currentUserData.user_nickname) {
        updateFields.push('user_nickname = ?');
        updateValues.push(trimmedNickname);
        updatedFields.nickname_changed = true;
      }
      
      // user_updated_at 필드 추가 (타임스탬프 업데이트)
      if (updateFields.length > 0) {
        updateFields.push('user_updated_at = NOW()');
      }
      
      // 변경사항이 없으면 성공 응답
      if (updateFields.length === 1) { // user_updated_at만 있는 경우
        return res.status(200).json({
          success: true,
          message: '변경사항이 없습니다.',
          data: {
            user_id: currentUserData.user_id,
            user_nickname: currentUserData.user_nickname,
            updated_fields: {}
          }
        });
      }
      
      // 트랜잭션 시작
      db.beginTransaction((transactionErr) => {
        if (transactionErr) {
          console.error('트랜잭션 시작 오류:', transactionErr);
          return res.status(500).json({
            success: false,
            message: '서버 오류가 발생했습니다.'
          });
        }
        
        updateValues.push(currentUserId); // WHERE 조건용
        
        const sql = `UPDATE users SET ${updateFields.join(', ')} WHERE user_id = ? AND user_status = 'active'`;
        
        console.log('업데이트 SQL:', sql);
        console.log('업데이트 값:', updateValues);
        
        db.query(sql, updateValues, (updateErr, result) => {
          if (updateErr) {
            console.error('프로필 업데이트 오류:', updateErr);
            
            return db.rollback(() => {
              if (updateErr.code === 'ER_DUP_ENTRY') {
                // 중복 키 오류 분석
                const duplicateField = updateErr.message.includes('user_nickname') ? '닉네임' : '아이디';
                return res.status(400).json({
                  success: false,
                  message: `이미 사용 중인 ${duplicateField}입니다.`
                });
              }
              
              return res.status(500).json({
                success: false,
                message: '프로필 업데이트 중 오류가 발생했습니다.',
                error: updateErr.message
              });
            });
          }
          
          console.log('업데이트 결과:', result);
          
          if (result.affectedRows === 0) {
            return db.rollback(() => {
              res.status(404).json({
                success: false,
                message: '사용자 정보를 찾을 수 없거나 업데이트되지 않았습니다.'
              });
            });
          }
          
          // 아이디가 변경된 경우 관련 테이블들도 업데이트 (FK 관계)
          if (updatedFields.user_id_changed) {
            console.log('아이디 변경됨 - 관련 테이블 업데이트 시작');
            
            // 모든 관련 테이블 업데이트를 위한 배열
            const relatedTableUpdates = [
              {
                sql: 'UPDATE friendrequests SET sender_id = ? WHERE sender_id = ?',
                values: [trimmedUserId, currentUserId],
                description: 'friendrequests.sender_id'
              },
              {
                sql: 'UPDATE friendrequests SET recipient_id = ? WHERE recipient_id = ?',
                values: [trimmedUserId, currentUserId],
                description: 'friendrequests.recipient_id'
              },
              {
                sql: 'UPDATE friendships SET user_id_1 = ? WHERE user_id_1 = ?',
                values: [trimmedUserId, currentUserId],
                description: 'friendships.user_id_1'
              },
              {
                sql: 'UPDATE friendships SET user_id_2 = ? WHERE user_id_2 = ?',
                values: [trimmedUserId, currentUserId],
                description: 'friendships.user_id_2'
              },
              {
                sql: 'UPDATE location SET user_id = ? WHERE user_id = ?',
                values: [trimmedUserId, currentUserId],
                description: 'location.user_id'
              },
              {
                sql: 'UPDATE locationhistory SET user_id = ? WHERE user_id = ?',
                values: [trimmedUserId, currentUserId],
                description: 'locationhistory.user_id'
              },
              {
                sql: 'UPDATE locationsharing SET sharer_id = ? WHERE sharer_id = ?',
                values: [trimmedUserId, currentUserId],
                description: 'locationsharing.sharer_id'
              },
              {
                sql: 'UPDATE locationsharing SET sharee_id = ? WHERE sharee_id = ?',
                values: [trimmedUserId, currentUserId],
                description: 'locationsharing.sharee_id'
              },
              {
                sql: 'UPDATE locationviewlogs SET viewer_id = ? WHERE viewer_id = ?',
                values: [trimmedUserId, currentUserId],
                description: 'locationviewlogs.viewer_id'
              },
              {
                sql: 'UPDATE locationviewlogs SET viewed_user_id = ? WHERE viewed_user_id = ?',
                values: [trimmedUserId, currentUserId],
                description: 'locationviewlogs.viewed_user_id'
              }
            ];
            
            // 순차적으로 관련 테이블들 업데이트
            let updateIndex = 0;
            
            function updateNextTable() {
              if (updateIndex >= relatedTableUpdates.length) {
                // 모든 관련 테이블 업데이트 완료
                console.log('모든 관련 테이블 업데이트 완료');
                commitTransaction();
                return;
              }
              
              const updateInfo = relatedTableUpdates[updateIndex];
              console.log(`업데이트 중: ${updateInfo.description}`);
              
              db.query(updateInfo.sql, updateInfo.values, (err, result) => {
                if (err) {
                  console.error(`${updateInfo.description} 업데이트 오류:`, err);
                  return db.rollback(() => {
                    res.status(500).json({
                      success: false,
                      message: `관련 데이터 업데이트 중 오류가 발생했습니다: ${updateInfo.description}`
                    });
                  });
                }
                
                console.log(`${updateInfo.description} 업데이트 완료 - 영향받은 행: ${result.affectedRows}`);
                updateIndex++;
                updateNextTable();
              });
            }
            
            updateNextTable();
          } else {
            // 아이디 변경이 없으면 바로 커밋
            commitTransaction();
          }
          
          function commitTransaction() {
            // 트랜잭션 커밋
            db.commit((commitErr) => {
              if (commitErr) {
                console.error('트랜잭션 커밋 오류:', commitErr);
                return db.rollback(() => {
                  res.status(500).json({
                    success: false,
                    message: '변경사항 저장 중 오류가 발생했습니다.'
                  });
                });
              }
              
              console.log(`프로필 업데이트 성공 - 사용자: ${currentUserId}, 영향받은 행: ${result.affectedRows}`);
              
              res.status(200).json({
                success: true,
                message: '프로필이 성공적으로 업데이트되었습니다.',
                data: {
                  user_id: trimmedUserId || currentUserData.user_id,
                  user_nickname: trimmedNickname || currentUserData.user_nickname,
                  updated_fields: updatedFields
                }
              });
            });
          }
        });
      });
    });
    
  } catch (error) {
    console.error('프로필 업데이트 중 오류:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.'
    });
  }
});

// 비밀번호 변경 (실제 DB 컬럼명 사용)
router.post("/change-password", isValidToken, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const userId = req.user.user_id;
    
    console.log(`비밀번호 변경 요청 - 사용자 ID: ${userId}`);
    console.log(`현재 비밀번호 길이: ${current_password?.length}, 새 비밀번호 길이: ${new_password?.length}`);
    
    if (!current_password || !new_password) {
      return res.status(400).json({
        success: false,
        message: '현재 비밀번호와 새 비밀번호를 모두 입력해주세요.'
      });
    }
    
    // 새 비밀번호 유효성 검사
    if (new_password.length < 8) {
      return res.status(400).json({
        success: false,
        message: '새 비밀번호는 8자리 이상이어야 합니다.'
      });
    }
    
    const hasLetter = /[a-zA-Z]/.test(new_password);
    const hasNumber = /[0-9]/.test(new_password);
    
    if (!hasLetter || !hasNumber) {
      return res.status(400).json({
        success: false,
        message: '새 비밀번호는 문자와 숫자를 모두 포함해야 합니다.'
      });
    }
    
    // 현재 비밀번호와 동일한지 확인
    if (current_password === new_password) {
      return res.status(400).json({
        success: false,
        message: '새 비밀번호는 현재 비밀번호와 다르게 설정해주세요.'
      });
    }
    
    // 현재 사용자의 비밀번호 조회 (실제 컬럼명 사용)
    const sql = 'SELECT user_password FROM users WHERE user_id = ? AND user_status = "active"';
    
    db.query(sql, [userId], async (err, results) => {
      if (err) {
        console.error('사용자 비밀번호 조회 오류:', err);
        return res.status(500).json({
          success: false,
          message: '서버 오류가 발생했습니다.'
        });
      }
      
      if (results.length === 0) {
        console.error(`사용자를 찾을 수 없음: ${userId}`);
        return res.status(404).json({
          success: false,
          message: '사용자 정보를 찾을 수 없습니다.'
        });
      }
      
      const storedPasswordHash = results[0].user_password;
      console.log(`저장된 비밀번호 해시: ${storedPasswordHash?.substring(0, 20)}...`);
      console.log(`해시 형식: ${storedPasswordHash?.substring(0, 4)}`);
      
      try {
        // 현재 비밀번호 확인 (다양한 해시 방식 지원)
        const isCurrentPasswordValid = await comparePasswordMultipleFormats(current_password, storedPasswordHash);
        console.log(`현재 비밀번호 확인 결과: ${isCurrentPasswordValid}`);
        
        if (!isCurrentPasswordValid) {
          console.log('현재 비밀번호가 일치하지 않음');
          return res.status(401).json({
            success: false,
            message: '현재 비밀번호가 올바르지 않습니다.'
          });
        }
        
        // 새 비밀번호 해시화 (bcrypt 사용)
        const newPasswordHash = await hashPasswordWithBcrypt(new_password);
        
        // 비밀번호 업데이트 (실제 컬럼명 사용)
        const updateSql = 'UPDATE users SET user_password = ?, user_updated_at = NOW() WHERE user_id = ? AND user_status = "active"';
        
        db.query(updateSql, [newPasswordHash, userId], (updateErr, updateResult) => {
          if (updateErr) {
            console.error('비밀번호 업데이트 오류:', updateErr);
            return res.status(500).json({
              success: false,
              message: '비밀번호 변경 중 오류가 발생했습니다.'
            });
          }
          
          if (updateResult.affectedRows === 0) {
            console.error('비밀번호 업데이트 실패 - 영향받은 행 없음');
            return res.status(500).json({
              success: false,
              message: '비밀번호 변경에 실패했습니다.'
            });
          }
          
          console.log(`비밀번호 변경 성공 - 사용자: ${userId}`);
          
          res.status(200).json({
            success: true,
            message: '비밀번호가 성공적으로 변경되었습니다.'
          });
        });
        
      } catch (compareError) {
        console.error('비밀번호 비교 중 오류:', compareError);
        return res.status(500).json({
          success: false,
          message: '비밀번호 확인 중 오류가 발생했습니다.'
        });
      }
    });
    
  } catch (error) {
    console.error('비밀번호 변경 중 오류:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.'
    });
  }
});

module.exports = router;