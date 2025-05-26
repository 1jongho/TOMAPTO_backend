// socket.js
const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const db = require('./db');

// 소켓 사용자 맵
const connectedUsers = new Map();

// 차단 상태 확인 헬퍼 함수
const checkBlockStatus = (userId1, userId2, callback) => {
  const sql = `
    SELECT * FROM Friendships 
    WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))
    AND (is_blocked_by_user_1 = 1 OR is_blocked_by_user_2 = 1)
  `;
  
  db.query(sql, [userId1, userId2, userId2, userId1], (err, results) => {
    if (err) {
      console.error('차단 상태 확인 오류:', err);
      return callback(false, false); // 오류 시 차단되지 않은 것으로 간주
    }
    
    if (results.length === 0) {
      return callback(false, false); // 차단 관계 없음
    }
    
    const friendship = results[0];
    
    // userId1이 userId2를 차단했는지 확인
    const user1BlockedUser2 = 
      (friendship.user_id_1 === userId1 && friendship.is_blocked_by_user_1) ||
      (friendship.user_id_2 === userId1 && friendship.is_blocked_by_user_2);
    
    // userId2가 userId1을 차단했는지 확인
    const user2BlockedUser1 = 
      (friendship.user_id_1 === userId2 && friendship.is_blocked_by_user_1) ||
      (friendship.user_id_2 === userId2 && friendship.is_blocked_by_user_2);
    
    callback(user1BlockedUser2, user2BlockedUser1);
  });
};

