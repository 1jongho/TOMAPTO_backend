// routes/follow.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // '../config/database' -> '../db'로 수정
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
      user_id: decoded.user_id,
      user_nickname: decoded.user_nickname || ''
    };
    
    next();
  } catch (error) {
    console.error('인증 오류:', error);
    return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }
};

// 따라가기 요청 보내기 API
router.post('/request', auth, (req, res) => {
  const { friend_id } = req.body;
  const user_id = req.user.user_id;

  if (!friend_id) {
    return res.status(400).json({ error: '친구 ID는 필수 입력값입니다.' });
  }

  if (user_id === friend_id) {
    return res.status(400).json({ error: '자기 자신에게는 따라가기 요청을 할 수 없습니다.' });
  }

  // 1. 친구 관계 확인
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

    // 2. 위치 공유 관계 확인
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

      // 3. 기존 요청 확인 (중복 방지)
      const checkExistingSQL = `
        SELECT * FROM FollowRequests 
        WHERE requester_id = ? AND target_id = ? AND status IN ('pending', 'accepted')
      `;

      db.query(checkExistingSQL, [user_id, friend_id], (err, existingResult) => {
        if (err) {
          console.error('기존 요청 조회 실패:', err);
          return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
        }

        if (existingResult.length > 0) {
          const existingStatus = existingResult[0].status;
          if (existingStatus === 'pending') {
            return res.status(409).json({ error: '이미 따라가기 요청을 보냈습니다.' });
          } else if (existingStatus === 'accepted') {
            return res.status(409).json({ error: '이미 따라가기중입니다.' });
          }
        }

        // 4. 새 요청 생성
        const insertSQL = `
          INSERT INTO FollowRequests (requester_id, target_id, status)
          VALUES (?, ?, 'pending')
        `;

        db.query(insertSQL, [user_id, friend_id], (err, result) => {
          if (err) {
            console.error('따라가기 요청 생성 실패:', err);
            return res.status(500).json({ error: '따라가기 요청 생성에 실패했습니다.' });
          }

          // 5. 소켓을 통해 상대방에게 알림 전송
          const io = req.app.get('io');
          if (io) {
            io.emit('follow_request_received', {
              request_id: result.insertId,
              requester_id: user_id,
              requester_name: req.user.user_nickname,
              target_id: friend_id
            });
          }

          res.status(200).json({ 
            success: true,
            message: '따라가기 요청을 보냈습니다.',
            request_id: result.insertId
          });
        });
      });
    });
  });
});

