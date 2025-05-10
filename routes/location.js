// routes/location.js - 수정된 버전
const express = require('express');
const db = require('../db'); // DB 연결 파일
const router = express.Router();
const jwt = require('jsonwebtoken');

// 인증 미들웨어 - 토큰을 검증하고 사용자 정보를 req에 추가
const auth = (req, res, next) => {
  try {
    // 헤더에서 토큰 추출
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
    }
    
    // 토큰 검증
    const decoded = jwt.verify(token, process.env.JWT_SECRET || '7belly_fat4');
    
    // 요청 객체에 사용자 정보 추가
    req.user = {
      user_id: decoded.user_id
    };
    
    next();
  } catch (error) {
    console.error('인증 오류:', error);
    return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }
};

// API 상태 확인 엔드포인트 (디버깅용)
router.get('/status', auth, (req, res) => {
  res.status(200).json({
    success: true,
    message: '위치 API 서버가 정상 작동 중입니다.',
    user_id: req.user.user_id,
    timestamp: new Date().toISOString()
  });
});

// 내 위치 업데이트 API
router.post('/update', auth, (req, res) => {
  const { latitude, longitude, accuracy, heading } = req.body;
  const user_id = req.user.user_id; // 인증 미들웨어에서 받은 유저 정보

  console.log(`위치 업데이트 요청 - 사용자: ${user_id}, 위치: ${latitude}, ${longitude}`);

  if (!latitude || !longitude) {
    return res.status(400).json({ error: '위도와 경도는 필수 입력값입니다.' });
  }

  // 먼저 사용자의 위치 정보가 이미 존재하는지 확인
  const checkSQL = `SELECT location_id FROM Location WHERE user_id = ?`;
  
  db.query(checkSQL, [user_id], (err, result) => {
    if (err) {
      console.error('위치 정보 조회 실패:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    // 위치 정보가 있으면 업데이트, 없으면 삽입
    let sql, params;
    
    if (result && result.length > 0) {
      console.log(`기존 위치 정보 업데이트 - 사용자: ${user_id}`);
      sql = `
        UPDATE Location 
        SET latitude = ?, longitude = ?, accuracy = ?, heading = ?, updated_at = NOW() 
        WHERE user_id = ?
      `;
      params = [latitude, longitude, accuracy || 0, heading || 0, user_id];
    } else {
      console.log(`새 위치 정보 생성 - 사용자: ${user_id}`);
      sql = `
        INSERT INTO Location (user_id, latitude, longitude, accuracy, heading, updated_at) 
        VALUES (?, ?, ?, ?, ?, NOW())
      `;
      params = [user_id, latitude, longitude, accuracy || 0, heading || 0];
    }
    
    db.query(sql, params, (err, result) => {
      if (err) {
        console.error('위치 업데이트 실패:', err);
        return res.status(500).json({ error: '위치 업데이트에 실패했습니다.' });
      }
      
      // 위치 히스토리 추가
      const historySQL = `
        INSERT INTO LocationHistory (user_id, latitude, longitude, accuracy, heading, created_at) 
        VALUES (?, ?, ?, ?, ?, NOW())
      `;
      
      db.query(historySQL, [user_id, latitude, longitude, accuracy || 0, heading || 0], (histErr) => {
        if (histErr) {
          console.error('위치 히스토리 저장 실패:', histErr);
          // 히스토리 저장 실패는 오류로 처리하지 않고 로그만 남김
        } else {
          console.log(`위치 히스토리 저장 성공 - 사용자: ${user_id}`);
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
});

// 친구 위치 조회 API
router.get('/friend/:friendId', auth, (req, res) => {
  const user_id = req.user.user_id;
  const friend_id = req.params.friendId;

  // 1. 먼저 친구 관계가 존재하는지 확인
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

    // 2. 위치 공유 관계가 활성화되어 있는지 확인
    const checkSharingSQL = `
      SELECT * FROM LocationSharing 
      WHERE ((sharer_id = ? AND sharee_id = ?) OR (sharer_id = ? AND sharee_id = ?))
      AND status = 'active'
      AND (end_time IS NULL OR end_time > NOW())
    `;

    db.query(checkSharingSQL, [user_id, friend_id, friend_id, user_id], (err, sharingResult) => {
      if (err) {
        console.error('위치 공유 관계 조회 실패:', err);
        return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
      }

      if (sharingResult.length === 0) {
        return res.status(403).json({ error: '위치 공유 관계가 없습니다.' });
      }

      // 3. 친구의 최신 위치 조회
      const getLocationSQL = `
        SELECT l.user_id, l.latitude, l.longitude, l.accuracy, l.heading, 
               l.location_name, l.updated_at, u.user_nickname
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

        // 위치 조회 로그 저장
        const logViewSQL = `
          INSERT INTO LocationViewLogs (viewer_id, viewed_user_id, viewed_at)
          VALUES (?, ?, NOW())
        `;
        
        db.query(logViewSQL, [user_id, friend_id], (logErr) => {
          if (logErr) {
            console.error('위치 조회 로그 저장 실패:', logErr);
            // 로그 저장 실패는 오류로 처리하지 않음
          }
          
          res.status(200).json(locationResult[0]);
        });
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

    // 2. 이미 활성화된 위치 공유가 있는지 확인
    const checkActiveSharingSQL = `
      SELECT * FROM LocationSharing 
      WHERE ((sharer_id = ? AND sharee_id = ?) OR (sharer_id = ? AND sharee_id = ?))
      AND status = 'active'
      AND (end_time IS NULL OR end_time > NOW())
    `;

    db.query(checkActiveSharingSQL, [user_id, friend_id, friend_id, user_id], (err, activeSharingResult) => {
      if (err) {
        console.error('활성 위치 공유 조회 실패:', err);
        return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
      }

      let endTime = null;
      if (duration_minutes) {
        // 현재 시간에 duration_minutes 분을 더해서 종료 시간 계산
        const now = new Date();
        endTime = new Date(now.getTime() + duration_minutes * 60000); // 밀리초로 변환
      }

      let sql, params;
      
      if (activeSharingResult.length > 0) {
        // 이미 활성화된 위치 공유가 있으면 업데이트
        const sharingId = activeSharingResult[0].sharing_id;
        sql = `
          UPDATE LocationSharing 
          SET end_time = ?, updated_at = NOW() 
          WHERE sharing_id = ?
        `;
        params = [endTime, sharingId];
      } else {
        // 새 위치 공유 생성
        sql = `
          INSERT INTO LocationSharing (sharer_id, sharee_id, status, start_time, end_time, created_at, updated_at) 
          VALUES (?, ?, 'active', NOW(), ?, NOW(), NOW())
        `;
        params = [user_id, friend_id, endTime];
      }

      db.query(sql, params, (err, result) => {
        if (err) {
          console.error('위치 공유 설정 실패:', err);
          return res.status(500).json({ error: '위치 공유 설정에 실패했습니다.' });
        }

        res.status(200).json({ 
          success: true,
          message: '위치 공유가 설정되었습니다.',
          duration_minutes: duration_minutes,
          end_time: endTime ? endTime.toISOString() : null
        });
      });
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

  const sql = `
    UPDATE LocationSharing
    SET status = 'inactive', end_time = NOW(), updated_at = NOW()
    WHERE ((sharer_id = ? AND sharee_id = ?) OR (sharer_id = ? AND sharee_id = ?))
    AND status = 'active'
  `;

  db.query(sql, [user_id, friend_id, friend_id, user_id], (err, result) => {
    if (err) {
      console.error('위치 공유 종료 실패:', err);
      return res.status(500).json({ error: '위치 공유 종료에 실패했습니다.' });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '활성화된 위치 공유가 없습니다.' });
    }
    
    res.status(200).json({ message: '위치 공유가 종료되었습니다.' });
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

// 위치 히스토리 조회 API
router.get('/history/:friendId', auth, (req, res) => {
  const user_id = req.user.user_id;
  const friend_id = req.params.friendId;
  const limit = parseInt(req.query.limit) || 20; // 기본값 20개

  // 1. 먼저 친구 관계가 존재하는지 확인
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

    // 2. 친구의 위치 히스토리 조회
    const locationHistorySQL = `
      SELECT lh.*, u.user_nickname
      FROM LocationHistory lh
      JOIN Users u ON lh.user_id = u.user_id
      WHERE lh.user_id = ?
      ORDER BY lh.created_at DESC
      LIMIT ?
    `;

    db.query(locationHistorySQL, [friend_id, limit], (err, historyResult) => {
      if (err) {
        console.error('위치 히스토리 조회 실패:', err);
        return res.status(500).json({ error: '위치 히스토리 조회에 실패했습니다.' });
      }

      res.status(200).json(historyResult);
    });
  });
});

module.exports = router;