// routes/friends.js
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

// 사용자 검색 API
router.get('/search', auth, (req, res) => {
  const searchTerm = req.query.term;
  const userId = req.user.user_id;
  
  if (!searchTerm) {
    return res.status(400).json({ error: '검색어가 필요합니다.' });
  }
  
  const searchSQL = `
    SELECT u.user_id, u.user_name, u.user_nickname 
    FROM Users u
    WHERE (u.user_id LIKE ? OR u.user_name LIKE ? OR u.user_nickname LIKE ?) 
    AND u.user_id != ? 
    AND u.user_status = 'active'
    LIMIT 20
  `;
  
  // 각 검색어에 와일드카드 추가
  const searchPattern = `%${searchTerm}%`;
  
  db.query(searchSQL, [searchPattern, searchPattern, searchPattern, userId], (err, results) => {
    if (err) {
      console.error('사용자 검색 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    // 친구 요청 상태 확인을 위한 추가 쿼리
    if (results.length > 0) {
      const userIds = results.map(user => user.user_id);
      const placeholders = userIds.map(() => '?').join(',');
      
      const requestSQL = `
        SELECT fr.sender_id, fr.recipient_id, fr.request_status, fr.request_id
        FROM FriendRequests fr
        WHERE (fr.sender_id = ? AND fr.recipient_id IN (${placeholders}))
        OR (fr.recipient_id = ? AND fr.sender_id IN (${placeholders}))
      `;
      
      const friendshipSQL = `
        SELECT f.user_id_1, f.user_id_2, f.status
        FROM Friendships f
        WHERE (f.user_id_1 = ? AND f.user_id_2 IN (${placeholders}))
        OR (f.user_id_2 = ? AND f.user_id_1 IN (${placeholders}))
      `;
      
      // 파라미터 배열 구성 (sender_id = userId, recipient_ids = userIds)
      const requestParams = [userId, ...userIds, userId, ...userIds];
      const friendshipParams = [userId, ...userIds, userId, ...userIds];
      
      // 친구 요청 상태 조회
      db.query(requestSQL, requestParams, (err, requestResults) => {
        if (err) {
          console.error('친구 요청 상태 조회 오류:', err);
          return res.status(200).json({ users: results }); // 에러가 있어도 일단 사용자 검색 결과는 반환
        }
        
        // 친구 관계 상태 조회
        db.query(friendshipSQL, friendshipParams, (err, friendshipResults) => {
          if (err) {
            console.error('친구 관계 상태 조회 오류:', err);
            return res.status(200).json({ users: results }); // 에러가 있어도 일단 사용자 검색 결과는 반환
          }
          
          // 검색 결과에 친구 요청/관계 상태 추가
          const enrichedResults = results.map(user => {
            const userData = { ...user };
            
            // 친구 요청 상태 확인
            const outgoingRequest = requestResults.find(
              req => req.sender_id === userId && req.recipient_id === user.user_id
            );
            const incomingRequest = requestResults.find(
              req => req.recipient_id === userId && req.sender_id === user.user_id
            );
            
            if (outgoingRequest) {
              userData.request_sent = true;
              userData.request_status = outgoingRequest.request_status;
              userData.request_id = outgoingRequest.request_id;
            }
            if (incomingRequest) {
              userData.request_received = true;
              userData.request_status = incomingRequest.request_status;
              userData.request_id = incomingRequest.request_id;
            }
            
            // 친구 관계 상태 확인
            const friendship = friendshipResults.find(
              f => (f.user_id_1 === userId && f.user_id_2 === user.user_id) ||
                   (f.user_id_2 === userId && f.user_id_1 === user.user_id)
            );
            
            if (friendship) {
              userData.is_friend = friendship.status === 'active';
              userData.friendship_status = friendship.status;
            }
            
            return userData;
          });
          
          res.status(200).json({ users: enrichedResults });
        });
      });
    } else {
      // 검색 결과가 없는 경우
      res.status(200).json({ users: [] });
    }
  });
});

// 친구 요청 보내기 API
router.post('/request', auth, (req, res) => {
  const { recipient_id } = req.body;
  const sender_id = req.user.user_id;
  
  if (!recipient_id) {
    return res.status(400).json({ error: '요청 대상 ID가 필요합니다.' });
  }
  
  if (sender_id === recipient_id) {
    return res.status(400).json({ error: '자기 자신에게 친구 요청을 보낼 수 없습니다.' });
  }
  
  // 이미 친구인지 확인
  const checkFriendshipSQL = `
    SELECT * FROM Friendships 
    WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
    AND status = 'active'
  `;
  
  db.query(checkFriendshipSQL, [sender_id, recipient_id, recipient_id, sender_id], (err, friendshipResults) => {
    if (err) {
      console.error('친구 관계 확인 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    if (friendshipResults.length > 0) {
      return res.status(400).json({ error: '이미 친구인 사용자입니다.' });
    }
    
    // 이미 요청을 보냈는지 확인
    const checkRequestSQL = `
      SELECT * FROM FriendRequests 
      WHERE sender_id = ? AND recipient_id = ?
    `;
    
    db.query(checkRequestSQL, [sender_id, recipient_id], (err, requestResults) => {
      if (err) {
        console.error('친구 요청 확인 오류:', err);
        return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
      }
      
      if (requestResults.length > 0 && requestResults[0].request_status === 'pending') {
        return res.status(400).json({ error: '이미 친구 요청을 보냈습니다.' });
      }
      
      // 상대방이 나에게 요청을 보냈는지 확인
      const checkReverseRequestSQL = `
        SELECT * FROM FriendRequests 
        WHERE sender_id = ? AND recipient_id = ?
      `;
      
      db.query(checkReverseRequestSQL, [recipient_id, sender_id], (err, reverseRequestResults) => {
        if (err) {
          console.error('역방향 친구 요청 확인 오류:', err);
          return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
        }
        
        if (reverseRequestResults.length > 0 && reverseRequestResults[0].request_status === 'pending') {
          // 상대방이 나에게 요청을 보낸 경우, 자동으로 수락 처리
          const acceptRequestSQL = `
            UPDATE FriendRequests 
            SET request_status = 'accepted', updated_at = NOW() 
            WHERE sender_id = ? AND recipient_id = ?
          `;
          
          db.query(acceptRequestSQL, [recipient_id, sender_id], (err) => {
            if (err) {
              console.error('친구 요청 수락 오류:', err);
              return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
            }
            
            // 친구 관계 생성
            const createFriendshipSQL = `
              INSERT INTO Friendships (user_id_1, user_id_2, friendship_type, status, created_at, updated_at)
              VALUES (?, ?, 'regular', 'active', NOW(), NOW())
            `;
            
            // user_id_1은 항상 더 작은 ID로 설정 (일관성 유지)
            const [smallerId, largerId] = sender_id < recipient_id ? 
              [sender_id, recipient_id] : [recipient_id, sender_id];
            
            db.query(createFriendshipSQL, [smallerId, largerId], (err) => {
              if (err) {
                console.error('친구 관계 생성 오류:', err);
                return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
              }
              
              res.status(200).json({ 
                message: '상대방이 보낸 친구 요청을 수락하여 친구가 되었습니다.',
                auto_accepted: true
              });
            });
          });
        } else {
          // 새 친구 요청 생성
          const createRequestSQL = `
            INSERT INTO FriendRequests (sender_id, recipient_id, request_status, created_at, updated_at)
            VALUES (?, ?, 'pending', NOW(), NOW())
            ON DUPLICATE KEY UPDATE request_status = 'pending', updated_at = NOW()
          `;
          
          db.query(createRequestSQL, [sender_id, recipient_id], (err, result) => {
            if (err) {
              console.error('친구 요청 생성 오류:', err);
              return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
            }
            
            res.status(201).json({ 
              message: '친구 요청을 보냈습니다.',
              request_id: result.insertId
            });
          });
        }
      });
    });
  });
});

// 받은 친구 요청 목록 조회 API
router.get('/requests', auth, (req, res) => {
  const userId = req.user.user_id;
  
  const sql = `
    SELECT fr.request_id, fr.sender_id, fr.recipient_id, fr.request_status, fr.created_at,
           u.user_name as sender_name, u.user_nickname as sender_nickname
    FROM FriendRequests fr
    JOIN Users u ON fr.sender_id = u.user_id
    WHERE fr.recipient_id = ? AND fr.request_status = 'pending'
    ORDER BY fr.created_at DESC
  `;
  
  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error('친구 요청 목록 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    res.status(200).json({ requests: results });
  });
});

// 친구 요청 수락 API
router.post('/request/:requestId/accept', auth, (req, res) => {
  const requestId = req.params.requestId;
  const userId = req.user.user_id;
  
  console.log(`친구 요청 수락 처리: ID=${requestId}, 사용자=${userId}`);
  
  // 요청 확인 및 수락 권한 확인
  const checkRequestSQL = `
    SELECT fr.*, u.user_name as sender_name, u.user_nickname as sender_nickname
    FROM FriendRequests fr 
    JOIN Users u ON fr.sender_id = u.user_id
    WHERE fr.request_id = ? AND fr.recipient_id = ? AND fr.request_status = 'pending'
  `;
  
  db.query(checkRequestSQL, [requestId, userId], (err, results) => {
    if (err) {
      console.error('친구 요청 확인 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    if (results.length === 0) {
      console.log(`유효한 요청을 찾을 수 없음: ID=${requestId}`);
      return res.status(404).json({ error: '유효한 친구 요청을 찾을 수 없습니다.' });
    }
    
    const request = results[0];
    console.log(`요청 상세: 발신자=${request.sender_id}, 수신자=${request.recipient_id}`);
    
    // 요청 수락 상태로 업데이트
    const acceptRequestSQL = `
      UPDATE FriendRequests 
      SET request_status = 'accepted', updated_at = NOW() 
      WHERE request_id = ?
    `;
    
    db.query(acceptRequestSQL, [requestId], (err) => {
      if (err) {
        console.error('친구 요청 수락 상태 업데이트 오류:', err);
        return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
      }
      
      console.log(`요청 상태 업데이트 완료: ID=${requestId}`);
      
      // 이미 친구 관계가 있는지 확인
      const checkFriendshipSQL = `
        SELECT * FROM Friendships 
        WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
      `;
      
      db.query(checkFriendshipSQL, [request.sender_id, userId, userId, request.sender_id], (err, friendshipResults) => {
        if (err) {
          console.error('친구 관계 조회 오류:', err);
          return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
        }
        
        // 기존 관계가 있다면 먼저 삭제 (중복 오류 방지)
        if (friendshipResults.length > 0) {
          const friendship = friendshipResults[0];
          console.log(`기존 친구 관계 발견: ID=${friendship.friendship_id}, 상태=${friendship.status} - 삭제 후 재생성`);
          
          const deleteFriendshipSQL = `
            DELETE FROM Friendships
            WHERE friendship_id = ?
          `;
          
          db.query(deleteFriendshipSQL, [friendship.friendship_id], (err) => {
            if (err) {
              console.error('기존 친구 관계 삭제 오류:', err);
              return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
            }
            
            // 새 친구 관계 생성
            createNewFriendship(request.sender_id, userId, res, request.sender_name, request.sender_nickname);
          });
        } else {
          // 관계가 없으면 바로 새로 생성
          createNewFriendship(request.sender_id, userId, res, request.sender_name, request.sender_nickname);
        }
      });
    });
  });
});

// 새 친구 관계 생성 헬퍼 함수
function createNewFriendship(senderId, recipientId, res, senderName, senderNickname) {
  // user_id_1은 항상 더 작은 ID로 설정 (일관성 유지)
  const [smallerId, largerId] = senderId < recipientId ? 
    [senderId, recipientId] : [recipientId, senderId];
  
  console.log(`새 친구 관계 생성: user_id_1=${smallerId}, user_id_2=${largerId}`);
  
  const createFriendshipSQL = `
    INSERT INTO Friendships (user_id_1, user_id_2, friendship_type, status, created_at, updated_at)
    VALUES (?, ?, 'regular', 'active', NOW(), NOW())
  `;
  
  db.query(createFriendshipSQL, [smallerId, largerId], (err) => {
    if (err) {
      console.error('친구 관계 생성 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    console.log('친구 관계 생성 완료');
    
    res.status(200).json({ 
      message: '친구 요청을 수락했습니다.',
      friend: {
        id: senderId,
        name: senderName,
        nickname: senderNickname || ''
      }
    });
  });
}

// 친구 요청 거절 API
router.post('/request/:requestId/reject', auth, (req, res) => {
  const requestId = req.params.requestId;
  const userId = req.user.user_id;
  
  // 요청 확인 및 거절 권한 확인
  const checkRequestSQL = `
    SELECT * FROM FriendRequests 
    WHERE request_id = ? AND recipient_id = ? AND request_status = 'pending'
  `;
  
  db.query(checkRequestSQL, [requestId, userId], (err, results) => {
    if (err) {
      console.error('친구 요청 확인 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: '유효한 친구 요청을 찾을 수 없습니다.' });
    }
    
    // 요청 거절 처리
    const rejectRequestSQL = `
      UPDATE FriendRequests 
      SET request_status = 'rejected', updated_at = NOW() 
      WHERE request_id = ?
    `;
    
    db.query(rejectRequestSQL, [requestId], (err) => {
      if (err) {
        console.error('친구 요청 거절 오류:', err);
        return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
      }
      
      res.status(200).json({ message: '친구 요청을 거절했습니다.' });
    });
  });
});

// 친구 요청 취소 API
router.delete('/request/:requestId', auth, (req, res) => {
  const requestId = req.params.requestId;
  const userId = req.user.user_id;
  
  // 요청 확인 및 권한 확인
  const checkRequestSQL = `
    SELECT * FROM FriendRequests 
    WHERE request_id = ? AND sender_id = ? AND request_status = 'pending'
  `;
  
  db.query(checkRequestSQL, [requestId, userId], (err, results) => {
    if (err) {
      console.error('친구 요청 확인 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: '취소할 수 있는 요청을 찾을 수 없습니다.' });
    }
    
    // 요청 삭제 또는 상태 변경
    const deleteRequestSQL = `
      DELETE FROM FriendRequests WHERE request_id = ?
    `;
    
    db.query(deleteRequestSQL, [requestId], (err) => {
      if (err) {
        console.error('친구 요청 취소 오류:', err);
        return res.status(500).json({ error: '친구 요청 취소에 실패했습니다.' });
      }
      
      res.status(200).json({ message: '친구 요청이 취소되었습니다.' });
    });
  });
});

// 친구 목록 조회 API
router.get('/list', auth, (req, res) => {
  const userId = req.user.user_id;
  
  const sql = `
    SELECT 
      f.friendship_id,
      CASE 
        WHEN f.user_id_1 = ? THEN f.user_id_2
        ELSE f.user_id_1
      END as friend_id,
      u.user_name as name,
      u.user_nickname as nickname,
      l.updated_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE) as isOnline
    FROM Friendships f
    JOIN Users u ON (
      CASE 
        WHEN f.user_id_1 = ? THEN f.user_id_2
        ELSE f.user_id_1
      END = u.user_id
    )
    LEFT JOIN Location l ON (
      CASE 
        WHEN f.user_id_1 = ? THEN f.user_id_2
        ELSE f.user_id_1
      END = l.user_id
    )
    WHERE (f.user_id_1 = ? OR f.user_id_2 = ?)
    AND f.status = 'active'
    ORDER BY u.user_name
  `;
  
  db.query(sql, [userId, userId, userId, userId, userId], (err, results) => {
    if (err) {
      console.error('친구 목록 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    // 친구 목록을 클라이언트에서 쉽게 사용할 수 있도록 포맷팅
    const friends = results.map(friend => ({
      id: friend.friend_id,
      name: friend.name || friend.friend_id,
      nickname: friend.nickname || '',
      isOnline: friend.isOnline || false
    }));
    
    res.status(200).json({ friends });
  });
});

// 친구 삭제 API
router.post('/delete', auth, (req, res) => {
  const { friend_id } = req.body;
  const user_id = req.user.user_id;
  
  if (!friend_id) {
    return res.status(400).json({ error: '친구 ID가 필요합니다.' });
  }
  
  console.log(`친구 삭제 요청: 사용자=${user_id}, 친구=${friend_id}`);
  
  // 친구 관계 확인
  const checkFriendshipSQL = `
    SELECT * FROM Friendships 
    WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
  `;
  
  db.query(checkFriendshipSQL, [user_id, friend_id, friend_id, user_id], (err, results) => {
    if (err) {
      console.error('친구 관계 확인 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: '친구 관계를 찾을 수 없습니다.' });
    }
    
    const friendship = results[0];
    
    // 친구 관계를 데이터베이스에서 완전히 삭제
    const deleteFriendshipSQL = `
      DELETE FROM Friendships
      WHERE friendship_id = ?
    `;
    
    db.query(deleteFriendshipSQL, [friendship.friendship_id], (err) => {
      if (err) {
        console.error('친구 삭제 오류:', err);
        return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
      }
      
      console.log(`친구 관계 삭제 완료: friendship_id=${friendship.friendship_id}`);
      
      // 친구 요청 기록도 함께 삭제
      const deleteRequestsSQL = `
        DELETE FROM FriendRequests
        WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
      `;
      
      db.query(deleteRequestsSQL, [user_id, friend_id, friend_id, user_id], (reqErr) => {
        if (reqErr) {
          console.error('친구 요청 기록 삭제 오류:', reqErr);
          // 요청 삭제에 실패해도 친구 관계는 이미 삭제됐으므로 계속 진행
        }

        // 위치 공유 관계가 있다면 종료
        const terminateSharingSQL = `
          UPDATE LocationSharing
          SET status = 'inactive', end_time = NOW(), updated_at = NOW()
          WHERE ((sharer_id = ? AND sharee_id = ?) OR (sharer_id = ? AND sharee_id = ?))
          AND status = 'active'
        `;
        
        db.query(terminateSharingSQL, [user_id, friend_id, friend_id, user_id], () => {
          // 오류가 있어도 무시하고 진행
          res.status(200).json({ message: '친구 관계가 삭제되었습니다.' });
        });
      });
    });
  });
});

// 친구 차단 API
router.post('/block', auth, (req, res) => {
  const { friend_id } = req.body;
  const user_id = req.user.user_id;
  
  if (!friend_id) {
    return res.status(400).json({ error: '친구 ID가 필요합니다.' });
  }
  
  console.log(`친구 차단 요청: 사용자=${user_id}, 친구=${friend_id}`);
  
  // 친구 관계 확인
  const checkFriendshipSQL = `
    SELECT * FROM Friendships 
    WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
  `;
  
  db.query(checkFriendshipSQL, [user_id, friend_id, friend_id, user_id], (err, results) => {
    if (err) {
      console.error('친구 관계 확인 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    if (results.length > 0) {
      // 이미 친구 관계가 있는 경우, 해당 관계 삭제 후 차단 관계 생성
      const friendship = results[0];
      
      // 기존 친구 관계 삭제
      const deleteFriendshipSQL = `
        DELETE FROM Friendships 
        WHERE friendship_id = ?
      `;
      
      db.query(deleteFriendshipSQL, [friendship.friendship_id], (err) => {
        if (err) {
          console.error('친구 관계 삭제 오류:', err);
          return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
        }
        
        // 위치 공유 관계가 있다면 종료
        const terminateSharingSQL = `
          UPDATE LocationSharing
          SET status = 'inactive', end_time = NOW(), updated_at = NOW()
          WHERE ((sharer_id = ? AND sharee_id = ?) OR (sharer_id = ? AND sharee_id = ?))
          AND status = 'active'
        `;
        
        db.query(terminateSharingSQL, [user_id, friend_id, friend_id, user_id], () => {
          // 새 차단 관계 생성
          createBlockRelationship(user_id, friend_id, res);
        });
      });
    } else {
      // 친구 관계가 없는 경우, 새로운 차단 관계 직접 생성
      createBlockRelationship(user_id, friend_id, res);
    }
  });
});

// 차단 관계 생성 헬퍼 함수 (계속)
function createBlockRelationship(user_id, friend_id, res) {
 // user_id_1은 항상 더 작은 ID로 설정 (일관성 유지)
 const [smallerId, largerId] = user_id < friend_id ? 
   [user_id, friend_id] : [friend_id, user_id];
 
 // 작은 ID가 차단했는지, 큰 ID가 차단했는지 설정
 const isBlockedByUser1 = smallerId === user_id ? 1 : 0;
 const isBlockedByUser2 = largerId === user_id ? 1 : 0;
 
 const createBlockSQL = `
   INSERT INTO Friendships (user_id_1, user_id_2, friendship_type, status, is_blocked_by_user_1, is_blocked_by_user_2, created_at, updated_at)
   VALUES (?, ?, 'blocked', 'inactive', ?, ?, NOW(), NOW())
 `;
 
 db.query(createBlockSQL, [smallerId, largerId, isBlockedByUser1, isBlockedByUser2], (err) => {
   if (err) {
     console.error('차단 관계 생성 오류:', err);
     return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
   }
   
   console.log(`차단 관계 생성 완료: ${smallerId}-${largerId}`);
   res.status(200).json({ message: '사용자가 차단되었습니다.' });
 });
}

// 차단 목록 조회 API
router.get('/blocked', auth, (req, res) => {
 const userId = req.user.user_id;
 
 // 차단된 사용자 목록 조회
 const sql = `
   SELECT 
     f.friendship_id,
     CASE 
       WHEN f.user_id_1 = ? THEN f.user_id_2
       ELSE f.user_id_1
     END as blocked_id,
     u.user_name as name,
     u.user_nickname as nickname
   FROM Friendships f
   JOIN Users u ON (
     CASE 
       WHEN f.user_id_1 = ? THEN f.user_id_2
       ELSE f.user_id_1
     END = u.user_id
   )
   WHERE ((f.user_id_1 = ? AND f.is_blocked_by_user_1 = 1)
      OR (f.user_id_2 = ? AND f.is_blocked_by_user_2 = 1))
   ORDER BY u.user_name
 `;
 
 db.query(sql, [userId, userId, userId, userId], (err, results) => {
   if (err) {
     console.error('차단 목록 조회 오류:', err);
     return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
   }
   
   // 차단 목록을 클라이언트에서 쉽게 사용할 수 있도록 포맷팅
   const blockedUsers = results.map(user => ({
     id: user.blocked_id,
     name: user.name || user.blocked_id,
     nickname: user.nickname || ''
   }));
   
   res.status(200).json({ blockedUsers });
 });
});

// 차단 해제 API
router.post('/unblock', auth, (req, res) => {
 const { blocked_id } = req.body;
 const user_id = req.user.user_id;
 
 if (!blocked_id) {
   return res.status(400).json({ error: '차단 해제할 사용자 ID가 필요합니다.' });
 }
 
 // 차단 관계 확인
 const checkFriendshipSQL = `
   SELECT * FROM Friendships 
   WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
 `;
 
 db.query(checkFriendshipSQL, [user_id, blocked_id, blocked_id, user_id], (err, results) => {
   if (err) {
     console.error('차단 관계 확인 오류:', err);
     return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
   }
   
   if (results.length === 0) {
     return res.status(404).json({ error: '차단 관계를 찾을 수 없습니다.' });
   }
   
   const friendship = results[0];
   
   // 차단 관계를 완전히 삭제
   const deleteBlockSQL = `
     DELETE FROM Friendships 
     WHERE friendship_id = ?
   `;
   
   db.query(deleteBlockSQL, [friendship.friendship_id], (err) => {
     if (err) {
       console.error('차단 해제 오류:', err);
       return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
     }
     
     res.status(200).json({ message: '차단이 해제되었습니다.' });
   });
 });
});

// 요청 확인 엔드포인트 추가
router.get('/request/:requestId/check', auth, (req, res) => {
 const requestId = req.params.requestId;
 const userId = req.user.user_id;
 
 console.log(`요청 확인: ID=${requestId}, 사용자=${userId}`);
 
 const sql = `
   SELECT fr.*, u.user_name, u.user_nickname 
   FROM FriendRequests fr
   JOIN Users u ON fr.sender_id = u.user_id
   WHERE fr.request_id = ? AND fr.recipient_id = ? AND fr.request_status = 'pending'
 `;
 
 db.query(sql, [requestId, userId], (err, results) => {
   if (err) {
     console.error('요청 확인 오류:', err);
     return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
   }
   
   if (results.length === 0) {
     console.log(`요청 ID=${requestId} 찾지 못함`);
     return res.status(404).json({ error: '유효한 친구 요청을 찾을 수 없습니다.' });
   }
   
   console.log(`요청 확인 성공: ID=${requestId}`);
   res.status(200).json({ 
     valid: true, 
     request: results[0]
   });
 });
});

// 친구 관계 초기화 API (관리자용 또는 테스트용)
router.post('/reset-relationships', auth, (req, res) => {
 const userId = req.user.user_id;
 const { target_id } = req.body; // 특정 사용자의 관계만 초기화할 경우 사용
 
 console.log(`관계 초기화 요청: 사용자=${userId}${target_id ? `, 대상=${target_id}` : ''}`);
 
 // 관리자 권한 또는 자신의 관계만 초기화 가능
 db.query('SELECT user_role FROM Users WHERE user_id = ?', [userId], (err, results) => {
   if (err) {
     console.error('사용자 권한 확인 오류:', err);
     return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
   }
   
   const isAdmin = results.length > 0 && results[0].user_role === 'admin';
   
   if (!isAdmin && target_id && target_id !== userId) {
     return res.status(403).json({ error: '권한이 없습니다.' });
   }
   
   let deleteSQL;
   let params = [];
   
   if (target_id) {
     // 특정 사용자의 관계만 초기화
     deleteSQL = `
       DELETE FROM Friendships 
       WHERE user_id_1 = ? OR user_id_2 = ?
     `;
     params = [target_id, target_id];
   } else if (isAdmin) {
     // 관리자: 모든 관계 초기화
     deleteSQL = `DELETE FROM Friendships`;
     params = [];
   } else {
     // 일반 사용자: 자신의 관계만 초기화
     deleteSQL = `
       DELETE FROM Friendships 
       WHERE user_id_1 = ? OR user_id_2 = ?
     `;
     params = [userId, userId];
   }
   
   db.query(deleteSQL, params, (err, result) => {
     if (err) {
       console.error('친구 관계 초기화 오류:', err);
       return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
     }
     
     console.log(`친구 관계 초기화 완료: ${result.affectedRows}개 관계 삭제됨`);
     
     // 친구 요청도 초기화할지 확인
     const resetRequests = req.body.reset_requests === true;
     
     if (resetRequests) {
       let requestDeleteSQL;
       let requestParams = [];
       
       if (target_id) {
         // 특정 사용자의 요청만 초기화
         requestDeleteSQL = `
           DELETE FROM FriendRequests 
           WHERE sender_id = ? OR recipient_id = ?
         `;
         requestParams = [target_id, target_id];
       } else if (isAdmin) {
         // 관리자: 모든 요청 초기화
         requestDeleteSQL = `DELETE FROM FriendRequests`;
         requestParams = [];
       } else {
         // 일반 사용자: 자신의 요청만 초기화
         requestDeleteSQL = `
           DELETE FROM FriendRequests 
           WHERE sender_id = ? OR recipient_id = ?
         `;
         requestParams = [userId, userId];
       }
       
       db.query(requestDeleteSQL, requestParams, (err, requestResult) => {
         if (err) {
           console.error('친구 요청 초기화 오류:', err);
           return res.status(200).json({ 
             message: '친구 관계가 초기화되었지만, 친구 요청 초기화 중 오류가 발생했습니다.',
             relationshipsDeleted: result.affectedRows
           });
         }
         
         console.log(`친구 요청 초기화 완료: ${requestResult.affectedRows}개 요청 삭제됨`);
         res.status(200).json({
           message: '친구 관계와 요청이 초기화되었습니다.',
           relationshipsDeleted: result.affectedRows,
           requestsDeleted: requestResult.affectedRows
         });
       });
     } else {
       res.status(200).json({
         message: '친구 관계가 초기화되었습니다.',
         relationshipsDeleted: result.affectedRows
       });
     }
   });
 });
});

module.exports = router;