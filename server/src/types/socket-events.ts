/**
 * server/src/types/socket-events.ts — Socket.IO Event Payload Tipleri
 *
 * Client ↔ Server arasındaki tüm Socket.IO event'lerinin veri yapıları.
 */

// ═══════════════════════════════════════════════
// Client → Server Event Payloadları
// ═══════════════════════════════════════════════

export interface JoinRoomPayload {
    userId: string;
    userSecret: string;
    nickname: string;
    roomKey: string;
    avatarColor: string;
    profilePic: string | null;
    authKey: string;
    mode: 'create' | 'join';
}

export interface SendMessagePayload {
    content: string;
    type: 'message' | 'file' | 'p2p-announce';
    replyTo: number | null;
}

export interface UpdateProfilePayload {
    oldNickname: string;
    nickname: string;
    avatarColor: string;
    profilePic: string | null;
}

export interface TypingPayload {
    isTyping: boolean;
}

export interface DeleteMessagePayload {
    messageId: number;
    roomId?: string;
}

export interface EditMessagePayload {
    messageId: number;
    newContent: string;
}

export interface ToggleReactionPayload {
    messageId: number;
    emoji: string;
}

// ═══════════════════════════════════════════════
// WebRTC Sinyalleme Payloadları
// ═══════════════════════════════════════════════

export interface WebRTCOfferPayload {
    targetId: string;
    offer: RTCSessionDescriptionInit;
}

export interface WebRTCAnswerPayload {
    targetId: string;
    answer: RTCSessionDescriptionInit;
}

export interface WebRTCCandidatePayload {
    targetId: string;
    candidate: RTCIceCandidateInit;
}

// ═══════════════════════════════════════════════
// P2P Dosya Transfer Payloadları
// ═══════════════════════════════════════════════

export interface P2PFileOfferPayload {
    targetId: string;
    offer: RTCSessionDescriptionInit;
    fileMeta: { fileId: string };
}

export interface P2PFileAnswerPayload {
    targetId: string;
    answer: RTCSessionDescriptionInit;
    fileId: string;
}

export interface P2PFileCandidatePayload {
    targetId: string;
    candidate: RTCIceCandidateInit;
    fileId: string;
}

// ═══════════════════════════════════════════════
// Ses/Görüntülü Arama Payloadları
// ═══════════════════════════════════════════════

export interface VoiceJoinPayload {
    userId: string;
    username: string;
    avatarColor: string;
    profilePic: string | null;
}

export interface VoiceCallDeclinedPayload {
    username: string;
}

export interface ScreenShareStatePayload {
    isSharing: boolean;
}

// ═══════════════════════════════════════════════
// Server → Client Event Payloadları
// ═══════════════════════════════════════════════

export interface OnlineUser {
    username: string;
    avatarColor: string;
    profilePic: string | null;
    id: string;
}

export interface NewMessageData {
    id: number;
    roomId: string;
    username: string;
    avatarColor: string;
    profile_pic: string | null;
    user_id: string | null;
    content: string;
    type: 'message' | 'file' | 'p2p-announce';
    reply_to: number | null;
    reply_username: string | null;
    reply_content: string | null;
    reactions: string;
    created_at: string;
    is_pinned?: boolean | number;
}

export interface RingingData {
    callerId: string;
    callerName: string;
    avatarColor: string;
    profilePic: string | null;
}

export interface VoiceUserData {
    userId: string;
    username: string;
    avatarColor: string;
    profilePic: string | null;
    isMicOn?: boolean;
}

export interface UsernameChangedData {
    oldUsername: string;
    newUsername: string;
    avatarColor: string;
    profilePic: string | null;
    userId: string;
}

export interface E2EESaltData {
    salt: string | null;
}

export interface ReactionUpdateData {
    messageId: number;
    reactions: string;
}

export interface WebRTCOfferIncoming {
    senderId: string;
    senderName: string;
    offer: RTCSessionDescriptionInit;
}

export interface WebRTCAnswerIncoming {
    senderId: string;
    answer: RTCSessionDescriptionInit;
}

export interface WebRTCCandidateIncoming {
    senderId: string;
    candidate: RTCIceCandidateInit;
}

export interface P2PFileOfferIncoming {
    senderId: string;
    senderName: string;
    offer: RTCSessionDescriptionInit;
    fileMeta: { fileId: string };
}

export interface P2PFileAnswerIncoming {
    senderId: string;
    answer: RTCSessionDescriptionInit;
    fileId: string;
}

export interface P2PFileCandidateIncoming {
    senderId: string;
    candidate: RTCIceCandidateInit;
    fileId: string;
}

export interface MessageDeletedData {
    messageId: number;
}

export interface MessageEditedData {
    messageId: number;
    newContent: string;
}

export interface UserKickedData {
    reason: string;
}

export interface RoomDestroyedData {
    reason: string;
}

/** Server'ın soket bağlantısında sakladığı metadata */
export interface SocketUserData {
    username: string;
    room: string;
    avatarColor: string;
    profilePic: string | null;
    userId: string;
    userSecret: string;
}
