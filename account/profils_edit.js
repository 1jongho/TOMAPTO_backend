// account/profils_edit.js - 수정된 버전
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

// 현재 프로필 정보 조회
router.get("/current", isValidToken, (req, res) => {
  try {
    const userId = req.user.user_id;
    
    console.log(`프로필 정보 조회 요청 - 사용자 ID: ${userId}`);
    
    const sql = `
      SELECT 
        user_id, 
        user_name,
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
          user_name: user.user_name,
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

// 닉네임 중복 확인 (강화된 유효성 검사)
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
    
    // 닉네임 유효성 검사 (강화된 버전)
    if (trimmedNickname.length < 2) {
      return res.status(200).json({
        available: false,
        message: '닉네임은 2자 이상이어야 합니다.'
      });
    }
    
    if (trimmedNickname.length > 20) {
      return res.status(200).json({
        available: false,
        message: '닉네임은 20자 이하여야 합니다.'
      });
    }
    
    // 특수문자 검사 (한글, 영문, 숫자, 일부 특수문자만 허용)
    const nicknameRegex = /^[가-힣a-zA-Z0-9._-]+$/;
    if (!nicknameRegex.test(trimmedNickname)) {
      return res.status(200).json({
        available: false,
        message: '한글, 영문, 숫자, 마침표(.), 하이픈(-), 언더스코어(_)만 사용 가능합니다.'
      });
    }
    
    // 공백 검사
    if (trimmedNickname.includes(' ')) {
      return res.status(200).json({
        available: false,
        message: '닉네임에는 공백을 사용할 수 없습니다.'
      });
    }
    
    // 연속된 특수문자 검사
    if (/[._-]{2,}/.test(trimmedNickname)) {
      return res.status(200).json({
        available: false,
        message: '특수문자는 연속으로 사용할 수 없습니다.'
      });
    }
    
    // 시작/끝 특수문자 검사
    if (/^[._-]|[._-]$/.test(trimmedNickname)) {
      return res.status(200).json({
        available: false,
        message: '닉네임은 특수문자로 시작하거나 끝날 수 없습니다.'
      });
    }
    
    // 금지 단어 검사
    const forbiddenWords = ['admin', '관리자', 'test', 'null', 'undefined'];
    const lowerNickname = trimmedNickname.toLowerCase();
    for (const word of forbiddenWords) {
      if (lowerNickname.includes(word)) {
        return res.status(200).json({
          available: false,
          message: '사용할 수 없는 닉네임입니다.'
        });
      }
    }
    
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

// 프로필 정보 업데이트 (닉네임만 허용)
router.put("/update", isValidToken, (req, res) => {
  try {
    const { new_nickname } = req.body; // 아이디 관련 필드 제거
    const currentUserId = req.user.user_id;
    
    console.log(`프로필 업데이트 요청 - 사용자: ${currentUserId}`, {
      new_nickname: new_nickname?.trim()
    });
    
    // 입력값 트림 처리
    const trimmedNickname = new_nickname?.trim();
    
    if (!trimmedNickname) {
      return res.status(400).json({
        success: false,
        message: '변경할 닉네임을 입력해주세요.'
      });
    }
    
    // 닉네임 유효성 재검사 (서버 사이드)
    if (trimmedNickname.length < 2 || trimmedNickname.length > 20) {
      return res.status(400).json({
        success: false,
        message: '닉네임은 2-20자 사이여야 합니다.'
      });
    }
    
    // 먼저 현재 사용자 정보 조회
    const getCurrentUserSql = `
      SELECT user_id, user_nickname, user_name 
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
      
      // 닉네임이 변경되지 않았다면
      if (trimmedNickname === currentUserData.user_nickname) {
        return res.status(200).json({
          success: true,
          message: '변경사항이 없습니다.',
          data: {
            user_id: currentUserData.user_id,
            user_nickname: currentUserData.user_nickname,
            user_name: currentUserData.user_name,
            updated_fields: {}
          }
        });
      }
      
      // 닉네임 중복 확인
      const checkDuplicateSql = "SELECT user_nickname FROM users WHERE user_nickname = ? AND user_status = 'active' AND user_id != ?";
      
      db.query(checkDuplicateSql, [trimmedNickname, currentUserId], (duplicateErr, duplicateResults) => {
        if (duplicateErr) {
          console.error('닉네임 중복 확인 오류:', duplicateErr);
          return res.status(500).json({
            success: false,
            message: '닉네임 중복 확인 중 오류가 발생했습니다.'
          });
        }
        
        if (duplicateResults.length > 0) {
          return res.status(400).json({
            success: false,
            message: '이미 사용 중인 닉네임입니다.'
          });
        }
        
        // 닉네임 업데이트 실행
        const updateSql = `UPDATE users SET user_nickname = ?, user_updated_at = NOW() WHERE user_id = ? AND user_status = 'active'`;
        
        console.log('업데이트 SQL:', updateSql);
        console.log('업데이트 값:', [trimmedNickname, currentUserId]);
        
        db.query(updateSql, [trimmedNickname, currentUserId], (updateErr, result) => {
          if (updateErr) {
            console.error('프로필 업데이트 오류:', updateErr);
            return res.status(500).json({
              success: false,
              message: '닉네임 변경 중 오류가 발생했습니다.',
              error: updateErr.message
            });
          }
          
          console.log('업데이트 결과:', result);
          
          if (result.affectedRows === 0) {
            return res.status(404).json({
              success: false,
              message: '사용자 정보를 찾을 수 없거나 업데이트되지 않았습니다.'
            });
          }
          
          console.log(`프로필 업데이트 성공 - 사용자: ${currentUserId}, 영향받은 행: ${result.affectedRows}`);
          
          res.status(200).json({
            success: true,
            message: '닉네임이 성공적으로 변경되었습니다.',
            data: {
              user_id: currentUserData.user_id,
              user_nickname: trimmedNickname,
              user_name: currentUserData.user_name,
              updated_fields: {
                nickname_changed: true
              }
            }
          });
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

// 비밀번호 변경
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
    
    // 현재 사용자의 비밀번호 조회
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
        
        // 비밀번호 업데이트
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