// 소켓 서버 초기화 함수
function initSocketServer(server) {
  const io = socketIO(server, {
    cors: {
      origin: "*", // 개발 환경에서는 모든 도메인 허용, 실제 환경에서는 구체적인 도메인 지정 필요
      methods: ["GET", "POST"],
      allowedHeaders: ["Authorization"],
      credentials: true
    }
  });

  // 인증 미들웨어
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token || 
                   socket.handshake.headers.authorization?.split(' ')[1];
      
      if (!token) {
        return next(new Error('인증 토큰이 필요합니다.'));
      }
      
      // 토큰 검증
      const decoded = jwt.verify(token, process.env.JWT_SECRET || '7belly_fat4');
      
      // 소켓 객체에 사용자 정보 저장
      socket.user = {
        id: decoded.user_id
      };
      
      // 사용자 정보를 DB에서 가져옴
      const sql = `SELECT user_id, user_name, user_nickname FROM Users WHERE user_id = ?`;
      
      db.query(sql, [decoded.user_id], (err, results) => {
        if (err || results.length === 0) {
          return next(new Error('유효하지 않은 사용자입니다.'));
        }
        
        // 사용자 정보 추가
        socket.user.name = results[0].user_name || decoded.user_id;
        socket.user.nickname = results[0].user_nickname || '';
        
        next();
      });
    } catch (error) {
      console.error('소켓 인증 오류:', error);
      next(new Error('인증 오류가 발생했습니다.'));
    }
  });

  // 연결 이벤트 처리
  io.on('connection', (socket) => {
    const userId = socket.user.id;
    console.log(`사용자 연결: ${userId}`);
    
    // 사용자 소켓 맵에 추가
    connectedUsers.set(userId, socket.id);
    
    // 연결 성공 이벤트 전송
    socket.emit('connect_success', {
      message: '연결 성공',
      user: {
        id: userId,
        name: socket.user.name,
        nickname: socket.user.nickname
      }
    });
    
    // 친구들에게 온라인 상태 알림
    notifyFriendsOnlineStatus(userId, true);
    
    // 친구 요청 이벤트 처리 (차단 확인 추가)
    socket.on('send_friend_request', (data) => {
      const { recipient_id } = data;
      
      if (!recipient_id) {
        return socket.emit('error', { message: '요청 대상 ID가 필요합니다.' });
      }
      
      // 차단 상태 확인
      checkBlockStatus(userId, recipient_id, (senderBlockedRecipient, recipientBlockedSender) => {
        // 발신자가 수신자를 차단했거나, 수신자가 발신자를 차단한 경우 요청 차단
        if (senderBlockedRecipient || recipientBlockedSender) {
          console.log(`친구 요청 차단됨: ${userId} -> ${recipient_id} (차단 상태)`);
          return socket.emit('error', { message: '친구 요청을 보낼 수 없습니다.' });
        }
        
        // 친구 요청 정보 가져오기
        const sql = `
          SELECT u.user_name, u.user_nickname 
          FROM Users u 
          WHERE u.user_id = ?
        `;
        
        db.query(sql, [userId], (err, results) => {
          if (err || results.length === 0) {
            return socket.emit('error', { message: '사용자 정보를 가져오는데 실패했습니다.' });
          }
          
          const sender = results[0];
          
          // 수신자 소켓 ID 확인
          const recipientSocketId = connectedUsers.get(recipient_id);
          
          // 수신자가 온라인이면 실시간 알림
          if (recipientSocketId) {
            io.to(recipientSocketId).emit('friend_request', {
              sender_id: userId,
              sender_name: sender.user_name,
              sender_nickname: sender.user_nickname,
              timestamp: new Date()
            });
          }
          
          socket.emit('friend_request_sent', {
            recipient_id,
            timestamp: new Date()
          });
        });
      });
    });
    
    // 친구 요청 수락 이벤트 처리 (차단 확인 추가)
    socket.on('accept_friend_request', (data) => {
      const { request_id } = data;
      
      if (!request_id) {
        return socket.emit('error', { message: '요청 ID가 필요합니다.' });
      }

      const requestIdStr = String(request_id);
      
      // 요청 정보 가져오기
      const sql = `
        SELECT fr.sender_id, fr.recipient_id,
               us.user_name as sender_name, us.user_nickname as sender_nickname,
               ur.user_name as recipient_name, ur.user_nickname as recipient_nickname
        FROM FriendRequests fr
        JOIN Users us ON fr.sender_id = us.user_id
        JOIN Users ur ON fr.recipient_id = ur.user_id
        WHERE fr.request_id = ? AND fr.recipient_id = ? AND fr.request_status = 'pending'
      `;
      
      db.query(sql, [request_id, userId], (err, results) => {
        if (err || results.length === 0) {
          return socket.emit('error', { message: '유효한 친구 요청을 찾을 수 없습니다.' });
        }
        
        const request = results[0];
        
        // 차단 상태 확인
        checkBlockStatus(request.sender_id, userId, (senderBlockedRecipient, recipientBlockedSender) => {
          // 서로 차단한 경우 수락 불가
          if (senderBlockedRecipient || recipientBlockedSender) {
            console.log(`친구 요청 수락 차단됨: ${request.sender_id} <-> ${userId} (차단 상태)`);
            return socket.emit('error', { message: '차단된 사용자의 요청은 수락할 수 없습니다.' });
          }
          
          // 발신자 소켓 ID 확인
          const senderSocketId = connectedUsers.get(request.sender_id);
          
          // 발신자가 온라인이면 실시간 알림
          if (senderSocketId) {
            io.to(senderSocketId).emit('friend_accept', {
              user_id: userId,
              user_name: request.recipient_name,
              user_nickname: request.recipient_nickname,
              timestamp: new Date()
            });
          }
          
          socket.emit('friend_accept_success', {
            friend_id: request.sender_id,
            friend_name: request.sender_name,
            friend_nickname: request.sender_nickname,
            timestamp: new Date()
          });
        });
      });
    });
    
    // 위치 업데이트 이벤트 처리 (차단된 사용자에게는 전송하지 않음)
    socket.on('update_location', (data) => {
      const { latitude, longitude, heading, accuracy } = data;
      
      if (!latitude || !longitude) {
        return socket.emit('error', { message: '위도와 경도는 필수 입력값입니다.' });
      }
      
      // 위치 공유 중인 친구 목록 가져오기
      const sharingSQL = `
        SELECT ls.sharee_id
        FROM LocationSharing ls
        WHERE ls.sharer_id = ?
        AND ls.status = 'active'
        AND (ls.end_time IS NULL OR ls.end_time > NOW())
      `;
      
      db.query(sharingSQL, [userId], (err, sharingResults) => {
        if (err) {
          console.error('위치 공유 목록 조회 오류:', err);
          return;
        }
        
        // 위치 공유 중인 친구들에게 위치 업데이트 알림 (차단되지 않은 경우만)
        sharingResults.forEach(sharing => {
          checkBlockStatus(userId, sharing.sharee_id, (senderBlockedFriend, friendBlockedSender) => {
            // 서로 차단하지 않은 경우에만 위치 정보 전송
            if (!senderBlockedFriend && !friendBlockedSender) {
              const friendSocketId = connectedUsers.get(sharing.sharee_id);
              
              if (friendSocketId) {
                io.to(friendSocketId).emit('location_update', {
                  user_id: userId,
                  latitude,
                  longitude,
                  heading,
                  accuracy,
                  timestamp: new Date()
                });
              }
            } else {
              console.log(`위치 공유 차단됨: ${userId} -> ${sharing.sharee_id} (차단 상태)`);
            }
          });
        });
      });
    });
    
    // 위치 공유 시작 이벤트 처리 (차단 확인 추가)
    socket.on('start_location_sharing', (data) => {
      const { friend_id, duration_minutes, unidirectional, direction } = data;
      
      if (!friend_id) {
        return socket.emit('error', { message: '친구 ID는 필수 입력값입니다.' });
      }
      
      // 차단 상태 확인
      checkBlockStatus(userId, friend_id, (userBlockedFriend, friendBlockedUser) => {
        // 서로 차단한 경우 위치 공유 불가
        if (userBlockedFriend || friendBlockedUser) {
          console.log(`위치 공유 시작 차단됨: ${userId} <-> ${friend_id} (차단 상태)`);
          return socket.emit('error', { message: '차단된 사용자와는 위치를 공유할 수 없습니다.' });
        }
        
        // 방향성 정확히 판단
        let sharerId = userId; // 기본값: 현재 사용자가 공유자
        let shareeId = friend_id; // 기본값: 친구가 수신자
        
        // direction 필드로 방향 결정 - 명시적으로 설정
        if (direction === 'friend_to_me') {
          // 친구가 나에게 공유하는 방향 (사용할 일 없음)
          sharerId = friend_id;
          shareeId = userId;
        } else if (direction === 'me_to_friend') {
          // 내가 친구에게 공유하는 방향 (기본값)
          sharerId = userId;
          shareeId = friend_id;
        }
        
        console.log(`위치 공유 방향: ${sharerId} -> ${shareeId}, 일방향: ${unidirectional}`);
        
        // 먼저 이미 활성화된 위치 공유가 있는지 확인
        const checkSharingSQL = `
          SELECT * FROM LocationSharing 
          WHERE sharer_id = ? AND sharee_id = ?
        `;
        
        db.query(checkSharingSQL, [sharerId, shareeId], (err, existingResults) => {
          if (err) {
            console.error('위치 공유 상태 확인 오류:', err);
            return socket.emit('error', { message: '서버 오류가 발생했습니다.' });
          }
          
          let endTime = null;
          if (duration_minutes) {
            // 현재 시간에 duration_minutes 분을 더해서 종료 시간 계산
            const now = new Date();
            endTime = new Date(now.getTime() + duration_minutes * 60000); // 밀리초로 변환
          }
          
          if (existingResults.length > 0) {
            // 기존 레코드가 있는 경우 업데이트
            const existingRecord = existingResults[0];
            const updateSharingSQL = `
              UPDATE LocationSharing 
              SET status = 'active', end_time = ?, updated_at = NOW() 
              WHERE sharing_id = ?
            `;
            
            db.query(updateSharingSQL, [endTime, existingRecord.sharing_id], (err, result) => {
              if (err) {
                console.error('위치 공유 업데이트 오류:', err);
                return socket.emit('error', { message: '위치 공유 설정에 실패했습니다.' });
              }
              
              // 친구 소켓 ID 확인
              const friendSocketId = connectedUsers.get(friend_id);
              
              // 친구가 온라인이면 실시간 알림
              if (friendSocketId) {
                io.to(friendSocketId).emit('location_sharing_started', {
                  user_id: userId,
                  user_name: socket.user.name,
                  user_nickname: socket.user.nickname,
                  duration_minutes,
                  timestamp: new Date()
                });
              }
              
              socket.emit('location_sharing_started_success', {
                friend_id,
                duration_minutes,
                timestamp: new Date()
              });
            });
          } else {
            // 새 레코드 추가 - 방향성 명확히 지정
            const insertSharingSQL = `
              INSERT INTO LocationSharing (sharer_id, sharee_id, status, start_time, end_time, created_at, updated_at) 
              VALUES (?, ?, 'active', NOW(), ?, NOW(), NOW())
            `;
            
            db.query(insertSharingSQL, [sharerId, shareeId, endTime], (err, result) => {
              if (err) {
                console.error('위치 공유 생성 오류:', err);
                return socket.emit('error', { message: '위치 공유 설정에 실패했습니다.' });
              }
              
              // 친구 소켓 ID 확인
              const friendSocketId = connectedUsers.get(friend_id);
              
              // 친구가 온라인이면 실시간 알림
              if (friendSocketId) {
                io.to(friendSocketId).emit('location_sharing_started', {
                  user_id: userId,
                  user_name: socket.user.name,
                  user_nickname: socket.user.nickname,
                  duration_minutes,
                  timestamp: new Date()
                });
              }
              
              socket.emit('location_sharing_started_success', {
                friend_id,
                duration_minutes,
                timestamp: new Date()
              });
            });
          }
        });
      });
    });
    
    // 위치 공유 종료 이벤트 처리
    socket.on('stop_location_sharing', (data) => {
      const { friend_id } = data;
      
      if (!friend_id) {
        return socket.emit('error', { message: '친구 ID는 필수 입력값입니다.' });
      }
      
      // 먼저 현재의 공유 상태를 확인
      const checkSharingSQL = `
        SELECT * FROM LocationSharing
        WHERE ((sharer_id = ? AND sharee_id = ?) OR (sharer_id = ? AND sharee_id = ?))
      `;
      
      db.query(checkSharingSQL, [userId, friend_id, friend_id, userId], (err, sharingResults) => {
        if (err) {
          console.error('위치 공유 상태 확인 오류:', err);
          return socket.emit('error', { message: '서버 오류가 발생했습니다.' });
        }
        
        if (sharingResults.length === 0) {
          return socket.emit('error', { message: '위치 공유 관계를 찾을 수 없습니다.' });
        }
        
        // 위치 공유 관계 비활성화 (status 조건 제거)
        const terminateSharingSQL = `
          UPDATE LocationSharing
          SET status = 'inactive', end_time = NOW(), updated_at = NOW()
          WHERE ((sharer_id = ? AND sharee_id = ?) OR (sharer_id = ? AND sharee_id = ?))
        `;
        
        db.query(terminateSharingSQL, [userId, friend_id, friend_id, userId], (err, result) => {
          if (err) {
            console.error('위치 공유 종료 오류:', err);
            return socket.emit('error', { message: '위치 공유 종료에 실패했습니다.' });
          }
          
          if (result.affectedRows === 0) {
            return socket.emit('error', { message: '위치 공유 종료 실패: 업데이트된 레코드가 없습니다.' });
          }
          
          // 친구 소켓 ID 확인
          const friendSocketId = connectedUsers.get(friend_id);
          
          // 친구가 온라인이면 실시간 알림
          if (friendSocketId) {
            io.to(friendSocketId).emit('location_sharing_stopped', {
              user_id: userId,
              timestamp: new Date()
            });
          }
          
          socket.emit('location_sharing_stopped_success', {
            friend_id,
            timestamp: new Date()
          });
        });
      });
    });
    
    // 연결 해제 이벤트 처리
    socket.on('disconnect', () => {
      console.log(`사용자 연결 해제: ${userId}`);
      
      // 사용자 소켓 맵에서 제거
      connectedUsers.delete(userId);
      
      // 친구들에게 오프라인 상태 알림
      notifyFriendsOnlineStatus(userId, false);
    });
  });
  
  // 친구들에게 온라인 상태 알림 함수 (차단된 친구에게는 알림 안함)
  function notifyFriendsOnlineStatus(userId, isOnline) {
    // 친구 목록 가져오기 (차단되지 않은 친구만)
    const sql = `
      SELECT 
        CASE 
          WHEN f.user_id_1 = ? THEN f.user_id_2
          ELSE f.user_id_1
        END as friend_id
      FROM Friendships f
      WHERE (f.user_id_1 = ? OR f.user_id_2 = ?)
      AND f.status = 'active'
      AND (IFNULL(f.is_blocked_by_user_1, 0) = 0 AND IFNULL(f.is_blocked_by_user_2, 0) = 0)
    `;
    
    db.query(sql, [userId, userId, userId], (err, results) => {
      if (err) {
        console.error('친구 목록 조회 오류:', err);
        return;
      }
      
      // 사용자 정보 가져오기
      const userInfoSQL = `
        SELECT user_id, user_name, user_nickname 
        FROM Users 
        WHERE user_id = ?
      `;
      
      db.query(userInfoSQL, [userId], (err, userResults) => {
        if (err || userResults.length === 0) {
          console.error('사용자 정보 조회 오류:', err);
          return;
        }
        
        const user = userResults[0];
        
        // 각 친구에게 상태 변경 알림 (차단 상태 재확인)
        results.forEach(friend => {
          checkBlockStatus(userId, friend.friend_id, (userBlockedFriend, friendBlockedUser) => {
            // 서로 차단하지 않은 경우에만 상태 알림 전송
            if (!userBlockedFriend && !friendBlockedUser) {
              const friendSocketId = connectedUsers.get(friend.friend_id);
              
              if (friendSocketId) {
                io.to(friendSocketId).emit('friend_status_change', {
                  user_id: user.user_id,
                  user_name: user.user_name,
                  user_nickname: user.user_nickname,
                  isOnline,
                  timestamp: new Date()
                });
              }
            } else {
              console.log(`상태 알림 차단됨: ${userId} -> ${friend.friend_id} (차단 상태)`);
            }
          });
        });
      });
    });
  }
  
  return io;
}

module.exports = initSocketServer;