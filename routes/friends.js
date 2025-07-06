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

// 차단 상태 확인 헬퍼 함수
const isUserBlockedBy = (friendship, blockerId, blockedId) => {
  if (!friendship) return false;
  
  if (friendship.user_id_1 === blockerId) {
    return !!friendship.is_blocked_by_user_1;
  } else if (friendship.user_id_2 === blockerId) {
    return !!friendship.is_blocked_by_user_2;
  }
  return false;
};

// 사용자 검색 API (차단된 사용자 필터링 수정)
router.get('/search', auth, (req, res) => {
  const searchTerm = req.query.term;
  const userId = req.user.user_id;
  
  if (!searchTerm) {
    return res.status(400).json({ error: '검색어가 필요합니다.' });
  }
  
  console.log(`사용자 검색 요청: 검색어="${searchTerm}", 사용자=${userId}`);
  
  // 🔥 수정: 차단된 사용자는 검색 결과에서 제외하는 올바른 로직
  const searchSQL = `
    SELECT u.user_id, u.user_name, u.user_nickname, u.user_email, u.user_profile_picture_url
    FROM Users u
    LEFT JOIN Friendships f ON (
      (f.user_id_1 = ? AND f.user_id_2 = u.user_id) OR 
      (f.user_id_2 = ? AND f.user_id_1 = u.user_id)
    )
    WHERE (u.user_id LIKE ? OR u.user_name LIKE ? OR u.user_nickname LIKE ?) 
    AND u.user_id != ? 
    AND u.user_status = 'active'
    AND (
      f.friendship_id IS NULL OR 
      (
        (f.user_id_1 = ? AND f.user_id_2 = u.user_id AND (IFNULL(f.is_blocked_by_user_1, 0) = 0 AND IFNULL(f.is_blocked_by_user_2, 0) = 0)) OR
        (f.user_id_2 = ? AND f.user_id_1 = u.user_id AND (IFNULL(f.is_blocked_by_user_1, 0) = 0 AND IFNULL(f.is_blocked_by_user_2, 0) = 0))
      )
    )
    ORDER BY 
      CASE 
        WHEN u.user_nickname LIKE ? THEN 1  -- 닉네임 매치 우선순위 1
        WHEN u.user_id LIKE ? THEN 2         -- 아이디 매치 우선순위 2  
        WHEN u.user_name LIKE ? THEN 3       -- 이름 매치 우선순위 3
        ELSE 4 
      END,
      u.user_nickname, u.user_id
    LIMIT 20
  `;
  
  // 각 검색어에 와일드카드 추가
  const searchPattern = `%${searchTerm}%`;
  
  // 🔥 수정: 매개변수 배열 구성 (userId 추가)
  const searchParams = [
    userId, userId, // LEFT JOIN 조건용
    searchPattern, searchPattern, searchPattern, // WHERE 조건용
    userId, // WHERE 조건용 (자기 자신 제외)
    userId, userId, // 차단 조건용 (추가)
    searchPattern, // ORDER BY 닉네임 매치용
    searchPattern, // ORDER BY 아이디 매치용  
    searchPattern  // ORDER BY 이름 매치용
  ];
  
  db.query(searchSQL, searchParams, (err, results) => {
    if (err) {
      console.error('사용자 검색 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    console.log(`검색어 "${searchTerm}"에 대한 결과 ${results.length}개:`, results.map(r => ({ user_id: r.user_id, user_nickname: r.user_nickname, user_name: r.user_name })));
    
    if (results.length > 0) {
      // 친구 관계와 요청 상태 정보 추가
      const userIds = results.map(user => user.user_id);
      const placeholders = userIds.map(() => '?').join(',');
      
      const enrichSQL = `
        SELECT 
          u.user_id,
          u.user_name as user_name,
          u.user_nickname,
          u.user_email,
          u.user_profile_picture_url,
          f.status as friendship_status,
          CASE 
            WHEN f.user_id_1 = ? THEN f.is_blocked_by_user_1
            WHEN f.user_id_2 = ? THEN f.is_blocked_by_user_2
            ELSE 0
          END as is_blocked,
          fr_sent.request_id as sent_request_id,
          fr_sent.request_status as sent_request_status,
          fr_received.request_id as received_request_id,
          fr_received.request_status as received_request_status
        FROM Users u
        LEFT JOIN Friendships f ON (
          (f.user_id_1 = ? AND f.user_id_2 = u.user_id) OR 
          (f.user_id_2 = ? AND f.user_id_1 = u.user_id)
        )
        LEFT JOIN FriendRequests fr_sent ON (
          fr_sent.sender_id = ? AND fr_sent.recipient_id = u.user_id 
          AND fr_sent.request_status = 'pending'
        )
        LEFT JOIN FriendRequests fr_received ON (
          fr_received.sender_id = u.user_id AND fr_received.recipient_id = ? 
          AND fr_received.request_status = 'pending'
        )
        WHERE u.user_id IN (${placeholders})
      `;
      
      const enrichParams = [userId, userId, userId, userId, userId, userId, ...userIds];
      
      db.query(enrichSQL, enrichParams, (err, enrichedResults) => {
        if (err) {
          console.error('검색 결과 보강 오류:', err);
          return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
        }
        
        const finalResults = enrichedResults.map(userData => {
          // 친구 상태 확인
          userData.is_friend = userData.friendship_status === 'active';
          
          // 요청 상태 확인
          userData.request_sent = !!userData.sent_request_id;
          userData.request_received = !!userData.received_request_id;
          userData.request_id = userData.sent_request_id || userData.received_request_id || null;
          
          // 차단 상태 처리 (이미 올바르게 계산됨)
          if (userData.friendship_status) {
            const friendship = enrichedResults.find(f => f.user_id === userData.user_id);
            if (friendship) {
              userData.is_blocked = !!userData.is_blocked;
            }
          }
          
          return userData;
        });
        
        res.status(200).json({ users: finalResults });
      });
    } else {
      // 검색 결과가 없는 경우
      res.status(200).json({ users: [] });
    }
  });
});

// 친구 요청 보내기 API (차단 상태 확인 추가)
router.post('/request', auth, (req, res) => {
  const { recipient_id } = req.body;
  const sender_id = req.user.user_id;
  
  if (!recipient_id) {
    return res.status(400).json({ error: '요청 대상 ID가 필요합니다.' });
  }
  
  if (sender_id === recipient_id) {
    return res.status(400).json({ error: '자기 자신에게 친구 요청을 보낼 수 없습니다.' });
  }
  
  // 차단 상태 확인 (나를 차단했거나 내가 차단한 경우)
  const checkBlockSQL = `
    SELECT * FROM Friendships 
    WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
    AND (is_blocked_by_user_1 = 1 OR is_blocked_by_user_2 = 1)
  `;
  
  db.query(checkBlockSQL, [sender_id, recipient_id, recipient_id, sender_id], (err, blockResults) => {
    if (err) {
      console.error('차단 상태 확인 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    if (blockResults.length > 0) {
      const friendship = blockResults[0];
      
      // 상대방이 나를 차단한 경우 요청 차단
      if ((friendship.user_id_1 === recipient_id && friendship.is_blocked_by_user_1) ||
          (friendship.user_id_2 === recipient_id && friendship.is_blocked_by_user_2)) {
        return res.status(403).json({ error: '친구 요청을 보낼 수 없습니다.' });
      }
      
      // 내가 상대를 차단한 경우에도 요청 차단
      if ((friendship.user_id_1 === sender_id && friendship.is_blocked_by_user_1) ||
          (friendship.user_id_2 === sender_id && friendship.is_blocked_by_user_2)) {
        return res.status(403).json({ error: '차단된 사용자에게는 친구 요청을 보낼 수 없습니다.' });
      }
    }
    
    // 이미 친구인지 확인
    const checkFriendshipSQL = `
      SELECT * FROM Friendships 
      WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
      AND status = 'active'
      AND (is_blocked_by_user_1 = 0 OR is_blocked_by_user_1 IS NULL)
      AND (is_blocked_by_user_2 = 0 OR is_blocked_by_user_2 IS NULL)
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
              
              // 친구 관계 생성 또는 업데이트
              createOrUpdateFriendship(sender_id, recipient_id, res);
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
});

// 친구 관계 생성 또는 업데이트 헬퍼 함수
function createOrUpdateFriendship(user1, user2, res) {
  const [smallerId, largerId] = user1 < user2 ? [user1, user2] : [user2, user1];
  
  // 기존 친구 관계가 있는지 확인
  const checkExistingSQL = `
    SELECT * FROM Friendships 
    WHERE user_id_1 = ? AND user_id_2 = ?
  `;
  
  db.query(checkExistingSQL, [smallerId, largerId], (err, results) => {
    if (err) {
      console.error('기존 친구 관계 확인 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    if (results.length > 0) {
      // 기존 관계가 있으면 활성화 및 차단 해제
      const updateSQL = `
        UPDATE Friendships 
        SET status = 'active', is_blocked_by_user_1 = 0, is_blocked_by_user_2 = 0, updated_at = NOW() 
        WHERE user_id_1 = ? AND user_id_2 = ?
      `;
      
      db.query(updateSQL, [smallerId, largerId], (err) => {
        if (err) {
          console.error('친구 관계 업데이트 오류:', err);
          return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
        }
        
        res.status(200).json({ 
          message: '상대방이 보낸 친구 요청을 수락하여 친구가 되었습니다.',
          auto_accepted: true
        });
      });
    } else {
      // 새 친구 관계 생성 (friendship_type 필드 제거)
      const createSQL = `
        INSERT INTO Friendships (user_id_1, user_id_2, status, created_at, updated_at)
        VALUES (?, ?, 'active', NOW(), NOW())
      `;
      
      db.query(createSQL, [smallerId, largerId], (err) => {
        if (err) {
          console.error('친구 관계 생성 오류:', err);
          return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
        }
        
        res.status(200).json({ 
          message: '상대방이 보낸 친구 요청을 수락하여 친구가 되었습니다.',
          auto_accepted: true
        });
      });
    }
  });
}

// 친구 차단 API (친구 관계 유지하면서 차단 플래그만 설정)
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
      // 이미 친구 관계가 있는 경우, 차단 플래그만 설정 (친구 관계는 유지)
      const friendship = results[0];
      
      let isBlockedByUser1 = friendship.is_blocked_by_user_1 || 0;
      let isBlockedByUser2 = friendship.is_blocked_by_user_2 || 0;
      
      if (friendship.user_id_1 === user_id) {
        isBlockedByUser1 = 1; // user_id_1이 차단함
      } else if (friendship.user_id_2 === user_id) {
        isBlockedByUser2 = 1; // user_id_2가 차단함
      }
      
      const updateSQL = `
        UPDATE Friendships 
        SET is_blocked_by_user_1 = ?, is_blocked_by_user_2 = ?, updated_at = NOW() 
        WHERE friendship_id = ?
      `;
      
      db.query(updateSQL, [isBlockedByUser1, isBlockedByUser2, friendship.friendship_id], (err) => {
        if (err) {
          console.error('차단 상태 업데이트 오류:', err);
          return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
        }
        
        // 위치 공유 종료 (차단 시 위치 공유 자동 종료)
        const terminateSharingSQL = `
          UPDATE LocationSharing
          SET status = 'inactive', end_time = NOW()
          WHERE ((sharer_id = ? AND sharee_id = ?) OR (sharer_id = ? AND sharee_id = ?))
          AND status = 'active'
        `;
        
        db.query(terminateSharingSQL, [user_id, friend_id, friend_id, user_id], () => {
          console.log(`친구 차단 완료 (관계 유지): ${user_id} -> ${friend_id}`);
          res.status(200).json({ message: '사용자가 차단되었습니다. 친구 관계는 유지됩니다.' });
        });
      });
    } else {
      // 친구 관계가 없는 경우, 차단된 관계 새로 생성 (friendship_type 필드 제거)
      const [smallerId, largerId] = user_id < friend_id ? 
        [user_id, friend_id] : [friend_id, user_id];
        
      const isBlockedByUser1 = smallerId === user_id ? 1 : 0;
      const isBlockedByUser2 = largerId === user_id ? 1 : 0;
      
      const insertSQL = `
        INSERT INTO Friendships (user_id_1, user_id_2, status, is_blocked_by_user_1, is_blocked_by_user_2, created_at, updated_at)
        VALUES (?, ?, 'inactive', ?, ?, NOW(), NOW())
      `;
      
      db.query(insertSQL, [smallerId, largerId, isBlockedByUser1, isBlockedByUser2], (err) => {
        if (err) {
          console.error('차단 관계 생성 오류:', err);
          return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
        }
        
        console.log(`차단 관계 생성 완료: ${user_id} -> ${friend_id}`);
        res.status(200).json({ message: '사용자가 차단되었습니다.' });
      });
    }
  });
});

// 차단 해제 API
router.post('/unblock', auth, (req, res) => {
  const { blocked_id } = req.body;
  const user_id = req.user.user_id;
  
  if (!blocked_id) {
    return res.status(400).json({ error: '차단 해제할 사용자 ID가 필요합니다.' });
  }
  
  console.log(`차단 해제 요청: 사용자=${user_id}, 차단된 사용자=${blocked_id}`);
  
  // 차단 관계 확인
  const checkBlockSQL = `
    SELECT * FROM Friendships 
    WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
  `;
  
  db.query(checkBlockSQL, [user_id, blocked_id, blocked_id, user_id], (err, results) => {
    if (err) {
      console.error('차단 관계 확인 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: '차단 관계를 찾을 수 없습니다.' });
    }
    
    const friendship = results[0];
    
    // 차단 플래그 해제 (내가 차단한 것만 해제)
    let isBlockedByUser1 = friendship.is_blocked_by_user_1 || 0;
    let isBlockedByUser2 = friendship.is_blocked_by_user_2 || 0;
    
    if (friendship.user_id_1 === user_id) {
      isBlockedByUser1 = 0; // user_id_1의 차단 해제
    } else if (friendship.user_id_2 === user_id) {
      isBlockedByUser2 = 0; // user_id_2의 차단 해제
    }
    
    const unblockSQL = `
      UPDATE Friendships 
      SET is_blocked_by_user_1 = ?, is_blocked_by_user_2 = ?, updated_at = NOW() 
      WHERE friendship_id = ?
    `;
    
    db.query(unblockSQL, [isBlockedByUser1, isBlockedByUser2, friendship.friendship_id], (err) => {
      if (err) {
        console.error('차단 해제 오류:', err);
        return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
      }
      
      console.log(`차단 해제 완료: ${user_id} -> ${blocked_id}`);
      res.status(200).json({ message: '차단이 해제되었습니다.' });
    });
  });
});

// 차단 목록 조회 API
router.get('/blocked', auth, (req, res) => {
  const userId = req.user.user_id;
  
  console.log(`차단 목록 조회 요청: 사용자=${userId}`);
  
  // 내가 차단한 사용자 목록 조회
const sql = `
    SELECT 
      f.friendship_id,
      CASE 
        WHEN f.user_id_1 = ? AND f.is_blocked_by_user_1 = 1 THEN f.user_id_2
        WHEN f.user_id_2 = ? AND f.is_blocked_by_user_2 = 1 THEN f.user_id_1
        ELSE NULL
      END as blocked_id,
      u.user_name as name,
      u.user_nickname as nickname,
      u.user_profile_picture_url,  
      f.status as friendship_status
    FROM Friendships f
    JOIN Users u ON (
      CASE 
        WHEN f.user_id_1 = ? AND f.is_blocked_by_user_1 = 1 THEN f.user_id_2
        WHEN f.user_id_2 = ? AND f.is_blocked_by_user_2 = 1 THEN f.user_id_1
        ELSE NULL
      END = u.user_id
    )
    WHERE ((f.user_id_1 = ? AND f.is_blocked_by_user_1 = 1)
      OR (f.user_id_2 = ? AND f.is_blocked_by_user_2 = 1))
    ORDER BY u.user_name
  `;
  
  db.query(sql, [userId, userId, userId, userId, userId, userId], (err, results) => {
    if (err) {
      console.error('차단 목록 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    // null blocked_id 필터링
    const blockedUsers = results
      .filter(user => user.blocked_id !== null)
      .map(user => ({
        id: user.blocked_id,
        name: user.name || user.blocked_id,
        nickname: user.nickname || '',
        user_profile_picture_url: user.user_profile_picture_url, 
        is_friend: user.friendship_status === 'active' // 친구 관계 여부
      }));
    
    console.log(`차단 목록 조회 결과: ${blockedUsers.length}명`);
    res.status(200).json({ blockedUsers });
  });
});

// 받은 친구 요청 목록 조회 API (차단된 사용자의 요청 필터링)
router.get('/requests', auth, (req, res) => {
  const userId = req.user.user_id;
  
  // 나를 차단하지 않은 사용자의 요청만 조회
  const sql = `
    SELECT fr.request_id, fr.sender_id, fr.recipient_id, fr.request_status, fr.created_at,
           u.user_name as sender_name, u.user_nickname as sender_nickname,
           u.user_profile_picture_url as sender_profile_picture_url
    FROM FriendRequests fr
    JOIN Users u ON fr.sender_id = u.user_id
    LEFT JOIN Friendships f ON (
      (f.user_id_1 = fr.sender_id AND f.user_id_2 = ?) OR 
      (f.user_id_2 = fr.sender_id AND f.user_id_1 = ?)
    )
    WHERE fr.recipient_id = ? AND fr.request_status = 'pending'
    AND (
      f.friendship_id IS NULL OR 
      (f.user_id_1 = fr.sender_id AND IFNULL(f.is_blocked_by_user_1, 0) = 0) OR
      (f.user_id_2 = fr.sender_id AND IFNULL(f.is_blocked_by_user_2, 0) = 0)
    )
    ORDER BY fr.created_at DESC
  `;
  
  db.query(sql, [userId, userId, userId], (err, results) => {
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
    SELECT fr.*, 
    u.user_name as sender_name, 
    u.user_nickname as sender_nickname,
    u.user_profile_picture_url as sender_profile_picture_url  
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
    
    // 차단 상태 확인 (서로 차단하지 않은 경우에만 수락 가능)
    const checkBlockSQL = `
      SELECT * FROM Friendships 
      WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
      AND (is_blocked_by_user_1 = 1 OR is_blocked_by_user_2 = 1)
    `;
    
    db.query(checkBlockSQL, [request.sender_id, userId, userId, request.sender_id], (err, blockResults) => {
      if (err) {
        console.error('차단 상태 확인 오류:', err);
        return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
      }
      
      if (blockResults.length > 0) {
        return res.status(403).json({ error: '차단된 사용자의 요청은 수락할 수 없습니다.' });
      }
      
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
        
        // 친구 관계 생성 또는 업데이트
        createOrUpdateFriendshipForAccept(request.sender_id, userId, res, request.sender_name, request.sender_nickname);
      });
    });
  });
});

// 친구 요청 수락용 친구 관계 생성 헬퍼 함수
function createOrUpdateFriendshipForAccept(senderId, recipientId, res, senderName, senderNickname) {
  const [smallerId, largerId] = senderId < recipientId ? 
    [senderId, recipientId] : [recipientId, senderId];
  
  console.log(`친구 관계 확인: user_id_1=${smallerId}, user_id_2=${largerId}`);
  
  // 기존 친구 관계가 있는지 확인
  const checkFriendshipSQL = `
    SELECT * FROM Friendships 
    WHERE user_id_1 = ? AND user_id_2 = ?
  `;
  
  db.query(checkFriendshipSQL, [smallerId, largerId], (err, friendshipResults) => {
    if (err) {
      console.error('친구 관계 조회 오류:', err);
      return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
    
    if (friendshipResults.length > 0) {
      // 기존 관계가 있다면 활성화 및 차단 해제
      const friendship = friendshipResults[0];
      console.log(`기존 친구 관계 발견: ID=${friendship.friendship_id}, 상태=${friendship.status} - 활성화`);
      
      const updateFriendshipSQL = `
        UPDATE Friendships
        SET status = 'active', is_blocked_by_user_1 = 0, is_blocked_by_user_2 = 0, updated_at = NOW()
        WHERE friendship_id = ?
      `;
      
      db.query(updateFriendshipSQL, [friendship.friendship_id], (err) => {
        if (err) {
          console.error('친구 관계 업데이트 오류:', err);
          return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
        }
        
        console.log('친구 관계 활성화 완료');
        
        res.status(200).json({ 
          message: '친구 요청을 수락했습니다.',
          friend: {
            id: senderId,
            name: senderName,
            nickname: senderNickname || ''
          }
        });
      });
    } else {
      // 새 친구 관계 생성 (friendship_type 필드 제거)
      console.log(`새 친구 관계 생성: user_id_1=${smallerId}, user_id_2=${largerId}`);
      
      const createFriendshipSQL = `
        INSERT INTO Friendships (user_id_1, user_id_2, status, created_at, updated_at)
        VALUES (?, ?, 'active', NOW(), NOW())
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
    
    // 요청 삭제
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

// 친구 목록 조회 API (차단되지 않은 친구만 조회)
router.get('/list', auth, (req, res) => {
  const userId = req.user.user_id;
  
  console.log(`친구 목록 조회 요청: 사용자=${userId}`);
  
const sql = `
    SELECT 
      CASE 
        WHEN f.user_id_1 = ? THEN f.user_id_2
        ELSE f.user_id_1
      END as friend_id,
      u.user_name as name,
      u.user_nickname as nickname,
      u.user_profile_picture_url,
      l.latitude,
      l.longitude,
      l.updated_at,
      f.is_blocked_by_user_1,
      f.is_blocked_by_user_2,
      f.user_id_1,
      f.user_id_2
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
    
    // 차단되지 않은 친구만 필터링
    const friends = results
      .filter(friend => {
        // 내가 친구를 차단했거나, 친구가 나를 차단한 경우 제외
        const iBlockedFriend = 
          (friend.user_id_1 === userId && friend.is_blocked_by_user_1) ||
          (friend.user_id_2 === userId && friend.is_blocked_by_user_2);
        
        const friendBlockedMe = 
          (friend.user_id_1 === friend.friend_id && friend.is_blocked_by_user_1) ||
          (friend.user_id_2 === friend.friend_id && friend.is_blocked_by_user_2);
        
        // 서로 차단하지 않은 경우만 포함
        const shouldInclude = !iBlockedFriend && !friendBlockedMe;
        
        if (!shouldInclude) {
          console.log(`친구 목록에서 제외: ${friend.friend_id} (차단 상태 - 내가 차단: ${iBlockedFriend}, 상대가 차단: ${friendBlockedMe})`);
        }
        
        return shouldInclude;
      })
     .map(friend => ({
  id: friend.friend_id,
  name: friend.name || friend.friend_id,
  nickname: friend.nickname || '',
  user_profile_picture_url: friend.user_profile_picture_url, // 추가
  isOnline: friend.isOnline || false
}));
    
    console.log(`친구 목록 조회 결과: 전체 ${results.length}명 중 표시 ${friends.length}명`);
    res.status(200).json({ friends });
  });
});

// 친구 삭제 API (차단 목록에서 사용)
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
          SET status = 'inactive', end_time = NOW()
          WHERE ((sharer_id = ? AND sharee_id = ?) OR (sharer_id = ? AND sharee_id = ?))
          AND status = 'active'
        `;
        
        db.query(terminateSharingSQL, [user_id, friend_id, friend_id, user_id], () => {
          // 오류가 있어도 무시하고 진행
          res.status(200).json({ message: '친구 관계가 완전히 삭제되었습니다.' });
        });
      });
    });
  });
});

module.exports = router;