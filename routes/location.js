// routes/location.js - heading, accuracy만 제거한 원본 유지 버전
const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');

// 인증 미들웨어
const auth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || '7belly_fat4');
    req.user = {
      user_id: decoded.user_id,
      user_nickname: decoded.user_nickname || ''
    };
    
    next();
  } catch (error) {
    console.error('인증 오류:', error);
    return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }
};

// 위치 업데이트 API
router.post('/update', auth, (req, res) => {
  const { latitude, longitude } = req.body;
  const user_id = req.user.user_id;

  if (!latitude || !longitude) {
    return res.status(400).json({ error: '위도와 경도는 필수 입력값입니다.' });
  }

  console.log(`위치 업데이트 요청 - 사용자: ${user_id}, 위치: ${latitude}, ${longitude}`);

  // 먼저 기존 위치 정보가 있는지 확인
  const checkLocationSQL = 'SELECT * FROM Location WHERE user_id = ?';
  
  db.query(checkLocationSQL, [user_id], (err, result) => {
    if (err) {
      console.error('위치 정보 조회 실패:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }

    let sql, params;
    
    if (result.length > 0) {
      // 기존 위치 정보 업데이트
      sql = `
        UPDATE Location 
        SET latitude = ?, longitude = ?, updated_at = NOW() 
        WHERE user_id = ?
      `;
      params = [latitude, longitude, user_id];
      console.log(`기존 위치 정보 업데이트 - 사용자: ${user_id}`);
    } else {
      // 새 위치 정보 삽입
      sql = `
        INSERT INTO Location (user_id, latitude, longitude, updated_at) 
        VALUES (?, ?, ?, NOW())
      `;
      params = [user_id, latitude, longitude];
      console.log(`새 위치 정보 생성 - 사용자: ${user_id}`);
    }

    db.query(sql, params, (err, updateResult) => {
      if (err) {
        console.error('위치 업데이트 실패:', err);
        return res.status(500).json({ error: '위치 업데이트에 실패했습니다.' });
      }

      console.log(`위치 업데이트 성공 - 사용자: ${user_id}`);
      
      res.status(200).json({
        success: true,
        message: '위치가 업데이트되었습니다.',
        user_id: user_id,
        latitude: latitude,
        longitude: longitude,
        updated_at: new Date().toISOString()
      });
    });
  });
});

// 친구 위치 조회 API
router.get('/friend/:friendId', auth, (req, res) => {
  const user_id = req.user.user_id;
  const friend_id = req.params.friendId;

  console.log(`친구 위치 조회 요청 - 요청자: ${user_id}, 대상: ${friend_id}`);

  // 1. 친구 관계가 존재하는지 확인
  const checkFriendshipSQL = `
    SELECT * FROM Friendships 
    WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
    AND status = 'active'
    AND ((user_id_1 = ? AND is_blocked_by_user_1 = 0) OR (user_id_2 = ? AND is_blocked_by_user_2 = 0))
  `;

  db.query(checkFriendshipSQL, [user_id, friend_id, friend_id, user_id, user_id, user_id], (err, friendResult) => {
    if (err) {
      console.error('친구 관계 조회 실패:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }

    if (friendResult.length === 0) {
      return res.status(403).json({ error: '친구 관계가 없거나 차단된 사용자입니다.' });
    }

    // 2. 친구가 나에게 위치 공유 중인지 확인 (단방향)
    const checkSharingSQL = `
      SELECT * FROM LocationSharing 
      WHERE sharer_id = ? AND sharee_id = ?
      AND status = 'active'
      AND (end_time IS NULL OR end_time > NOW())
    `;

    db.query(checkSharingSQL, [friend_id, user_id], (err, sharingResult) => {
      if (err) {
        console.error('위치 공유 관계 조회 실패:', err);
        return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
      }

      if (sharingResult.length === 0) {
        return res.status(403).json({ error: '친구가 위치를 공유하고 있지 않습니다.' });
      }

      // 3. 친구의 최신 위치 조회
      const getLocationSQL = `
        SELECT l.user_id, l.latitude, l.longitude, 
               l.updated_at, u.user_nickname
        FROM Location l
        JOIN Users u ON l.user_id = u.user_id
        WHERE l.user_id = ?
      `;

      db.query(getLocationSQL, [friend_id], (err, locationResult) => {
        if (err) {
          console.error('위치 조회 실패:', err);
          return res.status(500).json({ error: '위치 조회에 실패했습니다.' });
        }

        if (locationResult.length === 0) {
          return res.status(404).json({ error: '친구의 위치 정보가 없습니다.' });
        }

        console.log('친구 위치 조회 성공');
        
        res.status(200).json(locationResult[0]);
      });
    });
  });
});

// 위치 공유 시작 API
router.post('/share', auth, (req, res) => {
  const { friend_id, duration_minutes } = req.body;
  const user_id = req.user.user_id;

  if (!friend_id) {
    return res.status(400).json({ error: '친구 ID는 필수 입력값입니다.' });
  }

  console.log(`위치 공유 시작 요청 - 사용자: ${user_id} -> ${friend_id}, 기간: ${duration_minutes || '무제한'}`);

  // 1. 친구 관계가 존재하는지 확인
  const checkFriendshipSQL = `
    SELECT * FROM Friendships 
    WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
    AND status = 'active'
  `;

  db.query(checkFriendshipSQL, [user_id, friend_id, friend_id, user_id], (err, friendResult) => {
    if (err) {
      console.error('친구 관계 조회 실패:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }

    if (friendResult.length === 0) {
      return res.status(403).json({ error: '친구 관계가 없는 사용자입니다.' });
    }

    // 2. 이미 활성화된 위치 공유가 있는지 확인 (단방향만)
    const checkActiveSharingSQL = `
      SELECT * FROM LocationSharing 
      WHERE sharer_id = ? AND sharee_id = ?
      AND status = 'active'
      AND (end_time IS NULL OR end_time > NOW())
    `;

    db.query(checkActiveSharingSQL, [user_id, friend_id], (err, activeSharingResult) => {
      if (err) {
        console.error('활성 위치 공유 조회 실패:', err);
        return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
      }

      let endTime = null;
      if (duration_minutes) {
        const now = new Date();
        endTime = new Date(now.getTime() + duration_minutes * 60000);
      }
      
      if (activeSharingResult.length > 0) {
        // 이미 해당 방향으로 활성화된 위치 공유가 있으면 업데이트
        const sharingId = activeSharingResult[0].sharing_id;
        const updateSQL = `
          UPDATE LocationSharing 
          SET status = 'active', end_time = ?, start_time = NOW()
          WHERE sharing_id = ?
        `;
        
        db.query(updateSQL, [endTime, sharingId], (err, result) => {
          if (err) {
            console.error('위치 공유 업데이트 오류:', err);
            return res.status(500).json({ error: '위치 공유 설정에 실패했습니다.' });
          }
          
          console.log(`위치 공유 업데이트 성공: ${user_id} -> ${friend_id}`);
          res.status(200).json({ 
            success: true,
            message: '위치 공유가 설정되었습니다.',
            duration_minutes: duration_minutes,
            end_time: endTime ? endTime.toISOString() : null
          });
        });
      } else {
        // 특정 방향으로만 새 위치 공유 생성
        const insertSQL = `
          INSERT INTO LocationSharing (sharer_id, sharee_id, status, start_time, end_time) 
          VALUES (?, ?, 'active', NOW(), ?)
        `;
        
        db.query(insertSQL, [user_id, friend_id, endTime], (err, result) => {
          if (err) {
            console.error('위치 공유 생성 오류:', err);
            return res.status(500).json({ error: '위치 공유 설정에 실패했습니다.' });
          }
          
          console.log(`위치 공유 설정 성공: ${user_id} -> ${friend_id}`);
          res.status(200).json({ 
            success: true,
            message: '위치 공유가 설정되었습니다.',
            duration_minutes: duration_minutes,
            end_time: endTime ? endTime.toISOString() : null
          });
        });
      }
    });
  });
});

// 위치 공유 종료 API
router.post('/end-sharing', auth, (req, res) => {
  const { friend_id } = req.body;
  const user_id = req.user.user_id;

  if (!friend_id) {
    return res.status(400).json({ error: '친구 ID는 필수 입력값입니다.' });
  }

  console.log(`위치 공유 종료 요청 - 사용자: ${user_id} -> ${friend_id}`);

  // 단방향으로만 현재의 공유 상태를 확인
  const checkSharingSQL = `
    SELECT * FROM LocationSharing
    WHERE sharer_id = ? AND sharee_id = ?
    AND status = 'active'
    AND (end_time IS NULL OR end_time > NOW())
  `;
  
  db.query(checkSharingSQL, [user_id, friend_id], (err, sharingResults) => {
    if (err) {
      console.error('위치 공유 상태 확인 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    if (sharingResults.length === 0) {
      return res.status(404).json({ error: '활성화된 위치 공유를 찾을 수 없습니다.' });
    }

    // 특정 방향의 위치 공유만 비활성화
    const sql = `
      UPDATE LocationSharing
      SET status = 'inactive', end_time = NOW()
      WHERE sharer_id = ? AND sharee_id = ?
      AND status = 'active'
    `;

    db.query(sql, [user_id, friend_id], (err, result) => {
      if (err) {
        console.error('위치 공유 종료 실패:', err);
        return res.status(500).json({ error: '위치 공유 종료에 실패했습니다.' });
      }
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: '위치 공유 종료 실패: 업데이트된 레코드가 없습니다.' });
      }
      
      console.log(`위치 공유 종료 완료: ${user_id} -> ${friend_id}`);
      res.status(200).json({ 
        success: true,
        message: '위치 공유가 종료되었습니다.' 
      });
    });
  });
});

// 내 모든 활성 위치 공유 목록 조회 API
router.get('/active-sharings', auth, (req, res) => {
  const user_id = req.user.user_id;

  const sql = `
    SELECT ls.*, 
           u1.user_nickname as sharer_nickname,
           u2.user_nickname as sharee_nickname
    FROM LocationSharing ls
    JOIN Users u1 ON ls.sharer_id = u1.user_id
    JOIN Users u2 ON ls.sharee_id = u2.user_id
    WHERE (ls.sharer_id = ? OR ls.sharee_id = ?)
    AND ls.status = 'active'
    AND (ls.end_time IS NULL OR ls.end_time > NOW())
  `;

  db.query(sql, [user_id, user_id], (err, result) => {
    if (err) {
      console.error('위치 공유 목록 조회 실패:', err);
      return res.status(500).json({ error: '위치 공유 목록 조회에 실패했습니다.' });
    }
    
    res.status(200).json(result);
  });
});

module.exports = router;