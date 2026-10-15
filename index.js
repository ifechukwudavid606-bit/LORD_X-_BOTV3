const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const config = require('./config');

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    // Connection Updates & Pairing Code Request
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !sock.authState.creds.registered) {
            try {
                // Pass custom code if exactly 8 characters, otherwise standard request
                let code;
                if (config.customPairingCode && config.customPairingCode.length === 8) {
                    code = await sock.requestPairingCode(config.ownerNumber, config.customPairingCode);
                } else {
                    code = await sock.requestPairingCode(config.ownerNumber);
                }

                console.log(`\n========================================`);
                console.log(`🔑 PAIRING CODE FOR ${config.botName}:${code}`);
                console.log(`========================================\n`);
            } catch (err) {
                console.error("Error generating pairing code:", err);
            }
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log(`\n🚀 ${config.botName} IS ONLINE AND ACTIVE!`);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Message Listener (Public & Owner Commands)
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        
        const sender = isGroup ? (msg.key.participant || msg.participant) : from;
        const senderNumber = sender ? sender.split('@')[0] : '';
        const isOwner = senderNumber === config.ownerNumber;

        const type = Object.keys(msg.message)[0];
        const body = (type === 'conversation') ? msg.message.conversation :
                     (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text : '';

        if (!body.startsWith(config.prefix)) return;

        const args = body.slice(config.prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        switch (command) {

            // --- MAIN & GENERAL COMMANDS ---
            case 'ping':
                await sock.sendMessage(from, { text: '🏓 Pong! LORD X BOT is active.' }, { quoted: msg });
                break;

            case 'alive':
            case 'runtime':
                await sock.sendMessage(from, { text: `⚡ *${config.botName}* is online and functioning!` }, { quoted: msg });
                break;

            case 'menu':
            case 'help':
                const menuText = `
╭─🏠 *${config.botName}*
│ • Prefix: [ ${config.prefix} ]
│ • Status: Active (Public)
╰───────────────⭓

╭─🏠 MAIN
│ • menu • ping • alive • runtime • repo • owner
╰───────────────⭓

╭─🤖 AI
│ • gpt • gemini • llama • chatbot
╰───────────────⭓

╭─📥 DOWNLOADER
│ • play • ytmp3 • ytmp4 • instagram • tiktok
╰───────────────⭓

╭─ℹ️ INFO
│ • google • wikipedia • weather • jid
╰───────────────⭓

╭─🛠️ TOOLS
│ • vv • translate • shorturl • calc • qr
╰───────────────⭓

╭─🎭 FUN
│ • joke • truth • dare • roast • meme
╰───────────────⭓

╭─👥 GROUP-ADMIN
│ • welcome • gcstatus • tagall • hidetag • kick • promote • demote
╰───────────────⭓

╭─👑 OWNER
│ • broadcaster • setprefix • ban • unban
╰───────────────⭓
`;
                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                break;

            case 'owner':
                await sock.sendMessage(from, { text: `👑 *Bot Owner:* https://wa.me/${config.ownerNumber}` }, { quoted: msg });
                break;

            case 'jid':
                await sock.sendMessage(from, { text: `🆔 *Your JID:* ${sender}` }, { quoted: msg });
                break;

            // --- VIEW ONCE COMMAND (/vv) ---
            case 'vv':
            case 'viewonce':
            case 'retrieve':
                const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

                if (!quotedMsg) {
                    await sock.sendMessage(from, { text: `⚠️ Reply to a View Once message using \`${config.prefix}vv\`` }, { quoted: msg });
                    return;
                }

                const viewOnceContent = quotedMsg.viewOnceMessageV2?.message || 
                                        quotedMsg.viewOnceMessage?.message || 
                                        quotedMsg;

                const isImage = viewOnceContent.imageMessage;
                const isVideo = viewOnceContent.videoMessage;
                const isAudio = viewOnceContent.audioMessage;

                if (!isImage && !isVideo && !isAudio) {
                    await sock.sendMessage(from, { text: '❌ Quoted message is not a valid View Once media file!' }, { quoted: msg });
                    return;
                }

                try {
                    await sock.sendMessage(from, { text: '🔄 Extracting View Once media...' }, { quoted: msg });

                    let mediaType = isImage ? 'image' : isVideo ? 'video' : 'audio';
                    let targetMessage = isImage || isVideo || isAudio;

                    const stream = await downloadContentFromMessage(targetMessage, mediaType);
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    if (isImage) {
                        await sock.sendMessage(from, { image: buffer, caption: '🔓 *LORD X BOT* — Revealed View Once Image' }, { quoted: msg });
                    } else if (isVideo) {
                        await sock.sendMessage(from, { video: buffer, caption: '🔓 *LORD X BOT* — Revealed View Once Video' }, { quoted: msg });
                    } else if (isAudio) {
                        await sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mp4', ptt: true }, { quoted: msg });
                    }
                } catch (err) {
                    console.error("ViewOnce Error:", err);
                    await sock.sendMessage(from, { text: '❌ Failed to extract media. The media may have expired.' }, { quoted: msg });
                }
                break;

            // --- GROUP SETTINGS ---
            case 'welcome':
                if (!isGroup) {
                    await sock.sendMessage(from, { text: '❌ Group command only!' }, { quoted: msg });
                    return;
                }
                const opt = args[0]?.toLowerCase();
                if (opt === 'on') {
                    await sock.sendMessage(from, { text: '✅ Welcome messages enabled!' }, { quoted: msg });
                } else if (opt === 'off') {
                    await sock.sendMessage(from, { text: '❌ Welcome messages disabled!' }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: `Usage: ${config.prefix}welcome on/off` }, { quoted: msg });
                }
                break;

            case 'gcstatus':
                const link = args[0];
                if (!link) {
                    await sock.sendMessage(from, { text: `Provide link: ${config.prefix}gcstatus <link>` }, { quoted: msg });
                    return;
                }
                try {
                    const code = link.replace('https://chat.whatsapp.com/', '').trim();
                    const info = await sock.groupGetInviteInfo(code);
                    await sock.sendMessage(from, { text: `📊 *Group:* ${info.subject}\n👥 *Members:* ${info.size}` }, { quoted: msg });
                } catch {
                    await sock.sendMessage(from, { text: '❌ Invalid group link!' }, { quoted: msg });
                }
                break;

            // --- AI COMMANDS ---
            case 'gpt':
            case 'gemini':
            case 'llama':
                const query = args.join(" ");
                if (!query) {
                    await sock.sendMessage(from, { text: `Provide a prompt: ${config.prefix}${command} hello` }, { quoted: msg });
                    return;
                }
                await sock.sendMessage(from, { text: `🤖 AI Response for: "${query}"` }, { quoted: msg });
                break;

            // --- FUN COMMANDS ---
            case 'joke':
                try {
                    const res = await axios.get('https://official-joke-api.appspot.com/random_joke');
                    await sock.sendMessage(from, { text: `😂 ${res.data.setup}\n\n${res.data.punchline}` }, { quoted: msg });
                } catch {
                    await sock.sendMessage(from, { text: "Why don't skeletons fight? They don't have the guts!" }, { quoted: msg });
                }
                break;

            // --- OWNER COMMANDS ---
            case 'broadcaster':
            case 'setprefix':
                if (!isOwner) {
                    await sock.sendMessage(from, { text: '❌ Owner restricted command.' }, { quoted: msg });
                    return;
                }
                await sock.sendMessage(from, { text: '✅ Executed owner action.' }, { quoted: msg });
                break;

            default:
                break;
        }
    });
}

startBot();
