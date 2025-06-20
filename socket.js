// socket.js - 정리된 버전
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
      
      // 요청자 정보 확인
      const sql = `
        SELECT sender_id, u.user_name, u.user_nickname 
        FROM FriendRequests fr
        JOIN Users u ON fr.sender_id = u.user_id
        WHERE fr.request_id = ? AND fr.recipient_id = ?
      `;
      
      db.query(sql, [request_id, userId], (err, results) => {
        if (err || results.length === 0) {
          return socket.emit('error', { message: '유효하지 않은 요청입니다.' });
        }
        
        const request = results[0];
        
        // 차단 상태 확인
        checkBlockStatus(request.sender_id, userId, (senderBlockedUser, userBlockedSender) => {
          if (senderBlockedUser || userBlockedSender) {
            console.log(`친구 요청 수락 차단됨: ${request.sender_id} <-> ${userId} (차단 상태)`);
            return socket.emit('error', { message: '친구 요청을 수락할 수 없습니다.' });
          }
          
          const senderSocketId = connectedUsers.get(request.sender_id);
          
          // 요청자가 온라인이면 실시간 알림
          if (senderSocketId) {
            io.to(senderSocketId).emit('friend_accepted', {
              accepter_id: userId,
              accepter_name: socket.user.name,
              accepter_nickname: socket.user.nickname,
              timestamp: new Date()
            });
          }
          
          socket.emit('friend_request_accepted', {
            request_id,
            sender_id: request.sender_id,
            timestamp: new Date()
          });
        });
      });
    });
    
    // 위치 업데이트 이벤트 처리 (heading, accuracy 제거)
    socket.on('update_location', (data) => {
      const { latitude, longitude } = data;
      
      if (!latitude || !longitude) {
        return socket.emit('error', { message: '위도와 경도는 필수 입력값입니다.' });
      }
      
      console.log(`위치 업데이트 수신 - 사용자: ${userId}, 위치: ${latitude}, ${longitude}`);
      
      // 데이터베이스에 위치 정보 업데이트
      const updateLocationSQL = `
        INSERT INTO Location (user_id, latitude, longitude, updated_at) 
        VALUES (?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE 
        latitude = VALUES(latitude), 
        longitude = VALUES(longitude), 
        updated_at = VALUES(updated_at)
      `;
      
      db.query(updateLocationSQL, [userId, latitude, longitude], (err, result) => {
        if (err) {
          console.error('위치 업데이트 실패:', err);
          return socket.emit('error', { message: '위치 업데이트에 실패했습니다.' });
        }
        
        console.log(`위치 업데이트 성공 - 사용자: ${userId}`);
        
        // 성공 응답
        socket.emit('location_updated', {
          success: true,
          user_id: userId,
          latitude: latitude,
          longitude: longitude,
          updated_at: new Date().toISOString()
        });
      });
      
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
    
    // 위치 공유 시작 이벤트 처리
    socket.on('start_location_sharing', (data) => {
      const { friend_id, duration_minutes, unidirectional, direction } = data;
      
      if (!friend_id) {
        return socket.emit('error', { message: '친구 ID는 필수 입력값입니다.' });
      }
      
      // 차단 상태 확인
      checkBlockStatus(userId, friend_id, (userBlockedFriend, friendBlockedUser) => {
        if (userBlockedFriend || friendBlockedUser) {
          console.log(`위치 공유 시작 차단됨: ${userId} <-> ${friend_id} (차단 상태)`);
          return socket.emit('error', { message: '차단된 사용자와는 위치를 공유할 수 없습니다.' });
        }
        
        // 개별 제어 요청인 경우 단방향으로만 처리
        if (unidirectional === true) {
          const sharerId = userId;
          const shareeId = friend_id;
          
          console.log(`개별 제어 - 단방향 위치 공유: ${sharerId} -> ${shareeId}`);
          
          let endTime = null;
          if (duration_minutes) {
            endTime = new Date(Date.now() + duration_minutes * 60000);
          }
          
          // 활성/비활성 상관없이 모든 기존 레코드 체크
          const checkSharingSQL = `
            SELECT * FROM LocationSharing 
            WHERE sharer_id = ? AND sharee_id = ?
          `;
          
          db.query(checkSharingSQL, [sharerId, shareeId], (err, existing) => {
            if (err) {
              return socket.emit('error', { message: '서버 오류가 발생했습니다.' });
            }
            
            if (existing.length > 0) {
              // 기존 레코드 업데이트
              const updateSQL = `
                UPDATE LocationSharing 
                SET status = 'active', start_time = NOW(), end_time = ?
                WHERE sharer_id = ? AND sharee_id = ?
              `;
              
              db.query(updateSQL, [endTime, sharerId, shareeId], (updateErr) => {
                if (updateErr) {
                  console.error('위치 공유 업데이트 오류:', updateErr);
                  return socket.emit('error', { message: '위치 공유 설정에 실패했습니다.' });
                }
                
                console.log(`위치 공유 업데이트 성공: ${sharerId} -> ${shareeId}`);
                
                // 성공 응답
                socket.emit('location_sharing_started_success', {
                  friend_id: shareeId,
                  duration_minutes: duration_minutes,
                  timestamp: new Date()
                });
                
                // 친구에게 알림
                const friendSocketId = connectedUsers.get(shareeId);
                if (friendSocketId) {
                  io.to(friendSocketId).emit('location_sharing_started', {
                    user_id: sharerId,
                    duration_minutes: duration_minutes,
                    timestamp: new Date()
                  });
                }
              });
            } else {
              // 새 레코드 생성
              const insertSQL = `
                INSERT INTO LocationSharing (sharer_id, sharee_id, status, start_time, end_time) 
                VALUES (?, ?, 'active', NOW(), ?)
              `;
              
              db.query(insertSQL, [sharerId, shareeId, endTime], (insertErr) => {
                if (insertErr) {
                  console.error('위치 공유 생성 오류:', insertErr);
                  return socket.emit('error', { message: '위치 공유 설정에 실패했습니다.' });
                }
                
                console.log(`위치 공유 생성 성공: ${sharerId} -> ${shareeId}`);
                
                // 성공 응답
                socket.emit('location_sharing_started_success', {
                  friend_id: shareeId,
                  duration_minutes: duration_minutes,
                  timestamp: new Date()
                });
                
                // 친구에게 알림
                const friendSocketId = connectedUsers.get(shareeId);
                if (friendSocketId) {
                  io.to(friendSocketId).emit('location_sharing_started', {
                    user_id: sharerId,
                    duration_minutes: duration_minutes,
                    timestamp: new Date()
                  });
                }
              });
            }
          });
        }
      });
    });
    
    // 위치 공유 종료 이벤트 처리
    socket.on('stop_location_sharing', (friend_id) => {
      if (!friend_id) {
        return socket.emit('error', { message: '친구 ID는 필수 입력값입니다.' });
      }
      
      console.log(`위치 공유 종료 요청: ${userId} -> ${friend_id}`);
      
      // 차단 상태 확인
      checkBlockStatus(userId, friend_id, (userBlockedFriend, friendBlockedUser) => {
        if (userBlockedFriend || friendBlockedUser) {
          console.log(`위치 공유 종료 차단됨: ${userId} -> ${friend_id} (차단 상태)`);
          return socket.emit('error', { message: '위치 공유 종료 권한이 없습니다.' });
        }
        
        const terminateSharingSQL = `
          UPDATE LocationSharing 
          SET status = 'inactive', end_time = NOW()
          WHERE sharer_id = ? AND sharee_id = ?
          AND status = 'active'
        `;
        
        db.query(terminateSharingSQL, [userId, friend_id], (err, result) => {
          if (err) {
            console.error('위치 공유 종료 오류:', err);
            return socket.emit('error', { message: '위치 공유 종료에 실패했습니다.' });
          }
          
          if (result.affectedRows === 0) {
            return socket.emit('error', { message: '위치 공유 종료 실패: 업데이트된 레코드가 없습니다.' });
          }
          
          const friendSocketId = connectedUsers.get(friend_id);
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

    // 따라가기 요청 관련 이벤트들
    socket.on('send_follow_request', (data) => {
      const { friend_id } = data;
      console.log(`따라가기 요청 수신: ${userId} -> ${friend_id}`);
      
      if (!friend_id) {
        return socket.emit('error', { message: '친구 ID는 필수 입력값입니다.' });
      }

      // 친구 관계 및 차단 상태 확인
      checkBlockStatus(userId, friend_id, (senderBlockedRecipient, recipientBlockedSender) => {
        if (senderBlockedRecipient || recipientBlockedSender) {
          console.log(`따라가기 요청 차단됨: ${userId} -> ${friend_id} (차단 상태)`);
          return socket.emit('error', { message: '따라가기 요청을 보낼 수 없습니다.' });
        }

        // 사용자 정보 가져오기
        const sql = `SELECT user_name, user_nickname FROM Users WHERE user_id = ?`;
        
        db.query(sql, [userId], (err, results) => {
          if (err || results.length === 0) {
            return socket.emit('error', { message: '사용자 정보를 가져오는데 실패했습니다.' });
          }
          
          const sender = results[0];
          const friendSocketId = connectedUsers.get(friend_id);
          
          // 친구가 온라인이면 실시간 알림
          if (friendSocketId) {
            io.to(friendSocketId).emit('follow_request_received', {
              requester_id: userId,
              requester_name: sender.user_name,
              target_id: friend_id,
              timestamp: new Date()
            });
          }
          
          socket.emit('follow_request_sent_success', {
            friend_id,
            timestamp: new Date()
          });
        });
      });
    });

    socket.on('respond_follow_request', (data) => {
      const { request_id, response } = data; // response: 'accept' or 'reject'
      console.log(`따라가기 요청 응답: 요청ID ${request_id}, 응답: ${response}`);
      
      if (!request_id || !response) {
        return socket.emit('error', { message: '요청 ID와 응답은 필수 입력값입니다.' });
      }

      if (!['accept', 'reject'].includes(response)) {
        return socket.emit('error', { message: '올바르지 않은 응답입니다.' });
      }

      // 요청자 정보 가져오기 (DB에서 request_id로 조회)
      const sql = `
        SELECT fr.requester_id, u.user_name, u.user_nickname
        FROM FollowRequests fr
        JOIN Users u ON fr.requester_id = u.user_id
        WHERE fr.follow_request_id = ? AND fr.target_id = ?
      `;
      
      db.query(sql, [request_id, userId], (err, results) => {
        if (err || results.length === 0) {
          return socket.emit('error', { message: '유효하지 않은 요청입니다.' });
        }
        
        const request = results[0];
        const requesterSocketId = connectedUsers.get(request.requester_id);
        
        // 요청자가 온라인이면 실시간 알림
        if (requesterSocketId) {
          io.to(requesterSocketId).emit('follow_request_responded', {
            request_id: request_id,
            requester_id: request.requester_id,
            target_id: userId,
            target_name: socket.user.name,
            response: response,
            status: response === 'accept' ? 'accepted' : 'cancelled',
            timestamp: new Date()
          });
        }
        
        socket.emit('follow_response_sent_success', {
          request_id,
          response,
          timestamp: new Date()
        });
      });
    });

    socket.on('cancel_follow_request', (data) => {
      const { friend_id } = data;
      console.log(`따라가기 요청 취소: ${userId} -> ${friend_id}`);
      
      if (!friend_id) {
        return socket.emit('error', { message: '친구 ID는 필수 입력값입니다.' });
      }

      const friendSocketId = connectedUsers.get(friend_id);
      
      // 친구가 온라인이면 실시간 알림
      if (friendSocketId) {
        io.to(friendSocketId).emit('follow_request_cancelled', {
          requester_id: userId,
          requester_name: socket.user.name,
          target_id: friend_id,
          timestamp: new Date()
        });
      }
      
      socket.emit('follow_request_cancelled_success', {
        friend_id,
        timestamp: new Date()
      });
    });

    socket.on('stop_following', (data) => {
      const { friend_id } = data;
      console.log(`따라가기 중단: ${userId} -> ${friend_id}`);
      
      if (!friend_id) {
        return socket.emit('error', { message: '친구 ID는 필수 입력값입니다.' });
      }

      const friendSocketId = connectedUsers.get(friend_id);
      
      // 친구가 온라인이면 실시간 알림
      if (friendSocketId) {
        io.to(friendSocketId).emit('follow_stopped', {
          stopped_by: userId,
          stopped_by_name: socket.user.name,
          other_user_id: friend_id,
          timestamp: new Date()
        });
      }
      
      socket.emit('follow_stopped_success', {
        friend_id,
        timestamp: new Date()
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