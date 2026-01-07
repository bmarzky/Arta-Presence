// utils/getWAfinal.js
function getWAfinal(receiverWA, senderWA) {
    if (!receiverWA) return null;
    const final = receiverWA.includes('@') ? receiverWA : receiverWA + '@c.us';
    if (final === senderWA + '@c.us') return null;
    return final;
}

module.exports = getWAfinal;
