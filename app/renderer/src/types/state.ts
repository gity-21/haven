/**
 * state.ts — Frontend Uygulama Durum Tipleri
 *
 * AppState: Ana uygulama durumu (soket, kullanıcı bilgileri, oda vs.)
 * VoiceState: Sesli/görüntülü arama durumu (WebRTC peers, streams)
 */

import type { Socket } from 'socket.io-client';
import type { OnlineUser } from './socket-events';

export interface ReplyTarget {
    id: number | string;
    username: string;
    content: string;
}

export interface AppState {
    socket: Socket | null;
    userId: string;
    userSecret: string;
    nickname: string;
    roomKey: string;
    avatarColor: string;
    profilePic: string | null;
    authKey: string | null;
    roomPassword: string | null;
    joinMode: 'create' | 'join';
    serverUrl: string;
    users: OnlineUser[];
    lastMessageUserId: string | null;
    lastMessageTime: number | null;
    lastMessageDateString: string | null;
    replyingTo: ReplyTarget | null;
    adminToken: string | null;
    pendingImages: Blob[];
    currentPreviewIndex: number;
    viewOnceEnabled: boolean;
    _typingTimeout?: ReturnType<typeof setTimeout>;
    _lastTypingEmit?: number;
    _isTyping?: boolean;
    isSelfDestructText: boolean;
    editingMessageId: string | number | null;
}

export interface NoiseGateRefs {
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    analyser: AnalyserNode;
    gainNode: GainNode;
    destination: MediaStreamAudioDestinationNode;
}

export interface VoiceState {
    localStream: MediaStream | null;
    screenStream: MediaStream | null;
    peers: Record<string, RTCPeerConnection>;
    isInVoice: boolean;
    isVideoOn: boolean;
    isScreenOn: boolean;
    isMicOn: boolean;
    _noiseGate?: NoiseGateRefs;
}

export interface VolumeMeterEntry {
    source: MediaStreamAudioSourceNode;
    analyser: AnalyserNode;
    animationFrame: number;
}

/** Sunucudan gelen ve şifresi çözülmüş dosya mesajı içeriği */
export interface FileMessageContent {
    url: string;
    filename: string;
    mimetype: string;
    size?: number;
}

/** P2P dosya duyurusu içeriği */
export interface P2PAnnounceContent {
    fileId: string;
    filename: string;
    size: number;
    senderId: string;
    senderName: string;
}
