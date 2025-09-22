// Load environment variables from .env file
require('dotenv').config();

// Import the Bolt framework
const { App } = require('@slack/bolt');

// Initialize your app with your bot token and signing secret
const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  token: process.env.SLACK_BOT_TOKEN
});

// A helper function to find the user ID from a mention string (e.g., "<@U123456789>")
const extractUserId = (mention) => {
  // Regex to match a Slack user ID from a mention string
  const match = mention.match(/<@([A-Z0-9]+)>/);
  return match ? match[1] : null;
};

// Listen for the /channel-list slash command
app.command('/channel-list', async ({ ack, say, command }) => {
  // Acknowledge the command right away to prevent a timeout error
  await ack();

  try {
    // Trim the text from the command and split it by spaces
    const users = command.text.trim().split(/\s+/);
    
    // An array to store the IDs of the users to be processed
    const userIds = users.map(extractUserId).filter(id => id !== null);

    // If no users are mentioned, respond with the usage hint
    if (userIds.length === 0) {
      await say({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Please specify one or two users to get their channel list. \n\n*Usage:* \`/channel-list @user1 [@user2]\``
            }
          }
        ],
        text: `Please specify one or two users to get their channel list. Usage: /channel-list @user1 [@user2]`
      });
      return;
    }

    // Get the user information for all mentioned users
    const userInfo = await Promise.all(userIds.map(async (id) => {
      const response = await app.client.users.info({ user: id });
      return response.user;
    }));

    // Function to fetch all channels a user is in, handling pagination
    const fetchUserChannels = async (userId) => {
      let allChannels = [];
      let cursor = null;
      do {
        const result = await app.client.users.conversations({
          user: userId,
          types: 'public_channel,private_channel',
          limit: 100, // Fetch up to 100 channels at a time
          cursor: cursor
        });
        allChannels = allChannels.concat(result.channels);
        cursor = result.response_metadata ? result.response_metadata.next_cursor : null;
      } while (cursor);
      return allChannels;
    };

    // --- Scenario 1: One User ---
    if (userIds.length === 1) {
      const user1Info = userInfo[0];
      const channels = await fetchUserChannels(user1Info.id);
      
      // Build a simple markdown list of all channels
      const channelList = channels.map(c => `- #${c.name}`).join('\n');
      
      const messageBlocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Here is the list of channels for ${user1Info.real_name}:*\n\nTotal Channels: ${channels.length}\n\n${channelList}`
          }
        }
      ];

      await say({ blocks: messageBlocks, text: `Channel list for ${user1Info.real_name}.` });
    } 
    // --- Scenario 2: Two Users ---
    else if (userIds.length === 2) {
      const user1Info = userInfo[0];
      const user2Info = userInfo[1];

      // Fetch channels for both users concurrently
      const [channels1, channels2] = await Promise.all([
        fetchUserChannels(user1Info.id),
        fetchUserChannels(user2Info.id)
      ]);

      const channels1Ids = new Set(channels1.map(c => c.id));
      const channels2Ids = new Set(channels2.map(c => c.id));

      const sharedChannels = channels1.filter(c => channels2Ids.has(c.id));
      const user1UniqueChannels = channels1.filter(c => !channels2Ids.has(c.id));
      const user2UniqueChannels = channels2.filter(c => !channels1Ids.has(c.id));

      const getChannelText = (channel) => {
        const link = `<#${channel.id}|${channel.name}>`;
        return `- ${link}`;
      };

      const sharedChannelList = sharedChannels.length > 0
        ? sharedChannels.map(getChannelText).join('\n')
        : "No shared channels found.";
      
      const user1UniqueList = user1UniqueChannels.length > 0
        ? user1UniqueChannels.map(getChannelText).join('\n')
        : `${user1Info.real_name} has no unique channels.`;
        
      const user2UniqueList = user2UniqueChannels.length > 0
        ? user2UniqueChannels.map(getChannelText).join('\n')
        : `${user2Info.real_name} has no unique channels.`;
        
      const messageBlocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Channel Membership Report for ${user1Info.real_name} and ${user2Info.real_name}*`
          }
        },
        {
          type: "divider"
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Total Channels:* ${channels1.length} for ${user1Info.real_name}, ${channels2.length} for ${user2Info.real_name}\n*Shared Channels:* ${sharedChannels.length}\n*Unique Channels:* ${user1UniqueChannels.length} for ${user1Info.real_name}, ${user2UniqueChannels.length} for ${user2Info.real_name}`
          }
        },
        {
          type: "divider"
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Shared Channels*\n${sharedChannelList}`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Channels Unique to ${user1Info.real_name}*\n${user1UniqueList}`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Channels Unique to ${user2Info.real_name}*\n${user2UniqueList}`
          }
        }
      ];

      await say({ blocks: messageBlocks, text: "Channel membership report." });
    } else {
      // More than two users mentioned
      await say({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `This command supports a maximum of two users. \n\n*Usage:* \`/channel-list @user1 [@user2]\``
            }
          }
        ],
        text: "This command supports a maximum of two users."
      });
    }

  } catch (error) {
    console.error(`Failed to execute command: ${error}`);
    await say({
      text: `An error occurred while processing your request. Please check the permissions and try again. Error: ${error.message}`
    });
  }
});

(async () => {
  // Start the app
  await app.start(process.env.PORT || 3000);

  console.log('⚡️ Bolt app is running!');
})();
