// app.js — Slack App (Socket Mode on Render as Background Worker)
require('dotenv').config();
const { App } = require('@slack/bolt');

/**
 * Socket Mode requires an App-Level Token (xapp-...) with scope `connections:write`.
 * Deploy on Render as a Background Worker. No HTTP server, no PORT binding.
 * 
 * ENV VARS required:
 * - SLACK_BOT_TOKEN  (xoxb-...)
 * - SLACK_APP_TOKEN  (xapp-... with connections:write)
 */

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true
});

// ---------- Helpers ----------
const extractUserId = (mention) => {
  const match = mention.match(/<@([A-Z0-9]+)>/);
  return match ? match[1] : null;
};

// ---------- Slash Command: /channel-list ----------
app.command('/channel-list', async ({ ack, say, command }) => {
  await ack();

  try {
    const users = (command.text || '').trim().split(/\s+/).filter(Boolean);
    const userIds = users.map(extractUserId).filter(Boolean);

    if (userIds.length === 0 || userIds.length > 2) {
      await say({
        blocks: [{
          type: "section",
          text: { type: "mrkdwn",
            text: `Please specify *one or two* users.\n\n*Usage:* \`/channel-list @user1 [@user2]\``
          }
        }],
        text: `Please specify one or two users. Usage: /channel-list @user1 [@user2]`
      });
      return;
    }

    const userInfo = await Promise.all(userIds.map(async (id) => {
      const response = await app.client.users.info({ user: id });
      return response.user;
    }));

    const fetchUserChannels = async (userId) => {
      let all = []; let cursor;
      do {
        const res = await app.client.users.conversations({
          user: userId,
          types: 'public_channel,private_channel',
          limit: 100,
          cursor
        });
        all = all.concat(res.channels || []);
        cursor = res.response_metadata?.next_cursor || null;
      } while (cursor);
      return all;
    };

    if (userIds.length === 1) {
      const [u1] = userInfo;
      const ch = await fetchUserChannels(u1.id);
      const list = ch.map(c => `- <#${c.id}|${c.name}>`).join('\n');
      await say({
        blocks: [{
          type: "section",
          text: { type: "mrkdwn",
            text: `*Channels for ${u1.real_name || u1.name}:*\n\n*Total:* ${ch.length}\n\n${list || '_No channels found._'}`
          }
        }],
        text: `Channel list for ${u1.real_name || u1.name}.`
      });
    } else {
      const [u1, u2] = userInfo;
      const [c1, c2] = await Promise.all([fetchUserChannels(u1.id), fetchUserChannels(u2.id)]);
      const s1 = new Set(c1.map(c => c.id));
      const s2 = new Set(c2.map(c => c.id));
      const shared = c1.filter(c => s2.has(c.id));
      const u1Only = c1.filter(c => !s2.has(c.id));
      const u2Only = c2.filter(c => !s1.has(c.id));
      const link = (c) => `- <#${c.id}|${c.name}>`;

      await say({
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `*Channel Membership Report for ${u1.real_name || u1.name} and ${u2.real_name || u2.name}*` } },
          { type: "divider" },
          { type: "section", text: { type: "mrkdwn", text:
            `*Totals:* ${c1.length} for ${u1.real_name || u1.name}, ${c2.length} for ${u2.real_name || u2.name}\n*Shared:* ${shared.length}\n*Unique:* ${u1Only.length} vs ${u2Only.length}` } },
          { type: "divider" },
          { type: "section", text: { type: "mrkdwn", text: `*Shared Channels*\n${shared.length ? shared.map(link).join('\n') : '_No shared channels found._'}` } },
          { type: "section", text: { type: "mrkdwn", text: `*Unique to ${u1.real_name || u1.name}*\n${u1Only.length ? u1Only.map(link).join('\n') : `_${u1.real_name || u1.name} has no unique channels._`}` } },
          { type: "section", text: { type: "mrkdwn", text: `*Unique to ${u2.real_name || u2.name}*\n${u2Only.length ? u2Only.map(link).join('\n') : `_${u2.real_name || u2.name} has no unique channels._`}` } }
        ],
        text: "Channel membership report."
      });
    }
  } catch (err) {
    console.error(err);
    await say({ text: `An error occurred: ${err.message}` });
  }
});

// ---------- Start Socket Mode (no PORT) ----------
(async () => {
  await app.start();
  console.log('⚡️ Socket Mode app is running');
})();
