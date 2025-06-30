const express = require('express');
const router = express.Router();
const db = require('../db.js');  
const { auth } = require('./auth.js');  

// FCM 푸시 알림 함수 (firebase-admin 사용)
const admin = require('firebase-admin');

// Firebase Admin SDK 초기화 (환경변수 방식)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
}

async function sendPushNotification(fcmToken, title, body, data = {}) {
  try {
    // 🔥 수정: 모든 data 값을 문자열로 변환
    const stringifiedData = {};
    for (const [key, value] of Object.entries(data)) {
      stringifiedData[key] = String(value); // 모든 값을 문자열로 변환
    }

    const message = {
      notification: {
        title: title,
        body: body,
      },
      data: stringifiedData, // 🔥 수정: 문자열로 변환된 데이터 사용
      token: fcmToken,
    };

    console.log('FCM 메시지 전송 시도:', JSON.stringify(message, null, 2));

    const response = await admin.messaging().send(message);
    console.log('FCM 푸시 알림 전송 성공:', response);
    return response;
  } catch (error) {
    console.error('FCM 푸시 알림 전송 실패:', error);
    return null;
  }
}
// 찾아가기 요청 API
router.post('/request', auth, (req, res) => {
  const { friend_id, type } = req.body;
  const user_id = req.user.user_id;

  if (!friend_id) {
    return res.status(400).json({ error: '친구 ID는 필수 입력값입니다.' });
  }

 // 1. 위치 공유 관계 확인
const checkSharingSQL = `
  SELECT * FROM LocationSharing 
  WHERE (sharer_id = ? AND sharee_id = ?) OR (sharer_id = ? AND sharee_id = ?)
  AND status = 'active'
`;

db.query(checkSharingSQL, [user_id, friend_id, friend_id, user_id], (err, sharingResult) => {
  if (err) {
    console.error('위치 공유 관계 확인 실패:', err);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }

  if (sharingResult.length === 0) {
    return res.status(403).json({ error: '위치 공유 관계가 없습니다.' });
  }

    // 2. 기존 요청 확인 (모든 상태 포함)
    const checkExistingSQL = `
      SELECT * FROM FollowRequests 
      WHERE requester_id = ? AND target_id = ?
      ORDER BY follow_request_id DESC
      LIMIT 1
    `;

    db.query(checkExistingSQL, [user_id, friend_id], (err, existingResult) => {
      if (err) {
        console.error('기존 요청 조회 실패:', err);
        return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
      }

      // 3. 친구 정보 조회 (푸시알림용)
      const friendInfoSQL = `
        SELECT user_nickname, fcm_token FROM Users WHERE user_id = ?
      `;

      db.query(friendInfoSQL, [friend_id], (err, friendResult) => {
        if (err) {
          console.error('친구 정보 조회 실패:', err);
          return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
        }

        if (friendResult.length === 0) {
          return res.status(404).json({ error: '존재하지 않는 친구입니다.' });
        }

        const friendInfo = friendResult[0];

        // 기존 요청이 있는 경우
        if (existingResult.length > 0) {
          const existing = existingResult[0];
          
          // pending 상태면 이미 요청 중
          if (existing.status === 'pending') {
            return res.status(200).json({ 
              success: true,
              message: '이미 대기 중인 찾아가기 요청이 있습니다.',
              request_id: existing.follow_request_id,
              status: 'pending'
            });
          }
          
          // accepted 상태면 이미 찾아가는 중
          if (existing.status === 'accepted') {
            return res.status(200).json({ 
              success: true,
              message: '이미 찾아가기 중입니다.',
              request_id: existing.follow_request_id,
              status: 'accepted'
            });
          }
          
          // cancelled나 rejected 상태면 상태를 pending으로 업데이트
          const updateSQL = `
            UPDATE FollowRequests 
            SET status = 'pending'
            WHERE follow_request_id = ?
          `;
          
          db.query(updateSQL, [existing.follow_request_id], (err, updateResult) => {
            if (err) {
              console.error('요청 상태 업데이트 실패:', err);
              return res.status(500).json({ error: '요청 업데이트에 실패했습니다.' });
            }
            
           // 소켓을 통해 상대방에게 알림 전송
const io = req.app.get('io');
if (io) {
  const connectedUsers = req.app.get('connectedUsers') || new Map();
  const targetSocketId = connectedUsers.get(friend_id.toString());
  
  if (targetSocketId) {
    io.to(targetSocketId).emit('follow_request_received', {
      request_id: existing.follow_request_id,
      requester_id: user_id,
      requester_name: req.user.user_nickname,
      target_id: friend_id,
      type: type || 'find_way'
    });
  }
}

            // FCM 푸시알림 발송
            if (friendInfo.fcm_token) {
              sendPushNotification(
                friendInfo.fcm_token,
                '찾아가기 요청',
                `${req.user.user_nickname}님이 찾아가기를 요청했습니다`,
                {
                  type: 'find_way',
                  action: 'request',
                  friend_id: user_id.toString(),
                  friend_name: req.user.user_nickname,
                  request_id: existing.follow_request_id.toString()
                }
              );
            }
            
            res.status(200).json({ 
              success: true,
              message: '찾아가기 요청을 다시 보냈습니다.',
              request_id: existing.follow_request_id
            });
          });
          
        } else {
          // 4. 새 요청 생성
          const insertSQL = `
            INSERT INTO FollowRequests (requester_id, target_id, status)
            VALUES (?, ?, 'pending')
          `;

          db.query(insertSQL, [user_id, friend_id], (err, result) => {
            if (err) {
              console.error('찾아가기 요청 생성 실패:', err);
              
              // 혹시 동시에 요청이 들어와서 중복 오류가 발생한 경우
              if (err.code === 'ER_DUP_ENTRY') {
                return res.status(200).json({ 
                  success: true,
                  message: '찾아가기 요청을 처리 중입니다.',
                  status: 'pending'
                });
              }
              
              return res.status(500).json({ error: '찾아가기 요청 생성에 실패했습니다.' });
            }

            const requestId = result.insertId;

            // 5. 소켓을 통해 상대방에게 알림 전송
            const io = req.app.get('io');
if (io) {
  // 연결된 사용자들 맵 가져오기
  const connectedUsers = req.app.get('connectedUsers') || new Map();
  const targetSocketId = connectedUsers.get(friend_id);
  
  if (targetSocketId) {
    // 특정 사용자에게만 전송
    io.to(targetSocketId).emit('follow_request_received', {
      request_id: requestId,
      requester_id: user_id,
      requester_name: req.user.user_nickname,
      target_id: friend_id,
      type: type || 'find_way'
    });
  }
}

            // 6. FCM 푸시알림 발송
            if (friendInfo.fcm_token) {
              sendPushNotification(
                friendInfo.fcm_token,
                '찾아가기 요청',
                `${req.user.user_nickname}님이 찾아가기를 요청했습니다`,
                {
                  type: 'find_way',
                  action: 'request',
                  friend_id: user_id.toString(),
                  friend_name: req.user.user_nickname,
                  request_id: requestId.toString()
                }
              );
            }

            res.status(200).json({ 
              success: true,
              message: '찾아가기 요청을 보냈습니다.',
              request_id: requestId
            });
          });
        }
      });
    });
  });
});

