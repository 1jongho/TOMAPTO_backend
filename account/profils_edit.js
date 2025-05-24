// account/profile_edit.js
require("dotenv").config();
const express = require("express");
const router = express.Router();
const db = require("../db.js");
const { isValidToken } = require("../middleware/auth.js");

// 프로필 정보 조회 (현재 정보 확인용)
router.get("/current", isValidToken, (req, res) => {
  try {
    const userId = req.user.user_id;
    
    const sql = `
      SELECT user_id, user_nickname, user_email, user_name, 
             user_level, user_exp, user_created_at 
      FROM users 
      WHERE user_id = ? AND user_status = 'active'
    `;
    
    db.query(sql, [userId], (err, results) => {
      if (err) {
        console.error('프로필 조회 오류:', err);
        return res.status(500).json({ 
          success: false, 
          message: '서버 오류가 발생했습니다.' 
        });
      }
      
      if (results.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: '사용자를 찾을 수 없습니다.' 
        });
      }
      
      const user = results[0];
      res.status(200).json({
        success: true,
        data: {
          user_id: user.user_id,
          user_nickname: user.user_nickname,
          user_email: user.user_email,
          user_name: user.user_name,
          user_level: user.user_level,
          user_exp: user.user_exp,
          user_created_at: user.user_created_at
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

// 아이디 중복 확인
router.post("/check-userid", isValidToken, (req, res) => {
  try {
    const { new_user_id } = req.body;
    const currentUserId = req.user.user_id;
    
    if (!new_user_id) {
      return res.status(400).json({ 
        success: false, 
        message: '새 아이디가 필요합니다.' 
      });
    }
    
    // 아이디 유효성 검사
    const userIdRegex = /^[a-zA-Z0-9_]{4,20}$/;
    if (!userIdRegex.test(new_user_id)) {
      return res.status(400).json({ 
        success: false, 
        message: '아이디는 4-20자의 영문, 숫자, 언더스코어만 사용 가능합니다.' 
      });
    }
    
    // 현재 사용자의 아이디와 같다면 사용 가능
    if (new_user_id === currentUserId) {
      return res.status(200).json({ 
        success: true, 
        available: true,
        message: '현재 아이디입니다.' 
      });
    }
    
    // 다른 사용자가 사용중인지 확인
    const sql = 'SELECT user_id FROM users WHERE user_id = ? AND user_status = "active"';
    
    db.query(sql, [new_user_id], (err, results) => {
      if (err) {
        console.error('아이디 중복 확인 오류:', err);
        return res.status(500).json({ 
          success: false, 
          message: '서버 오류가 발생했습니다.' 
        });
      }
      
      const isAvailable = results.length === 0;
      
      res.status(200).json({
        success: true,
        available: isAvailable,
        message: isAvailable ? '사용 가능한 아이디입니다.' : '이미 사용중인 아이디입니다.'
      });
    });
  } catch (error) {
    console.error('아이디 중복 확인 중 오류:', error);
    res.status(500).json({ 
      success: false, 
      message: '서버 오류가 발생했습니다.' 
    });
  }
});

// 닉네임 중복 확인
router.post("/check-nickname", isValidToken, (req, res) => {
  try {
    const { new_nickname } = req.body;
    const currentUserId = req.user.user_id;
    
    if (!new_nickname) {
      return res.status(400).json({ 
        success: false, 
        message: '새 닉네임이 필요합니다.' 
      });
    }
    
    // 닉네임 유효성 검사
    if (new_nickname.length < 2 || new_nickname.length > 20) {
      return res.status(400).json({ 
        success: false, 
        message: '닉네임은 2-20자 사이여야 합니다.' 
      });
    }
    
    // 현재 사용자의 닉네임 확인
    const currentNicknameSql = 'SELECT user_nickname FROM users WHERE user_id = ?';
    
    db.query(currentNicknameSql, [currentUserId], (err, currentResults) => {
      if (err) {
        console.error('현재 닉네임 조회 오류:', err);
        return res.status(500).json({ 
          success: false, 
          message: '서버 오류가 발생했습니다.' 
        });
      }
      
      if (currentResults.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: '사용자를 찾을 수 없습니다.' 
        });
      }
      
      // 현재 사용자의 닉네임과 같다면 사용 가능
      if (new_nickname === currentResults[0].user_nickname) {
        return res.status(200).json({ 
          success: true, 
          available: true,
          message: '현재 닉네임입니다.' 
        });
      }
      
      // 다른 사용자가 사용중인지 확인
      const sql = 'SELECT user_nickname FROM users WHERE user_nickname = ? AND user_status = "active"';
      
      db.query(sql, [new_nickname], (err, results) => {
        if (err) {
          console.error('닉네임 중복 확인 오류:', err);
          return res.status(500).json({ 
            success: false, 
            message: '서버 오류가 발생했습니다.' 
          });
        }
        
        const isAvailable = results.length === 0;
        
        res.status(200).json({
          success: true,
          available: isAvailable,
          message: isAvailable ? '사용 가능한 닉네임입니다.' : '이미 사용중인 닉네임입니다.'
        });
      });
    });
  } catch (error) {
    console.error('닉네임 중복 확인 중 오류:', error);
    res.status(500).json({ 
      success: false, 
      message: '서버 오류가 발생했습니다.' 
    });
  }
});

// 프로필 업데이트
router.put("/update", isValidToken, (req, res) => {
  try {
    const { new_user_id, new_nickname } = req.body;
    const currentUserId = req.user.user_id;
    
    if (!new_user_id && !new_nickname) {
      return res.status(400).json({ 
        success: false, 
        message: '변경할 정보가 없습니다.' 
      });
    }
    
    // 유효성 검사
    if (new_user_id) {
      const userIdRegex = /^[a-zA-Z0-9_]{4,20}$/;
      if (!userIdRegex.test(new_user_id)) {
        return res.status(400).json({ 
          success: false, 
          message: '아이디는 4-20자의 영문, 숫자, 언더스코어만 사용 가능합니다.' 
        });
      }
    }
    
    if (new_nickname) {
      if (new_nickname.length < 2 || new_nickname.length > 20) {
        return res.status(400).json({ 
          success: false, 
          message: '닉네임은 2-20자 사이여야 합니다.' 
        });
      }
    }
    
    // 현재 사용자 정보 조회
    const getCurrentUserSql = 'SELECT user_id, user_nickname FROM users WHERE user_id = ?';
    
    db.query(getCurrentUserSql, [currentUserId], (err, currentUserResults) => {
      if (err) {
        console.error('현재 사용자 조회 오류:', err);
        return res.status(500).json({ 
          success: false, 
          message: '서버 오류가 발생했습니다.' 
        });
      }
      
      if (currentUserResults.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: '사용자를 찾을 수 없습니다.' 
        });
      }
      
      const currentUser = currentUserResults[0];
      
      // 중복 확인
      let checkPromises = [];
      
      // 아이디 중복 확인 (변경하려는 아이디가 현재 아이디와 다를 때만)
      if (new_user_id && new_user_id !== currentUser.user_id) {
        const userIdPromise = new Promise((resolve, reject) => {
          const sql = 'SELECT user_id FROM users WHERE user_id = ? AND user_status = "active"';
          db.query(sql, [new_user_id], (err, results) => {
            if (err) reject(err);
            else resolve({ type: 'user_id', available: results.length === 0 });
          });
        });
        checkPromises.push(userIdPromise);
      }
      
      // 닉네임 중복 확인 (변경하려는 닉네임이 현재 닉네임과 다를 때만)
      if (new_nickname && new_nickname !== currentUser.user_nickname) {
        const nicknamePromise = new Promise((resolve, reject) => {
          const sql = 'SELECT user_nickname FROM users WHERE user_nickname = ? AND user_status = "active"';
          db.query(sql, [new_nickname], (err, results) => {
            if (err) reject(err);
            else resolve({ type: 'nickname', available: results.length === 0 });
          });
        });
        checkPromises.push(nicknamePromise);
      }
      
      // 중복 확인 실행
      Promise.all(checkPromises)
        .then(checks => {
          // 중복 확인 결과 검사
          for (let check of checks) {
            if (!check.available) {
              const message = check.type === 'user_id' 
                ? '이미 사용중인 아이디입니다.' 
                : '이미 사용중인 닉네임입니다.';
              return res.status(400).json({ 
                success: false, 
                message: message 
              });
            }
          }
          
          // 업데이트 쿼리 생성
          let updateFields = [];
          let updateValues = [];
          
          if (new_user_id && new_user_id !== currentUser.user_id) {
            updateFields.push('user_id = ?');
            updateValues.push(new_user_id);
          }
          
          if (new_nickname && new_nickname !== currentUser.user_nickname) {
            updateFields.push('user_nickname = ?');
            updateValues.push(new_nickname);
          }
          
          if (updateFields.length === 0) {
            return res.status(200).json({ 
              success: true, 
              message: '변경사항이 없습니다.',
              data: {
                user_id: currentUser.user_id,
                user_nickname: currentUser.user_nickname
              }
            });
          }
          
          // user_updated_at 필드 추가
          updateFields.push('user_updated_at = NOW()');
          updateValues.push(currentUserId); // WHERE 절용
          
          const updateSql = `UPDATE users SET ${updateFields.join(', ')} WHERE user_id = ?`;
          
          db.query(updateSql, updateValues, (err, updateResult) => {
            if (err) {
              console.error('프로필 업데이트 오류:', err);
              return res.status(500).json({ 
                success: false, 
                message: '프로필 업데이트에 실패했습니다.' 
              });
            }
            
            if (updateResult.affectedRows === 0) {
              return res.status(404).json({ 
                success: false, 
                message: '사용자를 찾을 수 없습니다.' 
              });
            }
            
            console.log(`프로필 업데이트 완료: ${currentUserId} -> ${new_user_id || currentUser.user_id}`);
            
            // 업데이트된 정보 반환
            res.status(200).json({
              success: true,
              message: '프로필이 성공적으로 업데이트되었습니다.',
              data: {
                user_id: new_user_id || currentUser.user_id,
                user_nickname: new_nickname || currentUser.user_nickname,
                updated_fields: {
                  user_id_changed: !!(new_user_id && new_user_id !== currentUser.user_id),
                  nickname_changed: !!(new_nickname && new_nickname !== currentUser.user_nickname)
                }
              }
            });
          });
        })
        .catch(error => {
          console.error('중복 확인 중 오류:', error);
          res.status(500).json({ 
            success: false, 
            message: '서버 오류가 발생했습니다.' 
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

module.exports = router;