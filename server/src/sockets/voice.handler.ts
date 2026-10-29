/**
 * server/src/sockets/voice.handler.ts — Sesli & Görüntülü Arama / WebRTC Sinyalleşmesi
 *
 * Oda içi sesli kanal katılımı, mikrofon durumu, WebRTC SDP offer/answer/candidate ve ekran paylaşımı.
 */

import { Server } from 'socket.io';
import {
    HavenSocket,
    WebRTCOfferPayload,
    WebRTCAnswerPayload,
    WebRTCCandidatePayload,
    ScreenShareStatePayload,
    VoiceCallDeclinedPayload,
    RingingData
} from '../types';
import { activeRinging, activeVoiceUsers } from '../services/room.service';

export function registerVoiceHandlers(io: Server, socket: HavenSocket): void {
    // Sesli kanala katıl
    socket.on('voice-join', (data?: { isMicOn?: boolean }) => {
        if (!socket.roomKey) return;

        if (activeRinging.has(socket.roomKey)) {
            activeRinging.delete(socket.roomKey);
            io.to(socket.roomKey).emit('call-answered');
        }

        if (!activeVoiceUsers.has(socket.roomKey)) {
            activeVoiceUsers.set(socket.roomKey, new Map());
        }
        activeVoiceUsers.get(socket.roomKey)!.set(socket.id, {
            userId: socket.id,
            username: socket.nickname!,
            avatarColor: socket.avatarColor!,
            profilePic: socket.profilePic || null,
            isMicOn: !!(data?.isMicOn)
        });

        io.to(socket.roomKey).emit('active-voice-users',
            Array.from(activeVoiceUsers.get(socket.roomKey)!.values())
        );

        socket.to(socket.roomKey).emit('voice-join', {
            userId: socket.id,
            username: socket.nickname,
            avatarColor: socket.avatarColor,
            profilePic: socket.profilePic,
            isMicOn: !!(data?.isMicOn)
        });
    });

    // Sesli kanaldan ayrıl
    socket.on('voice-leave', () => {
        if (!socket.roomKey) return;

        const voiceUsers = activeVoiceUsers.get(socket.roomKey);
        if (voiceUsers) {
            voiceUsers.delete(socket.id);
            if (voiceUsers.size === 0) {
                activeVoiceUsers.delete(socket.roomKey);
                activeRinging.delete(socket.roomKey);
            }
            io.to(socket.roomKey).emit('active-voice-users',
                Array.from((activeVoiceUsers.get(socket.roomKey) || new Map()).values())
            );
        }

        socket.to(socket.roomKey).emit('voice-leave', {
            userId: socket.id,
            username: socket.nickname
        });
    });

    // Mikrofon durumu
    socket.on('mic-state', (data: { isMicOn: boolean }) => {
        if (!socket.roomKey) return;
        const users = activeVoiceUsers.get(socket.roomKey);
        if (users) {
            const user = users.get(socket.id);
            if (user) user.isMicOn = !!data.isMicOn;
        }
        socket.to(socket.roomKey).emit('user-mic-state', {
            userId: socket.id,
            isMicOn: !!data.isMicOn
        });
    });

    // Arama reddedildi
    socket.on('voice-call-declined', (data: VoiceCallDeclinedPayload) => {
        if (!socket.roomKey) return;
        socket.to(socket.roomKey).emit('voice-call-declined', {
            username: data.username
        });
    });

    // Odayı çaldır (Voice Call Room)
    socket.on('voice-call-room', () => {
        if (!socket.roomKey) return;
        const ringingData: RingingData = {
            callerId: socket.id,
            callerName: socket.nickname!,
            avatarColor: socket.avatarColor!,
            profilePic: socket.profilePic || null
        };
        activeRinging.set(socket.roomKey, ringingData);
        socket.to(socket.roomKey).emit('room-is-ringing', ringingData);
    });

    // Arama sonlandı
    socket.on('call-ended', () => {
        if (!socket.roomKey) return;
        activeRinging.delete(socket.roomKey);
        const voiceUsers = activeVoiceUsers.get(socket.roomKey);
        if (voiceUsers) {
            voiceUsers.delete(socket.id);
            if (voiceUsers.size === 0) {
                activeVoiceUsers.delete(socket.roomKey);
            }
            io.to(socket.roomKey).emit('active-voice-users',
                Array.from((activeVoiceUsers.get(socket.roomKey) || new Map()).values())
            );
        }
    });

    // WebRTC: SDP Offer
    socket.on('webrtc-offer', (data: WebRTCOfferPayload) => {
        io.to(data.targetId).emit('webrtc-offer', {
            senderId: socket.id,
            senderName: socket.nickname,
            offer: data.offer
        });
    });

    // WebRTC: SDP Answer
    socket.on('webrtc-answer', (data: WebRTCAnswerPayload) => {
        io.to(data.targetId).emit('webrtc-answer', {
            senderId: socket.id,
            answer: data.answer
        });
    });

    // WebRTC: ICE Candidate
    socket.on('webrtc-candidate', (data: WebRTCCandidatePayload) => {
        io.to(data.targetId).emit('webrtc-candidate', {
            senderId: socket.id,
            candidate: data.candidate
        });
    });

    // Ekran Paylaşımı
    socket.on('screen-share-state', (data: ScreenShareStatePayload) => {
        if (!socket.roomKey) return;
        socket.to(socket.roomKey).emit('screen-share-state', {
            userId: socket.id,
            username: socket.nickname,
            isSharing: !!data.isSharing
        });
    });
}