// 찾아가기 요청 응답 API
router.post('/respond', auth, (req, res) => {
  const { request_id, response, type } = req.body;
  const user_id = req.user.user_id;

  if (!request_id || !response) {
    return res.status(400).json({ error: '요청 ID와 응답은 필수 입력값입니다.' });
  }

  if (!['accept', 'reject'].includes(response)) {
    return res.status(400).json({ error: '응답은 accept 또는 reject여야 합니다.' });
  }

  // 1. 요청 정보 조회
  const checkRequestSQL = `
    SELECT fr.*, u.user_nickname as requester_name, u.fcm_token as requester_fcm_token
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
  const connectedUsers = req.app.get('connectedUsers') || new Map();
  const requesterSocketId = connectedUsers.get(request.requester_id.toString());
  
  if (requesterSocketId) {
    io.to(requesterSocketId).emit('follow_request_responded', {
      request_id: request_id,
      requester_id: request.requester_id,
      target_id: user_id,
      target_name: req.user.user_nickname,
      response: response,
      status: newStatus,
      type: type || 'find_way'
    });
  }
}

      // 4. FCM 푸시알림 발송
      if (request.requester_fcm_token) {
        const message = response === 'accept' 
          ? `${req.user.user_nickname}님이 찾아가기를 허용했습니다`
          : `${req.user.user_nickname}님이 찾아가기를 거부했습니다`;

        sendPushNotification(
          request.requester_fcm_token,
          '찾아가기 응답',
          message,
          {
            type: 'find_way',
            action: response,
            friend_id: user_id.toString(),
            friend_name: req.user.user_nickname,
            request_id: request_id.toString()
          }
        );
      }

      const message = response === 'accept' ? 
        '찾아가기 요청을 수락했습니다.' : 
        '찾아가기 요청을 거절했습니다.';

      res.status(200).json({ 
        success: true,
        message: message,
        status: newStatus
      });
    });
  });
});

// 찾아가기 요청 취소 API
router.post('/cancel', auth, (req, res) => {
  const { friend_id } = req.body;
  const user_id = req.user.user_id;

  if (!friend_id) {
    return res.status(400).json({ error: '친구 ID는 필수 입력값입니다.' });
  }

  // 1. 진행 중인 요청 확인
  const checkRequestSQL = `
    SELECT fr.*, u.user_nickname as target_name, u.fcm_token as target_fcm_token
    FROM FollowRequests fr
    JOIN Users u ON fr.target_id = u.user_id
    WHERE fr.requester_id = ? AND fr.target_id = ? AND fr.status IN ('pending', 'accepted')
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
  const connectedUsers = req.app.get('connectedUsers') || new Map();
  const targetSocketId = connectedUsers.get(friend_id.toString());
  
  if (targetSocketId) {
    io.to(targetSocketId).emit('follow_request_cancelled', {
      request_id: request.follow_request_id,
      requester_id: user_id,
      requester_name: req.user.user_nickname,
      target_id: friend_id,
      type: 'find_way'
    });
  }
}

      // 4. FCM 푸시알림 발송
      if (request.target_fcm_token) {
        sendPushNotification(
          request.target_fcm_token,
          '찾아가기 취소',
          `${req.user.user_nickname || req.user.user_id}님이 찾아가기를 취소했습니다`,
          {
            type: 'find_way',
            action: 'cancel',
            friend_id: user_id.toString(),
            friend_name: req.user.user_nickname,
            request_id: request.follow_request_id.toString()
          }
        );
      }

      res.status(200).json({ 
        success: true,
        message: '찾아가기 요청을 취소했습니다.'
      });
    });
  });
});