// 따라가기 요청 응답 API (수락/거절)
router.post('/respond', auth, (req, res) => {
  const { request_id, response } = req.body; // response: 'accept' or 'reject'
  const user_id = req.user.user_id;

  if (!request_id || !response) {
    return res.status(400).json({ error: '요청 ID와 응답은 필수 입력값입니다.' });
  }

  if (!['accept', 'reject'].includes(response)) {
    return res.status(400).json({ error: '올바르지 않은 응답입니다.' });
  }

  // 1. 요청 확인
  const checkRequestSQL = `
    SELECT fr.*, u.user_nickname as requester_name
    FROM FollowRequests fr
    JOIN Users u ON fr.requester_id = u.user_id
    WHERE fr.follow_request_id = ? AND fr.target_id = ? AND fr.status = 'pending'
  `;

  db.query(checkRequestSQL, [request_id, user_id], (err, requestResult) => {
    if (err) {
      console.error('요청 조회 실패:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }

    if (requestResult.length === 0) {
      return res.status(404).json({ error: '유효하지 않은 요청입니다.' });
    }

    const request = requestResult[0];
    const newStatus = response === 'accept' ? 'accepted' : 'cancelled';

    // 2. 요청 상태 업데이트
    const updateSQL = `
      UPDATE FollowRequests 
      SET status = ?
      WHERE follow_request_id = ?
    `;

    db.query(updateSQL, [newStatus, request_id], (err, result) => {
      if (err) {
        console.error('요청 상태 업데이트 실패:', err);
        return res.status(500).json({ error: '요청 처리에 실패했습니다.' });
      }

      // 3. 소켓을 통해 요청자에게 응답 알림
      const io = req.app.get('io');
      if (io) {
        io.emit('follow_request_responded', {
          request_id: request_id,
          requester_id: request.requester_id,
          target_id: user_id,
          target_name: req.user.user_nickname,
          response: response,
          status: newStatus
        });
      }

      const message = response === 'accept' ? 
        '따라가기 요청을 수락했습니다.' : 
        '따라가기 요청을 거절했습니다.';

      res.status(200).json({ 
        success: true,
        message: message,
        status: newStatus
      });
    });
  });
});

// 따라가기 요청 취소 API
router.post('/cancel', auth, (req, res) => {
  const { friend_id } = req.body;
  const user_id = req.user.user_id;

  if (!friend_id) {
    return res.status(400).json({ error: '친구 ID는 필수 입력값입니다.' });
  }

  // 1. 진행 중인 요청 확인
  const checkRequestSQL = `
    SELECT * FROM FollowRequests 
    WHERE requester_id = ? AND target_id = ? AND status IN ('pending', 'accepted')
  `;

  db.query(checkRequestSQL, [user_id, friend_id], (err, requestResult) => {
    if (err) {
      console.error('요청 조회 실패:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }

    if (requestResult.length === 0) {
      return res.status(404).json({ error: '취소할 요청이 없습니다.' });
    }

    const request = requestResult[0];

    // 2. 요청 취소 (상태를 cancelled로 변경)
    const cancelSQL = `
      UPDATE FollowRequests 
      SET status = 'cancelled'
      WHERE follow_request_id = ?
    `;

    db.query(cancelSQL, [request.follow_request_id], (err, result) => {
      if (err) {
        console.error('요청 취소 실패:', err);
        return res.status(500).json({ error: '요청 취소에 실패했습니다.' });
      }

      // 3. 소켓을 통해 상대방에게 취소 알림
      const io = req.app.get('io');
      if (io) {
        io.emit('follow_request_cancelled', {
          request_id: request.follow_request_id,
          requester_id: user_id,
          requester_name: req.user.user_nickname,
          target_id: friend_id
        });
      }

      res.status(200).json({ 
        success: true,
        message: '따라가기 요청을 취소했습니다.'
      });
    });
  });
});

// 따라가기 중단 API (수락된 상태에서 중단)
router.post('/stop', auth, (req, res) => {
  const { friend_id } = req.body;
  const user_id = req.user.user_id;

  if (!friend_id) {
    return res.status(400).json({ error: '친구 ID는 필수 입력값입니다.' });
  }

  // 1. 진행 중인 따라가기 확인 (양방향 확인)
  const checkFollowSQL = `
    SELECT * FROM FollowRequests 
    WHERE ((requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?))
    AND status = 'accepted'
  `;

  db.query(checkFollowSQL, [user_id, friend_id, friend_id, user_id], (err, followResult) => {
    if (err) {
      console.error('따라가기 상태 조회 실패:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }

    if (followResult.length === 0) {
      return res.status(404).json({ error: '진행 중인 따라가기가 없습니다.' });
    }

    const followRequest = followResult[0];

    // 2. 따라가기 중단 (상태를 cancelled로 변경)
    const stopSQL = `
      UPDATE FollowRequests 
      SET status = 'cancelled'
      WHERE follow_request_id = ?
    `;

    db.query(stopSQL, [followRequest.follow_request_id], (err, result) => {
      if (err) {
        console.error('따라가기 중단 실패:', err);
        return res.status(500).json({ error: '따라가기 중단에 실패했습니다.' });
      }

      // 3. 소켓을 통해 상대방에게 중단 알림
      const io = req.app.get('io');
      if (io) {
        const otherUserId = followRequest.requester_id === user_id ? 
          followRequest.target_id : followRequest.requester_id;

        io.emit('follow_stopped', {
          request_id: followRequest.follow_request_id,
          stopped_by: user_id,
          stopped_by_name: req.user.user_nickname,
          other_user_id: otherUserId
        });
      }

      res.status(200).json({ 
        success: true,
        message: '따라가기를 중단했습니다.'
      });
    });
  });
});

// 현재 따라가기 상태 조회 API
router.get('/status/:friendId', auth, (req, res) => {
  const user_id = req.user.user_id;
  const friend_id = req.params.friendId;

  const statusSQL = `
    SELECT fr.*, u1.user_nickname as requester_name, u2.user_nickname as target_name
    FROM FollowRequests fr
    JOIN Users u1 ON fr.requester_id = u1.user_id
    JOIN Users u2 ON fr.target_id = u2.user_id
    WHERE ((fr.requester_id = ? AND fr.target_id = ?) OR (fr.requester_id = ? AND fr.target_id = ?))
    AND fr.status IN ('pending', 'accepted')
  `;

  db.query(statusSQL, [user_id, friend_id, friend_id, user_id], (err, result) => {
    if (err) {
      console.error('따라가기 상태 조회 실패:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }

    if (result.length === 0) {
      return res.status(200).json({ 
        status: 'none',
        message: '진행 중인 따라가기가 없습니다.'
      });
    }

    const followRequest = result[0];
    res.status(200).json({ 
      status: followRequest.status,
      request_id: followRequest.follow_request_id,
      requester_id: followRequest.requester_id,
      target_id: followRequest.target_id,
      requester_name: followRequest.requester_name,
      target_name: followRequest.target_name,
      is_requester: followRequest.requester_id === user_id
    });
  });
});

module.exports = router;