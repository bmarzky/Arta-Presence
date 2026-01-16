//sendTypingPerChar.js
module.exports = async function sendTypingPerChar(chat, text, delay = 50) {
    let current = '';
    for (const char of text) {
        current += char;
        await chat.sendStateTyping?.();
        await new Promise(res => setTimeout(res, delay));
    }
    // Kirim pesan utuh di akhir
    await chat.sendMessage(text);
};