// 찾아가기 중단 API (수락된 상태에서 중단)
router.post('/stop', auth, (req, res) => {
  const { friend_id } = req.body;
  const user_id = req.user.user_id;

  if (!friend_id) {
    return res.status(400).json({ error: '친구 ID는 필수 입력값입니다.' });
  }

  // 1. 수락된 요청 확인 (양방향)
  const checkRequestSQL = `
    SELECT fr.*, 
           CASE WHEN fr.requester_id = ? THEN u2.user_nickname ELSE u1.user_nickname END as other_name,
           CASE WHEN fr.requester_id = ? THEN u2.fcm_token ELSE u1.fcm_token END as other_fcm_token,
           CASE WHEN fr.requester_id = ? THEN fr.target_id ELSE fr.requester_id END as other_id
    FROM FollowRequests fr
    JOIN Users u1 ON fr.requester_id = u1.user_id
    JOIN Users u2 ON fr.target_id = u2.user_id
    WHERE ((fr.requester_id = ? AND fr.target_id = ?) OR (fr.requester_id = ? AND fr.target_id = ?))
    AND fr.status = 'accepted'
  `;

  db.query(checkRequestSQL, [user_id, user_id, user_id, user_id, friend_id, friend_id, user_id], (err, requestResult) => {
    if (err) {
      console.error('요청 조회 실패:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }

    if (requestResult.length === 0) {
      return res.status(404).json({ error: '중단할 찾아가기가 없습니다.' });
    }

    const request = requestResult[0];

    // 2. 찾아가기 중단 (상태를 cancelled로 변경)
    const stopSQL = `
      UPDATE FollowRequests 
      SET status = 'cancelled'
      WHERE follow_request_id = ?
    `;

    db.query(stopSQL, [request.follow_request_id], (err, result) => {
      if (err) {
        console.error('찾아가기 중단 실패:', err);
        return res.status(500).json({ error: '찾아가기 중단에 실패했습니다.' });
      }

      // 3. 소켓을 통해 상대방에게 중단 알림
      const io = req.app.get('io');
if (io) {
  const connectedUsers = req.app.get('connectedUsers') || new Map();
  const otherSocketId = connectedUsers.get(request.other_id.toString());
  
  if (otherSocketId) {
    io.to(otherSocketId).emit('follow_stopped', {
      request_id: request.follow_request_id,
      stopped_by: user_id,
      stopped_by_name: req.user.user_nickname,
      other_user_id: request.other_id,
      type: 'find_way'
    });
  }
}

      // 4. FCM 푸시알림 발송
      if (request.other_fcm_token) {
        sendPushNotification(
          request.other_fcm_token,
          '찾아가기 중단',
          `${req.user.user_nickname}님이 찾아가기를 중단했습니다`,
          {
            type: 'find_way',
            action: 'stop',
            friend_id: user_id.toString(),
            friend_name: req.user.user_nickname,
            request_id: request.follow_request_id.toString()
          }
        );
      }

      res.status(200).json({ 
        success: true,
        message: '찾아가기를 중단했습니다.'
      });
    });
  });
});

// 찾아가기 상태 조회 API
router.get('/status/:friend_id', auth, (req, res) => {
  const friend_id = req.params.friend_id;
  const user_id = req.user.user_id;

  if (!friend_id) {
    return res.status(400).json({ error: '친구 ID는 필수입니다.' });
  }

  const statusSQL = `
    SELECT fr.*, 
           u1.user_nickname as requester_name, 
           u2.user_nickname as target_name
    FROM FollowRequests fr
    JOIN Users u1 ON fr.requester_id = u1.user_id  
    JOIN Users u2 ON fr.target_id = u2.user_id
    WHERE ((fr.requester_id = ? AND fr.target_id = ?) OR (fr.requester_id = ? AND fr.target_id = ?))
    AND fr.status IN ('pending', 'accepted')
  `;

  db.query(statusSQL, [user_id, friend_id, friend_id, user_id], (err, result) => {
    if (err) {
      console.error('찾아가기 상태 조회 실패:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }

    if (result.length === 0) {
      return res.status(200).json({ 
        success: true,
        status: 'none',
        message: '진행 중인 찾아가기가 없습니다.'
      });
    }

    const followRequest = result[0];
    
    res.status(200).json({ 
      success: true,
      status: followRequest.status,
      request_id: followRequest.follow_request_id,
      requester_id: followRequest.requester_id,
      target_id: followRequest.target_id,
      requester_name: followRequest.requester_name,
      target_name: followRequest.target_name,
      is_requester: followRequest.requester_id === user_id,
      created_at: followRequest.created_at
    });
  });
});

module.exports = router;