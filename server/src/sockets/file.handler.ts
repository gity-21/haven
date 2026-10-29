/**
 * server/src/sockets/file.handler.ts — WebRTC P2P Dosya Sinyalleşme Olayları
 *
 * Eşler arası (P2P) dosya transferi için WebRTC offer, answer ve ICE candidate sinyallerini iletir.
 */

import { Server } from 'socket.io';
import { HavenSocket, P2PFileOfferPayload, P2PFileAnswerPayload, P2PFileCandidatePayload } from '../types';

export function registerFileHandlers(io: Server, socket: HavenSocket): void {
    // P2P Dosya Teklifi (Offer)
    socket.on('p2p-file-offer', (data: P2PFileOfferPayload) => {
        io.to(data.targetId).emit('p2p-file-offer', {
            senderId: socket.id,
            senderName: socket.nickname,
            offer: data.offer,
            fileMeta: data.fileMeta
        });
    });

    // P2P Dosya Yanıtı (Answer)
    socket.on('p2p-file-answer', (data: P2PFileAnswerPayload) => {
        io.to(data.targetId).emit('p2p-file-answer', {
            senderId: socket.id,
            answer: data.answer,
            fileId: data.fileId
        });
    });

    // P2P Dosya ICE Adayı (Candidate)
    socket.on('p2p-file-candidate', (data: P2PFileCandidatePayload) => {
        io.to(data.targetId).emit('p2p-file-candidate', {
            senderId: socket.id,
            candidate: data.candidate,
            fileId: data.fileId
        });
    });
}

