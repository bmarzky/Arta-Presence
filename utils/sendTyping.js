// sendTyping.js
async function sendTyping(chat, message, typingTime = 1000) {
    await chat.sendStateTyping();
    await new Promise(res => setTimeout(res, typingTime));
    return chat.sendMessage(message);
}

module.exports = { sendTyping };