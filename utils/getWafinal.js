// utils/getWAfinal.js
function getWAfinal(receiverWA, senderWA) {
    if (!receiverWA) return null;
    const final = receiverWA.includes('@') ? receiverWA : receiverWA + '@c.us';
    if (final === senderWA + '@c.us') return null; // mencegah kirim ke diri sendiri
    return final;
}

module.exports = getWAfinal;
